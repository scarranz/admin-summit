import { state, passesVisibility } from './data.js';
import { $, MONTH_NAMES, monthOf, filingUrgency, fmtDate } from './utils.js';
import { show } from './nav.js';
import { openRegulatoryCheck } from './regcheck.js';

// NAV Statement filings are seeded but not ready to surface on the dashboard yet —
// hidden here, not deleted; data stays in Supabase.
const isHiddenFiling = (f) => (f.name || '').startsWith('NAV Statement');

// Status reads from text only — no color anywhere in the calendar, extending
// the "badges carry no color" rule from filing/policy rows to the calendar itself.
function badgeText(f) {
  const urgency = filingUrgency(f);
  if (f.status === 'completed') return 'Completed';
  if (urgency === 'overdue') return 'Overdue';
  if (urgency === 'urgent') return 'Upcoming';
  return 'Pending';
}

let monthModal = null;
function ensureMonthModal() {
  if (monthModal) return monthModal;
  monthModal = document.createElement('div');
  monthModal.className = 'modal-bg';
  monthModal.innerHTML = `<div class="modal cal-month-modal">
    <h3 class="cmm-title"></h3>
    <div class="cmm-list"></div>
    <div class="mbtns"><button class="btn cmm-close" type="button">Close</button></div>
  </div>`;
  document.getElementById('cmp-root').appendChild(monthModal);
  const close = () => monthModal.classList.remove('open');
  monthModal.querySelector('.cmm-close').onclick = close;
  monthModal.addEventListener('click', (e) => { if (e.target === monthModal) close(); });
  return monthModal;
}

function openMonthModal(monthName, items) {
  const m = ensureMonthModal();
  m.querySelector('.cmm-title').textContent = monthName;
  const list = m.querySelector('.cmm-list');
  if (!items.length) {
    list.innerHTML = `<div class="cal-empty">No deadlines</div>`;
  } else {
    list.innerHTML = items.map(f => {
      const entKey = f.entities ? f.entities.key : '';
      return `<div class="cmm-item${entKey ? '' : ' cmm-item-static'}" ${entKey ? `data-entity="${entKey}"` : ''}>
        <span class="cmm-name">${f.name}</span>
        <span class="cmm-due">${fmtDate(f.next_due_date)}</span>
        <span class="bx bgr">${badgeText(f)}</span>
      </div>`;
    }).join('');
    list.querySelectorAll('.cmm-item[data-entity]').forEach(item => {
      item.onclick = () => { m.classList.remove('open'); show('entity-' + item.dataset.entity); };
    });
  }
  m.classList.add('open');
}

export function renderCalendar(containerId, entityKeys) {
  const c = $(containerId); if (!c) return;
  const rows = state.filings.filter(f => {
    const key = f.entities ? f.entities.key : '__firmwide__';
    const included = entityKeys.includes(key) || key === '__firmwide__';
    return included && f.next_due_date && passesVisibility(f) && !isHiddenFiling(f);
  });

  const byMonth = Array.from({ length: 12 }, () => []);
  rows.forEach(f => { const m = monthOf(f.next_due_date); if (m !== null) byMonth[m].push(f); });
  byMonth.forEach(list => list.sort((a, b) => (a.next_due_date || '').localeCompare(b.next_due_date || '')));

  const MAX_LINES = 5;
  const monthsHtml = MONTH_NAMES.map((name, i) => {
    const items = byMonth[i];
    let body;
    if (!items.length) {
      body = `<span class="cal-empty">No deadlines</span>`;
    } else {
      const shown = items.slice(0, MAX_LINES);
      const more = items.length - shown.length;
      body = shown.map(f => `<span class="cal-item">${f.name} · ${fmtDate(f.next_due_date)}</span>`).join('')
        + (more > 0 ? `<span class="cal-more">+${more} more</span>` : '');
    }
    return `<button type="button" class="cal-mo" data-month="${i}"><span class="cal-mhd">${name}</span><span class="cal-body">${body}</span></button>`;
  }).join('');

  const neverExpire = state.filings.filter(f => {
    const key = f.entities ? f.entities.key : '__firmwide__';
    return (entityKeys.includes(key) || key === '__firmwide__') && f.recurrence === 'never' && passesVisibility(f) && !isHiddenFiling(f);
  });

  const lastCheck = state.regulatoryChecks[0];

  c.innerHTML = `<div class="card">
    <div class="ch">
      <span class="ct">Calendar — upcoming deadlines</span>
      <div style="display:flex;align-items:center;gap:8px">
        ${lastCheck ? `<span class="cal-last-check">Last checked ${fmtDate(lastCheck.checked_at.slice(0, 10))}</span>` : ''}
        <button type="button" class="cal-refresh-btn" title="Check SEC and state sources for regulatory updates">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>
          Check for updates
        </button>
      </div>
    </div>
    <div class="cal-grid">${monthsHtml}</div>
    ${neverExpire.length ? `<div class="cal-legend"><span class="cal-legend-lbl">Do not expire:</span> ${neverExpire.map(f => f.name).join(' · ')}</div>` : ''}
  </div>`;

  c.querySelectorAll('.cal-mo').forEach(tile => {
    tile.onclick = () => openMonthModal(MONTH_NAMES[Number(tile.dataset.month)], byMonth[Number(tile.dataset.month)]);
  });

  const refreshBtn = c.querySelector('.cal-refresh-btn');
  if (refreshBtn) refreshBtn.onclick = () => openRegulatoryCheck(refreshBtn);
}
