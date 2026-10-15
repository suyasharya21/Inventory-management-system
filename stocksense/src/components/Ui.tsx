import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { AlertTriangle, Inbox, LoaderCircle, X } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({ variant = 'primary', icon, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: ReactNode }) {
  return <button className={`button button-${variant} ${className}`} {...props}>{icon}{children && <span>{children}</span>}</button>;
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Badge({ tone = 'neutral', children }: { tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatCard({ label, value, detail, icon, tone = 'default', onClick }: { label: string; value: ReactNode; detail?: ReactNode; icon?: ReactNode; tone?: 'default' | 'good' | 'warn' | 'danger'; onClick?(): void }) {
  const content = <><div className="stat-card-top"><span className="stat-label">{label}</span>{icon && <span className="stat-icon">{icon}</span>}</div><strong className="stat-value">{value}</strong>{detail && <span className="stat-detail">{detail}</span>}</>;
  return onClick
    ? <button type="button" className={`stat-card stat-card-button stat-${tone}`} onClick={onClick}>{content}</button>
    : <div className={`stat-card stat-${tone}`}>{content}</div>;
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="input select" {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input textarea" {...props} />;
}

export function Modal({ title, description, open, onClose, children, footer, size = 'medium' }: { title: string; description?: string; open: boolean; onClose(): void; children: ReactNode; footer?: ReactNode; size?: 'small' | 'medium' | 'large' }) {
  if (!open) return null;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <header className="modal-header"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><IconButton label="Close" onClick={onClose}><X size={18} /></IconButton></header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </section>
  </div>;
}

export function LoadingState({ label = 'Loading data' }: { label?: string }) {
  return <div className="state-panel"><LoaderCircle className="spin" size={24} /><span>{label}</span></div>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="state-panel empty-state"><Inbox size={28} /><strong>{title}</strong><span>{description}</span>{action}</div>;
}

export function ErrorState({ message, retry }: { message: string; retry?(): void }) {
  return <div className="state-panel error-state"><AlertTriangle size={24} /><strong>Something needs attention</strong><span>{message}</span>{retry && <Button variant="secondary" onClick={retry}>Try again</Button>}</div>;
}

export function SectionHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function DataTable({ columns, rows, rowKey = 'id', onRowClick, empty = 'No records match these filters.' }: { columns: Array<{ key: string; label: string; align?: 'left' | 'right'; render?(row: Record<string, unknown>): ReactNode }>; rows: Array<Record<string, unknown>>; rowKey?: string; onRowClick?(row: Record<string, unknown>): void; empty?: string }) {
  if (!rows.length) return <EmptyState title="Nothing here yet" description={empty} />;
  return <div className="table-wrap"><table className="data-table"><thead><tr>{columns.map((column) => <th key={column.key} className={column.align === 'right' ? 'align-right' : ''}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row[rowKey] ?? index)} className={onRowClick ? 'clickable-row' : ''} onClick={() => onRowClick?.(row)}>{columns.map((column) => <td key={column.key} className={column.align === 'right' ? 'align-right' : ''}>{column.render ? column.render(row) : String(row[column.key] ?? '-')}</td>)}</tr>)}</tbody></table></div>;
}
