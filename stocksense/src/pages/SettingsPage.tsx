import { FormEvent, useEffect, useState } from 'react';
import { Building2, CheckCircle2, CircleAlert, ImagePlus, MonitorCog, Palette, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import type { BusinessProfile } from '../types/app';
import { BrandMark } from '../components/BrandMark';
import { Badge, Button, Field, Input, SectionHeader, Select, Textarea } from '../components/Ui';

const themes = [
  { id: 'teal', label: 'Teal', color: '#2f6f73' },
  { id: 'blue', label: 'Blue', color: '#2563a8' },
  { id: 'green', label: 'Green', color: '#3f6f4c' },
  { id: 'charcoal', label: 'Charcoal', color: '#4b5563' },
  { id: 'contrast', label: 'High contrast', color: '#111827' },
];

export function SettingsPage({ profile, onUpdated }: { profile: BusinessProfile; onUpdated(profile: BusinessProfile): void }) {
  const [form, setForm] = useState(profile);
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string }>();
  useEffect(() => { setForm(profile); void api.system.getMeta().then(setMeta); }, [profile]);
  const save = async (event: FormEvent) => { event.preventDefault(); setMessage(undefined); try { const updated = await api.business.updateProfile({ ...form, reason: 'Business profile and branding updated' }); onUpdated(updated); setMessage({ tone: 'success', text: 'Business profile and branding saved.' }); } catch (reason) { setMessage({ tone: 'danger', text: reason instanceof Error ? reason.message : 'Settings could not be saved.' }); } };
  const chooseTheme = (theme: typeof themes[number]) => setForm((current) => ({ ...current, themeName: theme.id, primaryColor: theme.color }));
  const chooseLogo = async () => {
    setMessage(undefined);
    try {
      const result = await api.business.chooseLogo();
      if (!result.canceled && result.profile) { setForm(result.profile); onUpdated(result.profile); setMessage({ tone: 'success', text: 'Business logo saved.' }); }
    } catch (reason) { setMessage({ tone: 'danger', text: reason instanceof Error ? reason.message : 'Business logo could not be saved.' }); }
  };
  const removeLogo = async () => {
    setMessage(undefined);
    try { const updated = await api.business.removeLogo(); setForm(updated); onUpdated(updated); setMessage({ tone: 'success', text: 'Business logo removed.' }); }
    catch (reason) { setMessage({ tone: 'danger', text: reason instanceof Error ? reason.message : 'Business logo could not be removed.' }); }
  };

  return <div className="page-stack">
    <div className="page-heading"><div><span className="eyebrow">Your business identity</span><h1>Business and app settings</h1><p>Set your business details, logo, and app colours. Sociverse attribution remains in the footer.</p></div><Button icon={<Save size={16} />} onClick={() => document.getElementById('settings-submit')?.click()}>Save settings</Button></div>
    {message && <div className={`inline-alert alert-${message.tone}`}>{message.tone === 'success' ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}<span>{message.text}</span></div>}
    <form className="settings-layout" onSubmit={save}>
      <div className="settings-main">
        <section className="panel settings-section"><SectionHeader title="Business profile" description="Used throughout the app, report headers, backups, and restore previews" action={<Building2 size={19} />} /><div className="form-grid"><Field label="Business name" className="span-2"><Input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></Field><Field label="Owner name"><Input value={form.ownerName} onChange={(event) => setForm((current) => ({ ...current, ownerName: event.target.value }))} /></Field><Field label="Tax ID"><Input value={form.taxId} onChange={(event) => setForm((current) => ({ ...current, taxId: event.target.value }))} /></Field><Field label="Phone"><Input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></Field><Field label="Email"><Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></Field><Field label="Address" className="span-2"><Textarea rows={3} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></Field><Field label="Currency"><Select value={form.currency} onChange={(event) => setForm((current) => ({ ...current, currency: event.target.value }))}><option value="INR">INR - Indian Rupee</option><option value="USD">USD - US Dollar</option><option value="EUR">EUR - Euro</option><option value="GBP">GBP - British Pound</option></Select></Field><Field label="Timezone"><Input value={form.timezone} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))} /></Field></div></section>
        <section className="panel settings-section"><SectionHeader title="Logo and app colours" description="Use your logo in the app and choose a colour for buttons and highlights" action={<Palette size={19} />} /><div className="logo-setting"><span>{form.logoPath ? <img src={form.logoPath} alt="Business logo" /> : <Building2 size={22} />}</span><div><strong>Business logo</strong><small>PNG, JPG, or WebP up to 2 MB</small></div><Button type="button" variant="secondary" icon={<ImagePlus size={16} />} onClick={chooseLogo}>Choose logo</Button>{form.logoPath && <Button type="button" variant="ghost" icon={<Trash2 size={16} />} onClick={removeLogo}>Remove</Button>}</div><div className="theme-options">{themes.map((theme) => <button type="button" key={theme.id} className={form.themeName === theme.id ? 'active' : ''} onClick={() => chooseTheme(theme)}><span style={{ backgroundColor: theme.color }} />{theme.label}{form.themeName === theme.id && <CheckCircle2 size={16} />}</button>)}</div><div className="form-grid"><Field label="Custom app colour"><Input type="color" value={form.primaryColor} onChange={(event) => setForm((current) => ({ ...current, primaryColor: event.target.value, themeName: 'custom' }))} /></Field></div></section>
        <section className="panel settings-section"><SectionHeader title="This installation" description="App version and where your data is stored on this device" action={<MonitorCog size={19} />} /><dl className="system-list"><div><dt>App version</dt><dd>{String(meta.appVersion ?? '0.1.0')}</dd></div><div><dt>Device platform</dt><dd>{String(meta.platform ?? 'Loading')}</dd></div><div><dt>Data folder on this device</dt><dd className="mono">{String(meta.dataPath ?? 'Loading')}</dd></div><div><dt>Data storage</dt><dd><Badge tone="success">Local database</Badge></dd></div></dl></section>
      </div>
      <aside className="branding-preview"><span className="catalog-title">Brand preview</span><div className="preview-shell" style={{ '--preview-accent': form.primaryColor } as React.CSSProperties}><div className="preview-header"><BrandMark /><Badge tone="neutral">Owner</Badge></div><div className="preview-business"><span>{form.logoPath ? <img src={form.logoPath} alt="" /> : form.name.slice(0, 2).toUpperCase()}</span><div><strong>{form.name || 'Business name'}</strong><small>{form.ownerName || 'Owner name'}</small></div></div><div className="preview-report"><span>Current Inventory</span><strong>{form.name || 'Business name'}</strong><small>{form.address || 'Business address'}</small><i /></div><div className="preview-footer"><ShieldCheck size={15} /><span>Developed by sociverse · sociverse.tech</span></div></div><p>Your business details appear in the app and reports. Sociverse attribution remains in the footer.</p></aside>
      <button id="settings-submit" type="submit" hidden />
    </form>
  </div>;
}
