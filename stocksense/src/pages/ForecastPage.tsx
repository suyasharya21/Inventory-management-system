import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, RefreshCw, ShoppingCart, Sparkles, TrendingUp } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { formatCompact, formatCurrency, formatNumber } from '../lib/format';
import type { ForecastData } from '../types/app';
import { Badge, Button, DataTable, LoadingState, SectionHeader, StatCard } from '../components/Ui';

export function ForecastPage({ currency }: { currency: string }) {
  const [horizonDays, setHorizonDays] = useState(30);
  const [data, setData] = useState<ForecastData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = async () => { setLoading(true); setError(''); try { setData(await api.analytics.forecast({ horizonDays })); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Forecast could not be generated.'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [horizonDays]);
  const projection = useMemo(() => {
    if (!data) return [];
    return Array.from({ length: 7 }, (_, index) => ({ period: `${Math.round((index + 1) * data.horizonDays / 7)}d`, expected: round(data.predictedSales * (index + 1) / 7), lower: round(data.predictedSales * (index + 1) / 7 * 0.86), upper: round(data.predictedSales * (index + 1) / 7 * 1.14) }));
  }, [data]);
  if (loading && !data) return <LoadingState label="Calculating forecast from local history" />;
  if (!data) return null;
  return <div className="page-stack">
    <div className="page-heading"><div><span className="eyebrow">Planning suggestions</span><h1>Future sales and purchase advice</h1><p>Estimated future sales, quantities to buy, and practical actions based on recent records.</p></div><div className="heading-actions"><div className="segmented-control" aria-label="Number of days to estimate">{[7, 30, 90].map((days) => <button key={days} className={horizonDays === days ? 'active' : ''} onClick={() => setHorizonDays(days)}>{days} days</button>)}</div><Button variant="secondary" icon={<RefreshCw size={16} />} onClick={load}>Refresh</Button></div></div>
    {error && <div className="inline-alert alert-danger"><CircleAlert size={18} /><span>{error}</span></div>}
    <div className="disclaimer-callout"><CircleAlert size={19} /><div><strong>Planning estimate, not a guarantee</strong><p>{data.disclaimer}</p></div></div>
    <section className="stat-grid stat-grid-4"><StatCard label="Estimated future sales" value={formatCompact(data.predictedSales, currency)} detail={`Next ${data.horizonDays} days`} icon={<TrendingUp size={18} />} /><StatCard label="Estimated sales change" value={`${data.predictedGrowthPercent >= 0 ? '+' : ''}${formatNumber(data.predictedGrowthPercent)}%`} detail="Compared with recent sales" icon={<Sparkles size={18} />} tone={data.predictedGrowthPercent >= 0 ? 'good' : 'danger'} /><StatCard label="Estimated purchase cost" value={formatCompact(data.recommendations.reduce((sum, row) => sum + row.estimatedCost, 0), currency)} detail={`${data.recommendations.length} products`} icon={<ShoppingCart size={18} />} /><StatCard label="How reliable" value={data.confidence} detail="See what this estimate assumes" tone={data.confidence === 'high' ? 'good' : 'warn'} /></section>
    <section className="panel chart-panel forecast-chart"><SectionHeader title="Suggested future sales" description="Expected cumulative sales with a simple confidence range" /><div className="chart-frame"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 280 }}><AreaChart data={projection} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}><CartesianGrid stroke="#e6ebeb" vertical={false} /><XAxis dataKey="period" tick={{ fontSize: 11 }} /><YAxis tickFormatter={(value) => formatCompact(value)} tick={{ fontSize: 11 }} width={56} /><Tooltip formatter={(value) => formatCurrency(Number(value), currency)} /><Area type="monotone" dataKey="upper" stroke="none" fill="#dcebea" fillOpacity={0.72} /><Area type="monotone" dataKey="expected" stroke="#2f6f73" fill="#2f6f73" fillOpacity={0.16} strokeWidth={2.5} /><Area type="monotone" dataKey="lower" stroke="#6d989a" fill="transparent" strokeDasharray="4 4" /></AreaChart></ResponsiveContainer></div></section>
    <section className="panel table-panel"><SectionHeader title="Purchase plan" description="Prioritized products using forecast demand, safety stock, current stock, and cost" /><DataTable rows={data.recommendations as unknown as Array<Record<string, unknown>>} columns={[
      { key: 'productName', label: 'Product', render: (row) => <span className="table-primary"><strong>{String(row.productName)}</strong><small>{String(row.reason)}</small></span> },
      { key: 'currentStock', label: 'In stock', align: 'right' },
      { key: 'predictedDemand', label: 'Estimated items needed', align: 'right', render: (row) => formatNumber(Number(row.predictedDemand), 0) },
      { key: 'daysOfCover', label: 'Estimated days remaining', align: 'right', render: (row) => row.daysOfCover === null ? 'No recent sales' : formatNumber(Number(row.daysOfCover), 0) },
      { key: 'recommendedQuantity', label: 'Suggested quantity to buy', align: 'right', render: (row) => <strong>{formatNumber(Number(row.recommendedQuantity), 0)}</strong> },
      { key: 'estimatedCost', label: 'Estimated cost', align: 'right', render: (row) => formatCurrency(Number(row.estimatedCost), currency) },
      { key: 'priority', label: 'How soon', render: (row) => <Badge tone={row.priority === 'high' ? 'danger' : row.priority === 'medium' ? 'warning' : 'neutral'}>{row.priority === 'high' ? 'Buy soon' : row.priority === 'medium' ? 'Plan to buy' : 'Can wait'}</Badge> },
    ]} empty="Current stock covers forecast demand and configured safety stock." /></section>
    <section><SectionHeader title="Suggested strategy changes" description="Rule-based actions with reasons and expected impact" /><div className="strategy-grid">{data.strategy.map((suggestion, index) => <article key={`${suggestion.type}-${index}`} className="strategy-card"><div><Badge tone={suggestion.priority === 'high' ? 'danger' : suggestion.priority === 'medium' ? 'warning' : 'neutral'}>{suggestion.priority} priority</Badge><span className="strategy-type">{suggestion.type.replace(/_/g, ' ')}</span></div><h3>{suggestion.title}</h3><p>{suggestion.reason}</p><footer><span>Expected impact</span><strong>{suggestion.expectedImpact}</strong></footer></article>)}</div></section>
    <section className="assumption-band"><div><strong>Assumptions used</strong><p>These inputs explain why the forecast may change.</p></div><ul>{data.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></section>
  </div>;
}

const round = (value: number) => Math.round(value * 100) / 100;
