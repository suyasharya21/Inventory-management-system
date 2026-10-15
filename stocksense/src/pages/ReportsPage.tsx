import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, CircleAlert, Download, FileSpreadsheet, Filter, RefreshCw, Search } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { daysAgoInput, formatCurrency, formatDate, formatNumber, humanize, todayInput } from '../lib/format';
import type { ReportResult } from '../types/app';
import { Badge, Button, DataTable, Field, Input, LoadingState, Select } from '../components/Ui';

export function ReportsPage({ currency }: { currency: string }) {
  const [definitions, setDefinitions] = useState<Array<{ id: string; title: string; description: string }>>([]);
  const [activeType, setActiveType] = useState(() => {
    const requested = window.sessionStorage.getItem('stocksense-report-type');
    window.sessionStorage.removeItem('stocksense-report-type');
    return requested || 'inventory';
  });
  const [report, setReport] = useState<ReportResult>();
  const [filters, setFilters] = useState({ startDate: daysAgoInput(29), endDate: todayInput(), search: '', stock: 'all', sellingStatus: 'all' });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeFilters = useMemo(() => {
    if (['inventory', 'low_stock'].includes(activeType)) return { search: filters.search, stock: filters.stock };
    if (activeType === 'aging_inventory') return { startDate: filters.startDate, endDate: filters.endDate, search: filters.search, sellingStatus: filters.sellingStatus };
    return { startDate: filters.startDate, endDate: filters.endDate, search: filters.search };
  }, [activeType, filters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [items, result] = await Promise.all([api.reports.definitions(), api.reports.view(activeType, activeFilters)]);
      setDefinitions(items);
      setReport(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Report could not be generated.'); } finally { setLoading(false); }
  }, [activeType, activeFilters]);
  useEffect(() => { void load(); }, [load]);

  const exportReport = async () => {
    setExporting(true);
    setError('');
    try {
      const result = await api.reports.exportExcel(activeType, activeFilters);
      if (!result.canceled) setNotice(`Exported ${String(result.fileName ?? 'report')}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Report could not be exported.'); } finally { setExporting(false); }
  };

  const graphData = useMemo(() => {
    if (!report) return [];
    return report.rows.slice(0, 10).map((row, index) => ({ name: String(row.productName ?? row.name ?? row.entityName ?? row.type ?? index + 1).slice(0, 18), value: Number(report.reportType === 'aging_inventory' ? row.salesShortfall : row.total ?? row.stockValue ?? row.currentStock ?? row.actualValue ?? row.quantity ?? 0) }));
  }, [report]);

  const columns = (report?.columns ?? []).map((column) => ({
    ...column,
    render: (row: Record<string, unknown>) => renderReportValue(column.key, row[column.key], currency),
  }));

  return <div className="page-stack reports-page">
    <div className="page-heading"><div><span className="eyebrow">View and download</span><h1>Business reports</h1><p>Choose a report, apply filters, review every detail, and download the same records to Excel.</p></div><div className="heading-actions"><Button variant="secondary" icon={<RefreshCw size={16} />} onClick={load}>Refresh</Button><Button icon={<Download size={16} />} onClick={exportReport} disabled={exporting}>{exporting ? 'Preparing...' : 'Download Excel'}</Button></div></div>
    {error && <div className="inline-alert alert-danger"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
    {notice && <div className="inline-alert alert-success"><FileSpreadsheet size={18} /><span>{notice}</span><button onClick={() => setNotice('')}>Dismiss</button></div>}
    {['sales', 'profit'].includes(activeType) && <div className="inline-alert alert-info"><CircleAlert size={18} /><span>These reports keep the cost saved at the time of each sale. A later cost update appears in Current Stock and Prices and Selling Price and Cost Changes, but it does not rewrite old sales.</span></div>}
    {activeType === 'price_changes' && <div className="inline-alert alert-info"><CircleAlert size={18} /><span>Every confirmed selling-price or cost-price update appears here. Use Refresh after making a change in another window.</span></div>}
    {activeType === 'aging_inventory' && <div className="inline-alert alert-info"><CircleAlert size={18} /><span>A product is aging when its sales are below the “Minimum sales expected in 30 days” target saved in Inventory. The target is automatically adjusted to match the selected dates. Products with a target of 0 are not monitored.</span></div>}
    <div className="report-workspace">
      <aside className="report-catalog"><span className="catalog-title">Available reports</span>{definitions.map((item) => <button key={item.id} className={activeType === item.id ? 'active' : ''} onClick={() => setActiveType(item.id)}><FileSpreadsheet size={17} /><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}</aside>
      <div className="report-content">
        <section className={`report-filterbar ${['inventory', 'low_stock'].includes(activeType) ? 'compact-filters' : ''}`}><div className="filterbar-label"><Filter size={17} /><span>Filters</span></div>{!['inventory', 'low_stock'].includes(activeType) && <><Field label="From"><Input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /></Field><Field label="To"><Input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></Field></>}<Field label="Search"><div className="search-control"><Search size={16} /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder={activeType === 'aging_inventory' ? 'Product or category' : 'Product, note, user'} /></div></Field>{['inventory', 'low_stock'].includes(activeType) && <Field label="Stock status"><Select value={filters.stock} onChange={(event) => setFilters((current) => ({ ...current, stock: event.target.value }))}><option value="all">All</option><option value="healthy">Healthy</option><option value="low">Low</option><option value="out">Out</option></Select></Field>}{activeType === 'aging_inventory' && <Field label="Show"><Select value={filters.sellingStatus} onChange={(event) => setFilters((current) => ({ ...current, sellingStatus: event.target.value }))}><option value="all">All below target</option><option value="no_sales">No sales only</option></Select></Field>}</section>
        {loading || !report ? <LoadingState label="Building report preview" /> : <>
          <div className="report-title"><div><span className="eyebrow">Report preview</span><h2>{report.title}</h2><p>{report.description}</p></div><Badge tone="neutral">Generated {formatDate(report.generatedAt, true)}</Badge></div>
          <section className="summary-strip">{Object.entries(report.summary).slice(0, 6).map(([key, value]) => <div key={key}><span>{summaryLabel(key)}</span><strong>{formatSummary(key, value, currency)}</strong></div>)}</section>
          {graphData.some((item) => item.value !== 0) && <section className="panel report-chart"><div className="section-header"><div><h2><BarChart3 size={18} /> Report overview</h2><p>{activeType === 'aging_inventory' ? 'Quantity below the sales target for the first ten products' : 'First ten rows using the primary numeric value'}</p></div></div><div className="report-chart-frame"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 280 }}><BarChart data={graphData} margin={{ top: 8, right: 12, left: 0, bottom: 28 }}><CartesianGrid stroke="#e6ebeb" vertical={false} /><XAxis dataKey="name" angle={-16} textAnchor="end" interval={0} tick={{ fontSize: 10 }} height={52} /><YAxis tickFormatter={(value) => new Intl.NumberFormat('en-IN', { notation: 'compact' }).format(value)} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => formatNumber(Number(value))} /><Bar dataKey="value" fill="#2f6f73" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></section>}
          <section className="panel table-panel"><div className="table-result-meta"><span><strong>{report.rows.length}</strong> matching records</span><span>The Excel download uses these exact filters</span></div><DataTable rows={report.rows} columns={columns} rowKey="id" /></section>
          <div className="filters-used"><strong>Filters used</strong>{Object.entries(report.appliedFilters).filter(([, value]) => value !== '' && value !== 'all').map(([key, value]) => <Badge key={key} tone="neutral">{humanize(key)}: {String(value)}</Badge>)}</div>
        </>}
      </div>
    </div>
  </div>;
}

function renderReportValue(key: string, value: unknown, currency: string) {
  if (value === null || value === undefined || value === '') return '-';
  if (/(price|cost|value|total|profit|spend)/i.test(key) && typeof value === 'number') return formatCurrency(value, currency);
  if (/date|At$/.test(key) && typeof value === 'string') return formatDate(value, key.endsWith('At'));
  if (/(margin|percent|deviation)/i.test(key) && typeof value === 'number') return `${formatNumber(value)}%`;
  if (['severity', 'status', 'type', 'priceType', 'action', 'sellingStatus'].includes(key)) return <Badge tone={String(value).includes('No sales') ? 'danger' : String(value).includes('below') || String(value).includes('Below') ? 'warning' : 'neutral'}>{humanize(String(value))}</Badge>;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatSummary(key: string, value: string | number, currency: string) {
  if (typeof value === 'number' && /(value|sales|profit|spend|budget|cost|revenue|discount)/i.test(key)) return formatCurrency(value, currency);
  if (typeof value === 'number') return formatNumber(value);
  return value;
}

function summaryLabel(key: string) {
  return ({ rowCount: 'Matching records', quantity: 'Total quantity', revenue: 'Sales after discounts', discountsGiven: 'Discounts given', purchaseSpend: 'Stock purchase cost', grossProfit: 'Profit after product cost', productCount: 'Products', totalQuantity: 'Total quantity', stockValue: 'Stock value at cost', lowStockCount: 'Low-stock products', agingProductCount: 'Products below sales target', noSaleProductCount: 'Products with no sales', totalCurrentQuantity: 'Current quantity in aging products', slowStockValue: 'Value tied up in aging products' } as Record<string, string>)[key] ?? humanize(key);
}
