import { useEffect, useMemo, useState } from 'react';
import { AppShell } from './components/AppShell';
import { LoadingState } from './components/Ui';
import { api, isElectron } from './lib/api';
import type { AuthStatus, BusinessProfile, PageId } from './types/app';
import { DashboardPage } from './pages/DashboardPage';
import { SmartEntryPage } from './pages/SmartEntryPage';
import { InventoryPage } from './pages/InventoryPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { ReportsPage } from './pages/ReportsPage';
import { ForecastPage } from './pages/ForecastPage';
import { AnomaliesPage } from './pages/AnomaliesPage';
import { AuditPage } from './pages/AuditPage';
import { NlpHelpPage } from './pages/NlpHelpPage';
import { BackupPage } from './pages/BackupPage';
import { SettingsPage } from './pages/SettingsPage';
import { AuthPage } from './pages/AuthPage';
import { BusinessSetupPage } from './pages/BusinessSetupPage';

const pages: PageId[] = ['dashboard', 'smart-entry', 'inventory', 'transactions', 'reports', 'forecast', 'anomalies', 'audit', 'nlp-help', 'backup', 'settings'];

export default function App() {
  const initialPage = pages.includes(window.location.hash.slice(1) as PageId) ? window.location.hash.slice(1) as PageId : 'dashboard';
  const [activePage, setActivePage] = useState<PageId>(initialPage);
  const [auth, setAuth] = useState<AuthStatus>();
  const [business, setBusiness] = useState<BusinessProfile>();
  const [collapsed, setCollapsed] = useState(() => {
    if (window.matchMedia('(max-width: 780px)').matches) return true;
    const saved = window.localStorage.getItem('stocksense-sidebar');
    return saved ? saved === 'collapsed' : false;
  });
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isElectron) return;
    void api.auth.status().then(setAuth).catch((reason) => setError(reason instanceof Error ? reason.message : 'StockSense could not check your account.'));
  }, []);
  useEffect(() => {
    if (auth?.state !== 'authenticated') { setBusiness(undefined); return; }
    void api.business.getProfile().then(setBusiness).catch((reason) => setError(reason instanceof Error ? reason.message : 'The business profile could not be loaded.'));
  }, [auth]);
  useEffect(() => {
    const handler = () => { const page = window.location.hash.slice(1) as PageId; if (pages.includes(page)) setActivePage(page); };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 780px)');
    const handleViewportChange = (event: MediaQueryListEvent) => {
      const saved = window.localStorage.getItem('stocksense-sidebar');
      setCollapsed(event.matches ? true : saved === 'collapsed');
    };
    media.addEventListener('change', handleViewportChange);
    return () => media.removeEventListener('change', handleViewportChange);
  }, []);
  const navigate = (page: PageId) => {
    setActivePage(page);
    if (window.matchMedia('(max-width: 780px)').matches) setCollapsed(true);
    window.location.hash = page;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const handleAuthChanged = (status: AuthStatus) => {
    setAuth(status);
    if (status.state === 'authenticated') {
      setActivePage('dashboard');
      window.location.hash = 'dashboard';
    }
  };
  const toggleCollapsed = () => { setCollapsed((current) => { const next = !current; window.localStorage.setItem('stocksense-sidebar', next ? 'collapsed' : 'expanded'); return next; }); };
  const signOut = async () => { setBusiness(undefined); setAuth(await api.auth.signOut()); };
  const themeStyle = useMemo(() => ({ '--accent': business?.primaryColor ?? '#2f6f73' }) as React.CSSProperties, [business]);
  if (!isElectron) return <div className="fatal-screen"><strong>Open the StockSense desktop app</strong><p>This interface reads records only through the secure desktop connection to SQLite. Browser data and mock records are disabled.</p></div>;
  if (error) return <div className="fatal-screen"><strong>StockSense could not start</strong><p>{error}</p></div>;
  if (!auth) return <div className="startup-screen"><span className="startup-mark"><i /><i /><i /></span><LoadingState label="Opening StockSense" /></div>;
  if (auth.state === 'needs_account' || auth.state === 'signed_out') return <AuthPage firstRun={auth.state === 'needs_account'} onChanged={handleAuthChanged} />;
  if (auth.state === 'needs_business') return <BusinessSetupPage userName={auth.user?.name ?? ''} userEmail={auth.user?.email ?? ''} onChanged={handleAuthChanged} />;
  if (!business) return <div className="startup-screen"><span className="startup-mark"><i /><i /><i /></span><LoadingState label="Opening your business" /></div>;
  return <div style={themeStyle}><AppShell activePage={activePage} onNavigate={navigate} onSignOut={signOut} business={business} collapsed={collapsed} onToggleCollapsed={toggleCollapsed}>{renderPage(activePage, business, navigate, setBusiness)}</AppShell></div>;
}

function renderPage(page: PageId, business: BusinessProfile, navigate: (page: PageId) => void, setBusiness: (profile: BusinessProfile) => void) {
  switch (page) {
    case 'dashboard': return <DashboardPage currency={business.currency} onNavigate={navigate} />;
    case 'smart-entry': return <SmartEntryPage currency={business.currency} onNavigate={navigate} />;
    case 'inventory': return <InventoryPage currency={business.currency} />;
    case 'transactions': return <TransactionsPage currency={business.currency} />;
    case 'reports': return <ReportsPage currency={business.currency} />;
    case 'forecast': return <ForecastPage currency={business.currency} />;
    case 'anomalies': return <AnomaliesPage currency={business.currency} />;
    case 'audit': return <AuditPage />;
    case 'nlp-help': return <NlpHelpPage currency={business.currency} onNavigate={navigate} />;
    case 'backup': return <BackupPage />;
    case 'settings': return <SettingsPage profile={business} onUpdated={setBusiness} />;
  }
}
