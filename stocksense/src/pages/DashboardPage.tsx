import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Clock3, IndianRupee, PackageX, RefreshCw, ShoppingCart, TrendingUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { daysAgoInput, formatCompact, formatCurrency, formatDate, formatNumber, todayInput } from '../lib/format';
import type { DashboardData, PageId } from '../types/app';
import { Badge, Button, DataTable, ErrorState, Field, Input, LoadingState, SectionHeader, StatCard } from '../components/Ui';

const chartColors = ['#2f6f73', '#b7791f', '#4d7c0f', '#b42318', '#65758b'];

export function DashboardPage({ currency, onNavigate }: { currency: string; onNavigate(page: PageId): void }) {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ startDate: daysAgoInput(29), endDate: todayInput() });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api.analytics.dashboard(filters));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dashboard could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { void load(); }, [load]);
  const openReport = (reportType: string) => { window.sessionStorage.setItem('stocksense-report-type', reportType); onNavigate('reports'); };
  if (loading && !data) return <LoadingState label="Reading your local business data" />;
  if (error && !data) return <ErrorState message={error} retry={load} />;
  if (!data) return null;

  const growthPositive = data.kpis.growthPercent >= 0;
  return <div className="page-stack">
    <div className="page-heading">
      <div><span className="eyebrow">Business overview</span><h1>Current business status</h1><p>Sales, stock, profit, unusual activity, and suggested next actions from this device.</p></div>
      <div className="heading-actions filter-inline">
        <Field label="From"><Input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /></Field>
        <Field label="To"><Input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></Field>
        <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={load}>Refresh</Button>
      </div>
    </div>

    <section className="stat-grid stat-grid-6" aria-label="Key business indicators">
      <StatCard label="Sales after discounts" value={formatCompact(data.kpis.salesTotal, currency)} detail={`${formatNumber(data.kpis.salesQuantity)} items · ${formatCompact(data.kpis.discountTotal, currency)} discounts`} icon={<IndianRupee size={18} />} onClick={() => openReport('sales')} />
      <StatCard label="Profit after product cost" value={formatCompact(data.kpis.grossProfit, currency)} detail={`${formatNumber(data.kpis.marginPercent)}% of sales`} icon={<TrendingUp size={18} />} tone="good" onClick={() => openReport('profit')} />
      <StatCard label="Stock value" value={formatCompact(data.kpis.inventoryValue, currency)} detail="Using current cost prices" icon={<Boxes size={18} />} onClick={() => onNavigate('inventory')} />
      <StatCard label="Sales change" value={`${growthPositive ? '+' : ''}${formatNumber(data.kpis.growthPercent)}%`} detail="Compared with the previous period" icon={growthPositive ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />} tone={growthPositive ? 'good' : 'danger'} onClick={() => openReport('sales')} />
      <StatCard label="Low / out of stock" value={`${data.kpis.lowStockCount} / ${data.kpis.outOfStockCount}`} detail="Products that need attention" icon={<PackageX size={18} />} tone="warn" onClick={() => onNavigate('inventory')} />
      <StatCard label="Suggested purchase cost" value={formatCompact(data.kpis.recommendedPurchaseBudget, currency)} detail={`${data.forecast.recommendations.length} products suggested`} icon={<ShoppingCart size={18} />} onClick={() => onNavigate('forecast')} />
    </section>

    <section className="analytics-grid">
      <div className="panel chart-panel chart-wide">
        <SectionHeader title="Sales and profit" description="Daily totals after discounts for the selected dates" />
        <div className="chart-frame"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 280 }}><LineChart data={data.charts.salesTrend} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}><CartesianGrid stroke="#e6ebeb" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} tick={{ fontSize: 11 }} /><YAxis tickFormatter={(value) => formatCompact(value)} tick={{ fontSize: 11 }} width={54} /><Tooltip formatter={(value) => formatCurrency(Number(value), currency)} labelFormatter={(value) => formatDate(String(value))} /><Legend /><Line type="monotone" dataKey="sales" name="Sales" stroke="#2f6f73" strokeWidth={2.5} dot={{ r: 3 }} /><Line type="monotone" dataKey="profit" name="Profit after product cost" stroke="#b7791f" strokeWidth={2.2} dot={{ r: 3 }} /></LineChart></ResponsiveContainer></div>
      </div>
      <div className="panel chart-panel">
        <SectionHeader title="Inventory value" description="Current cost value by category" />
        <div className="chart-frame"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 280 }}><PieChart><Pie data={data.charts.inventoryValueByCategory} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>{data.charts.inventoryValueByCategory.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}</Pie><Tooltip formatter={(value) => formatCurrency(Number(value), currency)} /><Legend iconType="circle" /></PieChart></ResponsiveContainer></div>
      </div>
      <div className="panel chart-panel">
        <SectionHeader title="Sales by category" description="Sales after discounts for each category" />
        <div className="chart-frame"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 280 }}><BarChart data={data.charts.categoryPerformance} layout="vertical" margin={{ top: 4, right: 12, left: 10, bottom: 0 }}><CartesianGrid stroke="#e6ebeb" horizontal={false} /><XAxis type="number" tickFormatter={(value) => formatCompact(value)} tick={{ fontSize: 11 }} /><YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={82} /><Tooltip formatter={(value) => formatCurrency(Number(value), currency)} /><Bar dataKey="sales" fill="#2f6f73" radius={[0, 3, 3, 0]} /></BarChart></ResponsiveContainer></div>
      </div>
      <div className="panel chart-panel chart-wide">
        <SectionHeader title="Top products" description="Products with the most sales and profit" action={<Button variant="ghost" onClick={() => openReport('sales')}>Open sales report</Button>} />
        <div className="chart-frame"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 280 }}><BarChart data={data.charts.topProducts} margin={{ top: 8, right: 12, left: 0, bottom: 34 }}><CartesianGrid stroke="#e6ebeb" vertical={false} /><XAxis dataKey="name" angle={-18} textAnchor="end" interval={0} tick={{ fontSize: 10 }} height={58} /><YAxis tickFormatter={(value) => formatCompact(value)} tick={{ fontSize: 11 }} /><Tooltip formatter={(value) => formatCurrency(Number(value), currency)} /><Legend /><Bar dataKey="sales" name="Sales" fill="#2f6f73" radius={[3, 3, 0, 0]} /><Bar dataKey="profit" name="Profit" fill="#b7791f" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div>
      </div>
    </section>

    <section className="recommendation-band">
      <div className="recommendation-summary"><span className="recommendation-icon"><TrendingUp size={20} /></span><div><span className="eyebrow">Next {data.forecast.horizonDays} days</span><strong>{formatCurrency(data.forecast.predictedSales, currency)} suggested future sales</strong><p>{data.forecast.confidence} confidence based on recent local sales history.</p></div></div>
      <div className="recommendation-actions"><Badge tone="info">Estimated {data.forecast.predictedGrowthPercent >= 0 ? '+' : ''}{formatNumber(data.forecast.predictedGrowthPercent)}% growth</Badge><Button onClick={() => onNavigate('forecast')}>Review purchase plan</Button></div>
    </section>

    <section className="panel table-panel aging-products-panel">
      <SectionHeader title="Aging products (selling slowly)" description="Products that sold fewer units than the target you set for the selected dates" action={<Button variant="ghost" icon={<Clock3 size={16} />} onClick={() => openReport('aging_inventory')}>Open aging report</Button>} />
      <DataTable
        rows={data.agingProducts as unknown as Array<Record<string, unknown>>}
        columns={[
          { key: 'name', label: 'Product', render: (row) => <div className="product-cell"><span><strong>{String(row.name)}</strong><small>{String(row.category)}</small></span></div> },
          { key: 'soldQuantity', label: 'Sold / expected', align: 'right', render: (row) => <strong>{formatNumber(Number(row.soldQuantity), 0)} / {formatNumber(Number(row.expectedSalesForPeriod), 0)}</strong> },
          { key: 'sellingStatus', label: 'Sales status', render: (row) => <Badge tone={Number(row.soldQuantity) === 0 ? 'danger' : 'warning'}>{String(row.sellingStatus)}</Badge> },
          { key: 'currentStock', label: 'Current stock', align: 'right', render: (row) => `${formatNumber(Number(row.currentStock), 0)} ${String(row.unit)}` },
          { key: 'latestSaleAt', label: 'Latest sale', render: (row) => row.latestSaleAt ? formatDate(String(row.latestSaleAt), true) : 'No sale recorded' },
          { key: 'stockValue', label: 'Stock value', align: 'right', render: (row) => formatCurrency(Number(row.stockValue), currency) },
        ]}
        onRowClick={() => openReport('aging_inventory')}
        empty="No products are below their sales target for these dates."
      />
    </section>

    <section className="split-section">
      <div className="panel">
        <SectionHeader title="Recent activity" description="Latest transactions across the business" action={<Button variant="ghost" onClick={() => onNavigate('transactions')}>View all</Button>} />
        <DataTable rows={data.recentTransactions as unknown as Array<Record<string, unknown>>} columns={[
          { key: 'occurredAt', label: 'Date', render: (row) => formatDate(String(row.occurredAt), true) },
          { key: 'productName', label: 'Product' },
          { key: 'type', label: 'Type', render: (row) => <Badge tone={row.type === 'sale' ? 'info' : row.type === 'damage' ? 'danger' : 'success'}>{String(row.type)}</Badge> },
          { key: 'quantity', label: 'Qty', align: 'right' },
          { key: 'total', label: 'Value', align: 'right', render: (row) => formatCurrency(Number(row.total), currency) },
        ]} />
      </div>
      <div className="panel attention-panel">
        <SectionHeader title="Attention needed" description="Low stock and unusual activity" action={<Button variant="ghost" onClick={() => onNavigate('anomalies')}>Review unusual activity</Button>} />
        <div className="attention-summary"><AlertTriangle size={19} /><span><strong>{data.anomalySummary.open}</strong> unusual items to review</span></div>
        <div className="compact-list">{data.lowStockProducts.map((product) => <button key={product.id} onClick={() => onNavigate('inventory')}><span><strong>{product.name}</strong><small>{product.category}</small></span><Badge tone={product.currentStock <= 0 ? 'danger' : 'warning'}>{product.currentStock} {product.unit}</Badge></button>)}</div>
      </div>
    </section>
  </div>;
}
