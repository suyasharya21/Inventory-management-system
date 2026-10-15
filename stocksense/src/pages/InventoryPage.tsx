import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, CircleAlert, Edit3, Eye, PackagePlus, RefreshCw, Search, Tags } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatDate, formatNumber, todayInput } from '../lib/format';
import type { Product } from '../types/app';
import { Badge, Button, DataTable, ErrorState, Field, Input, LoadingState, Modal, SectionHeader, Select, Textarea } from '../components/Ui';

type ProductForm = { name: string; sku: string; barcode: string; category: string; unit: string; quantity: string; sellingPrice: string; costPrice: string; lowStockLimit: string; minimumSales30Days: string; datePurchased: string; reason: string };
const emptyForm = (): ProductForm => ({ name: '', sku: '', barcode: '', category: '', unit: 'unit', quantity: '0', sellingPrice: '0', costPrice: '0', lowStockLimit: '5', minimumSales30Days: '', datePurchased: todayInput(), reason: '' });

export function InventoryPage({ currency }: { currency: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [filters, setFilters] = useState({ search: '', category: 'all', stock: 'all' });
  const [inventoryView, setInventoryView] = useState<'active' | 'archived'>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm());
  const [editingId, setEditingId] = useState<number>();
  const [duplicates, setDuplicates] = useState<Array<Product & { score: number; reasons?: string[] }>>([]);
  const [detail, setDetail] = useState<Product>();
  const [priceProduct, setPriceProduct] = useState<Product>();
  const [priceForm, setPriceForm] = useState({ sellingPrice: '', costPrice: '', reason: '' });
  const [stockProduct, setStockProduct] = useState<Product>();
  const [stockForm, setStockForm] = useState({ type: 'restock', quantity: '1', unitPrice: '', discountPercent: '0', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setProducts(await api.products.list({ ...filters, archived: inventoryView === 'archived' })); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Inventory could not be loaded.'); } finally { setLoading(false); }
  }, [filters, inventoryView]);
  useEffect(() => { const timeout = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timeout); }, [load]);

  const allCategories = useMemo(() => [...new Set(products.map((product) => product.category))].sort(), [products]);
  const inventoryValue = products.reduce((sum, product) => sum + product.stockValue, 0);
  const openCreate = () => { setForm(emptyForm()); setEditingId(undefined); setDuplicates([]); setFormMode('create'); };
  const openEdit = (product: Product) => {
    setEditingId(product.id);
    setForm({ name: product.name, sku: product.sku, barcode: product.barcode, category: product.category, unit: product.unit, quantity: String(product.currentStock), sellingPrice: String(product.sellingPrice), costPrice: String(product.costPrice), lowStockLimit: String(product.lowStockLimit), minimumSales30Days: String(product.minimumSales30Days), datePurchased: product.latestPurchaseDate?.slice(0, 10) ?? todayInput(), reason: '' });
    setDuplicates([]);
    setFormMode('edit');
  };

  const saveProduct = async (event?: FormEvent, createAnyway = false) => {
    event?.preventDefault();
    setError('');
    try {
      if (formMode === 'edit' && editingId) {
        await api.products.update(editingId, { name: form.name, sku: form.sku, barcode: form.barcode, category: form.category, unit: form.unit, lowStockLimit: Number(form.lowStockLimit), minimumSales30Days: Number(form.minimumSales30Days), reason: form.reason || 'Product details updated' });
        setNotice('Product details updated.');
        setFormMode(null);
      } else {
        const result = await api.products.create({ ...form, quantity: Number(form.quantity), sellingPrice: Number(form.sellingPrice), costPrice: Number(form.costPrice), lowStockLimit: Number(form.lowStockLimit), minimumSales30Days: Number(form.minimumSales30Days) }, { createAnyway });
        if (result.status === 'duplicate_warning') { setDuplicates((result.candidates ?? []) as Array<Product & { score: number; reasons?: string[] }>); return; }
        setNotice('Product created with opening stock and audit history.');
        setFormMode(null);
      }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Product could not be saved.'); }
  };

  const openDetail = async (product: Product) => {
    setDetail(await api.products.get(product.id));
  };

  const openPrice = (product: Product) => {
    setPriceProduct(product);
    setPriceForm({ sellingPrice: String(product.sellingPrice), costPrice: String(product.costPrice), reason: '' });
  };

  const savePrices = async (event: FormEvent) => {
    event.preventDefault();
    if (!priceProduct) return;
    try {
      await api.products.updatePrices(priceProduct.id, { sellingPrice: Number(priceForm.sellingPrice), costPrice: Number(priceForm.costPrice), reason: priceForm.reason, expectedVersion: priceProduct.version });
      setPriceProduct(undefined);
      setNotice('Prices updated. The new cost is now in Current Stock and Prices and Selling Price and Cost Changes. Past sales keep their original recorded cost.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Prices could not be updated.'); }
  };

  const openStock = (product: Product, type: 'sale' | 'restock') => {
    setStockProduct(product);
    setStockForm({ type, quantity: '1', unitPrice: String(type === 'sale' ? product.sellingPrice : product.costPrice), discountPercent: '0', notes: '' });
  };
  const changeStockType = (type: string) => setStockForm((current) => ({ ...current, type, discountPercent: '0', unitPrice: String(type === 'sale' ? stockProduct?.sellingPrice ?? '' : stockProduct?.costPrice ?? '') }));
  const changeStockDiscount = (value: number) => {
    const discount = Math.min(100, Math.max(0, value || 0));
    const listPrice = stockProduct?.sellingPrice ?? 0;
    setStockForm((current) => ({ ...current, discountPercent: String(discount), unitPrice: String(roundMoney(listPrice * (1 - discount / 100))) }));
  };
  const changeStockFinalPrice = (value: number) => {
    const listPrice = stockProduct?.sellingPrice ?? 0;
    const finalPrice = Math.min(listPrice, Math.max(0, value || 0));
    const discount = listPrice ? roundMoney(((listPrice - finalPrice) / listPrice) * 100) : 0;
    setStockForm((current) => ({ ...current, unitPrice: String(finalPrice), discountPercent: String(discount) }));
  };
  const saveStock = async (event: FormEvent) => {
    event.preventDefault();
    if (!stockProduct) return;
    try {
      await api.transactions.create({ productId: stockProduct.id, type: stockForm.type, quantity: Number(stockForm.quantity), unitPrice: Number(stockForm.unitPrice), discountPercent: Number(stockForm.discountPercent), costPrice: Number(stockForm.unitPrice), updateCostPrice: stockForm.type === 'restock', notes: stockForm.notes, source: 'inventory_quick_action' });
      setStockProduct(undefined);
      setNotice(`${stockForm.type === 'sale' ? 'Sale' : 'Restock'} recorded.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Stock action could not be recorded.'); }
  };

  const setArchived = async (product: Product, archived: boolean) => {
    if (archived && !window.confirm(`Archive ${product.name}? Its past sales and reports will stay unchanged.`)) return;
    try {
      await api.products.setArchived(product.id, archived);
      setDetail(undefined);
      setNotice(archived ? `${product.name} moved to Archived products.` : `${product.name} restored to active products.`);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The product status could not be changed.'); }
  };

  return <div className="page-stack">
    <div className="page-heading"><div><span className="eyebrow">Your products</span><h1>Products and stock</h1><p>See quantities and prices, record sales or restocks, and keep old products in the archive.</p></div><div className="heading-actions"><div className="segmented-control" aria-label="Choose product list"><button className={inventoryView === 'active' ? 'active' : ''} onClick={() => setInventoryView('active')}>Active products</button><button className={inventoryView === 'archived' ? 'active' : ''} onClick={() => setInventoryView('archived')}>Archived products</button></div><Button variant="secondary" icon={<RefreshCw size={16} />} onClick={load}>Refresh</Button>{inventoryView === 'active' && <Button icon={<PackagePlus size={16} />} onClick={openCreate}>New product</Button>}</div></div>
    {notice && <div className="inline-alert alert-success"><span>{notice}</span><button onClick={() => setNotice('')}>Dismiss</button></div>}
    {error && <div className="inline-alert alert-danger"><CircleAlert size={18} /><span>{error}</span><button onClick={() => setError('')}>Dismiss</button></div>}

    <section className="inventory-summary"><div><span>{inventoryView === 'active' ? 'Active products shown' : 'Archived products shown'}</span><strong>{products.length}</strong></div><div><span>Stock value at cost</span><strong>{formatCurrency(inventoryValue, currency)}</strong></div><div><span>Low or out of stock</span><strong>{products.filter((item) => item.currentStock <= item.lowStockLimit).length}</strong></div></section>

    <section className="panel table-panel">
      <div className="table-toolbar">
        <div className="search-control"><Search size={17} /><input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search name, product code, or barcode" /></div>
        <div className="filter-group"><Select value={filters.category} onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value }))}><option value="all">All categories</option>{allCategories.map((category) => <option key={category}>{category}</option>)}</Select><Select value={filters.stock} onChange={(event) => setFilters((current) => ({ ...current, stock: event.target.value }))}><option value="all">All stock</option><option value="healthy">Healthy</option><option value="low">Low stock</option><option value="out">Out of stock</option></Select></div>
      </div>
      {loading ? <LoadingState label="Reading inventory" /> : <DataTable rows={products as unknown as Array<Record<string, unknown>>} columns={[
        { key: 'name', label: 'Product', render: (row) => <div className="product-cell"><span className="product-glyph"><Tags size={16} /></span><span><strong>{String(row.name)}</strong><small>{String(row.sku || 'No product code')} · {String(row.category)}</small></span></div> },
        { key: 'currentStock', label: 'Stock', align: 'right', render: (row) => <div className="stock-cell"><strong>{formatNumber(Number(row.currentStock))}</strong><Badge tone={Number(row.currentStock) <= 0 ? 'danger' : Number(row.currentStock) <= Number(row.lowStockLimit) ? 'warning' : 'success'}>{Number(row.currentStock) <= 0 ? 'Out' : Number(row.currentStock) <= Number(row.lowStockLimit) ? 'Low' : 'Healthy'}</Badge></div> },
        { key: 'sellingPrice', label: 'Selling price', align: 'right', render: (row) => formatCurrency(Number(row.sellingPrice), currency) },
        { key: 'costPrice', label: 'Cost price', align: 'right', render: (row) => formatCurrency(Number(row.costPrice), currency) },
        { key: 'marginPercent', label: 'Profit margin', align: 'right', render: (row) => <Badge tone={Number(row.marginPercent) < 0 ? 'danger' : Number(row.marginPercent) < 15 ? 'warning' : 'success'}>{formatNumber(Number(row.marginPercent))}%</Badge> },
        { key: 'latestPurchaseDate', label: 'Last purchased', render: (row) => formatDate(String(row.latestPurchaseDate ?? '')) },
        { key: 'actions', label: 'Actions', render: (row) => { const product = row as unknown as Product; return <div className="row-actions"><button title="View product" onClick={(event) => { event.stopPropagation(); void openDetail(product); }}><Eye size={16} /></button>{inventoryView === 'active' ? <><button title="Record sale" onClick={(event) => { event.stopPropagation(); openStock(product, 'sale'); }}><ArrowUpFromLine size={16} /></button><button title="Restock" onClick={(event) => { event.stopPropagation(); openStock(product, 'restock'); }}><ArrowDownToLine size={16} /></button><button title="Update prices" onClick={(event) => { event.stopPropagation(); openPrice(product); }}><Edit3 size={16} /></button><button title="Archive product" onClick={(event) => { event.stopPropagation(); void setArchived(product, true); }}><Archive size={16} /></button></> : <button title="Restore product" onClick={(event) => { event.stopPropagation(); void setArchived(product, false); }}><ArchiveRestore size={16} /></button>}</div>; } },
      ]} onRowClick={(row) => void openDetail(row as unknown as Product)} />}
    </section>

    <Modal open={Boolean(formMode)} onClose={() => setFormMode(null)} title={formMode === 'edit' ? 'Edit product details' : 'Create product'} description="Selling and cost prices are stored separately. We check for similar products before creating one." size="large" footer={<><Button variant="secondary" onClick={() => setFormMode(null)}>Cancel</Button><Button onClick={() => document.getElementById('product-submit')?.click()}>{formMode === 'edit' ? 'Save changes' : 'Create product'}</Button></>}>
      {duplicates.length > 0 && <div className="duplicate-warning"><div><CircleAlert size={19} /><span><strong>Potential duplicates found</strong><small>Review these before creating another product.</small></span></div>{duplicates.map((candidate) => <div className="duplicate-row" key={candidate.id}><span><strong>{candidate.name}</strong><small>{candidate.sku} · {candidate.category} · {candidate.currentStock} in stock</small></span><Badge tone="warning">{candidate.score}% match</Badge></div>)}<div className="duplicate-actions"><Button variant="secondary" onClick={() => { setFormMode(null); void openDetail(duplicates[0]); }}>Use existing</Button><Button variant="danger" onClick={() => void saveProduct(undefined, true)}>Create anyway</Button></div></div>}
      <form className="form-grid" onSubmit={saveProduct}>
        <Field label="Product name" className="span-2"><Input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field>
        <Field label="Product code (SKU)"><Input value={form.sku} onChange={(event) => setForm((current) => ({ ...current, sku: event.target.value }))} /></Field>
        <Field label="Barcode"><Input value={form.barcode} onChange={(event) => setForm((current) => ({ ...current, barcode: event.target.value }))} /></Field>
        <Field label="Category"><Input required value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} list="category-list" /><datalist id="category-list">{allCategories.map((category) => <option key={category}>{category}</option>)}</datalist></Field>
        <Field label="Unit"><Input required value={form.unit} onChange={(event) => setForm((current) => ({ ...current, unit: event.target.value }))} /></Field>
        {formMode === 'create' && <><Field label="Opening quantity"><Input required type="number" min="0" step="1" value={form.quantity} onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))} /></Field><Field label="Date purchased"><Input required type="date" value={form.datePurchased} onChange={(event) => setForm((current) => ({ ...current, datePurchased: event.target.value }))} /></Field><Field label="Selling price per item"><Input required type="number" min="0" step="0.01" value={form.sellingPrice} onChange={(event) => setForm((current) => ({ ...current, sellingPrice: event.target.value }))} /></Field><Field label="Cost price per item"><Input required type="number" min="0" step="0.01" value={form.costPrice} onChange={(event) => setForm((current) => ({ ...current, costPrice: event.target.value }))} /></Field></>}
        <Field label="Low-stock reminder quantity"><Input required type="number" min="0" step="1" value={form.lowStockLimit} onChange={(event) => setForm((current) => ({ ...current, lowStockLimit: event.target.value }))} /></Field>
        <Field label="Minimum sales expected in 30 days" hint="StockSense marks this product as aging when sales are below this whole-number target. Enter 0 to turn off aging monitoring."><Input required type="number" min="0" step="1" value={form.minimumSales30Days} onChange={(event) => setForm((current) => ({ ...current, minimumSales30Days: event.target.value }))} placeholder="For example, 10" /></Field>
        <Field label="Reason for change" className="span-2"><Textarea rows={2} value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Optional unless this is a large change" /></Field>
        <button id="product-submit" type="submit" hidden />
      </form>
    </Modal>

    <Modal open={Boolean(priceProduct)} onClose={() => setPriceProduct(undefined)} title={`Update prices${priceProduct ? ` · ${priceProduct.name}` : ''}`} description="Past sales and purchases keep their original prices. This saves a price history and a protected change record." footer={<><Button variant="secondary" onClick={() => setPriceProduct(undefined)}>Cancel</Button><Button onClick={() => document.getElementById('price-submit')?.click()}>Update prices</Button></>}>
      {priceProduct && <form className="form-grid" onSubmit={savePrices}><Field label="Selling price"><Input type="number" min="0" step="0.01" value={priceForm.sellingPrice} onChange={(event) => setPriceForm((current) => ({ ...current, sellingPrice: event.target.value }))} /></Field><Field label="Cost price"><Input type="number" min="0" step="0.01" value={priceForm.costPrice} onChange={(event) => setPriceForm((current) => ({ ...current, costPrice: event.target.value }))} /></Field><div className="margin-preview span-2"><span>Profit margin after change</span><strong>{Number(priceForm.sellingPrice) ? formatNumber(((Number(priceForm.sellingPrice) - Number(priceForm.costPrice)) / Number(priceForm.sellingPrice)) * 100) : '0'}%</strong></div><Field label="Change reason" className="span-2"><Textarea required={Math.max(Math.abs(Number(priceForm.sellingPrice) - priceProduct.sellingPrice) / Math.max(priceProduct.sellingPrice, 1), Math.abs(Number(priceForm.costPrice) - priceProduct.costPrice) / Math.max(priceProduct.costPrice, 1)) >= 0.25} rows={3} value={priceForm.reason} onChange={(event) => setPriceForm((current) => ({ ...current, reason: event.target.value }))} /></Field><button id="price-submit" type="submit" hidden /></form>}
    </Modal>

    <Modal open={Boolean(stockProduct)} onClose={() => setStockProduct(undefined)} title={`${stockForm.type === 'sale' ? 'Record sale' : 'Restock'}${stockProduct ? ` · ${stockProduct.name}` : ''}`} description={stockProduct ? `${formatNumber(stockProduct.currentStock)} ${stockProduct.unit}(s) currently available.` : undefined} footer={<><Button variant="secondary" onClick={() => setStockProduct(undefined)}>Cancel</Button><Button onClick={() => document.getElementById('stock-submit')?.click()}>Confirm {stockForm.type}</Button></>}>
      {stockProduct && <form className="form-grid" onSubmit={saveStock}>
        <Field label="Action"><Select value={stockForm.type} onChange={(event) => changeStockType(event.target.value)}><option value="sale">Sale</option><option value="restock">Restock</option></Select></Field>
        <Field label="Quantity"><Input required type="number" min="1" step="1" value={stockForm.quantity} onChange={(event) => setStockForm((current) => ({ ...current, quantity: event.target.value }))} /></Field>
        {stockForm.type === 'sale' ? <>
          <Field label="Selling price per item"><Input readOnly value={formatCurrency(stockProduct.sellingPrice, currency)} /></Field>
          <Field label="Total before discount"><Input readOnly value={formatCurrency(Number(stockForm.quantity || 0) * stockProduct.sellingPrice, currency)} /></Field>
          <Field label="Discount %"><Input type="number" min="0" max="100" step="0.01" value={stockForm.discountPercent} onChange={(event) => changeStockDiscount(Number(event.target.value))} /></Field>
          <Field label="Price per item after discount"><Input type="number" min="0" max={stockProduct.sellingPrice} step="0.01" value={stockForm.unitPrice} onChange={(event) => changeStockFinalPrice(Number(event.target.value))} /></Field>
          <Field label="Total after discount"><Input readOnly value={formatCurrency(Number(stockForm.quantity || 0) * Number(stockForm.unitPrice || 0), currency)} /></Field>
        </> : <Field label="Cost price per item"><Input required type="number" min="0" step="0.01" value={stockForm.unitPrice} onChange={(event) => setStockForm((current) => ({ ...current, unitPrice: event.target.value }))} /></Field>}
        <Field label="Notes" className="span-2"><Textarea rows={3} value={stockForm.notes} onChange={(event) => setStockForm((current) => ({ ...current, notes: event.target.value }))} /></Field><button id="stock-submit" type="submit" hidden />
      </form>}
    </Modal>

    <Modal open={Boolean(detail)} onClose={() => setDetail(undefined)} title={detail?.name ?? 'Product detail'} description={detail ? `${detail.sku || 'No product code'} · ${detail.category}` : undefined} size="large" footer={detail && (detail.isActive ? <><Button variant="danger" icon={<Archive size={16} />} onClick={() => void setArchived(detail, true)}>Archive product</Button><Button variant="secondary" icon={<Edit3 size={16} />} onClick={() => { const current = detail; setDetail(undefined); openEdit(current); }}>Edit details</Button><Button onClick={() => { const current = detail; setDetail(undefined); openPrice(current); }}>Update prices</Button></> : <Button icon={<ArchiveRestore size={16} />} onClick={() => void setArchived(detail, false)}>Restore product</Button>)}>
      {detail && <div className="product-detail"><div className="detail-stats product-detail-stats"><div><span>Current stock</span><strong>{formatNumber(detail.currentStock)} {detail.unit}</strong></div><div><span>Selling price</span><strong>{formatCurrency(detail.sellingPrice, currency)}</strong></div><div><span>Cost price</span><strong>{formatCurrency(detail.costPrice, currency)}</strong></div><div><span>Profit margin</span><strong>{formatNumber(detail.marginPercent)}%</strong></div><div><span>Minimum sales in 30 days</span><strong>{formatNumber(detail.minimumSales30Days, 0)}</strong></div></div><SectionHeader title="Price and cost history" description="Saved past values and reasons" /><DataTable rows={(detail.priceHistory ?? []) as unknown as Array<Record<string, unknown>>} columns={[{ key: 'effectiveAt', label: 'Changed on', render: (row) => formatDate(String(row.effectiveAt), true) }, { key: 'priceType', label: 'Price changed' }, { key: 'oldValue', label: 'Old value', align: 'right', render: (row) => formatCurrency(Number(row.oldValue ?? 0), currency) }, { key: 'newValue', label: 'New value', align: 'right', render: (row) => formatCurrency(Number(row.newValue), currency) }, { key: 'userName', label: 'Changed by' }, { key: 'reason', label: 'Reason' }]} empty="No price changes are recorded yet." /></div>}
    </Modal>
  </div>;
}

function roundMoney(value: number) { return Math.round(value * 100) / 100; }
