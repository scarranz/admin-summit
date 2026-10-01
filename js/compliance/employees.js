// Employee roster + per-employee detail: signed documents and the
// personal trading compliance record (accounts, pre-clearance log,
// quarterly/annual reports, broker statement checklist).
import { state, refreshEmployees, refreshEmployeeDocuments, refreshPtReports } from './data.js';
import * as api from './api.js';
import { $, fmtDate } from './utils.js';

const DOC_TYPE_LABEL = {
  code_of_ethics: 'Code of Ethics', annual_certification: 'Annual Certification',
  employment_contract: 'Employment Contract', conflicts_disclosure: 'Conflicts / OBA',
  whistleblower_ack: 'Whistleblower Ack.', w9: 'W-9',
};

let selectedEmployeeCode = null;
let editMode = false;

export function renderEmployeesPage(containerId) {
  const c = $(containerId); if (!c) return;
  if (selectedEmployeeCode) { renderEmployeeDetail(containerId, selectedEmployeeCode); return; }
  renderRoster(containerId);
}

function renderRoster(containerId) {
  const c = $(containerId); if (!c) return;
  const rows = editMode ? state.employees : state.employees.filter(e => e.active !== false);

  c.innerHTML = `<div style="display:flex;justify-content:flex-end;padding:10px 16px 0">
      <button class="btn" id="${containerId}-edit-toggle">${editMode ? 'Done' : 'Edit employees'}</button>
    </div>
    <div class="twrap"><table>
    <thead><tr><th>Code</th><th>Signed Docs</th><th>Personal Trading</th><th></th></tr></thead>
    <tbody id="${containerId}-emp-tb"></tbody>
    </table></div>
    ${editMode ? `<div style="padding:12px 16px"><button class="btn" id="${containerId}-add">+ Add employee</button></div>` : ''}`;

  $(`${containerId}-edit-toggle`).onclick = () => { editMode = !editMode; renderRoster(containerId); };

  const addBtn = $(`${containerId}-add`);
  if (addBtn) {
    addBtn.onclick = async () => {
      const code = prompt('Employee code (e.g. ABCX — never a real name):');
      if (!code) return;
      const role = prompt('Role:') || null;
      const { data, error } = await api.insertEmployee({ code: code.trim().toUpperCase(), role });
      if (!data) { alert('Could not add employee: ' + error); return; }
      await refreshEmployees();
      renderRoster(containerId);
    };
  }

  const tb = $(containerId + '-emp-tb');
  tb.innerHTML = rows.map(e => {
    const hidden = e.active === false;
    const docs = state.employeeDocuments.filter(d => d.employees && d.employees.code === e.code);
    const signedN = docs.filter(d => d.status === 'signed').length;
    const reports = state.ptReports.filter(r => r.employees && r.employees.code === e.code);
    const submittedN = reports.filter(r => r.status !== 'pending').length;
    return `<tr data-code="${e.code}" ${hidden ? 'style="opacity:.5"' : ''}>
      <td><span class="code">${e.code}</span>${hidden ? ' <span style="font-size:9px;color:#9CA3AF">(hidden)</span>' : ''}</td>
      <td style="font-size:11px;color:#6B7280">${signedN} / ${docs.length} signed</td>
      <td style="font-size:11px;color:#6B7280">${submittedN} / ${reports.length} submitted</td>
      <td>${editMode
        ? `<button class="btn emp-toggle">${hidden ? 'Unhide' : 'Hide'}</button>`
        : `<button class="btn emp-open">View detail</button>`}</td>
    </tr>`;
  }).join('');

  tb.querySelectorAll('.emp-open').forEach(btn => {
    btn.onclick = () => { selectedEmployeeCode = btn.closest('tr').dataset.code; renderEmployeesPage(containerId); };
  });
  tb.querySelectorAll('.emp-toggle').forEach(btn => {
    btn.onclick = async () => {
      const code = btn.closest('tr').dataset.code;
      const e = state.employees.find(x => x.code === code);
      if (!e) return;
      await api.updateEmployee(e.id, { active: e.active === false });
      await refreshEmployees();
      renderRoster(containerId);
    };
  });
}

