import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { closeDatabase, initializeDatabase } from './db.mjs';
import { analyticsService, anomalyService, auditService, authService, businessService, nlpHelpService, productService, reportService, smartEntryService, transactionService } from './services.mjs';
import { backupService } from './backup.mjs';
import { exportReportExcel } from './exporter.mjs';

const root = join(tmpdir(), `stocksense-acceptance-${process.pid}`);
const databasePath = `${root}.sqlite`;
const backupPath = `${root}.ssbackup`;
const exportPath = `${root}.xlsx`;
const agingExportPath = `${root}-aging.xlsx`;
const generatedFiles = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, backupPath, exportPath, agingExportPath];
for (const path of generatedFiles) if (existsSync(path)) rmSync(path, { force: true });

const expect = (condition, message) => { if (!condition) throw new Error(message); };

try {
  initializeDatabase(databasePath);
  expect(authService.status().state === 'needs_account', 'A new install did not start at account setup.');
  expect(productCount() === 0, 'A new install contains facade products.');

  authService.signUp({ name: 'Acceptance Owner', email: 'owner@example.test', password: 'secure-pass-123' });
  expect(authService.status().state === 'needs_business', 'Sign-up did not continue to business setup.');
  authService.completeBusiness({ name: 'Acceptance Store', ownerName: 'Acceptance Owner', email: 'store@example.test', currency: 'INR', timezone: 'Asia/Kolkata', themeName: 'teal', primaryColor: '#2f6f73' });
  expect(authService.status().state === 'authenticated', 'Business setup did not open the app.');
  expect(businessService.getProfile().name === 'Acceptance Store', 'Business profile was not saved.');
  businessService.updateProfile({ logoPath: 'data:image/png;base64,AA==', reason: 'Acceptance logo' });
  expect(Boolean(businessService.getProfile().logoPath), 'Business logo was not saved.');
  businessService.updateProfile({ logoPath: null, reason: 'Remove acceptance logo' });
  expect(!businessService.getProfile().logoPath, 'Business logo was not removed.');

  const create = productService.create({ name: 'Surf Excel 1kg', sku: 'SURF-1KG', category: 'Cleaning', unit: 'pack', quantity: 10, sellingPrice: 245, costPrice: 198, lowStockLimit: 3, minimumSales30Days: 10, datePurchased: new Date().toISOString(), reason: 'First real product' });
  expect(create.status === 'created' && create.product, 'Product creation failed.');
  expect(create.product.minimumSales30Days === 10, 'Product aging sales threshold was not saved.');
  const productId = create.product.id;
  const cola = productService.create({ name: 'Coca-Cola 500ml', sku: 'COKE-500', category: 'Beverages', unit: 'bottle', quantity: 20, sellingPrice: 100, costPrice: 60, lowStockLimit: 5, minimumSales30Days: 2, datePurchased: new Date().toISOString(), reason: 'Second real product' });
  expect(cola.status === 'created' && cola.product, 'Coca-Cola product creation failed.');
  const duplicate = productService.create({ name: 'Surf Excel 1 kg', category: 'Cleaning', unit: 'pack', quantity: 1, sellingPrice: 245, costPrice: 198 });
  expect(duplicate.status === 'duplicate_warning', 'Similar product did not show a duplicate warning.');
  expectThrows(() => transactionService.create({ type: 'sale', productId, quantity: 1.5 }), 'whole number');

  const sale = transactionService.create({ type: 'sale', productId, quantity: 2, unitPrice: 220.5, notes: 'Counter sale with discount', source: 'acceptance_test' });
  expect(sale.stockBefore === 10 && sale.stockAfter === 8 && sale.costPrice === 198, 'Sale stock or historical cost is incorrect.');
  expect(sale.listPrice === 245 && sale.listTotal === 490 && sale.discountPercent === 10 && sale.discountAmount === 49 && sale.total === 441, 'Discount accounting is incorrect for the Surf Excel sale.');
  const colaSale = transactionService.create({ type: 'sale', productId: cola.product.id, quantity: 2, unitPrice: 90, notes: 'Sold below standard price', source: 'acceptance_test' });
  expect(colaSale.listPrice === 100 && colaSale.unitPrice === 90 && colaSale.discountPercent === 10 && colaSale.discountAmount === 20 && colaSale.total === 180 && colaSale.grossProfit === 60, 'A product priced at 100 and sold at 90 was not recorded as a 10% discount.');

  const damageCommand = smartEntryService.parse('damaged two Surf Excel packs');
  expect(damageCommand.intent === 'damage' && damageCommand.status === 'ready' && damageCommand.extracted.quantity === 2, 'Spoken-number damage command was not understood.');
  const homophoneDamageCommand = smartEntryService.parse('damage to Surf Excel packs');
  expect(homophoneDamageCommand.intent === 'damage' && homophoneDamageCommand.status === 'ready' && homophoneDamageCommand.extracted.quantity === 2, 'Speech homophone "damage to" was not safely interpreted as quantity 2.');
  const damage = smartEntryService.confirm(damageCommand);
  expect(damage.type === 'damage' && damage.stockBefore === 8 && damage.stockAfter === 6, 'Damage did not reduce usable stock by two.');

  const restock = transactionService.create({ type: 'restock', productId, quantity: 5, unitPrice: 205, costPrice: 205, updateCostPrice: true, notes: 'New supplier cost', source: 'acceptance_test' });
  expect(restock.stockBefore === 6 && restock.stockAfter === 11, 'Restock did not increase stock.');
  const returned = transactionService.create({ type: 'return', productId, quantity: 1, notes: 'Customer return', source: 'acceptance_test' });
  expect(returned.stockAfter === 12, 'Return did not increase stock.');
  const adjusted = transactionService.create({ type: 'adjustment', productId, quantity: -1, adjustmentMode: 'delta', notes: 'Count correction', source: 'acceptance_test' });
  expect(adjusted.stockAfter === 11, 'Stock correction did not apply.');

  const beforePriceUpdate = productService.get(productId);
  productService.updatePrices(productId, { sellingPrice: 250, costPrice: 210, reason: 'Supplier price changed', expectedVersion: beforePriceUpdate.version, source: 'acceptance_test' });
  const inventoryReport = reportService.view('inventory', {});
  const inventoryRow = inventoryReport.rows.find((row) => row.id === productId);
  expect(inventoryRow?.costPrice === 210, 'Current Stock and Prices does not show the updated cost.');
  const priceReport = reportService.view('price_changes', { startDate: dateInput(-1), endDate: dateInput(1), productId });
  expect(priceReport.rows.some((row) => row.priceType === 'cost' && row.newValue === 210), 'Cost change report does not show the updated cost.');
  const salesReport = reportService.view('sales', { startDate: dateInput(-7), endDate: dateInput(1), productId });
  expect(salesReport.rows.length === 1 && salesReport.rows[0].costPrice === 198, 'Past sale cost was incorrectly rewritten.');
  expect(salesReport.rows[0].discountAmount === 49 && salesReport.summary.discountsGiven === 49, 'Sales report does not include the saved discount.');
  const agingReport = reportService.view('aging_inventory', { startDate: dateInput(-29), endDate: dateInput(0), search: 'Surf' });
  const agingRow = agingReport.rows.find((row) => row.id === productId);
  expect(agingRow?.soldQuantity === 2 && agingRow.expectedSalesForPeriod === 10 && agingRow.salesShortfall === 8, 'Aging report did not compare actual sales with the saved product target.');
  expect(!reportService.view('aging_inventory', { startDate: dateInput(-29), endDate: dateInput(0) }).rows.some((row) => row.id === cola.product.id), 'A product that met its sales target was incorrectly marked as aging.');
  expect(agingReport.summary.agingProductCount === 1 && agingReport.summary.slowStockValue > 0, 'Aging report summary is incorrect.');

  const salesQuestion = nlpHelpService.answer('how many coca cola sold in last 1 week?');
  expect(salesQuestion.status === 'answered' && salesQuestion.intent === 'product_sales', 'Product sales question was not answered.');
  expect(salesQuestion.metrics?.find((metric) => metric.label === 'Units sold')?.value === 2, `Product sales answer returned the wrong quantity: ${JSON.stringify(salesQuestion)}`);
  expect(salesQuestion.metrics?.find((metric) => metric.label === 'Discounts given')?.value === 20, 'Product sales answer does not include discounts.');
  const missingWrite = nlpHelpService.answer('add a new product called Green Tea');
  expect(missingWrite.status === 'guided_action' && missingWrite.guidance?.targetPage === 'inventory', 'NLP write guidance is missing.');

  productService.setArchived(productId, true);
  expect(!productService.list({}).some((product) => product.id === productId), 'Archived product still appears in active inventory.');
  expect(productService.list({ archived: true }).some((product) => product.id === productId), 'Archived product does not appear in the archive.');
  const archivedDuplicate = productService.create({ name: 'Surf Excel 1kg', category: 'Cleaning', unit: 'pack', quantity: 0, sellingPrice: 245, costPrice: 198 });
  expect(archivedDuplicate.status === 'duplicate_warning' && archivedDuplicate.candidates?.some((candidate) => candidate.id === productId), 'Archived products are not included in duplicate warnings.');
  productService.setArchived(productId, false);
  expect(productService.list({}).some((product) => product.id === productId), 'Restored product did not return to active inventory.');

  anomalyService.runDetection();
  const dashboard = analyticsService.dashboard({ startDate: dateInput(-7), endDate: dateInput(1) });
  expect(dashboard.kpis.salesQuantity === 4 && dashboard.kpis.discountTotal === 69, 'Overview sales or discount total is not based on database records.');
  expect(reportService.view('stock_movement', { startDate: dateInput(-7), endDate: dateInput(1) }).rows.length >= 5, 'Stock changes report is incomplete.');
  expect(auditService.verifyIntegrity().valid, 'Protected change history failed verification.');
  expect(dashboard.agingProducts.some((product) => product.id === productId), 'Dashboard does not show a product selling below its saved target.');
  expect(!dashboard.agingProducts.some((product) => product.id === cola.product.id), 'Dashboard incorrectly shows a product that met its sales target.');

  await exportReportExcel('inventory', {}, exportPath);
  expect(existsSync(exportPath), 'Excel report was not written.');
  await exportReportExcel('aging_inventory', { startDate: dateInput(-29), endDate: dateInput(0) }, agingExportPath);
  expect(existsSync(agingExportPath), 'Aging-products Excel report was not written.');
  backupService.createBackup({ filePath: backupPath, password: 'backup-pass-123' });
  expect(existsSync(backupPath), 'Encrypted local backup was not written.');

  authService.signOut();
  expect(authService.status().state === 'signed_out', 'Sign-out did not close the local session.');
  authService.login({ email: 'owner@example.test', password: 'secure-pass-123' });
  expect(authService.status().state === 'authenticated', 'Sign-in did not reopen the business.');

  console.log(JSON.stringify({
    firstRun: 'empty onboarding',
    whiteLabelLogo: true,
    product: create.product.name,
    duplicateWarning: true,
    wholeNumberQuantities: true,
    discountExample: '100 -> 90 = 10% discount',
    damage: `${damage.stockBefore} -> ${damage.stockAfter}`,
    productSalesQuestion: salesQuestion.summary,
    currentCostInReport: inventoryRow.costPrice,
    historicalSaleCost: salesReport.rows[0].costPrice,
    stockActions: ['sale', 'damage', 'restock', 'return', 'adjustment'],
    archiveAndRestore: true,
    agingProducts: 'product-specific 30-day sales target',
    excelExport: true,
    encryptedBackup: true,
    signOutAndLogin: true,
    auditVerified: true,
  }, null, 2));
} finally {
  closeDatabase();
  for (const path of generatedFiles) if (existsSync(path)) rmSync(path, { force: true });
}

function productCount() {
  const db = initializeDatabase(databasePath);
  return Number(db.prepare('SELECT COUNT(*) AS count FROM products').get().count);
}

function dateInput(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function expectThrows(action, expectedMessage) {
  let message = '';
  try { action(); } catch (error) { message = error instanceof Error ? error.message : String(error); }
  expect(message.toLowerCase().includes(expectedMessage.toLowerCase()), `Expected error containing "${expectedMessage}", received "${message}".`);
}
