import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import Fuse from 'fuse.js';
import { deleteSetting, getContext, getDatabase, getSetting, margin, normalizeName, setSetting, writeAudit } from './db.mjs';

const isoNow = () => new Date().toISOString();
const round = (value, places = 2) => Number(Number(value ?? 0).toFixed(places));
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const parseJson = (value, fallback = {}) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

function assertText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function assertPositive(value, label) {
  const number = asNumber(value, Number.NaN);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero.`);
  return number;
}

function assertWholeNumber(value, label, minimum = 0) {
  const number = asNumber(value, Number.NaN);
  if (!Number.isInteger(number) || number < minimum) throw new Error(`${label} must be a whole number${minimum > 0 ? ` of at least ${minimum}` : ''}.`);
  return number;
}

function mapProduct(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    businessId: Number(row.business_id),
    name: row.name,
    normalizedName: row.normalized_name,
    sku: row.sku ?? '',
    barcode: row.barcode ?? '',
    categoryId: row.category_id ? Number(row.category_id) : null,
    category: row.category_name ?? 'Uncategorized',
    unit: row.unit,
    currentStock: Number(row.current_stock),
    lowStockLimit: Number(row.low_stock_limit),
    minimumSales30Days: Number(row.minimum_sales_30_days ?? 0),
    sellingPrice: Number(row.selling_price),
    costPrice: Number(row.cost_price),
    marginPercent: round(margin(Number(row.selling_price), Number(row.cost_price))),
    stockValue: round(Number(row.current_stock) * Number(row.cost_price)),
    latestPurchaseDate: row.latest_purchase_date,
    version: Number(row.version),
    isActive: Boolean(row.is_active),
    updatedAt: row.updated_at,
  };
}

function productSelect(where = '') {
  return `
    SELECT p.*, c.name AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ${where}
  `;
}

function getProductRow(db, businessId, productId) {
  const row = db.prepare(productSelect('WHERE p.business_id = ? AND p.id = ?')).get(businessId, productId);
  if (!row) throw new Error('Product was not found.');
  return row;
}

function ensureCategory(db, businessId, categoryName) {
  const name = String(categoryName ?? 'Uncategorized').trim() || 'Uncategorized';
  const existing = db.prepare('SELECT id FROM categories WHERE business_id = ? AND lower(name) = lower(?)').get(businessId, name);
  if (existing) return Number(existing.id);
  const stamp = isoNow();
  const result = db.prepare('INSERT INTO categories (business_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(businessId, name, stamp, stamp);
  return Number(result.lastInsertRowid);
}

function dateBounds(input = {}) {
  const now = new Date();
  const end = input.endDate ? new Date(`${input.endDate}T23:59:59.999`) : now;
  let start;
  if (input.startDate) {
    start = new Date(`${input.startDate}T00:00:00.000`);
  } else {
    start = new Date(end);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

function shiftBounds(bounds) {
  const start = new Date(bounds.start);
  const end = new Date(bounds.end);
  const duration = end.getTime() - start.getTime() + 1;
  return {
    start: new Date(start.getTime() - duration).toISOString(),
    end: new Date(end.getTime() - duration).toISOString(),
  };
}

function fieldDiff(before, after, fields) {
  return Object.fromEntries(
    fields
      .filter((key) => before[key] !== after[key])
      .map((key) => [key, { before: before[key] ?? null, after: after[key] ?? null }]),
  );
}

const SMALL_NUMBERS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS_NUMBERS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUMBER_WORD_PATTERN = new RegExp(`\\b(?:${[...Object.keys(SMALL_NUMBERS), ...Object.keys(TENS_NUMBERS), 'hundred', 'thousand'].join('|')})(?:[ -]+(?:and[ -]+)?(?:${[...Object.keys(SMALL_NUMBERS), ...Object.keys(TENS_NUMBERS), 'hundred', 'thousand'].join('|')}))*\\b`, 'gi');

function normalizeSpokenNumbers(value) {
  const inventoryAware = String(value).replace(
    /\b(sold|sell|sale|restock|restocked|purchased|purchase|bought|returned|return|damaged|damage)\s+(?:to|too)\b/gi,
    '$1 2',
  );
  return inventoryAware.replace(NUMBER_WORD_PATTERN, (phrase) => {
    let total = 0;
    let current = 0;
    for (const word of phrase.toLowerCase().split(/[ -]+/).filter((item) => item !== 'and')) {
      if (word in SMALL_NUMBERS) current += SMALL_NUMBERS[word];
      else if (word in TENS_NUMBERS) current += TENS_NUMBERS[word];
      else if (word === 'hundred') current = (current || 1) * 100;
      else if (word === 'thousand') { total += (current || 1) * 1000; current = 0; }
    }
    return String(total + current);
  });
}

function mapUser(row) {
  if (!row) return null;
  return { id: Number(row.id), businessId: row.business_id ? Number(row.business_id) : null, name: row.name, email: row.email, role: row.role, provider: row.provider };
}

function sessionFor(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, provider: user.provider };
}

function hashPassword(password, salt) {
  return scryptSync(String(password), salt, 64).toString('hex');
}

function assertEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  return email;
}

export const authService = {
  status() {
    const db = getDatabase();
    const accountCount = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count);
    const session = getSetting('current_user', null, db);
    if (!session?.id) return { state: accountCount ? 'signed_out' : 'needs_account', accountCount };
    const user = mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(session.id));
    if (!user) {
      deleteSetting('current_user', db);
      deleteSetting('active_business_id', db);
      return { state: accountCount ? 'signed_out' : 'needs_account', accountCount };
    }
    if (!user.businessId) return { state: 'needs_business', accountCount, user: sessionFor(user) };
    const business = db.prepare('SELECT id, name FROM businesses WHERE id = ?').get(user.businessId);
    if (!business) return { state: 'needs_business', accountCount, user: sessionFor(user) };
    setSetting('active_business_id', user.businessId, db);
    return { state: 'authenticated', accountCount, user: sessionFor(user), business: { id: Number(business.id), name: business.name } };
  },

  signUp(payload) {
    const db = getDatabase();
    const name = assertText(payload.name, 'Your name');
    const email = assertEmail(payload.email);
    const password = String(payload.password ?? '');
    if (password.length < 8) throw new Error('Create a password with at least 8 characters.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new Error('An account already uses this email. Sign in instead.');
    const stamp = isoNow();
    const salt = randomBytes(16).toString('hex');
    const result = db.prepare(`
      INSERT INTO users (business_id, name, email, password_hash, password_salt, provider, role, created_at, updated_at)
      VALUES (NULL, ?, ?, ?, ?, 'local', 'owner', ?, ?)
    `).run(name, email, hashPassword(password, salt), salt, stamp, stamp);
    const user = { id: Number(result.lastInsertRowid), businessId: null, name, email, role: 'owner', provider: 'local' };
    setSetting('current_user', sessionFor(user), db);
    deleteSetting('active_business_id', db);
    return authService.status();
  },

  login(payload) {
    const db = getDatabase();
    const email = assertEmail(payload.email);
    const userRow = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    const supplied = String(payload.password ?? '');
    if (!userRow?.password_hash || !userRow?.password_salt) throw new Error('Use Google sign-in for this account.');
    const expected = Buffer.from(userRow.password_hash, 'hex');
    const actual = Buffer.from(hashPassword(supplied, userRow.password_salt), 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Email or password is incorrect.');
    const user = mapUser(userRow);
    setSetting('current_user', sessionFor(user), db);
    if (user.businessId) setSetting('active_business_id', user.businessId, db);
    return authService.status();
  },

  signInGoogle(profile) {
    const db = getDatabase();
    const email = assertEmail(profile.email);
    const subject = assertText(profile.subject, 'Google account');
    let row = db.prepare('SELECT * FROM users WHERE provider_subject = ? OR email = ?').get(subject, email);
    if (!row) {
      const stamp = isoNow();
      const result = db.prepare(`
        INSERT INTO users (business_id, name, email, provider, provider_subject, role, created_at, updated_at)
        VALUES (NULL, ?, ?, 'google', ?, 'owner', ?, ?)
      `).run(String(profile.name ?? email.split('@')[0]), email, subject, stamp, stamp);
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    } else if (!row.provider_subject) {
      db.prepare("UPDATE users SET provider = 'google', provider_subject = ?, updated_at = ? WHERE id = ?").run(subject, isoNow(), row.id);
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    }
    const user = mapUser(row);
    setSetting('current_user', sessionFor(user), db);
    if (user.businessId) setSetting('active_business_id', user.businessId, db); else deleteSetting('active_business_id', db);
    return authService.status();
  },

  completeBusiness(payload) {
    const db = getDatabase();
    const session = getSetting('current_user', null, db);
    if (!session?.id) throw new Error('Create or sign in to your account first.');
    const user = mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(session.id));
    if (!user) throw new Error('Your local account could not be found.');
    const stamp = isoNow();
    let businessId;
    db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO businesses (name, owner_name, address, phone, email, tax_id, currency, timezone, theme_name, primary_color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assertText(payload.name, 'Business name'),
        String(payload.ownerName ?? user.name).trim(),
        String(payload.address ?? '').trim(),
        String(payload.phone ?? '').trim(),
        String(payload.email ?? user.email).trim(),
        String(payload.taxId ?? '').trim(),
        String(payload.currency ?? 'INR').trim().toUpperCase(),
        String(payload.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Asia/Kolkata'),
        String(payload.themeName ?? 'teal'),
        String(payload.primaryColor ?? '#2f6f73'),
        stamp,
        stamp,
      );
      businessId = Number(result.lastInsertRowid);
      db.prepare('UPDATE users SET business_id = ?, updated_at = ? WHERE id = ?').run(businessId, stamp, user.id);
      const activeUser = { ...user, businessId };
      setSetting('active_business_id', businessId, db);
      setSetting('current_user', sessionFor(activeUser), db);
      writeAudit({
        db,
        businessId,
        user: sessionFor(activeUser),
        action: 'create',
        entityType: 'business',
        entityId: businessId,
        after: { name: payload.name, ownerName: payload.ownerName ?? user.name },
        reason: 'Business setup completed',
        source: 'setup',
      });
    })();
    return authService.status();
  },

  signOut() {
    const db = getDatabase();
    deleteSetting('current_user', db);
    deleteSetting('active_business_id', db);
    return authService.status();
  },
};

export const businessService = {
  getProfile() {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
    return {
      id: Number(business.id),
      name: business.name,
      ownerName: business.owner_name,
      address: business.address,
      phone: business.phone,
      email: business.email,
      taxId: business.tax_id,
      currency: business.currency,
      timezone: business.timezone,
      themeName: business.theme_name,
      primaryColor: business.primary_color,
      logoPath: business.logo_path,
      currentUser: user,
      developedBy: 'Sociverse',
      website: 'https://sociverse.tech',
    };
  },

  updateProfile(payload) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const before = businessService.getProfile();
    const after = {
      ...before,
      name: assertText(payload.name ?? before.name, 'Business name'),
      ownerName: String(payload.ownerName ?? before.ownerName).trim(),
      address: String(payload.address ?? before.address).trim(),
      phone: String(payload.phone ?? before.phone).trim(),
      email: String(payload.email ?? before.email).trim(),
      taxId: String(payload.taxId ?? before.taxId).trim(),
      currency: String(payload.currency ?? before.currency).trim().toUpperCase(),
      timezone: String(payload.timezone ?? before.timezone).trim(),
      themeName: String(payload.themeName ?? before.themeName).trim(),
      primaryColor: String(payload.primaryColor ?? before.primaryColor).trim(),
      logoPath: payload.logoPath === undefined ? before.logoPath : payload.logoPath ? String(payload.logoPath) : null,
    };
    const correlationId = randomUUID();
    db.transaction(() => {
      db.prepare(`
        UPDATE businesses SET name = ?, owner_name = ?, address = ?, phone = ?, email = ?, tax_id = ?,
          currency = ?, timezone = ?, theme_name = ?, primary_color = ?, logo_path = ?, updated_at = ? WHERE id = ?
      `).run(after.name, after.ownerName, after.address, after.phone, after.email, after.taxId, after.currency, after.timezone, after.themeName, after.primaryColor, after.logoPath, isoNow(), businessId);
      writeAudit({
        db,
        businessId,
        user,
        action: 'update',
        entityType: 'business',
        entityId: businessId,
        before: { ...before, logoPath: Boolean(before.logoPath) },
        after: { ...after, logoPath: Boolean(after.logoPath) },
        fieldChanges: fieldDiff({ ...before, logoPath: Boolean(before.logoPath) }, { ...after, logoPath: Boolean(after.logoPath) }, ['name', 'ownerName', 'address', 'phone', 'email', 'taxId', 'currency', 'timezone', 'themeName', 'primaryColor', 'logoPath']),
        reason: String(payload.reason ?? 'Business profile updated'),
        source: 'settings',
        correlationId,
      });
    })();
    return businessService.getProfile();
  },
};

export const productService = {
  list(filters = {}) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const clauses = ['p.business_id = ?', filters.archived ? 'p.is_active = 0' : 'p.is_active = 1'];
    const params = [businessId];
    if (filters.search) {
      clauses.push('(lower(p.name) LIKE ? OR lower(COALESCE(p.sku, \'\')) LIKE ? OR lower(COALESCE(p.barcode, \'\')) LIKE ?)');
      const term = `%${String(filters.search).toLowerCase()}%`;
      params.push(term, term, term);
    }
    if (filters.category && filters.category !== 'all') {
      clauses.push('lower(c.name) = lower(?)');
      params.push(String(filters.category));
    }
    if (filters.stock === 'low') clauses.push('p.current_stock <= p.low_stock_limit AND p.current_stock > 0');
    if (filters.stock === 'out') clauses.push('p.current_stock <= 0');
    if (filters.stock === 'healthy') clauses.push('p.current_stock > p.low_stock_limit');
    const rows = db.prepare(`${productSelect(`WHERE ${clauses.join(' AND ')}`)} ORDER BY p.name COLLATE NOCASE`).all(...params);
    return rows.map(mapProduct);
  },

  get(id) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const product = mapProduct(getProductRow(db, businessId, id));
    const priceHistory = db.prepare(`
      SELECT id, price_type AS priceType, old_value AS oldValue, new_value AS newValue,
        margin_before AS marginBefore, margin_after AS marginAfter, effective_at AS effectiveAt,
        user_name AS userName, source, reason
      FROM product_price_history WHERE business_id = ? AND product_id = ? ORDER BY effective_at DESC, id DESC LIMIT 100
    `).all(businessId, id);
    const recentTransactions = transactionService.list({ productId: id, limit: 30 });
    return { ...product, priceHistory, recentTransactions };
  },

  checkDuplicates(payload) {
    const name = assertText(payload.name, 'Product name');
    const normalized = normalizeName(name);
    const compactName = normalized.replace(/\s+/g, '');
    const products = [...productService.list({}), ...productService.list({ archived: true })];
    const fuse = new Fuse(products, { keys: ['name', 'sku', 'barcode'], includeScore: true, threshold: 0.45, ignoreLocation: true });
    const candidateMap = new Map();
    for (const result of fuse.search(name, { limit: 6 })) {
      const score = Math.round((1 - (result.score ?? 1)) * 100);
      candidateMap.set(result.item.id, {
        ...result.item,
        score,
        reasons: [score >= 95 ? 'Nearly identical product name' : 'Similar product name'],
      });
    }
    for (const product of products) {
      const reasons = [];
      if (product.normalizedName === normalized) reasons.push('Exact normalized name');
      if (product.normalizedName.replace(/\s+/g, '') === compactName && product.normalizedName !== normalized) reasons.push('Same name and size with different spacing');
      if (payload.sku && product.sku && String(payload.sku).toLowerCase() === product.sku.toLowerCase()) reasons.push('Same SKU');
      if (payload.barcode && product.barcode && String(payload.barcode) === product.barcode) reasons.push('Same barcode');
      if (reasons.length) candidateMap.set(product.id, { ...product, score: reasons.includes('Exact normalized name') || reasons.includes('Same SKU') || reasons.includes('Same barcode') ? 100 : 98, reasons });
    }
    return [...candidateMap.values()].sort((a, b) => b.score - a.score).slice(0, 6);
  },

  create(payload, options = {}) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const name = assertText(payload.name, 'Product name');
    const duplicates = productService.checkDuplicates(payload);
    if (duplicates.some((candidate) => candidate.score >= 85) && !options.createAnyway) {
      return { status: 'duplicate_warning', candidates: duplicates };
    }
    const sellingPrice = asNumber(payload.sellingPrice);
    const costPrice = asNumber(payload.costPrice);
    const openingStock = assertWholeNumber(payload.quantity ?? 0, 'Opening quantity');
    const lowStockLimit = assertWholeNumber(payload.lowStockLimit ?? 5, 'Low-stock reminder quantity');
    const minimumSales30Days = assertWholeNumber(payload.minimumSales30Days ?? 0, 'Minimum expected sales in 30 days');
    const categoryId = ensureCategory(db, businessId, payload.category);
    const stamp = isoNow();
    const correlationId = randomUUID();
    let productId;
    db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO products (
          business_id, name, normalized_name, sku, barcode, category_id, unit, current_stock,
          low_stock_limit, minimum_sales_30_days, selling_price, cost_price, latest_purchase_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        businessId,
        name,
        normalizeName(name),
        String(payload.sku ?? '').trim() || null,
        String(payload.barcode ?? '').trim() || null,
        categoryId,
        String(payload.unit ?? 'unit').trim() || 'unit',
        openingStock,
        lowStockLimit,
        minimumSales30Days,
        sellingPrice,
        costPrice,
        openingStock > 0 ? String(payload.datePurchased ?? stamp) : null,
        stamp,
        stamp,
      );
      productId = Number(result.lastInsertRowid);
      if (openingStock > 0) {
        db.prepare(`
          INSERT INTO transactions (business_id, product_id, type, quantity, unit_price, cost_price, stock_before, stock_after, occurred_at, notes, user_name, source, correlation_id, created_at)
          VALUES (?, ?, 'opening', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `).run(businessId, productId, openingStock, costPrice, costPrice, openingStock, String(payload.datePurchased ?? stamp), 'Opening stock', user.name, options.source ?? 'manual', correlationId, stamp);
      }
      const currentMargin = margin(sellingPrice, costPrice);
      for (const [priceType, value] of [['selling', sellingPrice], ['cost', costPrice]]) {
        db.prepare(`
          INSERT INTO product_price_history (business_id, product_id, price_type, old_value, new_value, margin_before, margin_after, effective_at, user_name, source, reason, created_at)
          VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?)
        `).run(businessId, productId, priceType, value, currentMargin, stamp, user.name, options.source ?? 'manual', String(payload.reason ?? 'Product created'), stamp);
      }
      const after = mapProduct(getProductRow(db, businessId, productId));
      writeAudit({
        db,
        businessId,
        user,
        action: 'create',
        entityType: 'product',
        entityId: productId,
        before: {},
        after,
        fieldChanges: Object.fromEntries(Object.entries(after).map(([key, value]) => [key, { before: null, after: value }])),
        reason: String(payload.reason ?? 'Product created'),
        source: options.source ?? 'manual',
        correlationId,
      });
    })();
    evaluateProductAnomalies(productId, { source: options.source ?? 'manual' });
    return { status: 'created', product: productService.get(productId), candidates: duplicates };
  },

  update(id, payload) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const before = mapProduct(getProductRow(db, businessId, id));
    const categoryId = payload.category ? ensureCategory(db, businessId, payload.category) : before.categoryId;
    const next = {
      name: assertText(payload.name ?? before.name, 'Product name'),
      sku: String(payload.sku ?? before.sku).trim() || null,
      barcode: String(payload.barcode ?? before.barcode).trim() || null,
      categoryId,
      unit: String(payload.unit ?? before.unit).trim() || 'unit',
      lowStockLimit: assertWholeNumber(payload.lowStockLimit ?? before.lowStockLimit, 'Low-stock reminder quantity'),
      minimumSales30Days: assertWholeNumber(payload.minimumSales30Days ?? before.minimumSales30Days, 'Minimum expected sales in 30 days'),
    };
    const correlationId = randomUUID();
    db.transaction(() => {
      db.prepare(`
        UPDATE products SET name = ?, normalized_name = ?, sku = ?, barcode = ?, category_id = ?, unit = ?, low_stock_limit = ?, minimum_sales_30_days = ?, version = version + 1, updated_at = ?
        WHERE business_id = ? AND id = ?
      `).run(next.name, normalizeName(next.name), next.sku, next.barcode, next.categoryId, next.unit, next.lowStockLimit, next.minimumSales30Days, isoNow(), businessId, id);
      const after = mapProduct(getProductRow(db, businessId, id));
      writeAudit({
        db,
        businessId,
        user,
        action: 'update',
        entityType: 'product',
        entityId: Number(id),
        before,
        after,
        fieldChanges: fieldDiff(before, after, ['name', 'sku', 'barcode', 'categoryId', 'unit', 'lowStockLimit', 'minimumSales30Days']),
        reason: String(payload.reason ?? 'Product details updated'),
        source: payload.source ?? 'manual',
        correlationId,
      });
    })();
    return productService.get(id);
  },

  updatePrices(id, payload) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const before = mapProduct(getProductRow(db, businessId, id));
    if (payload.expectedVersion && Number(payload.expectedVersion) !== before.version) {
      throw new Error('This product was changed by another action. Refresh it before updating prices.');
    }
    const sellingPrice = payload.sellingPrice === undefined ? before.sellingPrice : Math.max(0, asNumber(payload.sellingPrice));
    const costPrice = payload.costPrice === undefined ? before.costPrice : Math.max(0, asNumber(payload.costPrice));
    if (sellingPrice === before.sellingPrice && costPrice === before.costPrice) return productService.get(id);
    const effectiveAt = payload.effectiveAt ? new Date(payload.effectiveAt).toISOString() : isoNow();
    const reason = String(payload.reason ?? '').trim();
    const maxChange = Math.max(
      before.sellingPrice ? Math.abs((sellingPrice - before.sellingPrice) / before.sellingPrice) : 0,
      before.costPrice ? Math.abs((costPrice - before.costPrice) / before.costPrice) : 0,
    );
    if (maxChange >= 0.25 && !reason) throw new Error('A reason is required for price changes of 25% or more.');
    const correlationId = randomUUID();
    db.transaction(() => {
      db.prepare('UPDATE products SET selling_price = ?, cost_price = ?, version = version + 1, updated_at = ? WHERE business_id = ? AND id = ?').run(sellingPrice, costPrice, isoNow(), businessId, id);
      const after = mapProduct(getProductRow(db, businessId, id));
      let auditId;
      const audit = writeAudit({
        db,
        businessId,
        user,
        action: 'update_prices',
        entityType: 'product',
        entityId: Number(id),
        before,
        after,
        fieldChanges: fieldDiff(before, after, ['sellingPrice', 'costPrice', 'marginPercent']),
        reason: reason || 'Price updated',
        source: payload.source ?? 'manual',
        correlationId,
      });
      auditId = audit.id;
      const insert = db.prepare(`
        INSERT INTO product_price_history (
          business_id, product_id, price_type, old_value, new_value, margin_before, margin_after,
          effective_at, user_name, source, reason, audit_log_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      if (sellingPrice !== before.sellingPrice) insert.run(businessId, id, 'selling', before.sellingPrice, sellingPrice, before.marginPercent, after.marginPercent, effectiveAt, user.name, payload.source ?? 'manual', reason || 'Selling price updated', auditId, isoNow());
      if (costPrice !== before.costPrice) insert.run(businessId, id, 'cost', before.costPrice, costPrice, before.marginPercent, after.marginPercent, effectiveAt, user.name, payload.source ?? 'manual', reason || 'Cost price updated', auditId, isoNow());
    })();
    evaluateProductAnomalies(id, { source: payload.source ?? 'manual' });
    return productService.get(id);
  },

  setArchived(id, archived) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const before = mapProduct(getProductRow(db, businessId, id));
    const nextActive = archived ? 0 : 1;
    if (before.isActive === Boolean(nextActive)) return productService.get(id);
    db.transaction(() => {
      db.prepare('UPDATE products SET is_active = ?, version = version + 1, updated_at = ? WHERE business_id = ? AND id = ?').run(nextActive, isoNow(), businessId, id);
      const after = mapProduct(getProductRow(db, businessId, id));
      writeAudit({
        db,
        businessId,
        user,
        action: archived ? 'archive' : 'unarchive',
        entityType: 'product',
        entityId: Number(id),
        before,
        after,
        fieldChanges: { isActive: { before: before.isActive, after: after.isActive } },
        reason: archived ? 'Product archived' : 'Product restored to active inventory',
        source: 'inventory',
      });
    })();
    return productService.get(id);
  },
};

