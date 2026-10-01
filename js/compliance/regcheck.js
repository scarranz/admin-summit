// "Check for updates" button on the dashboard calendar. Calls our own
// Netlify function (netlify/functions/sec-check.js), which fetches the
// SEC's press-release feed server-side (browsers can't read it directly —
// the feed has no CORS header) and filters it for investment-adviser /
// Reg D relevant keywords. There is no equivalent machine-readable feed
// for individual state regulators, so those are surfaced as direct links
// for a human to check, not as an automated match.
import * as api from './api.js';
import { refreshRegulatoryChecks } from './data.js';

let modal = null;
function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.innerHTML = `<div class="modal regcheck-modal">
    <h3>Regulatory check</h3>
    <div class="regcheck-body"></div>
    <div class="mbtns">
      <button class="btn regcheck-close" type="button">Close</button>
      <button class="btn regcheck-confirm" type="button" hidden>Confirm &amp; log check</button>
    </div>
  </div>`;
  document.getElementById('cmp-root').appendChild(modal);
  const close = () => modal.classList.remove('open');
  modal.querySelector('.regcheck-close').onclick = close;
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  return modal;
}

const STATE_LINKS = [
  ['Texas', 'https://www.ssb.texas.gov/securities-regulation/regulatory-updates'],
  ['Florida', 'https://flofr.gov/sitePages/RulesAndRegulations.htm'],
  ['Delaware', 'https://corp.delaware.gov/frnotices/'],
  ['Colorado', 'https://www.coloradosos.gov/pubs/securities/laws.html'],
];

function stateChecklistHtml() {
  return `<div class="regcheck-state-list">${STATE_LINKS.map(([name, url]) =>
    `<div>${name}: <a href="${url}" target="_blank" rel="noopener">check regulator site ↗</a></div>`
  ).join('')}</div>`;
}

export async function openRegulatoryCheck(btn) {
  const m = ensureModal();
  const body = m.querySelector('.regcheck-body');
  const confirmBtn = m.querySelector('.regcheck-confirm');
  confirmBtn.hidden = true;

  btn.disabled = true;
  btn.classList.add('spinning');
  body.innerHTML = `<div class="cal-empty">Checking SEC.gov…</div>`;
  m.classList.add('open');

  let result;
  try {
    const res = await fetch('/.netlify/functions/sec-check');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    result = await res.json();
  } catch (err) {
    body.innerHTML = `<div class="cal-empty">Could not reach the SEC check right now (${err.message}). Try again shortly, or check manually:</div>${stateChecklistHtml()}`;
    btn.disabled = false;
    btn.classList.remove('spinning');
    return;
  }

  const items = result.items || [];
  const itemsHtml = items.length
    ? `<div class="regcheck-list">${items.map(it => `
        <div class="regcheck-item">
          <div class="regcheck-item-title"><a href="${it.link}" target="_blank" rel="noopener">${it.title}</a></div>
          <div class="regcheck-item-meta">${it.date || ''}</div>
        </div>`).join('')}</div>`
    : `<div class="cal-empty" style="margin-bottom:10px">No new SEC press releases matching investment-adviser / Reg D keywords in the last ${result.windowDays || 30} days.</div>`;

  body.innerHTML = `
    ${itemsHtml}
    <div class="regcheck-note">
      SEC results come straight from sec.gov's own press-release feed, keyword-filtered — always confirm anything relevant before acting on it.
      There's no equivalent automated feed for individual states, so check these directly:
    </div>
    ${stateChecklistHtml()}
  `;

  confirmBtn.hidden = false;
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    await api.insertRegulatoryCheck({
      checked_at: new Date().toISOString(),
      found_count: items.length,
      items,
    });
    await refreshRegulatoryChecks();
    confirmBtn.textContent = 'Logged ✓';
  };

  btn.disabled = false;
  btn.classList.remove('spinning');
}
