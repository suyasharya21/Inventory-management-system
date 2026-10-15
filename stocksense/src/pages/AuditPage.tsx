import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Download, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import { daysAgoInput, formatDate, humanize, todayInput } from '../lib/format';
import type { AuditEntry } from '../types/app';
import { Badge, Button, DataTable, Field, Input, LoadingState, Modal, SectionHeader, Select } from '../components/Ui';

export function AuditPage() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [graph, setGraph] = useState<Array<{ date: string; price: number; stock: number; product: number; anomaly: number; total: number }>>([]);
  const [integrity, setIntegrity] = useState<{ valid: boolean; checked: number; failedAtId?: number }>();
  const [filters, setFilters] = useState({ startDate: daysAgoInput(29), endDate: todayInput(), search: '', action: 'all', entityType: 'all' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AuditEntry>();
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [entries, graphRows, check] = await Promise.all([api.audit.list({ ...filters, limit: 1000 }), api.audit.changeGraph(filters), api.audit.verifyIntegrity()]);
      setRows(entries); setGraph(graphRows); setIntegrity(check);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Change history could not be loaded.'); } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { const timeout = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timeout); }, [load]);
  const exportAudit = async () => { try { await api.reports.exportExcel('audit', filters); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Change history report could not be downloaded.'); } };

  return <div className="page-stack">
    <div className="page-heading"><div><span className="eyebrow">Protected record</span><h1>Change history</h1><p>See who changed each record, when it changed, why it changed, and its before-and-after values.</p></div><div className="heading-actions"><Button variant="secondary" icon={<RefreshCw size={16} />} onClick={load}>Refresh</Button><Button icon={<Download size={16} />} onClick={exportAudit}>Download change report</Button></div></div>
    {error && <div className="inline-alert alert-danger"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
    <section className={`integrity-band ${integrity?.valid ? 'integrity-good' : 'integrity-bad'}`}><span>{integrity?.valid ? <ShieldCheck size={22} /> : <CircleAlert size={22} />}</span><div><strong>{integrity?.valid ? 'Protected history verified' : 'Protected history needs review'}</strong><p>{integrity?.valid ? `${integrity.checked} saved changes passed verification.` : `A saved change could not be verified${integrity?.failedAtId ? ` at record ${integrity.failedAtId}` : ''}.`}</p></div><Badge tone={integrity?.valid ? 'success' : 'danger'}>{integrity?.valid ? 'Verified' : 'Attention'}</Badge></section>
    <section className="audit-filterbar"><div className="search-control"><Search size={17} /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search person, reason, or record" /></div><Field label="From"><Input type="date" value={filters.startDate} onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))} /></Field><Field label="To"><Input type="date" value={filters.endDate} onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))} /></Field><Field label="Record type"><Select value={filters.entityType} onChange={(event) => setFilters((current) => ({ ...current, entityType: event.target.value }))}><option value="all">All record types</option><option value="product">Products</option><option value="transaction">Stock activity</option><option value="anomaly">Unusual activity</option><option value="business">Business details</option><option value="report">Reports</option><option value="backup">Backups</option></Select></Field></section>
    <section className="panel chart-panel audit-chart"><SectionHeader title="Changes over time" description="Price, stock, product, and unusual-activity reviews by day" /><div className="chart-frame"><ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0} initialDimension={{ width: 800, height: 280 }}><AreaChart data={graph} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}><CartesianGrid stroke="#e6ebeb" vertical={false} /><XAxis dataKey="date" tickFormatter={(value) => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} tick={{ fontSize: 11 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip labelFormatter={(value) => formatDate(String(value))} /><Legend /><Area type="monotone" dataKey="stock" name="Stock" stackId="1" stroke="#2f6f73" fill="#2f6f73" fillOpacity={0.5} /><Area type="monotone" dataKey="price" name="Price" stackId="1" stroke="#b7791f" fill="#b7791f" fillOpacity={0.5} /><Area type="monotone" dataKey="product" name="Product" stackId="1" stroke="#65758b" fill="#65758b" fillOpacity={0.45} /><Area type="monotone" dataKey="anomaly" name="Unusual activity review" stackId="1" stroke="#b42318" fill="#b42318" fillOpacity={0.35} /></AreaChart></ResponsiveContainer></div></section>
    <section className="panel table-panel"><SectionHeader title="Saved changes" description="Old records are kept. Corrections are saved as new changes." />{loading ? <LoadingState label="Verifying and loading change history" /> : <DataTable rows={rows as unknown as Array<Record<string, unknown>>} onRowClick={(row) => setSelected(row as unknown as AuditEntry)} columns={[
      { key: 'occurredAt', label: 'Date', render: (row) => formatDate(String(row.occurredAt), true) },
      { key: 'userName', label: 'Changed by', render: (row) => <span className="table-primary"><strong>{String(row.userName)}</strong><small>{String(row.userRole)}</small></span> },
      { key: 'action', label: 'Action', render: (row) => <Badge tone={String(row.action).includes('price') ? 'warning' : String(row.action).includes('backup') ? 'info' : 'neutral'}>{humanize(String(row.action))}</Badge> },
      { key: 'entityType', label: 'Record', render: (row) => `${humanize(String(row.entityType))}${row.entityId ? ` #${row.entityId}` : ''}` },
      { key: 'changeSummary', label: 'Change' },
      { key: 'reason', label: 'Reason' },
      { key: 'source', label: 'Changed from' },
    ]} />}</section>

    <Modal open={Boolean(selected)} onClose={() => setSelected(undefined)} title="Change details" description={selected ? `${humanize(selected.action)} · ${formatDate(selected.occurredAt, true)}` : undefined} size="large" footer={<Button variant="secondary" onClick={() => setSelected(undefined)}>Close</Button>}>
      {selected && <div className="audit-detail"><div className="audit-meta"><div><span>Changed by</span><strong>{selected.userName} · {selected.userRole}</strong></div><div><span>Changed from</span><strong>{selected.source}</strong></div><div><span>Record</span><strong>{humanize(selected.entityType)} {selected.entityId ? `#${selected.entityId}` : ''}</strong></div><div><span>Related change number</span><strong className="mono">{selected.correlationId}</strong></div></div><SectionHeader title="What changed" description={selected.reason} /><div className="diff-table"><div className="diff-head"><span>Field</span><span>Before</span><span>After</span></div>{Object.entries(selected.fieldChanges).length ? Object.entries(selected.fieldChanges).map(([field, change]) => <div key={field}><strong>{humanize(field)}</strong><code>{formatDiffValue(change.before)}</code><code>{formatDiffValue(change.after)}</code></div>) : <div><strong>Record event</strong><code>-</code><code>{selected.changeSummary}</code></div>}</div><div className="hash-proof"><CheckCircle2 size={18} /><div><strong>Verification code</strong><code>{selected.entryHash}</code></div></div></div>}
    </Modal>
  </div>;
}

function formatDiffValue(value: unknown) {
  if (value === null || value === undefined) return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