export const transactionService = {
  create(payload) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const type = String(payload.type ?? '').toLowerCase();
    if (!['sale', 'restock', 'return', 'damage', 'adjustment'].includes(type)) throw new Error('Unsupported transaction type.');
    const beforeProduct = mapProduct(getProductRow(db, businessId, payload.productId));
    const quantityInput = asNumber(payload.quantity, Number.NaN);
    let change;
    let recordedQuantity;
    if (type === 'adjustment') {
      if (!String(payload.notes ?? '').trim()) throw new Error('A reason is required for stock adjustments.');
      if (payload.adjustmentMode === 'set') {
        const target = assertWholeNumber(payload.quantity, 'New stock quantity');
        change = target - beforeProduct.currentStock;
        recordedQuantity = Math.abs(change);
      } else {
        if (!Number.isInteger(quantityInput) || quantityInput === 0) throw new Error('Stock correction must be a non-zero whole number.');
        change = quantityInput;
        recordedQuantity = Math.abs(change);
      }
    } else {
      const quantity = assertWholeNumber(quantityInput, 'Quantity', 1);
      const direction = ['sale', 'damage'].includes(type) ? -1 : 1;
      change = quantity * direction;
      recordedQuantity = quantity;
    }
    const stockAfter = round(beforeProduct.currentStock + change, 3);
    if (stockAfter < 0) throw new Error(`Only ${beforeProduct.currentStock} ${beforeProduct.unit}(s) are available.`);
    const listPrice = type === 'sale' ? beforeProduct.sellingPrice : asNumber(payload.unitPrice, beforeProduct.costPrice);
    let unitPrice = type === 'sale'
      ? payload.unitPrice === undefined
        ? listPrice * (1 - Math.min(100, Math.max(0, asNumber(payload.discountPercent))) / 100)
        : asNumber(payload.unitPrice, listPrice)
      : asNumber(payload.unitPrice, beforeProduct.costPrice);
    unitPrice = round(unitPrice);
    if (unitPrice < 0) throw new Error('Selling price after discount cannot be below zero.');
    if (type === 'sale' && unitPrice > listPrice) throw new Error('Selling price after discount cannot be higher than the product selling price. Update the product price instead.');
    const discountPercent = type === 'sale' && listPrice > 0 ? round(((listPrice - unitPrice) / listPrice) * 100) : 0;
    const discountAmount = type === 'sale' ? round(recordedQuantity * (listPrice - unitPrice)) : 0;
    const transactionCost = type === 'restock' ? asNumber(payload.costPrice, beforeProduct.costPrice) : beforeProduct.costPrice;
    const occurredAt = payload.occurredAt ? new Date(payload.occurredAt).toISOString() : isoNow();
    const correlationId = randomUUID();
    let transactionId;
    db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO transactions (
          business_id, product_id, type, quantity, list_price, unit_price, cost_price, discount_percent,
          discount_amount, stock_before, stock_after, occurred_at, notes, user_name, source, correlation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        businessId,
        beforeProduct.id,
        type,
        recordedQuantity,
        listPrice,
        unitPrice,
        transactionCost,
        discountPercent,
        discountAmount,
        beforeProduct.currentStock,
        stockAfter,
        occurredAt,
        String(payload.notes ?? '').trim(),
        user.name,
        payload.source ?? 'manual',
        correlationId,
        isoNow(),
      );
      transactionId = Number(result.lastInsertRowid);
      db.prepare(`
        UPDATE products SET current_stock = ?, latest_purchase_date = CASE WHEN ? = 'restock' THEN ? ELSE latest_purchase_date END,
          version = version + 1, updated_at = ? WHERE id = ? AND business_id = ?
      `).run(stockAfter, type, occurredAt, isoNow(), beforeProduct.id, businessId);

      if (type === 'restock' && payload.updateCostPrice && transactionCost !== beforeProduct.costPrice) {
        const newMargin = margin(beforeProduct.sellingPrice, transactionCost);
        db.prepare('UPDATE products SET cost_price = ? WHERE id = ? AND business_id = ?').run(transactionCost, beforeProduct.id, businessId);
        db.prepare(`
          INSERT INTO product_price_history (
            business_id, product_id, price_type, old_value, new_value, margin_before, margin_after,
            effective_at, user_name, source, reason, created_at
          ) VALUES (?, ?, 'cost', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(businessId, beforeProduct.id, beforeProduct.costPrice, transactionCost, beforeProduct.marginPercent, newMargin, occurredAt, user.name, payload.source ?? 'manual', String(payload.notes ?? 'Restock cost updated'), isoNow());
      }

      const afterProduct = mapProduct(getProductRow(db, businessId, beforeProduct.id));
      writeAudit({
        db,
        businessId,
        user,
        action: `create_${type}`,
        entityType: 'transaction',
        entityId: transactionId,
        before: { product: beforeProduct, transaction: null },
        after: { product: afterProduct, transactionId, type, quantity: recordedQuantity, stockChange: change, listPrice, unitPrice, discountPercent, discountAmount },
        fieldChanges: {
          currentStock: { before: beforeProduct.currentStock, after: afterProduct.currentStock },
          ...(afterProduct.costPrice !== beforeProduct.costPrice ? { costPrice: { before: beforeProduct.costPrice, after: afterProduct.costPrice } } : {}),
        },
        reason: String(payload.notes ?? `${type} recorded`),
        source: payload.source ?? 'manual',
        correlationId,
        occurredAt,
      });
    })();
    evaluateProductAnomalies(beforeProduct.id, { transactionId, source: payload.source ?? 'manual' });
    return transactionService.get(transactionId);
  },

  get(id) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const row = db.prepare(`
      SELECT t.*, p.name AS product_name, p.unit, c.name AS category_name
      FROM transactions t
      JOIN products p ON p.id = t.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE t.business_id = ? AND t.id = ?
    `).get(businessId, id);
    return row ? mapTransaction(row) : null;
  },

  list(filters = {}) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const clauses = ['t.business_id = ?'];
    const params = [businessId];
    if (filters.type && filters.type !== 'all') {
      clauses.push('t.type = ?');
      params.push(String(filters.type));
    }
    if (filters.productId) {
      clauses.push('t.product_id = ?');
      params.push(Number(filters.productId));
    }
    if (filters.search) {
      clauses.push('(lower(p.name) LIKE ? OR lower(t.notes) LIKE ?)');
      const term = `%${String(filters.search).toLowerCase()}%`;
      params.push(term, term);
    }
    if (filters.startDate) {
      clauses.push('t.occurred_at >= ?');
      params.push(new Date(`${filters.startDate}T00:00:00.000`).toISOString());
    }
    if (filters.endDate) {
      clauses.push('t.occurred_at <= ?');
      params.push(new Date(`${filters.endDate}T23:59:59.999`).toISOString());
    }
    const limit = Math.min(1000, Math.max(1, asNumber(filters.limit, 250)));
    const rows = db.prepare(`
      SELECT t.*, p.name AS product_name, p.unit, c.name AS category_name
      FROM transactions t
      JOIN products p ON p.id = t.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY t.occurred_at DESC, t.id DESC LIMIT ${limit}
    `).all(...params);
    return rows.map(mapTransaction);
  },
};

function mapTransaction(row) {
  const direction = ['sale', 'damage'].includes(row.type) ? -1 : 1;
  const stockChange = row.type === 'adjustment' ? Number(row.stock_after) - Number(row.stock_before) : Number(row.quantity) * direction;
  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    productName: row.product_name,
    category: row.category_name ?? 'Uncategorized',
    type: row.type,
    quantity: Number(row.quantity),
    stockChange: round(stockChange, 3),
    unit: row.unit,
    listPrice: Number(row.list_price || row.unit_price),
    listTotal: round(Number(row.quantity) * Number(row.list_price || row.unit_price)),
    unitPrice: Number(row.unit_price),
    costPrice: Number(row.cost_price),
    discountPercent: Number(row.discount_percent ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    total: round(Number(row.quantity) * Number(row.unit_price)),
    grossProfit: row.type === 'sale' ? round(Number(row.quantity) * (Number(row.unit_price) - Number(row.cost_price))) : 0,
    stockBefore: Number(row.stock_before),
    stockAfter: Number(row.stock_after),
    occurredAt: row.occurred_at,
    notes: row.notes,
    userName: row.user_name,
    source: row.source,
    correlationId: row.correlation_id,
  };
}

export const smartEntryService = {
  parse(text) {
    const command = assertText(text, 'Command');
    const lower = normalizeSpokenNumbers(command.toLowerCase().trim());
    let intent = 'unknown';
    if (/\b(sold|sell|sale)\b/.test(lower)) intent = 'sale';
    else if (/\b(restock|purchased|purchase|add stock|bought)\b/.test(lower)) intent = 'restock';
    else if (/\b(returned|return)\b/.test(lower)) intent = 'return';
    else if (/\b(damaged|damage|expired)\b/.test(lower)) intent = 'damage';
    else if (/\b(adjust|set stock|stock to)\b/.test(lower)) intent = 'adjustment';
    else if (/\b(create product|new product|add product)\b/.test(lower)) intent = 'create_product';
    else if (/\b(change|update|set)\b.*\b(selling price|cost price|price|cost)\b/.test(lower)) intent = 'update_price';
    else if (/\b(report|show sales|show purchases|low stock)\b/.test(lower)) intent = 'report';

    const numbers = [...lower.matchAll(/(?:rs\.?\s*)?(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    const quantity = numbers[0];
    const priceMatch = lower.match(/(?:selling price|price)\s*(?:to|is|=)?\s*(\d+(?:\.\d+)?)/);
    const costMatch = lower.match(/cost(?: price)?\s*(?:to|is|=)?\s*(\d+(?:\.\d+)?)/);
    const salePriceMatch = lower.match(/\b(?:at|for)\s*(?:rs\.?\s*)?(\d+(?:\.\d+)?)\s*(?:each|per item)?\b/);
    const discountMatch = lower.match(/(\d+(?:\.\d+)?)\s*%\s*(?:discount|off)?/);
    let productPhrase = lower
      .replace(/\b(sold|sell|sale|restock|purchased|purchase|bought|returned|return|damaged|damage|expired|adjust|set stock|stock to|create product|new product|add product|change|update|set|selling price|cost price|price|cost|to|is|by|at|for|each|per item|discount|off|units?|pieces?|packs?|bottles?|bags?)\b/g, ' ')
      .replace(/%/g, ' ')
      .replace(/(?:rs\.?\s*)?\d+(?:\.\d+)?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (intent === 'report' || intent === 'unknown') {
      return {
        status: intent === 'report' ? 'ready' : 'needs_input',
        intent: intent === 'unknown' ? 'help_query' : intent,
        confidence: intent === 'report' ? 0.9 : 0.45,
        originalText: command,
        extracted: {},
        message: intent === 'report' ? 'Open the matching report with these filters.' : 'I can answer this in NLP Help or you can choose an inventory action.',
        guidance: intent === 'unknown' ? {
          title: 'Try a supported command or use a manual flow',
          description: 'Include an action, quantity, and product name. You can also open the guided transaction form.',
          example: 'sold 5 Coca-Cola bottles',
          actionLabel: 'Open manual transactions',
          targetPage: 'transactions',
          steps: ['Choose the movement type', 'Select the product', 'Enter quantity and confirm'],
        } : undefined,
      };
    }

    const matches = productPhrase ? matchProducts(productPhrase) : [];
    const best = matches[0];
    const requestedDiscount = Math.min(100, Math.max(0, Number(discountMatch?.[1] ?? 0)));
    const saleUnitPrice = intent === 'sale' && best
      ? salePriceMatch ? Number(salePriceMatch[1]) : round(best.sellingPrice * (1 - requestedDiscount / 100))
      : undefined;
    const saleDiscountPercent = intent === 'sale' && best?.sellingPrice && saleUnitPrice !== undefined
      ? round(((best.sellingPrice - saleUnitPrice) / best.sellingPrice) * 100)
      : requestedDiscount;
    const quantityIsValid = Number.isInteger(quantity) && quantity > 0;
    const needsQuantity = ['sale', 'restock', 'return', 'damage', 'adjustment'].includes(intent) && !quantityIsValid;
    const needsProduct = !best && intent !== 'create_product';
    const ambiguous = matches.length > 1 && matches[0].score - matches[1].score < 8;
    const status = needsProduct || needsQuantity ? 'needs_input' : ambiguous ? 'ambiguous' : 'ready';
    return {
      status,
      intent,
      confidence: best ? Math.min(0.99, best.score / 100) : intent === 'create_product' ? 0.75 : 0.45,
      originalText: command,
      extracted: {
        productName: best?.name ?? productPhrase,
        productId: best?.id,
        quantity: quantityIsValid ? quantity : undefined,
        sellingPrice: intent === 'sale' ? best?.sellingPrice : priceMatch ? Number(priceMatch[1]) : undefined,
        saleUnitPrice,
        discountPercent: intent === 'sale' ? saleDiscountPercent : undefined,
        costPrice: costMatch ? Number(costMatch[1]) : undefined,
      },
      suggestions: matches.slice(0, 5),
      message: needsProduct
        ? `I could not confidently find "${productPhrase || 'that product'}". Choose a product or create it.`
        : needsQuantity
          ? 'How many units should be recorded?'
          : ambiguous
            ? 'This may refer to more than one product. Select the correct one.'
            : 'Review the parsed action before confirming.',
      guidance: needsProduct || needsQuantity ? {
        title: needsProduct ? 'Complete this in a guided form' : 'Add the missing quantity',
        description: needsProduct
          ? 'Choose or create the product manually, then return to the transaction flow.'
          : 'Enter a quantity above, or use the full manual transaction form.',
        example: intent === 'update_price' ? 'change Basmati Rice cost price to 560' : `${intent === 'restock' ? 'restock' : 'sold'} 5 Coca-Cola bottles`,
        actionLabel: needsProduct || intent === 'create_product' || intent === 'update_price' ? 'Open manual inventory' : 'Open manual transaction',
        targetPage: needsProduct || intent === 'create_product' || intent === 'update_price' ? 'inventory' : 'transactions',
        steps: needsProduct
          ? ['Search for the product', 'Create it if it does not exist', 'Review duplicate suggestions before saving']
          : ['Select the product', 'Enter the quantity', 'Review before and after stock, then confirm'],
      } : undefined,
    };
  },

  confirm(parsed) {
    if (!parsed || parsed.status !== 'ready') throw new Error('This command still needs information before it can be confirmed.');
    const source = 'smart_entry';
    if (['sale', 'restock', 'return', 'damage', 'adjustment'].includes(parsed.intent)) {
      return transactionService.create({
        type: parsed.intent,
        productId: parsed.extracted.productId,
        quantity: parsed.extracted.quantity,
        unitPrice: parsed.intent === 'sale' ? parsed.extracted.saleUnitPrice : undefined,
        discountPercent: parsed.intent === 'sale' ? parsed.extracted.discountPercent : undefined,
        notes: parsed.originalText,
        source,
      });
    }
    if (parsed.intent === 'update_price') {
      return productService.updatePrices(parsed.extracted.productId, {
        sellingPrice: parsed.extracted.sellingPrice,
        costPrice: parsed.extracted.costPrice,
        reason: parsed.originalText,
        source,
      });
    }
    throw new Error('This command should continue in its guided page.');
  },
};

function matchProducts(query) {
  const products = productService.list({});
  const normalized = normalizeName(query);
  const fuse = new Fuse(products, { keys: ['name', 'sku', 'barcode'], includeScore: true, threshold: 0.55, ignoreLocation: true });
  return fuse.search(query, { limit: 6 }).map((result) => ({
    ...result.item,
    score: result.item.normalizedName === normalized ? 100 : Math.round((1 - (result.score ?? 1)) * 100),
  }));
}

function slowSellingProductRows(db, businessId, filters = {}, limit) {
  const bounds = dateBounds(filters);
  const periodDays = Math.max(1, Math.ceil((new Date(bounds.end).getTime() - new Date(bounds.start).getTime()) / 86400000));
  const search = String(filters.search ?? '').trim();
  const rows = db.prepare(`
    SELECT p.id, p.name, COALESCE(p.sku, '') AS sku, COALESCE(c.name, 'Uncategorized') AS category,
      p.current_stock AS currentStock, p.unit, p.cost_price AS costPrice,
      p.minimum_sales_30_days AS minimumSales30Days,
      ROUND(p.current_stock * p.cost_price, 2) AS stockValue,
      COALESCE(SUM(CASE WHEN t.type = 'sale' AND t.occurred_at BETWEEN @start AND @end THEN t.quantity ELSE 0 END), 0) AS soldQuantity,
      COALESCE(SUM(CASE WHEN t.type = 'sale' AND t.occurred_at BETWEEN @start AND @end THEN t.quantity * t.unit_price ELSE 0 END), 0) AS salesValue,
      MAX(CASE WHEN t.type = 'sale' THEN t.occurred_at END) AS latestSaleAt
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN transactions t ON t.product_id = p.id AND t.business_id = p.business_id
    WHERE p.business_id = @businessId AND p.is_active = 1 AND p.current_stock > 0 AND p.minimum_sales_30_days > 0
      AND (@search = '' OR p.name LIKE @searchLike OR COALESCE(p.sku, '') LIKE @searchLike OR COALESCE(c.name, '') LIKE @searchLike)
    GROUP BY p.id, p.name, p.sku, c.name, p.current_stock, p.unit, p.cost_price, p.minimum_sales_30_days
  `).all({ start: bounds.start, end: bounds.end, businessId, search, searchLike: `%${search}%` }).map((row) => {
    const soldQuantity = Number(row.soldQuantity);
    const currentStock = Number(row.currentStock);
    const minimumSales30Days = Number(row.minimumSales30Days);
    const expectedSalesForPeriod = Math.max(1, Math.ceil(minimumSales30Days * periodDays / 30));
    const averageDailySales = soldQuantity / periodDays;
    const daysSinceLatestSale = row.latestSaleAt
      ? Math.max(0, Math.floor((Date.now() - new Date(row.latestSaleAt).getTime()) / 86400000))
      : null;
    return {
      ...row,
      id: Number(row.id),
      currentStock,
      costPrice: Number(row.costPrice),
      stockValue: Number(row.stockValue),
      minimumSales30Days,
      soldQuantity,
      salesValue: Number(row.salesValue),
      expectedSalesForPeriod,
      salesShortfall: Math.max(0, expectedSalesForPeriod - soldQuantity),
      targetCompletionPercent: round(soldQuantity * 100 / expectedSalesForPeriod, 2),
      averageDailySales: round(averageDailySales, 2),
      estimatedDaysToSellCurrentStock: averageDailySales > 0 ? Math.ceil(currentStock / averageDailySales) : null,
      daysSinceLatestSale,
      sellingStatus: soldQuantity === 0 ? 'No sales in selected dates' : soldQuantity * 2 < expectedSalesForPeriod ? 'Far below expected sales' : 'Below expected sales',
    };
  }).filter((row) => row.soldQuantity < row.expectedSalesForPeriod)
    .filter((row) => filters.sellingStatus !== 'no_sales' || row.soldQuantity === 0)
    .sort((left, right) => left.targetCompletionPercent - right.targetCompletionPercent || right.stockValue - left.stockValue || left.name.localeCompare(right.name));
  return Number.isInteger(limit) && limit > 0 ? rows.slice(0, limit) : rows;
}

const REPORT_DEFINITIONS = {
  inventory: { title: 'Current Stock and Prices', description: 'Current quantities, selling prices, costs, and stock value.' },
  aging_inventory: { title: 'Aging Products', description: 'Products with stock available but sales below their saved target during the selected dates.' },
  sales: { title: 'Sales', description: 'Products sold, sales value, and profit using the cost recorded at each sale.' },
  purchases: { title: 'Stock Added', description: 'Products purchased or restocked and the cost recorded at that time.' },
  stock_movement: { title: 'All Stock Changes', description: 'Every increase and decrease with the quantity before and after.' },
  low_stock: { title: 'Products Running Low', description: 'Products at or below the quantity where you want to buy more.' },
  profit: { title: 'Profit After Product Cost', description: 'Sales value minus the product cost recorded at each sale.' },
  price_changes: { title: 'Selling Price and Cost Changes', description: 'Every saved selling-price and cost-price change over time.' },
  anomalies: { title: 'Unusual Activity', description: 'Events that may need review, with the reason they were flagged.' },
  audit: { title: 'Change History', description: 'A protected record of important business changes.' },
};

export const reportService = {
  definitions() {
    return Object.entries(REPORT_DEFINITIONS).map(([id, value]) => ({ id, ...value }));
  },

  view(reportType, filters = {}) {
    const definition = REPORT_DEFINITIONS[reportType];
    if (!definition) throw new Error('Unknown report type.');
    const db = getDatabase();
    const { businessId } = getContext(db);
    let rows = [];
    let columns = [];
    let summary = {};

    if (reportType === 'inventory' || reportType === 'low_stock') {
      rows = productService.list({ ...filters, stock: reportType === 'low_stock' ? 'low' : filters.stock });
      columns = [
        ['name', 'Product'], ['sku', 'Product Code'], ['category', 'Category'], ['currentStock', 'Quantity'],
        ['unit', 'Unit'], ['sellingPrice', 'Current Selling Price'], ['costPrice', 'Current Cost Price'],
        ['marginPercent', 'Profit Margin %'], ['stockValue', 'Stock Value at Current Cost'], ['minimumSales30Days', 'Minimum Expected Sales in 30 Days'], ['latestPurchaseDate', 'Last Purchased'],
      ];
      summary = {
        productCount: rows.length,
        totalQuantity: round(rows.reduce((sum, row) => sum + row.currentStock, 0), 3),
        stockValue: round(rows.reduce((sum, row) => sum + row.stockValue, 0)),
        lowStockCount: rows.filter((row) => row.currentStock <= row.lowStockLimit).length,
      };
    } else if (reportType === 'aging_inventory') {
      rows = slowSellingProductRows(db, businessId, filters);
      columns = [
        ['name', 'Product'], ['sku', 'Product Code'], ['category', 'Category'], ['currentStock', 'Current Quantity'],
        ['unit', 'Unit'], ['soldQuantity', 'Quantity Sold'], ['expectedSalesForPeriod', 'Expected Sales for Selected Dates'],
        ['minimumSales30Days', 'Minimum Expected Sales in 30 Days'], ['salesShortfall', 'Quantity Below Target'], ['targetCompletionPercent', 'Sales Target Completed %'],
        ['sellingStatus', 'Selling Status'], ['latestSaleAt', 'Latest Sale'], ['daysSinceLatestSale', 'Days Since Latest Sale'],
        ['averageDailySales', 'Average Sold Per Day'], ['estimatedDaysToSellCurrentStock', 'Estimated Days to Sell Current Stock'],
        ['salesValue', 'Sales Value'],
        ['costPrice', 'Current Cost Price'], ['stockValue', 'Stock Value at Current Cost'],
      ];
      summary = {
        agingProductCount: rows.length,
        noSaleProductCount: rows.filter((row) => row.soldQuantity === 0).length,
        totalCurrentQuantity: rows.reduce((sum, row) => sum + row.currentStock, 0),
        slowStockValue: round(rows.reduce((sum, row) => sum + row.stockValue, 0)),
      };
    } else if (['sales', 'purchases', 'stock_movement', 'profit'].includes(reportType)) {
      const type = reportType === 'sales' || reportType === 'profit' ? 'sale' : reportType === 'purchases' ? 'restock' : filters.type;
      rows = transactionService.list({ ...filters, type: type ?? 'all', limit: 1000 });
      columns = [
        ['occurredAt', 'Date'], ['type', 'Type'], ['productName', 'Product'], ['category', 'Category'],
        ['quantity', 'Quantity'], ['listPrice', 'Standard Price Per Item'], ['listTotal', 'Total Before Discount'],
        ['discountPercent', 'Discount %'], ['discountAmount', 'Discount Amount'], ['unitPrice', 'Price Per Item After Discount'],
        ['total', 'Total After Discount'], ['costPrice', 'Cost When Recorded'], ['grossProfit', 'Profit After Product Cost'], ['stockBefore', 'Quantity Before'], ['stockAfter', 'Quantity After'],
        ['userName', 'Recorded By'], ['source', 'How It Was Added'], ['notes', 'Notes'],
      ];
      const salesRows = rows.filter((row) => row.type === 'sale');
      summary = {
        rowCount: rows.length,
        quantity: round(rows.reduce((sum, row) => sum + row.quantity, 0), 3),
        revenue: round(salesRows.reduce((sum, row) => sum + row.total, 0)),
        discountsGiven: round(salesRows.reduce((sum, row) => sum + row.discountAmount, 0)),
        purchaseSpend: round(rows.filter((row) => row.type === 'restock').reduce((sum, row) => sum + row.quantity * row.costPrice, 0)),
        grossProfit: round(salesRows.reduce((sum, row) => sum + row.grossProfit, 0)),
      };
    } else if (reportType === 'price_changes') {
      const bounds = dateBounds(filters);
      const clauses = ['h.business_id = ?', 'h.effective_at BETWEEN ? AND ?'];
      const params = [businessId, bounds.start, bounds.end];
      if (filters.productId) {
        clauses.push('h.product_id = ?');
        params.push(Number(filters.productId));
      }
      rows = db.prepare(`
        SELECT h.id, h.effective_at AS effectiveAt, p.name AS productName, c.name AS category,
          h.price_type AS priceType, h.old_value AS oldValue, h.new_value AS newValue,
          CASE WHEN h.old_value IS NULL OR h.old_value = 0 THEN NULL ELSE ROUND((h.new_value - h.old_value) * 100.0 / h.old_value, 2) END AS changePercent,
          h.margin_before AS marginBefore, h.margin_after AS marginAfter, h.user_name AS userName,
          h.source, h.reason, h.audit_log_id AS auditLogId
        FROM product_price_history h
        JOIN products p ON p.id = h.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${clauses.join(' AND ')} ORDER BY h.effective_at DESC, h.id DESC
      `).all(...params).map((row) => ({ ...row, id: Number(row.id) }));
      columns = [
        ['effectiveAt', 'Date'], ['productName', 'Product'], ['category', 'Category'], ['priceType', 'Changed Price'],
        ['oldValue', 'Old Value'], ['newValue', 'New Value'], ['changePercent', 'Change %'],
        ['marginBefore', 'Profit Margin Before'], ['marginAfter', 'Profit Margin After'], ['userName', 'Changed By'],
        ['source', 'How It Was Changed'], ['reason', 'Reason'],
      ];
      summary = {
        changes: rows.length,
        sellingChanges: rows.filter((row) => row.priceType === 'selling').length,
        costChanges: rows.filter((row) => row.priceType === 'cost').length,
        largeChanges: rows.filter((row) => Math.abs(Number(row.changePercent ?? 0)) >= 25).length,
      };
    } else if (reportType === 'anomalies') {
      rows = anomalyService.list(filters);
      columns = [
        ['detectedAt', 'Found On'], ['severity', 'Importance'], ['anomalyType', 'Activity Type'], ['entityName', 'Product or Record'],
        ['expectedValue', 'Usual Value'], ['actualValue', 'Recorded Value'], ['deviation', 'Difference'],
        ['ruleName', 'Why It Was Flagged'], ['status', 'Review Status'], ['assignedTo', 'Reviewed By'], ['resolutionNote', 'Review Note'],
      ];
      summary = anomalyService.summary(filters);
    } else if (reportType === 'audit') {
      rows = auditService.list({ ...filters, limit: 2000 });
      columns = [
        ['occurredAt', 'Date'], ['userName', 'Changed By'], ['userRole', 'Access Level'], ['action', 'Action'],
        ['entityType', 'Record Type'], ['entityId', 'Record Number'], ['changeSummary', 'Before / After'],
        ['reason', 'Reason'], ['source', 'How It Was Changed'], ['correlationId', 'Related Change Number'], ['entryHash', 'Verification Code'],
      ];
      summary = { entries: rows.length, integrity: auditService.verifyIntegrity().valid ? 'Verified' : 'Review required' };
    }

    return {
      reportType,
      title: definition.title,
      description: definition.description,
      generatedAt: isoNow(),
      appliedFilters: { ...filters },
      summary,
      columns: columns.map(([key, label]) => ({ key, label })),
      rows,
    };
  },

  recordExport(reportType, filters, fileName) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    db.transaction(() => {
      db.prepare('INSERT INTO report_exports (business_id, report_type, filters_json, file_name, user_name, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(businessId, reportType, JSON.stringify(filters ?? {}), fileName, user.name, isoNow());
      writeAudit({
        db,
        businessId,
        user,
        action: 'export_report',
        entityType: 'report',
        before: {},
        after: { reportType, filters, fileName },
        reason: `${REPORT_DEFINITIONS[reportType]?.title ?? reportType} exported`,
        source: 'reports',
      });
    })();
  },
};

export const analyticsService = {
  dashboard(filters = {}) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const bounds = dateBounds(filters);
    const previous = shiftBounds(bounds);
    const inventory = db.prepare(`
      SELECT COALESCE(SUM(current_stock * cost_price), 0) AS inventory_value,
        SUM(CASE WHEN current_stock <= low_stock_limit AND current_stock > 0 THEN 1 ELSE 0 END) AS low_stock_count,
        SUM(CASE WHEN current_stock <= 0 THEN 1 ELSE 0 END) AS out_of_stock_count
      FROM products WHERE business_id = ? AND is_active = 1
    `).get(businessId);
    const currentSales = salesSummary(db, businessId, bounds);
    const previousSales = salesSummary(db, businessId, previous);
    const growthPercent = previousSales.salesTotal
      ? ((currentSales.salesTotal - previousSales.salesTotal) / previousSales.salesTotal) * 100
      : currentSales.salesTotal > 0 ? 100 : 0;
    const salesTrend = db.prepare(`
      SELECT substr(occurred_at, 1, 10) AS date,
        ROUND(SUM(quantity * unit_price), 2) AS sales,
        ROUND(SUM(quantity * (unit_price - cost_price)), 2) AS profit,
        ROUND(SUM(quantity), 2) AS quantity
      FROM transactions WHERE business_id = ? AND type = 'sale' AND occurred_at BETWEEN ? AND ?
      GROUP BY substr(occurred_at, 1, 10) ORDER BY date
    `).all(businessId, bounds.start, bounds.end).map(numberizeRow);
    const categoryPerformance = db.prepare(`
      SELECT COALESCE(c.name, 'Uncategorized') AS name,
        ROUND(SUM(t.quantity * t.unit_price), 2) AS sales,
        ROUND(SUM(t.quantity * (t.unit_price - t.cost_price)), 2) AS profit,
        ROUND(SUM(t.quantity), 2) AS quantity
      FROM transactions t JOIN products p ON p.id = t.product_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE t.business_id = ? AND t.type = 'sale' AND t.occurred_at BETWEEN ? AND ?
      GROUP BY c.name ORDER BY sales DESC
    `).all(businessId, bounds.start, bounds.end).map(numberizeRow);
    const topProducts = db.prepare(`
      SELECT p.id, p.name, ROUND(SUM(t.quantity * t.unit_price), 2) AS sales,
        ROUND(SUM(t.quantity * (t.unit_price - t.cost_price)), 2) AS profit,
        ROUND(SUM(t.quantity), 2) AS quantity
      FROM transactions t JOIN products p ON p.id = t.product_id
      WHERE t.business_id = ? AND t.type = 'sale' AND t.occurred_at BETWEEN ? AND ?
      GROUP BY p.id, p.name ORDER BY sales DESC LIMIT 8
    `).all(businessId, bounds.start, bounds.end).map(numberizeRow);
    const inventoryValueByCategory = db.prepare(`
      SELECT COALESCE(c.name, 'Uncategorized') AS name, ROUND(SUM(p.current_stock * p.cost_price), 2) AS value
      FROM products p LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.business_id = ? AND p.is_active = 1 GROUP BY c.name ORDER BY value DESC
    `).all(businessId).map(numberizeRow);
    const stockMovement = db.prepare(`
      SELECT type, ROUND(SUM(CASE WHEN type IN ('sale','damage') THEN -quantity ELSE quantity END), 2) AS quantity
      FROM transactions WHERE business_id = ? AND occurred_at BETWEEN ? AND ? GROUP BY type
    `).all(businessId, bounds.start, bounds.end).map(numberizeRow);
    const anomalySummary = anomalyService.summary({});
    const forecast = analyticsService.forecast({ ...filters, horizonDays: asNumber(filters.horizonDays, 30) });
    const agingProducts = slowSellingProductRows(db, businessId, filters, 8);
    return {
      period: bounds,
      kpis: {
        inventoryValue: round(inventory.inventory_value),
        salesTotal: round(currentSales.salesTotal),
        grossProfit: round(currentSales.grossProfit),
        discountTotal: round(currentSales.discountTotal),
        marginPercent: currentSales.salesTotal ? round((currentSales.grossProfit / currentSales.salesTotal) * 100) : 0,
        salesQuantity: round(currentSales.quantity, 3),
        lowStockCount: Number(inventory.low_stock_count ?? 0),
        outOfStockCount: Number(inventory.out_of_stock_count ?? 0),
        growthPercent: round(growthPercent),
        openAnomalies: anomalySummary.open,
        recommendedPurchaseBudget: forecast.recommendations.reduce((sum, row) => sum + row.estimatedCost, 0),
      },
      charts: { salesTrend, categoryPerformance, topProducts, inventoryValueByCategory, stockMovement },
      forecast,
      recentTransactions: transactionService.list({ limit: 8 }),
      lowStockProducts: productService.list({ stock: 'low' }).slice(0, 8),
      agingProducts,
      anomalySummary,
    };
  },

  forecast(filters = {}) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const horizonDays = Math.min(180, Math.max(7, assertWholeNumber(filters.horizonDays ?? 30, 'Forecast days', 1)));
    const lookbackStart = new Date();
    lookbackStart.setDate(lookbackStart.getDate() - 60);
    const rows = db.prepare(`
      SELECT p.id, p.name, p.current_stock, p.low_stock_limit, p.cost_price, p.selling_price,
        COALESCE(SUM(CASE WHEN t.type = 'sale' AND t.occurred_at >= ? THEN t.quantity ELSE 0 END), 0) AS sold_60,
        COALESCE(SUM(CASE WHEN t.type = 'sale' AND t.occurred_at >= ? THEN t.quantity * t.unit_price ELSE 0 END), 0) AS sales_60
      FROM products p LEFT JOIN transactions t ON t.product_id = p.id
      WHERE p.business_id = ? AND p.is_active = 1
      GROUP BY p.id ORDER BY p.name
    `).all(lookbackStart.toISOString(), lookbackStart.toISOString(), businessId);
    const recommendations = rows.map((row) => {
      const averageDailySales = Number(row.sold_60) / 60;
      const predictedDemand = Math.ceil(averageDailySales * horizonDays);
      const safetyStock = Math.max(Number(row.low_stock_limit), averageDailySales * 7);
      const recommendedQuantity = Math.max(0, Math.ceil(predictedDemand + safetyStock - Number(row.current_stock)));
      const daysOfCover = averageDailySales > 0 ? Number(row.current_stock) / averageDailySales : 999;
      return {
        productId: Number(row.id),
        productName: row.name,
        currentStock: Number(row.current_stock),
        averageDailySales: round(averageDailySales, 3),
        predictedDemand,
        recommendedQuantity,
        estimatedCost: round(recommendedQuantity * Number(row.cost_price)),
        daysOfCover: daysOfCover === 999 ? null : Math.ceil(daysOfCover),
        priority: daysOfCover < 7 ? 'high' : daysOfCover < horizonDays ? 'medium' : 'low',
        reason: recommendedQuantity > 0 ? 'Forecast demand plus safety stock exceeds current stock.' : 'Current stock covers forecast demand and safety stock.',
      };
    }).filter((row) => row.recommendedQuantity > 0).sort((a, b) => b.estimatedCost - a.estimatedCost);
    const totalPredictedSales = rows.reduce((sum, row) => sum + (Number(row.sales_60) / 60) * horizonDays, 0);
    const recent30 = rows.reduce((sum, row) => sum + Number(row.sales_60) / 2, 0);
    const growthPercent = recent30 ? ((totalPredictedSales - recent30) / recent30) * 100 : 0;
    const strategy = buildStrategySuggestions(db, businessId, recommendations);
    return {
      horizonDays,
      predictedSales: round(totalPredictedSales),
      predictedGrowthPercent: round(growthPercent),
      confidence: rows.some((row) => Number(row.sold_60) > 0) ? 'medium' : 'low',
      assumptions: ['Recent 60-day sales rate continues', 'No major seasonality adjustment', 'Current prices and supplier costs remain stable'],
      recommendations,
      strategy,
      disclaimer: 'Forecasts and strategy suggestions are estimates based on available local data. They are not guarantees, financial advice, or tax advice. Review the linked records before acting.',
    };
  },
};

function salesSummary(db, businessId, bounds) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity * unit_price), 0) AS sales_total,
      COALESCE(SUM(quantity * (unit_price - cost_price)), 0) AS gross_profit,
      COALESCE(SUM(discount_amount), 0) AS discount_total,
      COALESCE(SUM(quantity), 0) AS quantity
    FROM transactions WHERE business_id = ? AND type = 'sale' AND occurred_at BETWEEN ? AND ?
  `).get(businessId, bounds.start, bounds.end);
  return { salesTotal: Number(row.sales_total), grossProfit: Number(row.gross_profit), discountTotal: Number(row.discount_total), quantity: Number(row.quantity) };
}

function numberizeRow(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'number' ? Number(value) : value]));
}

