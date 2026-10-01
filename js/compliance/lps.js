import { state, refreshLps } from './data.js';
import * as api from './api.js';
import { $, fmtDate } from './utils.js';

const TYPE_PILL = { Individual: 'p-pu', 'Limited Liability Company (LLC)': 'p-b', 'Corporation (Non-US)': 'p-g', Joint: 'p-a', Trust: 'p-a' };

export function renderLps() {
  const c = $('page-fund-lps'); if (!c) return;
  c.innerHTML = `<div class="card">
    <div class="ch">
      <div><div class="ct">LP Tracker — ${state.lps.length} investors</div><div class="csub">Sub. Agreement: NAV | Summit Portal · KYC/AML: NAV</div></div>
      <button class="btn" id="add-lp-btn">+ Add LP</button>
    </div>
    <div class="twrap"><table>
      <thead><tr><th>Code</th><th>Jurisdiction</th><th>Entry</th><th>Type</th><th>Sub. Agreement</th><th>Location</th><th>KYC/AML</th></tr></thead>
      <tbody id="lps-tb"></tbody>
    </table></div>
  </div>
  <div class="modal-bg" id="modal-lp">
    <div class="modal">
      <h3>Add LP</h3>
      <div class="mf"><label>Code (auto)</label><input id="ml-code" disabled></div>
      <div class="mf"><label>Jurisdiction</label><input id="ml-juris" placeholder="US state or NON-US"></div>
      <div class="mf"><label>Entry date</label><input id="ml-date" type="date"></div>
      <div class="mf"><label>Type</label><select id="ml-type"><option>Individual</option><option>Limited Liability Company (LLC)</option><option>Corporation (Non-US)</option><option>Joint</option><option>Trust</option></select></div>
      <div class="mbtns"><button class="btn" id="ml-cancel">Cancel</button><button class="btn btn-pri" id="ml-save">Add</button></div>
    </div>
  </div>`;

  renderLpRows();
  $('add-lp-btn').onclick = () => { $('ml-code').value = 'LP-' + String(state.lps.length + 1).padStart(3, '0'); $('modal-lp').classList.add('open'); };
  $('ml-cancel').onclick = () => $('modal-lp').classList.remove('open');
  document.querySelector('#modal-lp').addEventListener('click', e => { if (e.target.id === 'modal-lp') e.target.classList.remove('open'); });
  $('ml-save').onclick = async () => {
    const code = 'LP-' + String(state.lps.length + 1).padStart(3, '0');
    const { data } = await api.insertLp({ code, jurisdiction: $('ml-juris').value || '—', entry_date: $('ml-date').value || null, type: $('ml-type').value });
    if (data) { await refreshLps(); renderLps(); $('modal-lp').classList.remove('open'); }
  };
}

function renderLpRows() {
  const tb = $('lps-tb'); if (!tb) return;
  tb.innerHTML = state.lps.map(lp => `<tr data-lid="${lp.id}">
      <td><span class="code">${lp.code}</span></td>
      <td style="color:#6B7280">${lp.jurisdiction}</td>
      <td style="color:#6B7280">${fmtDate(lp.entry_date)}</td>
      <td><span class="pill ${TYPE_PILL[lp.type] || 'p-gr'}" style="font-size:9px">${lp.type}</span></td>
      <td><label class="chk"><input type="checkbox" class="l-sub" ${lp.sub_agreement_signed ? 'checked' : ''}> Signed</label></td>
      <td style="color:#9CA3AF;font-size:10px">${lp.sub_agreement_location || '—'}</td>
      <td><label class="chk"><input type="checkbox" class="l-kyc" ${lp.kyc_done ? 'checked' : ''}> Done</label></td>
    </tr>`).join('');

  state.lps.forEach(lp => {
    const row = tb.querySelector(`[data-lid="${lp.id}"]`); if (!row) return;
    row.querySelector('.l-sub').onchange = e => saveLpField(lp, { sub_agreement_signed: e.target.checked });
    row.querySelector('.l-kyc').onchange = e => saveLpField(lp, { kyc_done: e.target.checked });
  });
}

async function saveLpField(lp, updates) {
  const { data } = await api.updateLp(lp.id, updates);
  if (data) { Object.assign(lp, data); renderLps(); }
}
