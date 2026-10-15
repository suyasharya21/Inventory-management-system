import Database from 'better-sqlite3';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { closeDatabase, getContext, getDatabase, getDatabasePath, initializeDatabase, writeAudit } from './db.mjs';

const MAGIC = Buffer.from('STOCKSENSE-BACKUP-V1\n', 'utf8');

export const backupService = {
  createBackup({ filePath, password }) {
    if (!filePath) throw new Error('Choose a backup file location.');
    if (!password || String(password).length < 8) throw new Error('Backup password must contain at least 8 characters.');
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    db.pragma('wal_checkpoint(TRUNCATE)');
    const source = readFileSync(getDatabasePath());
    const encrypted = encrypt(source, String(password));
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, encrypted);
    const size = statSync(filePath).size;
    db.transaction(() => {
      db.prepare(`
        INSERT INTO backup_records (business_id, file_name, file_path, status, encrypted, size_bytes, created_at)
        VALUES (?, ?, ?, 'complete', 1, ?, ?)
      `).run(businessId, basename(filePath), filePath, size, new Date().toISOString());
      writeAudit({
        db,
        businessId,
        user,
        action: 'create_backup',
        entityType: 'backup',
        before: {},
        after: { fileName: basename(filePath), encrypted: true, sizeBytes: size },
        reason: 'Encrypted local backup created',
        source: 'backup',
        correlationId: randomUUID(),
      });
    })();
    return { filePath, fileName: basename(filePath), encrypted: true, sizeBytes: size };
  },

  restoreBackup({ filePath, password }) {
    if (!filePath) throw new Error('Choose a backup file.');
    if (!password) throw new Error('Enter the backup password.');
    const decrypted = decrypt(readFileSync(filePath), String(password));
    const currentPath = getDatabasePath();
    const tempPath = `${currentPath}.restore-${Date.now()}`;
    writeFileSync(tempPath, decrypted);
    let validationDb;
    try {
      validationDb = new Database(tempPath, { readonly: true });
      const integrity = validationDb.pragma('integrity_check', { simple: true });
      const hasBusiness = validationDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'businesses'").get();
      if (integrity !== 'ok' || !hasBusiness) throw new Error('Backup database did not pass integrity checks.');
    } finally {
      validationDb?.close();
    }
    closeDatabase();
    const safetyPath = `${currentPath}.pre-restore-${Date.now()}`;
    copyFileSync(currentPath, safetyPath);
    renameSync(tempPath, currentPath);
    const db = initializeDatabase(currentPath);
    const { businessId, user } = getContext(db);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO backup_records (business_id, file_name, file_path, status, encrypted, size_bytes, created_at)
        VALUES (?, ?, ?, 'restored', 1, ?, ?)
      `).run(businessId, basename(filePath), filePath, statSync(filePath).size, new Date().toISOString());
      writeAudit({
        db,
        businessId,
        user,
        action: 'restore_backup',
        entityType: 'backup',
        before: { safetyCopy: safetyPath },
        after: { restoredFrom: basename(filePath) },
        reason: 'Encrypted backup restored locally',
        source: 'backup',
      });
    })();
    return { restored: true, fileName: basename(filePath), safetyCopy: safetyPath };
  },

  listBackups() {
    const db = getDatabase();
    const { businessId } = getContext(db);
    return db.prepare(`
      SELECT id, file_name AS fileName, file_path AS filePath, status, encrypted,
        size_bytes AS sizeBytes, created_at AS createdAt
      FROM backup_records WHERE business_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(businessId).map((row) => ({ ...row, id: Number(row.id), encrypted: Boolean(row.encrypted), sizeBytes: Number(row.sizeBytes) }));
  },

  markCloudUploaded({ localPath, driveFile }) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const cloudPath = `google-drive:${driveFile.id}`;
    db.transaction(() => {
      db.prepare(`
        UPDATE backup_records SET file_path = ?, status = 'google_drive'
        WHERE business_id = ? AND file_path = ?
      `).run(cloudPath, businessId, localPath);
      writeAudit({
        db,
        businessId,
        user,
        action: 'upload_backup',
        entityType: 'backup',
        after: { provider: 'Google Drive', fileName: driveFile.name, encrypted: true, driveFileId: driveFile.id },
        reason: 'Encrypted backup uploaded to Google Drive',
        source: 'backup',
        correlationId: randomUUID(),
      });
    })();
    return { fileName: driveFile.name, driveFileId: driveFile.id, webViewLink: driveFile.webViewLink, encrypted: true, provider: 'Google Drive' };
  },

  markCloudFailed({ localPath, error }) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    db.prepare(`
      UPDATE backup_records SET file_path = 'google-drive:upload-failed', status = 'google_drive_failed'
      WHERE business_id = ? AND file_path = ?
    `).run(businessId, localPath);
    return { status: 'google_drive_failed', message: String(error || 'Google Drive upload failed.') };
  },
};

function encrypt(plain, password) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const metadata = Buffer.from(JSON.stringify({
    version: 1,
    algorithm: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    createdAt: new Date().toISOString(),
  }), 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length, 0);
  return Buffer.concat([MAGIC, length, metadata, ciphertext]);
}

function decrypt(payload, password) {
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('This is not a supported StockSense backup.');
  const metadataLength = payload.readUInt32BE(MAGIC.length);
  const metadataStart = MAGIC.length + 4;
  const metadataEnd = metadataStart + metadataLength;
  const metadata = JSON.parse(payload.subarray(metadataStart, metadataEnd).toString('utf8'));
  try {
    const key = scryptSync(password, Buffer.from(metadata.salt, 'base64'), 32);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(metadata.authTag, 'base64'));
    return Buffer.concat([decipher.update(payload.subarray(metadataEnd)), decipher.final()]);
  } catch {
    throw new Error('Backup password is incorrect or the backup file is damaged.');
  }
}