function buildStrategySuggestions(db, businessId, recommendations) {
  const suggestions = [];
  if (recommendations.some((row) => row.priority === 'high')) {
    suggestions.push({ type: 'reorder', priority: 'high', title: 'Protect fast-moving availability', reason: 'One or more products have less than seven days of cover.', expectedImpact: 'Lower stockout risk and fewer missed sales.' });
  }
  const negativeMargins = db.prepare('SELECT COUNT(*) AS count FROM products WHERE business_id = ? AND cost_price > selling_price AND is_active = 1').get(businessId);
  if (Number(negativeMargins.count) > 0) suggestions.push({ type: 'price_change', priority: 'high', title: 'Review negative margins', reason: `${negativeMargins.count} product(s) cost more than their selling price.`, expectedImpact: 'Prevent avoidable gross losses.' });
  const lowMovement = db.prepare(`
    SELECT p.name, p.current_stock * p.cost_price AS value
    FROM products p LEFT JOIN transactions t ON t.product_id = p.id AND t.type = 'sale' AND t.occurred_at >= datetime('now', '-45 days')
    WHERE p.business_id = ? GROUP BY p.id HAVING COUNT(t.id) = 0 AND value > 0 ORDER BY value DESC LIMIT 3
  `).all(businessId);
  if (lowMovement.length) suggestions.push({ type: 'discount', priority: 'medium', title: 'Move dormant stock', reason: `${lowMovement.length} stocked product(s) have no sales in 45 days.`, expectedImpact: 'Release cash tied up in slow inventory.' });
  if (!suggestions.length) suggestions.push({ type: 'category_focus', priority: 'low', title: 'Maintain the current mix', reason: 'No immediate margin or stock-risk rule is triggered.', expectedImpact: 'Keep monitoring category growth and supplier costs.' });
  return suggestions;
}

