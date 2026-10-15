import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { CircleAlert, RefreshCw, ScanSearch, ShieldAlert } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { formatCurrency, formatDate, formatNumber, humanize } from '../lib/format';
import type { Anomaly, AnomalySummary } from '../types/app';
import { Badge, Button, DataTable, Field, LoadingState, Modal, SectionHeader, Select, StatCard, Textarea } from '../components/Ui';

const emptySummary: AnomalySummary = { total: 0, open: 0, critical: 0, high: 0, medium: 0, resolved: 0, valueAtRisk: 0 };

export function AnomaliesPage({ currency }: { currency: string }) {
  const [rows, setRows] = useState<Anomaly[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [filters, setFilters] = useState({ status: 'all', severity: 'all' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Anomaly>();
  const [review, setReview] = useState({ status: 'reviewing', note: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, stats] = await Promise.all([api.anomalies.list(filters), api.anomalies.summary(filters)]);
      setRows(items); setSummary(stats);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unusual activity could not be loaded.'); } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  const chartData = useMemo(() => ['critical', 'high', 'medium', 'low'].map((severity) => ({ severity: humanize(severity), count: rows.filter((row) => row.severity === severity).length })), [rows]);
  const openDetail = (row: Anomaly) => { setSelected(row); setReview({ status: row.status === 'open' ? 'reviewing' : row.status, note: row.resolutionNote }); };
  const saveReview = async (event: FormEvent) => { event.preventDefault(); if (!selected) return; try { const updated = await api.anomalies.updateStatus(selected.id, review.status, review.note); setSelected(updated); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Review could not be saved.'); } };
  const run = async () => { setLoading(true); try { await api.anomalies.runDetection(); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The unusual activity check could not run.'); } };

  return <div className="page-stack">
    <div className="page-heading"><div><span className="eyebrow">Automatic checks</span><h1>Unusual activity</h1><p>Review price, cost, profit, sales, and stock activity that looks different from normal.</p></div><div className="heading-actions"><Select aria-label="Importance" value={filters.severity} onChange={(event) => setFilters((current) => ({ ...current, severity: event.target.value }))}><option value="all">All importance levels</option><option value="critical">Urgent</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select><Select aria-label="Review status" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="all">All review statuses</option><option value="open">Needs review</option><option value="reviewing">Being reviewed</option><option value="resolved">Resolved</option><option value="false_positive">False alarm</option></Select><Button icon={<ScanSearch size={16} />} onClick={run}>Check now</Button></div></div>
    {error && <div className="inline-alert alert-danger"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
    <div className="disclaimer-callout"><ShieldAlert size={19} /><div><strong>A warning is not proof</strong><p>These are automatic warnings about unusual data, not proof of fraud, theft, an accounting error, or misconduct. Check the matching records before taking action.</p></div></div>
    <section className="stat-grid stat-grid-5"><StatCard label="Needs review" value={summary.open} detail={`${summary.total} findings in total`} tone="warn" /><StatCard label="Urgent" value={summary.critical} detail="Review now" tone={summary.critical ? 'danger' : 'default'} /><StatCard label="High importance" value={summary.high} detail="Review today" tone={summary.high ? 'warn' : 'default'} /><StatCard label="Resolved" value={summary.resolved} detail="Finished reviews" tone="good" /><StatCard label="Estimated value affected" value={formatCurrency(summary.valueAtRisk, currency)} detail="Estimate only" /></section>
    <section className="panel chart-panel anomaly-chart"><SectionHeader title="Findings by importance" description="Current and past automatic findings" action={<Button variant="ghost" icon={<RefreshCw size={15} />} onClick={load}>Refresh</Button>} /><div className="chart-frame"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 280 }}><BarChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}><CartesianGrid stroke="#e6ebeb" vertical={false} /><XAxis dataKey="severity" tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="count" fill="#b7791f" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
    <section className="panel table-panel"><SectionHeader title="Items to review" description="Select a row to see why it was flagged and the records used" />{loading ? <LoadingState label="Checking for unusual activity" /> : <DataTable rows={rows as unknown as Array<Record<string, unknown>>} onRowClick={(row) => openDetail(row as unknown as Anomaly)} columns={[
      { key: 'detectedAt', label: 'Found on', render: (row) => formatDate(String(row.detectedAt), true) },
      { key: 'severity', label: 'Importance', render: (row) => <Badge tone={row.severity === 'critical' ? 'danger' : row.severity === 'high' ? 'warning' : 'info'}>{row.severity === 'critical' ? 'Urgent' : String(row.severity)}</Badge> },
      { key: 'entityName', label: 'Product or record', render: (row) => <span className="table-primary"><strong>{String(row.entityName)}</strong><small>{humanize(String(row.anomalyType))}</small></span> },
      { key: 'expectedValue', label: 'Expected', align: 'right', render: (row) => row.expectedValue === null ? '-' : formatNumber(Number(row.expectedValue)) },
      { key: 'actualValue', label: 'Recorded', align: 'right', render: (row) => row.actualValue === null ? '-' : formatNumber(Number(row.actualValue)) },
      { key: 'deviation', label: 'Difference', align: 'right', render: (row) => row.deviation === null ? '-' : formatNumber(Number(row.deviation)) },
      { key: 'status', label: 'Review status', render: (row) => <Badge tone={row.status === 'resolved' ? 'success' : row.status === 'open' ? 'warning' : 'neutral'}>{row.status === 'open' ? 'Needs review' : row.status === 'false_positive' ? 'False alarm' : humanize(String(row.status))}</Badge> },
      { key: 'ruleName', label: 'Why it was flagged' },
    ]} />}</section>

    <Modal open={Boolean(selected)} onClose={() => setSelected(undefined)} title={selected?.entityName ?? 'Unusual activity details'} description={selected ? `${humanize(selected.anomalyType)} · found ${formatDate(selected.detectedAt, true)}` : undefined} size="large" footer={<><Button variant="secondary" onClick={() => setSelected(undefined)}>Close</Button><Button onClick={() => document.getElementById('review-submit')?.click()}>Save review</Button></>}>
      {selected && <div className="anomaly-detail"><div className="detail-stats"><div><span>Importance</span><strong>{selected.severity === 'critical' ? 'Urgent' : humanize(selected.severity)}</strong></div><div><span>Expected</span><strong>{selected.expectedValue ?? '-'}</strong></div><div><span>Recorded</span><strong>{selected.actualValue ?? '-'}</strong></div><div><span>Review status</span><strong>{selected.status === 'open' ? 'Needs review' : humanize(selected.status)}</strong></div></div><div className="evidence-explanation"><strong>{selected.ruleName}</strong><p>{selected.explanation}</p></div><SectionHeader title="Records used for this check" description="These values explain why the item was flagged" /><dl className="evidence-grid">{Object.entries(selected.evidence).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{String(value ?? '-')}</dd></div>)}</dl><form className="review-form" onSubmit={saveReview}><Field label="Review outcome"><Select value={review.status} onChange={(event) => setReview((current) => ({ ...current, status: event.target.value }))}><option value="reviewing">Being reviewed</option><option value="valid">Confirmed issue</option><option value="expected">Expected activity</option><option value="false_positive">False alarm</option><option value="resolved">Resolved</option></Select></Field><Field label="Review note"><Textarea required={['resolved', 'false_positive', 'expected'].includes(review.status)} rows={3} value={review.note} onChange={(event) => setReview((current) => ({ ...current, note: event.target.value }))} placeholder="Required when closing this review" /></Field><button id="review-submit" type="submit" hidden /></form></div>}
    </Modal>
  </div>;
}
