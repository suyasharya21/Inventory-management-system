import { FormEvent, useState } from 'react';
import { Chrome, Eye, EyeOff, LockKeyhole, LogIn, UserPlus } from 'lucide-react';
import { BrandMark } from '../components/BrandMark';
import { Button, Field, Input } from '../components/Ui';
import { api } from '../lib/api';
import type { AuthStatus } from '../types/app';

export function AuthPage({ firstRun, onChanged }: { firstRun: boolean; onChanged(status: AuthStatus): void }) {
  const [mode, setMode] = useState<'login' | 'signup'>(firstRun ? 'signup' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = mode === 'signup' ? await api.auth.signUp({ name, email, password }) : await api.auth.login({ email, password });
      onChanged(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your account could not be opened.');
    } finally { setBusy(false); }
  };

  return <main className="access-screen">
    <section className="access-brand">
      <BrandMark />
      <div><span className="eyebrow">Private inventory on this device</span><h1>{mode === 'signup' ? 'Create your StockSense account' : 'Welcome back'}</h1><p>Your products, sales, and reports stay in the local database on this computer.</p></div>
      <ul><li>Works without an internet connection</li><li>Changes are recorded with the signed-in user</li><li>Cloud backup uploads only encrypted backup files</li></ul>
      <footer>Developed by sociverse<br /><a href="https://sociverse.tech" target="_blank" rel="noreferrer">sociverse.tech</a></footer>
    </section>
    <section className="access-form-area">
      <form className="access-form" onSubmit={submit}>
        <div className="access-tabs" role="tablist"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Sign in</button><button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>Create account</button></div>
        <div><h2>{mode === 'signup' ? 'Start with your account' : 'Sign in to this device'}</h2><p>{mode === 'signup' ? 'Business details come next. No sample products will be added.' : 'Use the account created on this installation.'}</p></div>
        {mode === 'signup' && <Field label="Your name"><Input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="For example, Meera Shah" /></Field>}
        <Field label="Email address"><Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" /></Field>
        <Field label="Password" hint={mode === 'signup' ? 'Use at least 8 characters.' : undefined}><div className="password-control"><LockKeyhole size={17} /><Input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" /><button type="button" className="password-reveal" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field>
        {error && <div className="form-error" role="alert">{error}</div>}
        <Button type="submit" icon={mode === 'signup' ? <UserPlus size={17} /> : <LogIn size={17} />} disabled={busy}>{mode === 'signup' ? 'Create account and continue' : 'Sign in'}</Button>
        <div className="access-divider"><span>or</span></div>
        <Button type="button" variant="secondary" icon={<Chrome size={17} />} disabled>Google sign-in (Coming soon)</Button>
        <small className="access-note">Google sign-in is temporarily unavailable. Create a local account to continue.</small>
      </form>
    </section>
  </main>;
}