export const anomalyService = {
  runDetection() {
    const products = productService.list({});
    for (const product of products) evaluateProductAnomalies(product.id, { source: 'scheduled_detection' });
    evaluateSalesSpikes();
    return { detectedAt: isoNow(), summary: anomalyService.summary({}), rows: anomalyService.list({}) };
  },

  list(filters = {}) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const clauses = ['business_id = ?'];
    const params = [businessId];
    if (filters.status && filters.status !== 'all') {
      clauses.push('status = ?');
      params.push(String(filters.status));
    }
    if (filters.severity && filters.severity !== 'all') {
      clauses.push('severity = ?');
      params.push(String(filters.severity));
    }
    if (filters.type && filters.type !== 'all') {
      clauses.push('anomaly_type = ?');
      params.push(String(filters.type));
    }
    if (filters.search) {
      clauses.push('(lower(entity_name) LIKE ? OR lower(explanation) LIKE ?)');
      const term = `%${String(filters.search).toLowerCase()}%`;
      params.push(term, term);
    }
    const rows = db.prepare(`SELECT * FROM anomaly_events WHERE ${clauses.join(' AND ')} ORDER BY
      CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      detected_at DESC`).all(...params);
    return rows.map(mapAnomaly);
  },

  get(id) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    return mapAnomaly(db.prepare('SELECT * FROM anomaly_events WHERE business_id = ? AND id = ?').get(businessId, id));
  },

  summary(filters = {}) {
    const rows = anomalyService.list(filters);
    const openRows = rows.filter((row) => !['resolved', 'false_positive', 'expected'].includes(row.status));
    return {
      total: rows.length,
      open: openRows.length,
      critical: openRows.filter((row) => row.severity === 'critical').length,
      high: openRows.filter((row) => row.severity === 'high').length,
      medium: openRows.filter((row) => row.severity === 'medium').length,
      resolved: rows.filter((row) => row.status === 'resolved').length,
      valueAtRisk: round(openRows.reduce((sum, row) => sum + Number(row.valueAtRisk ?? 0), 0)),
    };
  },

  updateStatus(id, status, note = '') {
    const allowed = ['open', 'reviewing', 'valid', 'expected', 'false_positive', 'resolved'];
    if (!allowed.includes(status)) throw new Error('Unsupported anomaly status.');
    if (['resolved', 'false_positive', 'expected'].includes(status) && !String(note).trim()) throw new Error('A resolution note is required.');
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const before = anomalyService.get(id);
    if (!before) throw new Error('Anomaly was not found.');
    db.transaction(() => {
      db.prepare(`
        UPDATE anomaly_events SET status = ?, resolution_note = ?, resolved_at = ?, updated_at = ?
        WHERE business_id = ? AND id = ?
      `).run(status, String(note).trim(), ['resolved', 'false_positive', 'expected'].includes(status) ? isoNow() : null, isoNow(), businessId, id);
      const after = anomalyService.get(id);
      writeAudit({
        db,
        businessId,
        user,
        action: 'review_anomaly',
        entityType: 'anomaly',
        entityId: Number(id),
        before,
        after,
        fieldChanges: fieldDiff(before, after, ['status', 'resolutionNote', 'resolvedAt']),
        reason: String(note || `Status changed to ${status}`),
        source: 'anomalies',
      });
    })();
    return anomalyService.get(id);
  },
};