async function renderEmployeeDetail(containerId, code) {
  const c = $(containerId); if (!c) return;
  const employee = state.employees.find(e => e.code === code);
  if (!employee) { selectedEmployeeCode = null; renderRoster(containerId); return; }

  c.innerHTML = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:2px">
    <button class="btn" id="emp-back">← Roster</button>
    <span class="code" style="font-size:14px">${employee.code}</span>
  </div>
  <div class="card">
    <div class="ch"><span class="ct">Signed Documents</span></div>
    <div id="emp-docs-rows"></div>
  </div>
  <div class="card">
    <div class="ch"><div><div class="ct">Personal Trading — Brokerage Accounts</div></div><button class="btn" id="pt-add-account">+ Account</button></div>
    <div id="pt-accounts-rows"></div>
  </div>
  <div class="card">
    <div class="ch"><div><div class="ct">Trade Pre-clearance</div></div><button class="btn" id="pt-add-preclear">+ Request</button></div>
    <div id="pt-preclear-rows"></div>
  </div>
  <div class="card">
    <div class="ch"><span class="ct">Reports — Quarterly / Annual</span></div>
    <div id="pt-reports-rows"></div>
  </div>
  <div class="card">
    <div class="ch"><span class="ct">Brokerage Statements Received</span></div>
    <div id="pt-statements-rows"></div>
  </div>`;

  $('emp-back').onclick = () => { selectedEmployeeCode = null; renderEmployeesPage(containerId); };

  renderEmpDocs(employee);
  renderPtReportsFor(employee);

  const [accountsRes, preclearRes, statementsRes] = await Promise.all([
    api.fetchPersonalTradingAccounts(employee.id),
    api.fetchPreclearance(employee.id),
    api.fetchPersonalTradingStatements(employee.id),
  ]);
  renderPtAccounts(employee, accountsRes.data || []);
  renderPreclearance(employee, preclearRes.data || []);
  renderPtStatements(employee, statementsRes.data || []);

  $('pt-add-account').onclick = async () => {
    const broker = prompt('Broker / custodian:'); if (!broker) return;
    const account_ref = prompt('Account number (optional):') || null;
    const { data } = await api.insertPersonalTradingAccount({ employee_id: employee.id, broker, account_ref });
    if (data) { const r = await api.fetchPersonalTradingAccounts(employee.id); renderPtAccounts(employee, r.data || []); }
  };
  $('pt-add-preclear').onclick = async () => {
    const security = prompt('Security / ticker:'); if (!security) return;
    const { data } = await api.insertPreclearance({ employee_id: employee.id, security, request_date: new Date().toISOString().slice(0, 10) });
    if (data) { const r = await api.fetchPreclearance(employee.id); renderPreclearance(employee, r.data || []); }
  };
}

function renderEmpDocs(employee) {
  const rows = state.employeeDocuments.filter(d => d.employees && d.employees.code === employee.code);
  const el = $('emp-docs-rows');
  el.innerHTML = rows.map(d => `<div class="frow" data-eid="${d.id}">
    <div class="finfo">
      <div class="fname">${DOC_TYPE_LABEL[d.doc_type] || d.doc_type}</div>
      <div class="fmeta">${d.signed_date ? 'Signed: ' + fmtDate(d.signed_date) : 'Not signed'}</div>
      <div class="fctl">
        <label class="chk"><input type="checkbox" class="ed-signed" ${d.status === 'signed' ? 'checked' : ''}> Signed</label>
        <input type="date" class="dinp ed-date" value="${d.signed_date || ''}">
      </div>
    </div>
  </div>`).join('');

  rows.forEach(d => {
    const row = el.querySelector(`[data-eid="${d.id}"]`); if (!row) return;
    row.querySelector('.ed-signed').onchange = async (e) => {
      const { data } = await api.updateEmployeeDocument(d.id, { status: e.target.checked ? 'signed' : 'pending' });
      if (data) { await refreshEmployeeDocuments(); renderEmpDocs(employee); }
    };
    row.querySelector('.ed-date').onchange = async (e) => {
      const { data } = await api.updateEmployeeDocument(d.id, { signed_date: e.target.value || null });
      if (data) await refreshEmployeeDocuments();
    };
  });
}

function renderPtAccounts(employee, accounts) {
  const el = $('pt-accounts-rows');
  el.innerHTML = accounts.length
    ? accounts.map(a => `<div class="frow"><div class="finfo"><div class="fname">${a.broker}</div><div class="fmeta">${a.account_ref || 'No number on file'} · ${a.status}</div></div></div>`).join('')
    : `<div style="padding:14px 16px;color:#9CA3AF;font-size:11px">No accounts on file.</div>`;
}

function renderPreclearance(employee, requests) {
  const el = $('pt-preclear-rows');
  el.innerHTML = requests.length ? requests.map(r => `<div class="frow" data-rid="${r.id}">
    <div class="finfo">
      <div class="fname">${r.security}</div>
      <div class="fmeta">Requested: ${fmtDate(r.request_date)}</div>
      <div class="fctl">
        <select class="linp pc-decision">
          <option value="pending" ${r.decision === 'pending' ? 'selected' : ''}>Pending</option>
          <option value="approved" ${r.decision === 'approved' ? 'selected' : ''}>Approved</option>
          <option value="denied" ${r.decision === 'denied' ? 'selected' : ''}>Denied</option>
        </select>
      </div>
    </div>
  </div>`).join('') : `<div style="padding:14px 16px;color:#9CA3AF;font-size:11px">No requests on file.</div>`;

  requests.forEach(r => {
    const row = el.querySelector(`[data-rid="${r.id}"]`); if (!row) return;
    row.querySelector('.pc-decision').onchange = async (e) => {
      await api.updatePreclearance(r.id, { decision: e.target.value, decision_date: new Date().toISOString().slice(0, 10) });
    };
  });
}

function renderPtStatements(employee, statements) {
  const el = $('pt-statements-rows');
  if (!statements.length) {
    el.innerHTML = `<div style="padding:14px 16px;color:#9CA3AF;font-size:11px;display:flex;align-items:center;gap:10px">
      No quarters on file. <button class="btn" id="pt-gen-statements">Generate Q1–Q4 ${new Date().getFullYear()}</button>
    </div>`;
    $('pt-gen-statements').onclick = async () => {
      const year = new Date().getFullYear();
      for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
        await api.insertPersonalTradingStatement({ employee_id: employee.id, period: `${q} ${year}`, received: false });
      }
      const r = await api.fetchPersonalTradingStatements(employee.id);
      renderPtStatements(employee, r.data || []);
    };
    return;
  }
  el.innerHTML = statements.map(s => `<div class="frow" data-sid="${s.id}">
    <div class="finfo">
      <div class="fname">${s.period}</div>
      <div class="fctl"><label class="chk"><input type="checkbox" class="st-received" ${s.received ? 'checked' : ''}> Received</label></div>
    </div>
  </div>`).join('');

  statements.forEach(s => {
    const row = el.querySelector(`[data-sid="${s.id}"]`); if (!row) return;
    row.querySelector('.st-received').onchange = async (e) => {
      const updates = { received: e.target.checked };
      if (e.target.checked) updates.received_date = new Date().toISOString().slice(0, 10);
      await api.updatePersonalTradingStatement(s.id, updates);
    };
  });
}

function renderPtReportsFor(employee) {
  const rows = state.ptReports.filter(r => r.employees && r.employees.code === employee.code);
  const el = $('pt-reports-rows');
  el.innerHTML = rows.map(r => `<div class="frow" data-rrid="${r.id}">
    <div class="finfo">
      <div class="fname">${r.period} — ${r.report_type === 'annual_holdings' ? 'Annual Holdings Report' : 'Quarterly Transaction Report'}</div>
      <div class="fctl">
        <label class="chk"><input type="checkbox" class="rr-submitted" ${r.status !== 'pending' ? 'checked' : ''}> Submitted</label>
        <label class="chk"><input type="checkbox" class="rr-reviewed" ${r.status === 'reviewed' ? 'checked' : ''}> Reviewed</label>
      </div>
    </div>
  </div>`).join('');

  rows.forEach(r => {
    const row = el.querySelector(`[data-rrid="${r.id}"]`); if (!row) return;
    const sync = async () => {
      const submitted = row.querySelector('.rr-submitted').checked;
      const reviewed = row.querySelector('.rr-reviewed').checked;
      const status = reviewed ? 'reviewed' : submitted ? 'submitted' : 'pending';
      const updates = { status };
      if (submitted && !r.submitted_date) updates.submitted_date = new Date().toISOString().slice(0, 10);
      const { data } = await api.updatePersonalTradingReport(r.id, updates);
      if (data) { await refreshPtReports(); renderPtReportsFor(employee); }
    };
    row.querySelector('.rr-submitted').onchange = sync;
    row.querySelector('.rr-reviewed').onchange = sync;
  });
}
