import { state, refreshClients } from './data.js';
import * as api from './api.js';
import { $ } from './utils.js';

const TYPE_PILL = { Corporation: 'p-b', Pooled: 'p-g', 'High Net Worth Individual': 'p-pu', Individual: 'p-pu', Trust: 'p-a', Joint: 'p-a' };

export function renderClients() {
  const c = $('page-adv-clients'); if (!c) return;
  const pendingCodes = state.clients.filter(cl => !cl.ima_signed || !cl.ground_rules_signed || !cl.kyc_done).map(cl => cl.code);

  c.innerHTML = `<div class="card">
    <div class="ch">
      <div><div class="ct">SMA Clients — ${state.clients.length} active</div><div class="csub">Summit Portal</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${pendingCodes.length ? `<span class="bx br">⚠ ${pendingCodes.join(', ')} — docs pending</span>` : ''}
        <button class="btn" id="add-client-btn">+ Add</button>
      </div>
    </div>
    <div class="twrap"><table>
      <thead><tr><th>Code</th><th>Type</th><th>Jurisdiction</th><th>ADV</th><th>IMA</th><th>Ground Rules</th><th>KYC/AML</th></tr></thead>
      <tbody id="clients-tb"></tbody>
    </table></div>
  </div>
  <div class="modal-bg" id="modal-client">
    <div class="modal">
      <h3>Add SMA Client</h3>
      <div class="mf"><label>Code</label><input id="mc-code" placeholder="e.g. NEWC"></div>
      <div class="mf"><label>Type</label><select id="mc-type"><option>Individual</option><option>Corporation</option><option>High Net Worth Individual</option><option>Pooled</option><option>Trust</option><option>Joint</option></select></div>
      <div class="mf"><label>Jurisdiction</label><select id="mc-juris"><option>US</option><option>Int</option></select></div>
      <div class="mf"><label>ADV category</label><select id="mc-adv"><option value="m">m — Managed</option><option value="b">b — Individual</option><option value="f">f — Pooled</option></select></div>
      <div class="mbtns"><button class="btn" id="mc-cancel">Cancel</button><button class="btn btn-pri" id="mc-save">Add</button></div>
    </div>
  </div>`;

  renderClientRows();
  $('add-client-btn').onclick = () => $('modal-client').classList.add('open');
  $('mc-cancel').onclick = () => $('modal-client').classList.remove('open');
  document.querySelector('#modal-client').addEventListener('click', e => { if (e.target.id === 'modal-client') e.target.classList.remove('open'); });
  $('mc-save').onclick = async () => {
    const code = $('mc-code').value.trim().toUpperCase();
    if (!code || state.clients.find(cl => cl.code === code)) return;
    const { data } = await api.insertClient({ code, type: $('mc-type').value, jurisdiction: $('mc-juris').value, adv_category: $('mc-adv').value });
    if (data) { await refreshClients(); renderClients(); $('modal-client').classList.remove('open'); }
  };
}

function renderClientRows() {
  const tb = $('clients-tb'); if (!tb) return;
  tb.innerHTML = state.clients.map(cl => {
    const err = (!cl.ima_signed || !cl.ground_rules_signed || !cl.kyc_done) ? 'row-err' : '';
    return `<tr class="${err}" data-cid="${cl.id}">
      <td><span class="code">${cl.code}</span></td>
      <td><span class="pill ${TYPE_PILL[cl.type] || 'p-gr'}">${cl.type}</span></td>
      <td style="color:#6B7280">${cl.jurisdiction}</td>
      <td style="font-family:monospace;color:#9CA3AF">${cl.adv_category || ''}</td>
      <td><label class="chk"><input type="checkbox" class="c-ima" ${cl.ima_signed ? 'checked' : ''}> Signed</label><div class="doc-loc">${cl.ima_location || '—'}</div></td>
      <td><label class="chk"><input type="checkbox" class="c-gr" ${cl.ground_rules_signed ? 'checked' : ''}> Signed</label><div class="doc-loc">${cl.ground_rules_location || '—'}</div></td>
      <td><label class="chk"><input type="checkbox" class="c-kyc" ${cl.kyc_done ? 'checked' : ''}> Done</label><div class="doc-loc">${cl.kyc_location || '—'}</div></td>
    </tr>`;
  }).join('');

  state.clients.forEach(cl => {
    const row = tb.querySelector(`[data-cid="${cl.id}"]`); if (!row) return;
    row.querySelector('.c-ima').onchange = e => saveClientField(cl, { ima_signed: e.target.checked });
    row.querySelector('.c-gr').onchange = e => saveClientField(cl, { ground_rules_signed: e.target.checked });
    row.querySelector('.c-kyc').onchange = e => saveClientField(cl, { kyc_done: e.target.checked });
  });
}

async function saveClientField(client, updates) {
  const { data } = await api.updateClient(client.id, updates);
  if (data) { Object.assign(client, data); renderClients(); }
}
