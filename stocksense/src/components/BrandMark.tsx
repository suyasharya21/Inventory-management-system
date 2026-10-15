export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <div className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
    <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
    {!compact && <span className="brand-copy"><strong>StockSense</strong><small>by Sociverse</small></span>}
  </div>;
}
