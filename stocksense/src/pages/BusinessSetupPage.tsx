import { FormEvent, useState } from 'react';
import { Building2, Check, LogOut } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { Button, Field, Input, Select } from '../components/Ui';
import { api } from '../lib/api';
import type { AuthStatus } from '../types/app';

const themes = [{ name: 'teal', label: 'Teal', color: '#2f6f73' }, { name: 'green', label: 'Green', color: '#3f6f4d' }, { name: 'blue', label: 'Blue', color: '#35678c' }, { name: 'rose', label: 'Rose', color: '#915466' }];

export function BusinessSetupPage({ userName, userEmail, onChanged }: { userName: string; userEmail: string; onChanged(status: AuthStatus): void }) {
  const [values, setValues] = useState({ name: '', ownerName: userName, email: userEmail, phone: '', address: '', taxId: '', currency: 'INR', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata', themeName: 'teal', primaryColor: '#2f6f73' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { onChanged(await api.auth.completeBusiness(values)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Business setup could not be completed.'); }
    finally { setBusy(false); }
  };
  const signOut = async () => onChanged(await api.auth.signOut());

  return <main className="setup-screen">
    <header className="setup-header"><BrandMark /><Button variant="ghost" icon={<LogOut size={16} />} onClick={signOut}>Sign out</Button></header>
    <form className="setup-form" onSubmit={submit}>
      <div className="setup-title"><span className="setup-icon"><Building2 size={23} /></span><div><span className="eyebrow">Step 2 of 2</span><h1>Tell us about your business</h1><p>This information appears in the app, reports, and encrypted backup details. You can change it later.</p></div></div>
      <div className="form-grid">
        <Field label="Business name"><Input required autoFocus value={values.name} onChange={(event) => set('name', event.target.value)} placeholder="For example, Meera General Store" /></Field>
        <Field label="Owner name"><Input required value={values.ownerName} onChange={(event) => set('ownerName', event.target.value)} /></Field>
        <Field label="Business email"><Input type="email" value={values.email} onChange={(event) => set('email', event.target.value)} /></Field>
        <Field label="Phone number"><Input value={values.phone} onChange={(event) => set('phone', event.target.value)} placeholder="Optional" /></Field>
        <Field label="Business address" className="span-2"><Input value={values.address} onChange={(event) => set('address', event.target.value)} placeholder="Optional" /></Field>
        <Field label="Tax or registration number"><Input value={values.taxId} onChange={(event) => set('taxId', event.target.value)} placeholder="Optional" /></Field>
        <Field label="Currency"><Select value={values.currency} onChange={(event) => set('currency', event.target.value)}><option value="INR">Indian Rupee (INR)</option><option value="USD">US Dollar (USD)</option><option value="GBP">British Pound (GBP)</option><option value="EUR">Euro (EUR)</option></Select></Field>
      </div>
      <fieldset className="setup-themes"><legend>Choose an app colour</legend>{themes.map((theme) => <button type="button" key={theme.name} className={values.themeName === theme.name ? 'active' : ''} onClick={() => setValues((current) => ({ ...current, themeName: theme.name, primaryColor: theme.color }))}><span style={{ background: theme.color }} />{theme.label}{values.themeName === theme.name && <Check size={15} />}</button>)}</fieldset>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="setup-actions"><p>Your inventory starts empty. Add your first real product after setup.</p><Button type="submit" icon={<Check size={17} />} disabled={busy}>Finish setup</Button></div>
    </form>
  </main>;
}
