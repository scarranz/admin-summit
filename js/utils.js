// Shared formatting helpers and constants

export const YEARS = [2022, 2023, 2024, 2025, 2026];
export const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export const MONTH_NAMES_FULL = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

export function fmt(v) {
  if (!v) return '<span style="color:var(--t3)">—</span>';
  return '$' + Math.round(v).toLocaleString();
}

export function fmtTotal(v) {
  if (!v) return '<span style="color:var(--t3)">—</span>';
  return '$' + Math.round(v).toLocaleString();
}

export function fmtMxn(v) {
  if (!v) return '<span style="color:var(--t3)">—</span>';
  return '$' + Math.round(v).toLocaleString();
}

export function fmtUsd(v) {
  if (!v) return '<span style="color:var(--t3)">—</span>';
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtUsdShort(v) {
  if (!v) return '<span style="color:var(--t3)">—</span>';
  return '$' + Math.round(v).toLocaleString();
}

export function fmtPct(v) {
  if (v === null || v === undefined || isNaN(v)) return '<span style="color:var(--t3);">—</span>';
  return v.toFixed(1) + '%';
}

export function fmtYoy(v) {
  if (v === null || v === undefined || isNaN(v)) return '<span style="color:var(--t3);">—</span>';
  const arrow = v >= 0 ? '▲' : '▼';
  return `${arrow} ${v.toFixed(1)}%`;
}

export function fmtMargin(v) {
  if (v === null || isNaN(v)) return '<span class="yoy-na">—</span>';
  return v.toFixed(1) + '%';
}

export function marginCls(v) {
  if (v === null) return '';
  if (v < 40) return 'margin-good';
  if (v <= 60) return 'margin-ok';
  return 'margin-bad';
}

export function showToast(msg, type = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}

export function yearMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}
