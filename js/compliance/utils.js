// Shared helpers — date/recurrence math, formatters, DOM shortcut.

export function $(id) { return document.getElementById(id); }

export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtUsd(n) {
  if (n === null || n === undefined || n === '') return '—';
  return '$' + Number(n).toLocaleString('en-US');
}

export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

// Status of a filing relative to today: 'completed' | 'overdue' | 'urgent' (<=30d) | 'upcoming' | 'none'
export function filingUrgency(filing) {
  if (filing.status === 'completed') return 'completed';
  if (!filing.next_due_date) return 'none';
  const d = daysUntil(filing.next_due_date);
  if (d < 0) return 'overdue';
  if (d <= 30) return 'urgent';
  return 'upcoming';
}

export const URGENCY_COLOR = {
  completed: '#22C55E',
  overdue: '#EF4444',
  urgent: '#F59E0B',
  upcoming: '#D1D5DB',
  none: '#D1D5DB',
};

// Advance next_due_date by one recurrence period — used when a filing is marked completed.
export function advanceDate(dateStr, recurrence) {
  if (!dateStr || recurrence === 'never' || recurrence === 'one_time') return dateStr;
  const d = new Date(dateStr + 'T00:00:00');
  if (recurrence === 'annual') d.setFullYear(d.getFullYear() + 1);
  else if (recurrence === 'quarterly') d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0, 10);
}

export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export function monthOf(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr + 'T00:00:00').getMonth();
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
