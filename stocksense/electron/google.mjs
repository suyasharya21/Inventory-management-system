import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename } from 'node:path';
import { safeStorage, shell } from 'electron';
import { deleteSetting, getSetting, setSetting } from './db.mjs';
import { authService } from './services.mjs';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY = 'google_drive_tokens';

function getClientId() {
  return String(process.env.STOCKSENSE_GOOGLE_CLIENT_ID || getSetting('google_client_id', '') || '').trim();
}

function requireClientId() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Google connection is not configured in this copy of StockSense. Add the Google desktop app client ID before release.');
  return clientId;
}

function encryptTokens(tokens) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure token storage is unavailable on this device. Google Drive was not connected.');
  return safeStorage.encryptString(JSON.stringify(tokens)).toString('base64');
}

function decryptTokens(payload) {
  if (!payload || !safeStorage.isEncryptionAvailable()) return null;
  try { return JSON.parse(safeStorage.decryptString(Buffer.from(payload, 'base64'))); } catch { return null; }
}

async function authorize(scopes, prompt = 'select_account') {
  const clientId = requireClientId();
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}/google-callback`;
  const codePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('Google connection timed out. Please try again.'));
    }, 180000);
    server.on('request', (request, response) => {
      const url = new URL(request.url, redirectUri);
      if (url.pathname !== '/google-callback') {
        response.writeHead(404).end();
        return;
      }
      clearTimeout(timer);
      const error = url.searchParams.get('error');
      const returnedState = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>StockSense</title><body style="font:16px system-ui;padding:40px"><h2>Google connection complete</h2><p>You can close this page and return to StockSense.</p></body>');
      server.close();
      if (error) reject(new Error('Google connection was cancelled.'));
      else if (returnedState !== state || !code) reject(new Error('Google returned an invalid sign-in response.'));
      else resolve(code);
    });
  });

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt,
  }).toString();
  await shell.openExternal(authUrl.toString());
  const code = await codePromise;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, code, code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirectUri }),
  });
  if (!response.ok) throw new Error('Google could not complete the connection. Please try again.');
  return response.json();
}

async function getGoogleProfile(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error('Google account details could not be read.');
  const profile = await response.json();
  return { subject: profile.sub, email: profile.email, name: profile.name || profile.email };
}

async function getDriveTokens() {
  const stored = decryptTokens(getSetting(TOKEN_KEY, ''));
  if (!stored) throw new Error('Connect Google Drive before creating a cloud backup.');
  if (stored.expiresAt > Date.now() + 60000) return stored;
  if (!stored.refreshToken) throw new Error('Google Drive access expired. Connect it again.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: requireClientId(), refresh_token: stored.refreshToken, grant_type: 'refresh_token' }),
  });
  if (!response.ok) throw new Error('Google Drive access expired. Connect it again.');
  const refreshed = await response.json();
  const next = { ...stored, accessToken: refreshed.access_token, expiresAt: Date.now() + Number(refreshed.expires_in ?? 3600) * 1000 };
  setSetting(TOKEN_KEY, encryptTokens(next));
  return next;
}

export const googleAuthService = {
  async signIn() {
    const tokens = await authorize(['openid', 'email', 'profile']);
    const profile = await getGoogleProfile(tokens.access_token);
    return authService.signInGoogle(profile);
  },
};

export const googleDriveService = {
  status() {
    const tokens = decryptTokens(getSetting(TOKEN_KEY, ''));
    return { configured: Boolean(getClientId()), connected: Boolean(tokens), email: tokens?.email ?? '' };
  },

  async connect() {
    const tokens = await authorize(['openid', 'email', 'profile', DRIVE_SCOPE], 'consent select_account');
    const profile = await getGoogleProfile(tokens.access_token);
    const stored = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + Number(tokens.expires_in ?? 3600) * 1000,
      email: profile.email,
      scope: tokens.scope,
    };
    setSetting(TOKEN_KEY, encryptTokens(stored));
    return googleDriveService.status();
  },

  disconnect() {
    deleteSetting(TOKEN_KEY);
    return googleDriveService.status();
  },

  async upload(filePath) {
    const tokens = await getDriveTokens();
    const boundary = `stocksense-${randomBytes(12).toString('hex')}`;
    const metadata = JSON.stringify({
      name: basename(filePath),
      mimeType: 'application/octet-stream',
      appProperties: { stocksenseEncryptedBackup: 'true' },
    });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      readFileSync(filePath),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime,webViewLink', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!response.ok) throw new Error('The encrypted backup could not be uploaded to Google Drive.');
    return response.json();
  },
};
