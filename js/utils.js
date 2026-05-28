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

// ─── Styled modals (replaces browser alert/confirm) ───

export function showInfoModal(title, detail, message) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'infoModal';
  overlay.innerHTML = `
    <div class="modal-card" style="width:340px; text-align:center;" onclick="event.stopPropagation()">
      <div style="font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--t3); font-weight:500; margin-bottom:14px;">${title}</div>
      <div style="font-size:14px; color:var(--t); margin-bottom:6px; font-weight:500;">${detail}</div>
      <div style="font-size:11px; color:var(--t3); margin-bottom:22px;">${message}</div>
      <div style="display:flex; justify-content:center;">
        <button class="btn btn-outline btn-sm" onclick="window._closeInfoModal()">OK</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) window._closeInfoModal(); });
}

export function showConfirmModal(title, detail, message, onConfirm) {
  const id = 'confirmModal_' + Date.now();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = id;
  overlay.innerHTML = `
    <div class="modal-card" style="width:340px; text-align:center;" onclick="event.stopPropagation()">
      <div style="font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--t3); font-weight:500; margin-bottom:14px;">${title}</div>
      <div style="font-size:14px; color:var(--t); margin-bottom:6px; font-weight:500;">${detail}</div>
      <div style="font-size:11px; color:var(--t3); margin-bottom:22px;">${message}</div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button class="btn btn-outline btn-sm" id="${id}_cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="${id}_confirm">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); } });
  document.getElementById(`${id}_cancel`).addEventListener('click', () => overlay.remove());
  document.getElementById(`${id}_confirm`).addEventListener('click', () => { overlay.remove(); onConfirm(); });
}

function closeInfoModal() {
  const modal = document.getElementById('infoModal');
  if (modal) modal.remove();
}
window._closeInfoModal = closeInfoModal;
