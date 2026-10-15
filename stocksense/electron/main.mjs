import { app, BrowserWindow, dialog, ipcMain, session, shell } from 'electron';
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { extname, join } from 'node:path';
import { initializeDatabase } from './db.mjs';
import { analyticsService, anomalyService, auditService, authService, businessService, nlpHelpService, productService, reportService, smartEntryService, transactionService } from './services.mjs';
import { exportReportExcel } from './exporter.mjs';
import { backupService } from './backup.mjs';
import { googleAuthService, googleDriveService } from './google.mjs';
import { speechService } from './speech.mjs';

let mainWindow;

app.setAppUserModelId('tech.sociverse.stocksense');

const isDev = !app.isPackaged;

app.whenReady().then(() => {
  initializeDatabase(join(app.getPath('userData'), 'stocksense.sqlite'));
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.every((type) => type === 'audio'));
  });
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    title: 'StockSense',
    backgroundColor: '#f5f7f7',
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(join(import.meta.dirname, '..', 'dist', 'index.html'));
  }
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

function registerIpc() {
  handle('system:meta', () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    dataPath: app.getPath('userData'),
    isPackaged: app.isPackaged,
  }));
  handle('system:openPath', (_event, path) => shell.openPath(path));
  handle('speech:status', () => speechService.status());
  handle('speech:requestPermission', () => speechService.requestPermission());
  handle('speech:transcribe', (_event, payload) => speechService.transcribe(payload));

  handle('auth:status', () => authService.status());
  handle('auth:signUp', (_event, payload) => authService.signUp(payload));
  handle('auth:login', (_event, payload) => authService.login(payload));
  handle('auth:signInGoogle', () => googleAuthService.signIn());
  handle('auth:completeBusiness', (_event, payload) => authService.completeBusiness(payload));
  handle('auth:signOut', () => authService.signOut());

  handle('business:getProfile', () => businessService.getProfile());
  handle('business:updateProfile', (_event, payload) => businessService.updateProfile(payload));
  handle('business:chooseLogo', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose business logo',
      properties: ['openFile'],
      filters: [{ name: 'Logo image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    if (statSync(filePath).size > 2 * 1024 * 1024) throw new Error('Choose a logo smaller than 2 MB.');
    const extension = extname(filePath).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    const logoPath = `data:${mime};base64,${readFileSync(filePath).toString('base64')}`;
    return { canceled: false, profile: businessService.updateProfile({ logoPath, reason: 'Business logo updated' }) };
  });
  handle('business:removeLogo', () => businessService.updateProfile({ logoPath: null, reason: 'Business logo removed' }));

  handle('products:list', (_event, filters) => productService.list(filters));
  handle('products:get', (_event, id) => productService.get(id));
  handle('products:checkDuplicates', (_event, payload) => productService.checkDuplicates(payload));
  handle('products:create', (_event, payload, options) => productService.create(payload, options));
  handle('products:update', (_event, id, payload) => productService.update(id, payload));
  handle('products:updatePrices', (_event, id, payload) => productService.updatePrices(id, payload));
  handle('products:setArchived', (_event, id, archived) => productService.setArchived(id, archived));

  handle('transactions:create', (_event, payload) => transactionService.create(payload));
  handle('transactions:list', (_event, filters) => transactionService.list(filters));

  handle('smartEntry:parse', (_event, text) => smartEntryService.parse(text));
  handle('smartEntry:confirm', (_event, parsed) => smartEntryService.confirm(parsed));

  handle('reports:definitions', () => reportService.definitions());
  handle('reports:view', (_event, reportType, filters) => reportService.view(reportType, filters));
  handle('reports:exportExcel', async (_event, reportType, filters) => {
    const business = businessService.getProfile();
    const date = new Date().toISOString().slice(0, 10);
    const slug = business.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export report to Excel',
      defaultPath: join(app.getPath('documents'), `${reportType}-${slug}-${date}.xlsx`),
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return exportReportExcel(reportType, filters, result.filePath);
  });

  handle('analytics:dashboard', (_event, filters) => analyticsService.dashboard(filters));
  handle('analytics:forecast', (_event, filters) => analyticsService.forecast(filters));

  handle('anomalies:list', (_event, filters) => anomalyService.list(filters));
  handle('anomalies:get', (_event, id) => anomalyService.get(id));
  handle('anomalies:summary', (_event, filters) => anomalyService.summary(filters));
  handle('anomalies:runDetection', () => anomalyService.runDetection());
  handle('anomalies:updateStatus', (_event, id, status, note) => anomalyService.updateStatus(id, status, note));

  handle('audit:list', (_event, filters) => auditService.list(filters));
  handle('audit:getDiff', (_event, id) => auditService.getDiff(id));
  handle('audit:changeGraph', (_event, filters) => auditService.changeGraph(filters));
  handle('audit:verifyIntegrity', () => auditService.verifyIntegrity());

  handle('nlpHelp:suggestedQuestions', () => nlpHelpService.suggestedQuestions());
  handle('nlpHelp:parseQuestion', (_event, text) => nlpHelpService.parseQuestion(text));
  handle('nlpHelp:answer', (_event, questionOrPlan) => nlpHelpService.answer(questionOrPlan));

  handle('backup:list', () => backupService.listBackups());
  handle('drive:status', () => googleDriveService.status());
  handle('drive:connect', () => googleDriveService.connect());
  handle('drive:disconnect', () => googleDriveService.disconnect());
  handle('backup:create', async (_event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Create encrypted StockSense backup',
      defaultPath: join(app.getPath('documents'), `stocksense-backup-${new Date().toISOString().slice(0, 10)}.ssbackup`),
      filters: [{ name: 'StockSense Encrypted Backup', extensions: ['ssbackup'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return backupService.createBackup({ ...options, filePath: result.filePath });
  });
  handle('backup:restore', async (_event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Restore encrypted StockSense backup',
      properties: ['openFile'],
      filters: [{ name: 'StockSense Encrypted Backup', extensions: ['ssbackup'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return backupService.restoreBackup({ ...options, filePath: result.filePaths[0] });
  });
  handle('backup:createGoogleDrive', async (_event, options) => {
    const filePath = join(app.getPath('temp'), `stocksense-backup-${Date.now()}.ssbackup`);
    try {
      backupService.createBackup({ ...options, filePath });
      const driveFile = await googleDriveService.upload(filePath);
      return backupService.markCloudUploaded({ localPath: filePath, driveFile });
    } catch (error) {
      backupService.markCloudFailed({ localPath: filePath, error: error instanceof Error ? error.message : error });
      throw error;
    } finally {
      if (existsSync(filePath)) unlinkSync(filePath);
    }
  });
}

function handle(channel, listener) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await listener(event, ...args);
    } catch (error) {
      console.error(`[${channel}]`, error);
      throw new Error(error instanceof Error ? error.message : 'Unexpected application error.');
    }
  });
}
