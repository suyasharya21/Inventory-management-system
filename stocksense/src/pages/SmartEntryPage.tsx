import { FormEvent, useEffect, useState } from 'react';
import { Check, ChevronRight, CircleAlert, ExternalLink, Mic, MicOff, PackagePlus, RotateCcw, Send, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import { formatCurrency, formatNumber } from '../lib/format';
import type { PageId, Product, SmartEntryResult } from '../types/app';
import { Badge, Button, EmptyState, Field, IconButton, Input, LoadingState } from '../components/Ui';
import { useSpeechInput } from '../hooks/useSpeechInput';

const examples = [
  'sold 5 Coca-Cola bottles',
  'restock 20 Tata Salt packs',
  'damaged 2 Surf Excel packs',
  'change Basmati Rice cost price to 560',
];

export function SmartEntryPage({ currency, onNavigate }: { currency: string; onNavigate(page: PageId): void }) {
  const [command, setCommand] = useState('');
  const [parsed, setParsed] = useState<SmartEntryResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const speech = useSpeechInput(setCommand);
  useEffect(() => { void api.products.list({}).then(setProducts).catch(() => setProducts([])); }, []);

  const parse = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!command.trim()) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      setParsed(await api.smartEntry.parse(command));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The command could not be parsed.');
    } finally {
      setLoading(false);
    }
  };

  const confirm = async () => {
    if (!parsed) return;
    setLoading(true);
    setError('');
    try {
      await api.smartEntry.confirm(parsed);
      setSuccess('The action was saved and added to Change History.');
      setParsed(undefined);
      setCommand('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The action could not be completed.');
    } finally {
      setLoading(false);
    }
  };

  const guidance = parsed?.guidance ?? (error && parsed ? {
    title: 'The action could not be saved',
    description: 'Your command is preserved. Continue in the manual form to review every required field and validation message.',
    example: parsed.originalText,
    actionLabel: ['update_price', 'create_product'].includes(parsed.intent) ? 'Open manual inventory' : 'Open manual transaction',
    targetPage: (['update_price', 'create_product'].includes(parsed.intent) ? 'inventory' : 'transactions') as PageId,
    steps: ['Open the guided form', 'Review product, quantity, price, and reason', 'Confirm after validation succeeds'],
  } : undefined);

  const chooseProduct = (productId: number, name?: string) => {
    if (!parsed) return;
    const product = products.find((item) => item.id === productId) ?? parsed.suggestions?.find((item) => item.id === productId);
    const needsQuantity = ['sale', 'restock', 'return', 'damage', 'adjustment'].includes(parsed.intent) && (!Number.isInteger(parsed.extracted.quantity) || Number(parsed.extracted.quantity) < 1);
    setParsed({
      ...parsed,
      status: needsQuantity ? 'needs_input' : 'ready',
      extracted: {
        ...parsed.extracted,
        productId,
        productName: product?.name ?? name,
        ...(parsed.intent === 'sale' && product ? { sellingPrice: product.sellingPrice, saleUnitPrice: product.sellingPrice, discountPercent: 0 } : {}),
      },
      message: needsQuantity ? 'Enter a whole-number quantity.' : 'Review the details before confirming.',
    });
  };

  const searchProduct = (name: string) => {
    if (!parsed) return;
    const product = products.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
    if (product) chooseProduct(product.id, product.name);
    else setParsed({ ...parsed, status: 'needs_input', extracted: { ...parsed.extracted, productName: name, productId: undefined }, message: 'Choose a product from the list.' });
  };

  const setQuantity = (value: number) => {
    if (!parsed) return;
    const valid = Number.isInteger(value) && value > 0;
    setParsed({ ...parsed, status: parsed.extracted.productId && valid ? 'ready' : 'needs_input', extracted: { ...parsed.extracted, quantity: valid ? value : undefined }, message: !valid ? 'Quantity must be a whole number greater than zero.' : parsed.extracted.productId ? 'Review the details before confirming.' : 'Choose a product from the list.' });
  };

  const setDiscount = (value: number) => {
    if (!parsed) return;
    const discountPercent = Math.min(100, Math.max(0, value || 0));
    const listPrice = Number(parsed.extracted.sellingPrice ?? 0);
    setParsed({ ...parsed, extracted: { ...parsed.extracted, discountPercent, saleUnitPrice: roundMoney(listPrice * (1 - discountPercent / 100)) } });
  };

  const setFinalUnitPrice = (value: number) => {
    if (!parsed) return;
    const listPrice = Number(parsed.extracted.sellingPrice ?? 0);
    const saleUnitPrice = Math.min(listPrice, Math.max(0, value || 0));
    const discountPercent = listPrice ? roundMoney(((listPrice - saleUnitPrice) / listPrice) * 100) : 0;
    setParsed({ ...parsed, extracted: { ...parsed.extracted, saleUnitPrice, discountPercent } });
  };

  const quantity = Number(parsed?.extracted.quantity ?? 0);
  const listPrice = Number(parsed?.extracted.sellingPrice ?? 0);
  const finalUnitPrice = Number(parsed?.extracted.saleUnitPrice ?? listPrice);

  return <div className="page-stack smart-entry-page">
    <div className="page-heading"><div><span className="eyebrow">Fast capture</span><h1>Tell StockSense what happened</h1><p>Type a sale, restock, return, damage, adjustment, or price update. Nothing changes until you confirm.</p></div></div>

    <section className="smart-composer">
      <div className="composer-mark"><Sparkles size={22} /></div>
      <form onSubmit={parse} className="composer-form">
        <textarea value={command} onChange={(event) => setCommand(event.target.value)} placeholder="For example: sold 5 Coca-Cola bottles" rows={3} autoFocus />
        <div className="composer-toolbar"><div><IconButton type="button" className={speech.listening ? 'listening' : ''} label={speech.listening ? 'Stop voice typing' : speech.transcribing ? 'Transcribing voice entry' : 'Start voice typing'} disabled={!speech.supported || speech.transcribing} onClick={() => speech.listening ? void speech.stop() : void speech.start(command)}>{speech.listening ? <MicOff size={19} /> : <Mic size={19} />}</IconButton><span>{speech.listening ? 'Listening... press stop when finished' : speech.transcribing ? 'Transcribing privately on this device...' : speech.checking ? 'Preparing on-device voice typing...' : speech.supported ? 'Use the microphone · audio stays on this device' : 'Voice typing is unavailable in this build'}</span></div><Button type="submit" icon={<Send size={16} />} disabled={loading || !command.trim()}>Understand command</Button></div>
      </form>
    </section>

    <div className="example-row"><span>Try:</span>{examples.map((example) => <button key={example} onClick={() => { setCommand(example); setParsed(undefined); }}>{example}</button>)}</div>
    {speech.error && <div className="inline-alert alert-danger"><CircleAlert size={18} /><span>{speech.error}</span></div>}
    {error && <div className="inline-alert alert-danger"><CircleAlert size={18} /><span>{error}</span></div>}
    {guidance && <section className="guidance-step smart-guidance-step"><div><strong>{guidance.title}</strong><p>{guidance.description}</p>{guidance.example && <code>Example: {guidance.example}</code>}</div>{guidance.steps && <ol>{guidance.steps.map((step) => <li key={step}>{step}</li>)}</ol>}<Button icon={<ExternalLink size={15} />} onClick={() => onNavigate(guidance.targetPage)}>{guidance.actionLabel}</Button></section>}
    {success && <div className="inline-alert alert-success"><Check size={18} /><span>{success}</span></div>}
    {loading && !parsed && <LoadingState label="Understanding command" />}

    {parsed ? <section className="parse-workspace">
      <div className="panel parse-summary">
        <div className="parse-heading"><div><span className="eyebrow">What StockSense understood</span><h2>{friendlyIntent(parsed.intent)}</h2></div><Badge tone={parsed.confidence >= 0.85 ? 'success' : parsed.confidence >= 0.6 ? 'warning' : 'danger'}>{parsed.confidence >= 0.85 ? 'Strong match' : parsed.confidence >= 0.6 ? 'Please check' : 'Needs help'}</Badge></div>
        <p className="parse-message">{parsed.message}</p>
        <div className="parse-edit-grid">
          <Field label="Product" className="span-2"><Input list="smart-product-list" value={parsed.extracted.productName ?? ''} onChange={(event) => searchProduct(event.target.value)} placeholder="Search and choose a product" /><datalist id="smart-product-list">{products.map((product) => <option key={product.id} value={product.name}>{product.sku || product.category}</option>)}</datalist></Field>
          {['sale', 'restock', 'return', 'damage', 'adjustment'].includes(parsed.intent) && <Field label="Quantity"><Input type="number" min="1" step="1" value={parsed.extracted.quantity ?? ''} onChange={(event) => setQuantity(Number(event.target.value))} placeholder="Whole number" /></Field>}
          {parsed.intent === 'sale' && <>
            <Field label="Selling price per item"><Input readOnly value={formatCurrency(listPrice, currency)} /></Field>
            <Field label="Total before discount"><Input readOnly value={formatCurrency(quantity * listPrice, currency)} /></Field>
            <Field label="Discount %"><Input type="number" min="0" max="100" step="0.01" value={parsed.extracted.discountPercent ?? 0} onChange={(event) => setDiscount(Number(event.target.value))} /></Field>
            <Field label="Price per item after discount"><Input type="number" min="0" max={listPrice} step="0.01" value={finalUnitPrice} onChange={(event) => setFinalUnitPrice(Number(event.target.value))} /></Field>
            <Field label="Total after discount"><Input readOnly value={formatCurrency(quantity * finalUnitPrice, currency)} /></Field>
          </>}
          {parsed.intent === 'update_price' && parsed.extracted.sellingPrice !== undefined && <Field label="New selling price"><Input readOnly value={formatCurrency(parsed.extracted.sellingPrice, currency)} /></Field>}
          {parsed.extracted.costPrice !== undefined && <Field label="New cost price"><Input readOnly value={formatCurrency(parsed.extracted.costPrice, currency)} /></Field>}
        </div>
        <div className="confirmation-bar"><Button variant="secondary" icon={<RotateCcw size={16} />} onClick={() => setParsed(undefined)}>Edit command</Button><Button icon={<Check size={16} />} disabled={parsed.status !== 'ready' || loading} onClick={confirm}>Confirm action</Button></div>
      </div>
      <div className="panel guided-panel">
        <div className="parse-heading"><div><span className="eyebrow">Product check</span><h2>{parsed.suggestions?.length ? 'Possible products' : 'No product found'}</h2></div></div>
        {parsed.suggestions?.length ? <div className="candidate-list">{parsed.suggestions.map((product) => <button key={product.id} className={parsed.extracted.productId === product.id ? 'selected' : ''} onClick={() => chooseProduct(product.id, product.name)}><span><strong>{product.name}</strong><small>{product.sku} · {product.category} · {formatNumber(product.currentStock)} in stock</small></span><span className="candidate-score">{product.score}%</span><ChevronRight size={17} /></button>)}</div> : <EmptyState title="Create or find this product" description="Use Inventory to add missing product details and check for similar products before saving." action={<Button icon={<PackagePlus size={16} />} onClick={() => onNavigate('inventory')}>Open Inventory</Button>} />}
      </div>
    </section> : <section className="smart-guidance"><div><strong>Use everyday words</strong><p>Say or type what happened, including the product and quantity. Slight spelling differences are allowed.</p></div><div><strong>Check before saving</strong><p>StockSense shows the product, quantity, and available stock before anything changes.</p></div><div><strong>Every change is recorded</strong><p>The app remembers who made the change, when it happened, and the stock before and after.</p></div></section>}
  </div>;
}

function friendlyIntent(intent: string) {
  return ({ sale: 'Product sold', restock: 'Stock added', return: 'Customer return', damage: 'Damaged stock', adjustment: 'Stock correction', create_product: 'New product', update_price: 'Price change', report: 'Open report', help_query: 'Question' } as Record<string, string>)[intent] ?? 'Stock change';
}

function roundMoney(value: number) { return Math.round(value * 100) / 100; }