function mapAnomaly(row) {
  if (!row) return null;
  const evidence = parseJson(row.evidence_json);
  return {
    id: Number(row.id),
    anomalyType: row.anomaly_type,
    entityType: row.entity_type,
    entityId: row.entity_id ? Number(row.entity_id) : null,
    entityName: row.entity_name,
    expectedValue: row.expected_value === null ? null : Number(row.expected_value),
    actualValue: row.actual_value === null ? null : Number(row.actual_value),
    deviation: row.deviation === null ? null : Number(row.deviation),
    severity: row.severity,
    status: row.status,
    ruleName: row.rule_name,
    explanation: row.explanation,
    evidence,
    valueAtRisk: Number(evidence.valueAtRisk ?? 0),
    assignedTo: row.assigned_to,
    resolutionNote: row.resolution_note,
    detectedAt: row.detected_at,
    resolvedAt: row.resolved_at,
    updatedAt: row.updated_at,
  };
}

function upsertAnomaly({ uniqueKey, anomalyType, entityType, entityId, entityName, expectedValue = null, actualValue = null, deviation = null, severity, ruleName, explanation, evidence = {} }) {
  const db = getDatabase();
  const { businessId } = getContext(db);
  const stamp = isoNow();
  db.prepare(`
    INSERT INTO anomaly_events (
      business_id, unique_key, anomaly_type, entity_type, entity_id, entity_name,
      expected_value, actual_value, deviation, severity, status, rule_name,
      explanation, evidence_json, detected_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    ON CONFLICT(business_id, unique_key) DO UPDATE SET
      expected_value = excluded.expected_value,
      actual_value = excluded.actual_value,
      deviation = excluded.deviation,
      severity = excluded.severity,
      rule_name = excluded.rule_name,
      explanation = excluded.explanation,
      evidence_json = excluded.evidence_json,
      detected_at = excluded.detected_at,
      updated_at = excluded.updated_at,
      status = CASE WHEN anomaly_events.status IN ('resolved', 'false_positive', 'expected') THEN anomaly_events.status ELSE 'open' END
  `).run(businessId, uniqueKey, anomalyType, entityType, entityId, entityName, expectedValue, actualValue, deviation, severity, ruleName, explanation, JSON.stringify(evidence), stamp, stamp);
}

