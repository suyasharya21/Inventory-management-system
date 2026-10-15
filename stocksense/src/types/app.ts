export type PageId = 'dashboard' | 'smart-entry' | 'inventory' | 'transactions' | 'reports' | 'forecast' | 'anomalies' | 'audit' | 'nlp-help' | 'backup' | 'settings';

export interface AuthStatus {
  state: 'needs_account' | 'signed_out' | 'needs_business' | 'authenticated';
  accountCount: number;
  user?: { id: number; name: string; email: string; role: string; provider: 'local' | 'google' };
  business?: { id: number; name: string };
}

export interface BusinessProfile {
  id: number;
  name: string;
  ownerName: string;
  address: string;
  phone: string;
  email: string;
  taxId: string;
  currency: string;
  timezone: string;
  themeName: string;
  primaryColor: string;
  logoPath?: string | null;
  currentUser: { id?: number; name: string; email?: string; role: string; provider?: string };
  developedBy: string;
  website: string;
}

export interface Product {
  id: number;
  businessId: number;
  name: string;
  normalizedName: string;
  sku: string;
  barcode: string;
  categoryId: number | null;
  category: string;
  unit: string;
  currentStock: number;
  lowStockLimit: number;
  minimumSales30Days: number;
  sellingPrice: number;
  costPrice: number;
  marginPercent: number;
  stockValue: number;
  latestPurchaseDate: string | null;
  version: number;
  isActive: boolean;
  updatedAt: string;
  priceHistory?: PriceHistory[];
  recentTransactions?: Transaction[];
}

export interface PriceHistory {
  id: number;
  priceType: 'selling' | 'cost';
  oldValue: number | null;
  newValue: number;
  marginBefore: number | null;
  marginAfter: number | null;
  effectiveAt: string;
  userName: string;
  source: string;
  reason: string;
}

export interface Transaction {
  id: number;
  productId: number;
  productName: string;
  category: string;
  type: string;
  quantity: number;
  stockChange: number;
  unit: string;
  listPrice: number;
  listTotal: number;
  unitPrice: number;
  costPrice: number;
  discountPercent: number;
  discountAmount: number;
  total: number;
  grossProfit: number;
  stockBefore: number;
  stockAfter: number;
  occurredAt: string;
  notes: string;
  userName: string;
  source: string;
  correlationId: string;
}

export interface SmartEntryResult {
  status: 'ready' | 'needs_input' | 'ambiguous' | 'error';
  intent: string;
  confidence: number;
  originalText: string;
  extracted: {
    productName?: string;
    productId?: number;
    quantity?: number;
    sellingPrice?: number;
    saleUnitPrice?: number;
    discountPercent?: number;
    costPrice?: number;
  };
  suggestions?: Array<Product & { score: number }>;
  message: string;
  guidance?: GuidedFlowStep;
}

export interface GuidedFlowStep {
  title: string;
  description: string;
  example?: string;
  actionLabel: string;
  targetPage: PageId;
  steps?: string[];
}

export interface DashboardData {
  period: { start: string; end: string };
  kpis: {
    inventoryValue: number;
    salesTotal: number;
    grossProfit: number;
    discountTotal: number;
    marginPercent: number;
    salesQuantity: number;
    lowStockCount: number;
    outOfStockCount: number;
    growthPercent: number;
    openAnomalies: number;
    recommendedPurchaseBudget: number;
  };
  charts: {
    salesTrend: Array<{ date: string; sales: number; profit: number; quantity: number }>;
    categoryPerformance: Array<{ name: string; sales: number; profit: number; quantity: number }>;
    topProducts: Array<{ id: number; name: string; sales: number; profit: number; quantity: number }>;
    inventoryValueByCategory: Array<{ name: string; value: number }>;
    stockMovement: Array<{ type: string; quantity: number }>;
  };
  forecast: ForecastData;
  recentTransactions: Transaction[];
  lowStockProducts: Product[];
  agingProducts: Array<{
    id: number;
    name: string;
    category: string;
    currentStock: number;
    unit: string;
    minimumSales30Days: number;
    soldQuantity: number;
    expectedSalesForPeriod: number;
    salesShortfall: number;
    targetCompletionPercent: number;
    sellingStatus: string;
    latestSaleAt: string | null;
    daysSinceLatestSale: number | null;
    stockValue: number;
  }>;
  anomalySummary: AnomalySummary;
}

export interface ForecastData {
  horizonDays: number;
  predictedSales: number;
  predictedGrowthPercent: number;
  confidence: string;
  assumptions: string[];
  recommendations: PurchaseRecommendation[];
  strategy: StrategySuggestion[];
  disclaimer: string;
}

export interface PurchaseRecommendation {
  productId: number;
  productName: string;
  currentStock: number;
  averageDailySales: number;
  predictedDemand: number;
  recommendedQuantity: number;
  estimatedCost: number;
  daysOfCover: number | null;
  priority: 'high' | 'medium' | 'low';
  reason: string;
}

export interface StrategySuggestion {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  expectedImpact: string;
}

export interface Anomaly {
  id: number;
  anomalyType: string;
  entityType: string;
  entityId: number | null;
  entityName: string;
  expectedValue: number | null;
  actualValue: number | null;
  deviation: number | null;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: string;
  ruleName: string;
  explanation: string;
  evidence: Record<string, unknown>;
  valueAtRisk: number;
  assignedTo: string;
  resolutionNote: string;
  detectedAt: string;
  resolvedAt: string | null;
  updatedAt: string;
}

