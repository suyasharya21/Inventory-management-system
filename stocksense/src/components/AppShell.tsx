import type { ReactNode } from 'react';
import { ArrowLeftRight, BotMessageSquare, ChevronLeft, ChevronRight, DatabaseBackup, FileSpreadsheet, History, LayoutDashboard, LogOut, Menu, PackageSearch, Settings, ShieldAlert, Sparkles, TrendingUp, UserRound } from 'lucide-react';
import { BrandMark } from './BrandMark';
import { IconButton } from './Ui';
import type { BusinessProfile, PageId } from '../types/app';

const navigation: Array<{ id: PageId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'smart-entry', label: 'Quick Add', icon: Sparkles },
  { id: 'inventory', label: 'Inventory', icon: PackageSearch },
  { id: 'transactions', label: 'Stock Activity', icon: ArrowLeftRight },
  { id: 'reports', label: 'Reports', icon: FileSpreadsheet },
  { id: 'forecast', label: 'Future Sales & Advice', icon: TrendingUp },
  { id: 'anomalies', label: 'Unusual Activity', icon: ShieldAlert },
  { id: 'audit', label: 'Change History', icon: History },
  { id: 'nlp-help', label: 'Ask Your Data', icon: BotMessageSquare },
  { id: 'backup', label: 'Backups', icon: DatabaseBackup },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const pageTitles = Object.fromEntries(navigation.map((item) => [item.id, item.label])) as Record<PageId, string>;

export function AppShell({ activePage, onNavigate, onSignOut, business, collapsed, onToggleCollapsed, children }: { activePage: PageId; onNavigate(page: PageId): void; onSignOut(): void; business: BusinessProfile; collapsed: boolean; onToggleCollapsed(): void; children: ReactNode }) {
  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className="sidebar">
      <div className="sidebar-brand"><BrandMark compact={collapsed} /></div>
      <div className="business-switcher" title={business.name}><span className="business-avatar">{business.logoPath ? <img src={business.logoPath} alt="" /> : business.name.slice(0, 2).toUpperCase()}</span>{!collapsed && <span><strong>{business.name}</strong><small>Local business</small></span>}</div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navigation.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-item ${activePage === id ? 'active' : ''}`} onClick={() => onNavigate(id)} title={collapsed ? label : undefined}><Icon size={18} strokeWidth={1.8} />{!collapsed && <span>{label}</span>}</button>)}
      </nav>
      <button className="sidebar-collapse" onClick={onToggleCollapsed}>{collapsed ? <ChevronRight size={17} /> : <><ChevronLeft size={17} /><span>Collapse</span></>}</button>
      {!collapsed && <div className="sidebar-watermark"><span>Developed by sociverse</span><a href="https://sociverse.tech" target="_blank" rel="noreferrer">sociverse.tech</a></div>}
    </aside>
    <div className="app-column">
      <header className="topbar">
        <div className="topbar-title"><IconButton label="Toggle navigation" className="mobile-menu" onClick={onToggleCollapsed}><Menu size={19} /></IconButton><div><span>{pageTitles[activePage]}</span><small>{business.name}</small></div></div>
        <div className="topbar-actions">
          <button className="quick-entry" onClick={() => onNavigate('smart-entry')}><Sparkles size={16} /><span>Quick add</span></button>
          <div className="user-menu" title={`${business.currentUser.name}, ${business.currentUser.role}`}><span><UserRound size={16} /></span><div><strong>{business.currentUser.name}</strong><small>{business.currentUser.role === 'owner' ? 'Owner' : business.currentUser.role}</small></div></div>
          <IconButton label="Sign out" onClick={onSignOut}><LogOut size={18} /></IconButton>
        </div>
      </header>
      <main className="page-canvas">{children}</main>
    </div>
  </div>;
}