function evaluateProductAnomalies(productId, context = {}) {
  const db = getDatabase();
  const { businessId } = getContext(db);
  const product = mapProduct(getProductRow(db, businessId, productId));
  if (product.costPrice > product.sellingPrice) {
    upsertAnomaly({
      uniqueKey: `negative-margin-${product.id}`,
      anomalyType: 'negative_margin',
      entityType: 'product',
      entityId: product.id,
      entityName: product.name,
      expectedValue: product.costPrice,
      actualValue: product.sellingPrice,
      deviation: round(product.sellingPrice - product.costPrice),
      severity: 'critical',
      ruleName: 'Cost exceeds selling price',
      explanation: `The current selling price is lower than cost by ${round(product.costPrice - product.sellingPrice)}.`,
      evidence: { productId: product.id, sellingPrice: product.sellingPrice, costPrice: product.costPrice, marginPercent: product.marginPercent, valueAtRisk: round((product.costPrice - product.sellingPrice) * product.currentStock), source: context.source },
    });
  }
  if (product.currentStock <= 0) {
    upsertAnomaly({
      uniqueKey: `stockout-${product.id}`,
      anomalyType: 'stockout',
      entityType: 'product',
      entityId: product.id,
      entityName: product.name,
      expectedValue: product.lowStockLimit,
      actualValue: product.currentStock,
      deviation: round(product.currentStock - product.lowStockLimit),
      severity: 'high',
      ruleName: 'Out of stock',
      explanation: 'Available stock has reached zero and may cause missed sales.',
      evidence: { productId: product.id, currentStock: product.currentStock, lowStockLimit: product.lowStockLimit, valueAtRisk: 0, source: context.source },
    });
  }
  const latestPriceChange = db.prepare(`
    SELECT * FROM product_price_history WHERE business_id = ? AND product_id = ? AND old_value IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get(businessId, product.id);
  if (latestPriceChange?.old_value) {
    const percent = ((Number(latestPriceChange.new_value) - Number(latestPriceChange.old_value)) / Number(latestPriceChange.old_value)) * 100;
    if (Math.abs(percent) >= 25) {
      upsertAnomaly({
        uniqueKey: `price-change-${latestPriceChange.id}`,
        anomalyType: 'large_price_change',
        entityType: 'product',
        entityId: product.id,
        entityName: product.name,
        expectedValue: Number(latestPriceChange.old_value),
        actualValue: Number(latestPriceChange.new_value),
        deviation: round(percent),
        severity: Math.abs(percent) >= 50 ? 'high' : 'medium',
        ruleName: 'Price changed by 25% or more',
        explanation: `${latestPriceChange.price_type === 'cost' ? 'Cost' : 'Selling'} price changed by ${round(percent)}%.`,
        evidence: { productId: product.id, priceHistoryId: Number(latestPriceChange.id), priceType: latestPriceChange.price_type, reason: latestPriceChange.reason, source: context.source },
      });
    }
  }
  if (context.transactionId) {
    const transaction = transactionService.get(context.transactionId);
    if (transaction && (transaction.type === 'adjustment' || transaction.type === 'damage') && Math.abs(transaction.stockChange) >= 20) {
      upsertAnomaly({
        uniqueKey: `large-stock-change-${transaction.id}`,
        anomalyType: 'large_stock_change',
        entityType: 'transaction',
        entityId: transaction.id,
        entityName: product.name,
        expectedValue: product.lowStockLimit,
        actualValue: Math.abs(transaction.stockChange),
        deviation: round(Math.abs(transaction.stockChange) - product.lowStockLimit),
        severity: Math.abs(transaction.stockChange) >= 50 ? 'high' : 'medium',
        ruleName: 'Large non-sale stock decrease',
        explanation: `${transaction.type} changed stock by ${Math.abs(transaction.stockChange)} ${product.unit}(s).`,
        evidence: { productId: product.id, transactionId: transaction.id, stockBefore: transaction.stockBefore, stockAfter: transaction.stockAfter, notes: transaction.notes, source: context.source },
      });
    }
  }
}

function evaluateSalesSpikes() {
  const db = getDatabase();
  const { businessId } = getContext(db);
  const rows = db.prepare(`
    WITH daily AS (
      SELECT product_id, substr(occurred_at, 1, 10) AS day, SUM(quantity) AS quantity
      FROM transactions WHERE business_id = ? AND type = 'sale' AND occurred_at >= datetime('now', '-60 days')
      GROUP BY product_id, day
    ), stats AS (
      SELECT product_id, AVG(quantity) AS avg_quantity, MAX(quantity) AS max_quantity, MAX(day) AS latest_day
      FROM daily GROUP BY product_id
    )
    SELECT s.*, p.name FROM stats s JOIN products p ON p.id = s.product_id
    WHERE s.avg_quantity > 0 AND s.max_quantity >= s.avg_quantity * 2.5
  `).all(businessId);
  for (const row of rows) {
    const percent = ((Number(row.max_quantity) - Number(row.avg_quantity)) / Number(row.avg_quantity)) * 100;
    upsertAnomaly({
      uniqueKey: `sales-spike-${row.product_id}-${row.latest_day}`,
      anomalyType: 'sales_spike',
      entityType: 'product',
      entityId: Number(row.product_id),
      entityName: row.name,
      expectedValue: round(row.avg_quantity, 2),
      actualValue: Number(row.max_quantity),
      deviation: round(percent),
      severity: percent >= 300 ? 'high' : 'medium',
      ruleName: 'Daily sales exceed 2.5x baseline',
      explanation: `Peak daily quantity is ${round(percent)}% above the recent daily average.`,
      evidence: { productId: Number(row.product_id), baselineDays: 60, latestDay: row.latest_day },
    });
  }
}

export const auditService = {
  list(filters = {}) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const clauses = ['business_id = ?'];
    const params = [businessId];
    if (filters.action && filters.action !== 'all') {
      clauses.push('action = ?');
      params.push(String(filters.action));
    }
    if (filters.entityType && filters.entityType !== 'all') {
      clauses.push('entity_type = ?');
      params.push(String(filters.entityType));
    }
    if (filters.source && filters.source !== 'all') {
      clauses.push('source = ?');
      params.push(String(filters.source));
    }
    if (filters.search) {
      clauses.push('(lower(user_name) LIKE ? OR lower(reason) LIKE ? OR lower(entity_type) LIKE ?)');
      const term = `%${String(filters.search).toLowerCase()}%`;
      params.push(term, term, term);
    }
    if (filters.startDate) {
      clauses.push('occurred_at >= ?');
      params.push(new Date(`${filters.startDate}T00:00:00.000`).toISOString());
    }
    if (filters.endDate) {
      clauses.push('occurred_at <= ?');
      params.push(new Date(`${filters.endDate}T23:59:59.999`).toISOString());
    }
    const limit = Math.min(5000, Math.max(1, asNumber(filters.limit, 500)));
    return db.prepare(`SELECT * FROM audit_logs WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC, id DESC LIMIT ${limit}`).all(...params).map(mapAudit);
  },

  getDiff(id) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    return mapAudit(db.prepare('SELECT * FROM audit_logs WHERE business_id = ? AND id = ?').get(businessId, id));
  },

  changeGraph(filters = {}) {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const bounds = dateBounds(filters);
    return db.prepare(`
      SELECT substr(occurred_at, 1, 10) AS date,
        SUM(CASE WHEN action = 'update_prices' THEN 1 ELSE 0 END) AS price,
        SUM(CASE WHEN entity_type = 'transaction' THEN 1 ELSE 0 END) AS stock,
        SUM(CASE WHEN entity_type = 'product' AND action != 'update_prices' THEN 1 ELSE 0 END) AS product,
        SUM(CASE WHEN entity_type = 'anomaly' THEN 1 ELSE 0 END) AS anomaly,
        COUNT(*) AS total
      FROM audit_logs WHERE business_id = ? AND occurred_at BETWEEN ? AND ?
      GROUP BY substr(occurred_at, 1, 10) ORDER BY date
    `).all(businessId, bounds.start, bounds.end).map(numberizeRow);
  },

  verifyIntegrity() {
    const db = getDatabase();
    const { businessId } = getContext(db);
    const rows = db.prepare('SELECT * FROM audit_logs WHERE business_id = ? ORDER BY id').all(businessId);
    let previousHash = '';
    for (const row of rows) {
      const payload = JSON.stringify({
        businessId: Number(row.business_id),
        user: { name: row.user_name, role: row.user_role },
        action: row.action,
        entityType: row.entity_type,
        entityId: row.entity_id === null ? null : Number(row.entity_id),
        before: parseJson(row.before_json),
        after: parseJson(row.after_json),
        fieldChanges: parseJson(row.field_changes_json),
        reason: row.reason,
        source: row.source,
        correlationId: row.correlation_id,
        occurredAt: row.occurred_at,
        previousHash,
      });
      const expected = createHash('sha256').update(payload).digest('hex');
      if (row.previous_hash !== previousHash || row.entry_hash !== expected) return { valid: false, checked: rows.length, failedAtId: Number(row.id) };
      previousHash = row.entry_hash;
    }
    return { valid: true, checked: rows.length, latestHash: previousHash };
  },
};

function mapAudit(row) {
  if (!row) return null;
  const changes = parseJson(row.field_changes_json);
  const changeSummary = Object.entries(changes).map(([key, value]) => `${key}: ${String(value.before ?? '-')} -> ${String(value.after ?? '-')}`).join('; ');
  return {
    id: Number(row.id),
    userName: row.user_name,
    userRole: row.user_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id === null ? null : Number(row.entity_id),
    fieldChanges: changes,
    before: parseJson(row.before_json),
    after: parseJson(row.after_json),
    changeSummary: changeSummary || 'Record created or exported',
    reason: row.reason,
    source: row.source,
    deviceId: row.device_id,
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at,
    previousHash: row.previous_hash,
    entryHash: row.entry_hash,
  };
}

export const nlpHelpService = {
  suggestedQuestions() {
    return [
      'How many Coca-Cola bottles were sold in the last 7 days?',
      'How much stock is available for a product?',
      'What were sales and profit after product cost this month?',
      'What are my top five products?',
      'Which products are low on stock?',
      'Who changed the cost price of rice?',
      'Were there unusual sales or stock changes?',
    ];
  },

  parseQuestion(question) {
    const text = assertText(question, 'Question');
    const lower = text.toLowerCase();
    let intent = 'unsupported';
    if (/\b(create|add)\b.*\b(new )?product\b/.test(lower)) intent = 'write_create_product';
    else if (/\b(how many|number of|units?)\b.*\b(sold|sales)\b/.test(lower) || /\b(sold|sales)\b.*\b(today|yesterday|last|this|week|month|day)\b/.test(lower)) intent = 'product_sales';
    else if (/\b(sold|sell|restock|purchased|return|damaged|damage|adjust stock|set stock)\b/.test(lower)) intent = 'write_transaction';
    else if (/\b(change|update|set)\b.*\b(selling price|cost price)\b/.test(lower)) intent = 'write_price';
    else if (/\b(stock|available|quantity|how many|how much .* available)\b/.test(lower) && !/low stock|out of stock|run out/.test(lower)) intent = 'inventory_lookup';
    else if (/\b(sales|revenue|profit|margin)\b/.test(lower)) intent = 'sales_summary';
    else if (/\b(top|best selling|highest selling)\b/.test(lower)) intent = 'top_products';
    else if (/\b(low stock|out of stock|run out|reorder)\b/.test(lower)) intent = 'stock_risk';
    else if (/\b(who changed|price change|cost change|changed the .* price)\b/.test(lower)) intent = 'price_changes';
    else if (/\b(unusual|anomal|suspicious|unexpected)\b/.test(lower)) intent = 'anomalies';
    const product = findMentionedProduct(text);
    const filters = periodFromQuestion(lower);
    return { question: text, intent, productId: product?.id, productName: product?.name, filters, confidence: intent === 'unsupported' ? 0.35 : product || !['inventory_lookup', 'price_changes', 'product_sales'].includes(intent) ? 0.9 : 0.55 };
  },

  answer(questionOrPlan) {
    const db = getDatabase();
    const { businessId, user } = getContext(db);
    const plan = typeof questionOrPlan === 'string' ? nlpHelpService.parseQuestion(questionOrPlan) : questionOrPlan;
    const common = {
      question: plan.question,
      intent: plan.intent,
      filters: plan.filters,
      generatedAt: isoNow(),
      disclaimer: 'This answer summarizes records in the active local database. It may be incomplete when data is missing or filtered. Open the linked records before making financial, tax, fraud, or purchasing decisions.',
    };
    let response;
    if (plan.intent === 'write_create_product') {
      response = {
        ...common,
        status: 'guided_action',
        title: 'Create this product in the manual flow',
        summary: 'NLP Help is read-only. The product form will collect required prices, category, opening stock, purchase date, and duplicate confirmation before writing to SQLite.',
        rows: [],
        sourceCount: 0,
        sourcePage: 'inventory',
        guidance: {
          title: 'Guided first-time product addition',
          description: 'Open Inventory, choose New product, complete the required fields, and review similar-product warnings.',
          example: 'Product: Amul Milk 1L, selling price 72, cost price 62, opening stock 24, category Dairy',
          actionLabel: 'Open manual product flow',
          targetPage: 'inventory',
          steps: ['Enter product and pricing details', 'Review possible duplicates', 'Confirm opening stock and save'],
        },
      };
    } else if (plan.intent === 'write_transaction') {
      response = {
        ...common,
        status: 'guided_action',
        title: 'Review this stock change before saving',
        summary: 'Write requests must use Smart Entry confirmation or the manual transaction form so stock availability and before/after values can be validated.',
        rows: [],
        sourceCount: 0,
        sourcePage: 'transactions',
        guidance: {
          title: 'Continue in the manual transaction flow',
          description: 'Select the movement type and product, enter quantity and notes, then review projected stock.',
          example: 'Sale: Coca-Cola 500ml, quantity 5',
          actionLabel: 'Open manual transaction flow',
          targetPage: 'transactions',
          steps: ['Choose sale, restock, return, damage, or adjustment', 'Select product and quantity', 'Review projected stock and confirm'],
        },
      };
    } else if (plan.intent === 'write_price') {
      response = {
        ...common,
        status: 'guided_action',
        title: 'Update the price from the product record',
        summary: 'Price updates need margin preview, version checks, a reason for large changes, price history, and an audit entry.',
        rows: [],
        sourceCount: 0,
        sourcePage: 'inventory',
        guidance: {
          title: 'Continue in the audited price flow',
          description: 'Open the product, choose Update prices, review the new margin, and confirm the reason.',
          example: 'Basmati Rice 5kg: change cost price from 545 to 560',
          actionLabel: 'Open manual price flow',
          targetPage: 'inventory',
          steps: ['Find and open the product', 'Choose Update prices', 'Review margin impact and confirm'],
        },
      };
    } else if (plan.intent === 'product_sales') {
      if (!plan.productId) {
        response = {
          ...common,
          status: 'needs_input',
          title: 'Which product should I check?',
          summary: 'Include the product name and time period, for example: How many Surf Excel packs were sold in the last 7 days?',
          rows: [],
          sourceCount: 0,
          sourcePage: 'reports',
          guidance: { title: 'Add the product name', description: 'Use the name shown in Inventory. A size or product code helps when names are similar.', example: 'How many Coca-Cola 500ml bottles were sold in the last 7 days?', actionLabel: 'Open sales report', targetPage: 'reports', steps: ['Check the product name', 'Add a time period', 'Ask the question again'] },
        };
      } else {
        const report = reportService.view('sales', { ...plan.filters, productId: plan.productId });
        const quantity = Math.round(report.rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0));
        const salesValue = round(report.rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0));
        const discounts = round(report.rows.reduce((sum, row) => sum + Number(row.discountAmount ?? 0), 0));
        const profit = round(report.rows.reduce((sum, row) => sum + Number(row.grossProfit ?? 0), 0));
        response = {
          ...common,
          status: 'answered',
          title: `${plan.productName} sales`,
          summary: `${quantity} unit(s) of ${plan.productName} were sold during ${plan.filters.periodLabel.toLowerCase()}.`,
          metrics: [{ label: 'Units sold', value: quantity }, { label: 'Sales after discounts', value: salesValue, currency: true }, { label: 'Discounts given', value: discounts, currency: true }, { label: 'Profit after product cost', value: profit, currency: true }],
          rows: report.rows.slice(0, 12),
          sourceCount: report.rows.length,
          sourcePage: 'reports',
          calculation: 'Units sold are the sum of sale quantities for this product within the shown dates. Cancelled or non-sale stock changes are not included.',
        };
      }
    } else if (plan.intent === 'inventory_lookup') {
      if (!plan.productId) {
        response = {
          ...common,
          status: 'needs_input',
          title: 'Which product do you mean?',
          summary: 'I could not confidently match a product. Try its product name, SKU, or barcode. If this is the first time you are adding it, use the manual product flow.',
          rows: [],
          sourceCount: 0,
          sourcePage: 'inventory',
          guidance: {
            title: 'Product not found',
            description: 'Search the inventory, then create the product if it does not exist. Duplicate checks run before saving.',
            example: 'Search: Coca-Cola 500ml or SKU BEV-COKE-500',
            actionLabel: 'Open manual product flow',
            targetPage: 'inventory',
            steps: ['Search by product name, SKU, or barcode', 'Choose New product if there is no match', 'Review duplicate suggestions and save'],
          },
        };
      } else {
        const product = productService.get(plan.productId);
        response = {
          ...common,
          status: 'answered',
          title: `${product.name} stock`,
          summary: `${product.currentStock} ${product.unit}(s) are available. ${product.currentStock <= product.lowStockLimit ? 'This is at or below the low-stock limit.' : 'Stock is above the configured low-stock limit.'}`,
          metrics: [
            { label: 'Available', value: product.currentStock, suffix: product.unit },
            { label: 'Low-stock limit', value: product.lowStockLimit, suffix: product.unit },
            { label: 'Stock value', value: product.stockValue, currency: true },
          ],
          rows: [product],
          sourceCount: 1,
          sourcePage: 'inventory',
          calculation: 'Current quantity is read from the product record and changes only through audited stock transactions.',
        };
      }
    } else if (plan.intent === 'sales_summary') {
      const report = reportService.view('sales', plan.filters);
      const revenue = Number(report.summary.revenue ?? 0);
      const profit = Number(report.summary.grossProfit ?? 0);
      const discounts = Number(report.summary.discountsGiven ?? 0);
      response = {
        ...common,
        status: 'answered',
        title: 'Sales and profit',
        summary: `Sales after discounts were ${round(revenue)}, discounts given were ${round(discounts)}, and profit after product cost was ${round(profit)} for the selected period.`,
        metrics: [
          { label: 'Sales after discounts', value: revenue, currency: true },
          { label: 'Discounts given', value: discounts, currency: true },
          { label: 'Profit after product cost', value: profit, currency: true },
          { label: 'Profit as % of sales', value: revenue ? round((profit / revenue) * 100) : 0, suffix: '%' },
        ],
        rows: report.rows.slice(0, 8),
        sourceCount: report.rows.length,
        sourcePage: 'reports',
        calculation: 'Sales use the final price after discount. Profit is quantity multiplied by final price minus the cost recorded for that sale.',
      };
    } else if (plan.intent === 'top_products') {
      const dashboard = analyticsService.dashboard(plan.filters);
      response = {
        ...common,
        status: 'answered',
        title: 'Top products by sales',
        summary: dashboard.charts.topProducts.length ? `${dashboard.charts.topProducts[0].name} leads the selected period by sales value.` : 'No sales were found for the selected period.',
        rows: dashboard.charts.topProducts.slice(0, 5),
        sourceCount: dashboard.charts.topProducts.length,
        sourcePage: 'dashboard',
        calculation: 'Products are ranked by total sale quantity multiplied by recorded unit price.',
      };
    } else if (plan.intent === 'stock_risk') {
      const low = productService.list({ stock: 'low' });
      const out = productService.list({ stock: 'out' });
      const rows = [...out, ...low.filter((row) => row.currentStock > 0)];
      response = {
        ...common,
        status: 'answered',
        title: 'Products needing stock attention',
        summary: `${out.length} product(s) are out of stock and ${low.length} are at or below their low-stock limit.`,
        metrics: [
          { label: 'Out of stock', value: out.length },
          { label: 'Low stock', value: low.length },
        ],
        rows: rows.slice(0, 12),
        sourceCount: rows.length,
        sourcePage: 'inventory',
        calculation: 'A product is low when current quantity is at or below its configured low-stock limit.',
      };
    } else if (plan.intent === 'price_changes') {
      const report = reportService.view('price_changes', { ...plan.filters, productId: plan.productId });
      response = {
        ...common,
        status: 'answered',
        title: plan.productName ? `${plan.productName} price changes` : 'Recent price and cost changes',
        summary: report.rows.length ? `${report.rows.length} matching audited price change(s) were found.` : 'No matching price changes were found.',
        rows: report.rows.slice(0, 12),
        sourceCount: report.rows.length,
        sourcePage: 'audit',
        calculation: 'Results come from immutable product price history and link to the related audit record when available.',
      };
    } else if (plan.intent === 'anomalies') {
      const rows = anomalyService.list({ status: 'open' });
      response = {
        ...common,
        status: 'answered',
        title: 'Open anomaly indicators',
        summary: rows.length ? `${rows.length} unusual event indicator(s) need review. Anomalies are signals, not proof of error or misconduct.` : 'No open anomaly indicators were found.',
        rows: rows.slice(0, 12),
        sourceCount: rows.length,
        sourcePage: 'anomalies',
        calculation: 'Results are generated by explainable local rules using price, margin, stock, and transaction baselines.',
      };
    } else {
      response = {
        ...common,
        status: 'unsupported',
        title: 'I cannot answer that safely yet',
        summary: 'Try asking about current stock, sales and gross profit, top products, low stock, price changes, or anomalies.',
        rows: [],
        sourceCount: 0,
        sourcePage: 'nlp_help',
        guidance: {
          title: 'Try an example or use a guided form',
          description: 'For database changes, use Smart Entry or a manual flow. For questions, include a product, metric, or date period.',
          example: 'What were sales and gross profit this month?',
          actionLabel: 'Open Smart Entry',
          targetPage: 'smart-entry',
          steps: ['State the action or business question', 'Include product and quantity when changing stock', 'Review the parsed result before confirming'],
        },
      };
    }

    db.prepare(`
      INSERT INTO nlp_query_logs (business_id, user_name, intent, filters_json, query_text, success, source_count, response_meta_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(businessId, user.name, plan.intent, JSON.stringify(plan.filters ?? {}), plan.question, response.status === 'answered' ? 1 : 0, response.sourceCount, JSON.stringify({ title: response.title, sourcePage: response.sourcePage }), isoNow());
    return response;
  },
};

function findMentionedProduct(question) {
  const products = productService.list({});
  const normalizedQuestion = normalizeName(question);
  const direct = products.find((product) => normalizedQuestion.includes(product.normalizedName));
  if (direct) return direct;
  const stripped = question
    .toLowerCase()
    .replace(/\b(how|much|many|is|are|was|were|do|did|i|have|available|stock|quantity|units?|packs?|bottles?|bags?|pieces?|sold|sales|in|who|changed|the|selling|cost|price|of|show|me|for|this|last|today|month|week|days?|one|two|three|four|five|six|seven|eight|nine|ten)\b/g, ' ')
    .replace(/\d+(?:\.\d+)?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = stripped ? matchProducts(stripped)[0] : null;
  return match?.score >= 55 ? match : null;
}

function periodFromQuestion(lower) {
  const now = new Date();
  const dateString = (value) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  if (/today/.test(lower)) return { startDate: dateString(now), endDate: dateString(now), periodLabel: 'Today' };
  if (/yesterday/.test(lower)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return { startDate: dateString(date), endDate: dateString(date), periodLabel: 'Yesterday' };
  }
  if (/last month/.test(lower)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { startDate: dateString(start), endDate: dateString(end), periodLabel: 'Last month' };
  }
  if (/this month/.test(lower)) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { startDate: dateString(start), endDate: dateString(now), periodLabel: 'This month' };
  }
  if (/last\s+(?:1|one)?\s*week|last\s+7\s+days/.test(lower)) {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return { startDate: dateString(start), endDate: dateString(now), periodLabel: 'Last 7 days' };
  }
  const start = new Date(now);
  start.setDate(start.getDate() - 29);
  return { startDate: dateString(start), endDate: dateString(now), periodLabel: 'Last 30 days' };
}

export const serviceRegistry = {
  business: businessService,
  products: productService,
  transactions: transactionService,
  smartEntry: smartEntryService,
  reports: reportService,
  analytics: analyticsService,
  anomalies: anomalyService,
  audit: auditService,
  nlpHelp: nlpHelpService,
};