export interface AnomalySummary {
  total: number;
  open: number;
  critical: number;
  high: number;
  medium: number;
  resolved: number;
  valueAtRisk: number;
}

export interface AuditEntry {
  id: number;
  userName: string;
  userRole: string;
  action: string;
  entityType: string;
  entityId: number | null;
  fieldChanges: Record<string, { before: unknown; after: unknown }>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  changeSummary: string;
  reason: string;
  source: string;
  deviceId: string;
  correlationId: string;
  occurredAt: string;
  previousHash: string;
  entryHash: string;
}

export interface ReportResult {
  reportType: string;
  title: string;
  description: string;
  generatedAt: string;
  appliedFilters: Record<string, unknown>;
  summary: Record<string, string | number>;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
}

export interface NlpAnswer {
  question: string;
  intent: string;
  filters: Record<string, unknown>;
  generatedAt: string;
  disclaimer: string;
  status: string;
  title: string;
  summary: string;
  metrics?: Array<{ label: string; value: number; suffix?: string; currency?: boolean }>;
  rows: Array<Record<string, unknown>>;
  sourceCount: number;
  sourcePage: PageId | string;
  calculation?: string;
  guidance?: GuidedFlowStep;
}

export interface AppApi {
  system: { getMeta(): Promise<Record<string, unknown>>; openPath(path: string): Promise<string> };
  speech: {
    status(): Promise<{ supported: boolean; engine: string; permission: string; private: boolean }>;
    requestPermission(): Promise<{ granted: boolean; permission: string }>;
    transcribe(payload: { audio: ArrayBuffer; language?: string; prompt?: string }): Promise<{ transcript: string; engine: string; private: boolean }>;
  };
  auth: {
    status(): Promise<AuthStatus>;
    signUp(payload: { name: string; email: string; password: string }): Promise<AuthStatus>;
    login(payload: { email: string; password: string }): Promise<AuthStatus>;
    signInGoogle(): Promise<AuthStatus>;
    completeBusiness(payload: Record<string, unknown>): Promise<AuthStatus>;
    signOut(): Promise<AuthStatus>;
  };
  business: {
    getProfile(): Promise<BusinessProfile>;
    updateProfile(payload: Partial<BusinessProfile> & { reason?: string }): Promise<BusinessProfile>;
    chooseLogo(): Promise<{ canceled: boolean; profile?: BusinessProfile }>;
    removeLogo(): Promise<BusinessProfile>;
  };
  products: {
    list(filters?: Record<string, unknown>): Promise<Product[]>;
    get(id: number): Promise<Product>;
    checkDuplicates(payload: Record<string, unknown>): Promise<Array<Product & { score: number; reasons: string[] }>>;
    create(payload: Record<string, unknown>, options?: Record<string, unknown>): Promise<{ status: string; product?: Product; candidates?: Array<Product & { score: number }> }>;
    update(id: number, payload: Record<string, unknown>): Promise<Product>;
    updatePrices(id: number, payload: Record<string, unknown>): Promise<Product>;
    setArchived(id: number, archived: boolean): Promise<Product>;
  };
  transactions: { create(payload: Record<string, unknown>): Promise<Transaction>; list(filters?: Record<string, unknown>): Promise<Transaction[]> };
  smartEntry: { parse(text: string): Promise<SmartEntryResult>; confirm(parsed: SmartEntryResult): Promise<unknown> };
  reports: {
    definitions(): Promise<Array<{ id: string; title: string; description: string }>>;
    view(reportType: string, filters?: Record<string, unknown>): Promise<ReportResult>;
    exportExcel(reportType: string, filters?: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  analytics: { dashboard(filters?: Record<string, unknown>): Promise<DashboardData>; forecast(filters?: Record<string, unknown>): Promise<ForecastData> };
  anomalies: {
    list(filters?: Record<string, unknown>): Promise<Anomaly[]>;
    get(id: number): Promise<Anomaly>;
    summary(filters?: Record<string, unknown>): Promise<AnomalySummary>;
    runDetection(): Promise<Record<string, unknown>>;
    updateStatus(id: number, status: string, note: string): Promise<Anomaly>;
  };
  audit: {
    list(filters?: Record<string, unknown>): Promise<AuditEntry[]>;
    getDiff(id: number): Promise<AuditEntry>;
    changeGraph(filters?: Record<string, unknown>): Promise<Array<{ date: string; price: number; stock: number; product: number; anomaly: number; total: number }>>;
    verifyIntegrity(): Promise<{ valid: boolean; checked: number; failedAtId?: number }>;
  };
  nlpHelp: { suggestedQuestions(): Promise<string[]>; parseQuestion(text: string): Promise<Record<string, unknown>>; answer(question: string | Record<string, unknown>): Promise<NlpAnswer> };
  backup: {
    list(): Promise<Array<Record<string, unknown>>>;
    create(options: { password: string }): Promise<Record<string, unknown>>;
    createGoogleDrive(options: { password: string }): Promise<Record<string, unknown>>;
    restore(options: { password: string }): Promise<Record<string, unknown>>;
  };
  drive: {
    status(): Promise<{ configured: boolean; connected: boolean; email: string }>;
    connect(): Promise<{ configured: boolean; connected: boolean; email: string }>;
    disconnect(): Promise<{ configured: boolean; connected: boolean; email: string }>;
  };
}
