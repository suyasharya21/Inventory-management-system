import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, CircleAlert, Plus, RefreshCw, Search } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDate, formatNumber } from '../lib/format';
import type { Product, Transaction } from '../types/app';
import { Badge, Button, DataTable, Field, Input, LoadingState, Modal, Select, Textarea } from '../components/Ui';

export function TransactionsPage({ currency }: { currency: string }) {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filters, setFilters] = useState({ search: '', type: 'all' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: 'sale', productId: '', quantity: '1', unitPrice: '', discountPercent: '0', notes: '', adjustmentMode: 'delta' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [transactionRows, productRows] = await Promise.all([api.transactions.list({ ...filters, limit: 500 }), api.products.list({})]);
      setRows(transactionRows);
      setProducts(productRows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Transactions could not be loaded.'); } finally { setLoading(false); }
  }, [filters]);
  useEffect(() => { const timeout = window.setTimeout(() => void load(), 150); return () => window.clearTimeout(timeout); }, [load]);

  const selectedProduct = products.find((product) => product.id === Number(form.productId));
  const openCreate = (type = 'sale') => { setForm({ type, productId: String(products[0]?.id ?? ''), quantity: '1', unitPrice: String(type === 'sale' ? products[0]?.sellingPrice ?? '' : products[0]?.costPrice ?? ''), discountPercent: '0', notes: '', adjustmentMode: 'delta' }); setOpen(true); };
  const changeProduct = (productId: string) => { const product = products.find((item) => item.id === Number(productId)); setForm((current) => ({ ...current, productId, discountPercent: '0', unitPrice: String(current.type === 'sale' ? product?.sellingPrice ?? '' : product?.costPrice ?? '') })); };
  const changeType = (type: string) => { setForm((current) => ({ ...current, type, discountPercent: '0', unitPrice: String(type === 'sale' ? selectedProduct?.sellingPrice ?? '' : selectedProduct?.costPrice ?? '') })); };
  const changeDiscount = (value: number) => { const discount = Math.min(100, Math.max(0, value || 0)); const listPrice = selectedProduct?.sellingPrice ?? 0; setForm((current) => ({ ...current, discountPercent: String(discount), unitPrice: String(roundMoney(listPrice * (1 - discount / 100))) })); };
  const changeFinalPrice = (value: number) => { const listPrice = selectedProduct?.sellingPrice ?? 0; const finalPrice = Math.min(listPrice, Math.max(0, value || 0)); const discount = listPrice ? roundMoney(((listPrice - finalPrice) / listPrice) * 100) : 0; setForm((current) => ({ ...current, unitPrice: String(finalPrice), discountPercent: String(discount) })); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    try {
      await api.transactions.create({ type: form.type, productId: Number(form.productId), quantity: Number(form.quantity), unitPrice: Number(form.unitPrice), discountPercent: Number(form.discountPercent), costPrice: Number(form.unitPrice), updateCostPrice: form.type === 'restock', notes: form.notes, adjustmentMode: form.adjustmentMode, source: 'stock_activity' });
      setOpen(false);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Transaction could not be recorded.'); }
  };

  return <div className="page-stack">
    <div className="page-heading"><div><span className="eyebrow">Stock records</span><h1>Stock activity</h1><p>Sales, stock added, returns, damage, and corrections with the quantity before and after.</p></div><div className="heading-actions"><Button variant="secondary" icon={<RefreshCw size={16} />} onClick={load}>Refresh</Button><Button icon={<Plus size={16} />} onClick={() => openCreate()}>Add stock activity</Button></div></div>
    {error && <div className="inline-alert alert-danger"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}
    <section className="quick-action-band"><button onClick={() => openCreate('sale')}><ArrowUpFromLine size={18} /><span><strong>Record sale</strong><small>Decrease available stock</small></span></button><button onClick={() => openCreate('restock')}><ArrowDownToLine size={18} /><span><strong>Record restock</strong><small>Increase stock and capture cost</small></span></button><button onClick={() => openCreate('damage')}><CircleAlert size={18} /><span><strong>Record damage</strong><small>Decrease unusable stock</small></span></button></section>
    <section className="panel table-panel">
      <div className="table-toolbar"><div className="search-control"><Search size={17} /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search product or notes" /></div><Select value={filters.type} onChange={(event) => setFilters((current) => ({ ...current, type: event.target.value }))}><option value="all">All movement types</option><option value="sale">Sales</option><option value="restock">Restocks</option><option value="return">Returns</option><option value="damage">Damage</option><option value="adjustment">Adjustments</option></Select></div>
      {loading ? <LoadingState label="Loading stock activity" /> : <DataTable rows={rows as unknown as Array<Record<string, unknown>>} columns={[
        { key: 'occurredAt', label: 'Date', render: (row) => formatDate(String(row.occurredAt), true) },
        { key: 'type', label: 'Type', render: (row) => <Badge tone={row.type === 'sale' ? 'info' : row.type === 'damage' ? 'danger' : row.type === 'adjustment' ? 'warning' : 'success'}>{String(row.type)}</Badge> },
        { key: 'productName', label: 'Product', render: (row) => <span className="table-primary"><strong>{String(row.productName)}</strong><small>{String(row.category)}</small></span> },
        { key: 'quantity', label: 'Qty', align: 'right', render: (row) => formatNumber(Number(row.quantity)) },
        { key: 'listTotal', label: 'Before discount', align: 'right', render: (row) => row.type === 'sale' ? formatCurrency(Number(row.listTotal), currency) : '-' },
        { key: 'discountAmount', label: 'Discount', align: 'right', render: (row) => row.type === 'sale' ? `${formatCurrency(Number(row.discountAmount), currency)} (${formatNumber(Number(row.discountPercent))}%)` : '-' },
        { key: 'stockChange', label: 'Change', align: 'right', render: (row) => <span className={Number(row.stockChange) >= 0 ? 'value-positive' : 'value-negative'}>{Number(row.stockChange) > 0 ? '+' : ''}{formatNumber(Number(row.stockChange))}</span> },
        { key: 'stockAfter', label: 'After', align: 'right', render: (row) => formatNumber(Number(row.stockAfter)) },
        { key: 'total', label: 'Value', align: 'right', render: (row) => formatCurrency(Number(row.total), currency) },
        { key: 'userName', label: 'Recorded by', render: (row) => <span className="table-primary"><strong>{String(row.userName)}</strong><small>{String(row.source)}</small></span> },
        { key: 'notes', label: 'Notes' },
      ]} />}
    </section>

    <Modal open={open} onClose={() => setOpen(false)} title="Add stock activity" description="Check the product, quantity, price, discount, and resulting stock before saving." footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => document.getElementById('transaction-submit')?.click()}>Save activity</Button></>}>
      <form className="form-grid" onSubmit={save}>
        <Field label="Movement type"><Select value={form.type} onChange={(event) => changeType(event.target.value)}><option value="sale">Sale</option><option value="restock">Restock</option><option value="return">Customer return</option><option value="damage">Damage</option><option value="adjustment">Manual adjustment</option></Select></Field>
        <Field label="Product"><Select required value={form.productId} onChange={(event) => changeProduct(event.target.value)}><option value="">Choose product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select></Field>
        {form.type === 'adjustment' && <Field label="Adjustment mode"><Select value={form.adjustmentMode} onChange={(event) => setForm((current) => ({ ...current, adjustmentMode: event.target.value }))}><option value="delta">Increase / decrease by</option><option value="set">Set exact quantity</option></Select></Field>}
        <Field label={form.type === 'adjustment' && form.adjustmentMode === 'set' ? 'New stock quantity' : 'Quantity'}><Input type="number" step="1" min={form.type === 'adjustment' && form.adjustmentMode === 'delta' ? undefined : '1'} value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></Field>
        {form.type === 'sale' && selectedProduct ? <>
          <Field label="Selling price per item"><Input readOnly value={formatCurrency(selectedProduct.sellingPrice, currency)} /></Field>
          <Field label="Total before discount"><Input readOnly value={formatCurrency(Number(form.quantity || 0) * selectedProduct.sellingPrice, currency)} /></Field>
          <Field label="Discount %"><Input type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={(event) => changeDiscount(Number(event.target.value))} /></Field>
          <Field label="Price per item after discount"><Input type="number" min="0" max={selectedProduct.sellingPrice} step="0.01" value={form.unitPrice} onChange={(event) => changeFinalPrice(Number(event.target.value))} /></Field>
          <Field label="Total after discount"><Input readOnly value={formatCurrency(Number(form.quantity || 0) * Number(form.unitPrice || 0), currency)} /></Field>
        </> : <Field label="Cost per item"><Input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} /></Field>}
        {selectedProduct && <div className="stock-preview span-2"><span>Current stock <strong>{formatNumber(selectedProduct.currentStock)} {selectedProduct.unit}</strong></span><span>Projected stock <strong>{formatNumber(form.type === 'adjustment' && form.adjustmentMode === 'set' ? Number(form.quantity) : selectedProduct.currentStock + Number(form.quantity || 0) * (['sale', 'damage'].includes(form.type) ? -1 : 1))} {selectedProduct.unit}</strong></span></div>}
        <Field label="Reason / notes" className="span-2"><Textarea required={form.type === 'adjustment'} rows={3} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder={form.type === 'adjustment' ? 'Required for manual adjustments' : 'Optional transaction note'} /></Field>
        <button id="transaction-submit" type="submit" hidden />
      </form>
    </Modal>
  </div>;
}

function roundMoney(value: number) { return Math.round(value * 100) / 100; }
