export function formatCurrency(value: number | null | undefined, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 2) {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits }).format(Number(value ?? 0));
}

export function formatCompact(value: number | null | undefined, currency?: string) {
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1, ...(currency ? { style: 'currency', currency } : {}) }).format(Number(value ?? 0));
}

export function formatDate(value: string | null | undefined, includeTime = false) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-IN', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}

export function humanize(value: string) {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

export function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

export function daysAgoInput(days: number) {
  const value = new Date();
  value.setDate(value.getDate() - days);
  return value.toISOString().slice(0, 10);
}
