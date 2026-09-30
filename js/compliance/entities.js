// Dashboard (global calendar + pending list + entity cards) and the
// per-entity page (General Information / Filings / Taxes tabs).
import { state, refreshFilings, refreshFilingHistory, refreshDocuments, refreshEntities, passesVisibility } from './data.js';
import * as api from './api.js';
import { $, fmtDate, fmtUsd, filingUrgency } from './utils.js';
import { renderCalendar } from './calendar.js';
import { show } from './nav.js';
import { openDocPreview } from './docviewer.js';

const ENTITY_ORDER = ['advisory', 'fund_llc', 'fund_lp'];
const ENTITY_COLOR = { advisory: '#1E40AF', fund_llc: '#059669', fund_lp: '#059669' };
const ENTITY_SUFFIX = { advisory: '', fund_llc: ' · LLC (ERA)', fund_lp: ' · LP' };

// entities.display_name is stored as "The Advisory" / "The Fund" in Supabase — drop
// the leading "The" for display only, without touching the seeded data.
const stripThe = (name) => name.replace(/^The\s+/, '');

// ─── Dashboard ──────────────────────────────────────────────

export function renderDashboard() {
  const c = $('page-dashboard'); if (!c) return;
  c.innerHTML = `
    <div id="dash-calendar"></div>
    <div class="ent-grid" id="dash-entities"></div>
  `;
  renderCalendar('dash-calendar', ENTITY_ORDER);
  renderEntityCards('dash-entities');
}

function entityFilingScore(key) {
  const filings = state.filings.filter(f => (f.entities ? f.entities.key : '') === key && passesVisibility(f));
  return { done: filings.filter(f => f.status === 'completed').length, total: filings.length };
}

function renderEntityCards(containerId) {
  const c = $(containerId); if (!c) return;
  c.innerHTML = ENTITY_ORDER.map(key => {
    const e = state.entityByKey[key]; if (!e) return '';
    const { done, total } = entityFilingScore(key);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const overdue = state.filings.some(f => (f.entities ? f.entities.key : '') === key && filingUrgency(f) === 'overdue' && passesVisibility(f));
    return `<div class="ent-card" data-entity="${key}">
      <div class="ent-card-top">
        <span class="ent-name">${stripThe(e.display_name)}${ENTITY_SUFFIX[key]}</span>
        ${overdue ? '<span class="bx br">Overdue</span>' : ''}
      </div>
      <div class="ent-legal">${e.legal_name}</div>
      <div class="ent-type">${e.entity_type}</div>
      <div class="ent-progress">
        <div class="ent-track"><div class="ent-fill" style="width:${pct}%;background:${ENTITY_COLOR[key]}"></div></div>
        <span class="ent-pct">${done} / ${total} filings up to date</span>
      </div>
    </div>`;
  }).join('');
  c.querySelectorAll('.ent-card').forEach(card => card.onclick = () => show('entity-' + card.dataset.entity));
}

// ─── Entity detail page ───────────────────────────────────────

export function renderEntityPage(key) {
  const containerId = 'page-entity-' + key;
  const c = $(containerId); if (!c) return;
  const e = state.entityByKey[key];
  if (!e) { c.innerHTML = `<div class="card"><div class="ch"><span class="ct">Entity not found</span></div></div>`; return; }

  const paneGeneral = 'ent-' + key + '-general';
  const paneFilings = 'ent-' + key + '-filings';
  const paneTaxes = 'ent-' + key + '-taxes';

  c.innerHTML = `<div class="card">
    <div class="stabs">
      <button class="stab active" data-stab="${paneGeneral}">General Information</button>
      <button class="stab" data-stab="${paneFilings}">Filings</button>
      <button class="stab" data-stab="${paneTaxes}">Taxes</button>
    </div>
    <div class="stab-pane active" id="${paneGeneral}"></div>
    <div class="stab-pane" id="${paneFilings}"></div>
    <div class="stab-pane" id="${paneTaxes}"></div>
  </div>`;

  renderEntityGeneral(paneGeneral, key);
  renderEntityFilings(paneFilings, key, ['filings', 'external_services']);
  renderEntityFilings(paneTaxes, key, ['tax']);
}

// ─── General Information ───────────────────────────────────────

const GENERAL_FIELDS = [
  ['legal_name', 'Legal Name'],
  ['entity_type', 'Entity Type'],
  ['ein', 'EIN'],
  ['crd', 'CRD'],
  ['sec_file_number', 'SEC File #'],
  ['state_file_number', 'State / Delaware File #'],
  ['formed_date', 'Formation Date'],
  ['fiscal_year_end', 'Fiscal Year End'],
  ['address', 'Address'],
  ['cco_name', 'CCO'],
  ['cco_title', 'CCO Title'],
  ['cco_phone', 'CCO Phone'],
  ['aum_usd', 'AUM / NAV'],
  ['custodian', 'Custodian'],
  ['administrator', 'Administrator'],
  ['auditor', 'Auditor'],
  ['registered_agent', 'Registered Agent'],
];

function prettifyKey(k) {
  return k.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
}

// field -> input type, for edit mode. Everything not listed here is a plain text input.
const FIELD_INPUT_TYPE = { formed_date: 'date', aum_usd: 'number' };

const editModeGeneral = new Set(); // entity keys currently showing the edit form

function renderEntityGeneral(paneId, key) {
  const pane = $(paneId); if (!pane) return;
  const e = state.entityByKey[key]; if (!e) return;
  const editing = editModeGeneral.has(key);

  const details = e.details || {};
  const detailRows = Object.entries(details).map(([k, v]) => {
    let val = v;
    if (typeof v === 'boolean') val = v ? 'Yes' : 'No';
    else if (typeof v === 'number' && /nav|amount|sold|investment/i.test(k)) val = fmtUsd(v);
    return `<div class="info-item"><div class="info-lbl">${prettifyKey(k)}</div><div class="info-val">${val}</div></div>`;
  }).join('');

  if (!editing) {
    const rows = GENERAL_FIELDS.map(([field, label]) => {
      let val = e[field];
      if (!val && val !== 0) return '';
      if (field === 'aum_usd') val = fmtUsd(val);
      if (field === 'formed_date') val = fmtDate(val);
      return `<div class="info-item"><div class="info-lbl">${label}</div><div class="info-val">${val}</div></div>`;
    }).join('');

    pane.innerHTML = `
      <div class="info-hd"><button class="btn btn-sm" id="${paneId}-edit-btn">Edit</button></div>
      <div class="info-grid">${rows}</div>
      ${e.aum_note ? `<div class="info-note">⚠ ${e.aum_note}</div>` : ''}
      ${detailRows ? `<div class="info-sub-title">Additional Details</div><div class="info-grid">${detailRows}</div>` : ''}
    `;
    $(`${paneId}-edit-btn`).onclick = () => { editModeGeneral.add(key); renderEntityGeneral(paneId, key); };
    return;
  }

  const editRows = GENERAL_FIELDS.map(([field, label]) => {
    const type = FIELD_INPUT_TYPE[field] || 'text';
    const val = e[field] ?? '';
    return `<div class="info-item">
      <div class="info-lbl">${label}</div>
      <input class="info-edit-input" type="${type}" data-field="${field}" value="${String(val).replace(/"/g, '&quot;')}">
    </div>`;
  }).join('');

  pane.innerHTML = `
    <div class="info-hd">
      <button class="btn btn-sm" id="${paneId}-save-btn">Save</button>
      <button class="btn btn-sm" id="${paneId}-cancel-btn">Cancel</button>
    </div>
    <div class="info-grid">${editRows}</div>
    ${detailRows ? `<div class="info-sub-title">Additional Details (read-only)</div><div class="info-grid">${detailRows}</div>` : ''}
  `;

  $(`${paneId}-cancel-btn`).onclick = () => { editModeGeneral.delete(key); renderEntityGeneral(paneId, key); };
  $(`${paneId}-save-btn`).onclick = async () => {
    const saveBtn = $(`${paneId}-save-btn`);
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    const updates = {};
    pane.querySelectorAll('.info-edit-input').forEach(input => {
      const field = input.dataset.field;
      let val = input.value.trim();
      if (field === 'aum_usd') updates[field] = val === '' ? null : Number(val);
      else updates[field] = val === '' ? null : val;
    });
    const res = await api.updateEntity(e.id, updates);
    if (!res.success) { alert('Could not save: ' + res.error); saveBtn.disabled = false; saveBtn.textContent = 'Save'; return; }
    await refreshEntities();
    editModeGeneral.delete(key);
    renderEntityGeneral(paneId, key);
  };
}

// ─── Filings / Taxes list (shared) ─────────────────────────────

function filingsForEntityGroups(entityKey, pageGroups) {
  return state.filings.filter(f => {
    const key = f.entities ? f.entities.key : '__firmwide__';
    return key === entityKey && pageGroups.includes(f.page_group) && passesVisibility(f);
  });
}

function renderEntityFilings(paneId, entityKey, pageGroups) {
  const pane = $(paneId); if (!pane) return;
  const rows = filingsForEntityGroups(entityKey, pageGroups);
  if (!rows.length) { pane.innerHTML = `<div class="pane-empty">No records in this view.</div>`; return; }

  const external = rows.filter(f => f.visibility === 'external_filed');
  const internal = rows.filter(f => f.visibility === 'internal_only');
  const section = (label, list) => !list.length ? '' : `
    <div class="fsec">
      <div class="fsec-hd">${label}</div>
      <div>${list.map(f => filingRowHtml(f)).join('')}</div>
    </div>`;

  pane.innerHTML = section('External', external) + section('Internal', internal);
  rows.forEach(f => wireFilingRow(f, paneId, entityKey, pageGroups));
}

// The provider's invoice (documents.category = 'invoice') is the one file per
// filing that isn't year-versioned — just "the current invoice on file."
function findInvoiceDoc(filingId) {
  return state.documents.find(d => d.filing_id === filingId && d.storage_path && d.category === 'invoice');
}

function filingInvoiceHtml(f) {
  const doc = findInvoiceDoc(f.id);
  if (doc) return `<a href="#" class="f-inv-view">Invoice: View</a> <label class="btn btn-sm" style="cursor:pointer">Replace<input type="file" class="f-inv-upload" style="display:none"></label> <button class="btn btn-sm btn-danger f-inv-delete" type="button">Delete</button>`;
  return `<label class="btn btn-sm" style="cursor:pointer">Upload invoice<input type="file" class="f-inv-upload" style="display:none"></label>`;
}

// Every completed cycle for a filing lives in filing_history, one row per year.
function filingVersions(filingId) {
  return state.filingHistory.filter(h => h.filing_id === filingId).sort((a, b) => b.period_year - a.period_year);
}

// A period can have more than one filing on record (e.g. a filing that
// was amended, or that bundles more than one document) — list every
// filing_history row for that year, each independently viewable and
// replaceable, plus a standing "Add document" control that always
// creates a new one rather than overwriting what's there.
function yearSlotHtml(year, versions) {
  const yearVersions = versions.filter(v => v.period_year === year);
  const rows = yearVersions.map(v => `
    <div class="fyear-row" data-hid="${v.id}">
      <span class="fyear-file">${v.document_id
        ? `<a href="#" class="fyear-view" data-docid="${v.document_id}">${fmtDate(v.completed_date)} · View</a>`
        : `${fmtDate(v.completed_date)} · No file attached`}</span>
      <span class="fyear-ctl">
        <label class="btn btn-sm" style="cursor:pointer">${v.document_id ? 'Replace' : 'Upload'}<input type="file" class="f-doc-replace" style="display:none"></label>
        <button class="btn btn-sm btn-danger fyear-delete" type="button">Delete</button>
      </span>
    </div>`).join('');

  return `
    ${rows || `<div class="fyear-empty">No file for ${year}</div>`}
    <label class="btn btn-sm" style="cursor:pointer;margin-top:6px">+ Add document<input type="file" class="f-doc-upload" style="display:none"></label>
  `;
}

function filingRowHtml(f) {
  const urgency = filingUrgency(f);
  const badgeClass = f.status === 'completed' ? 'bg' : urgency === 'overdue' ? 'br' : urgency === 'urgent' ? 'ba' : 'bgr';
  const badgeText = f.status === 'completed' ? 'Completed ✓' : urgency === 'overdue' ? 'Overdue' : urgency === 'urgent' ? 'Upcoming' : 'Pending';
  const dueText = f.next_due_date ? fmtDate(f.next_due_date) : (f.recurrence === 'never' ? 'No expiration' : '—');

  return `<div class="frow1" data-fid="${f.id}">
    <span class="fdue">${dueText}</span>
    <span class="fname1">${f.name}</span>
    <span class="bx ${badgeClass}">${badgeText}</span>
  </div>`;
}

// Clicking a filing row opens this popup: which year's file, provider,
// invoice, next-due date, regulator, notes — everything but the due date
// and status stays out of the row itself so the list reads as one line each.
let detailsModal = null;
function ensureDetailsModal() {
  if (detailsModal) return detailsModal;
  detailsModal = document.createElement('div');
  detailsModal.className = 'modal-bg';
  detailsModal.innerHTML = `<div class="modal">
    <h3 class="fd-title"></h3>
    <div class="mf"><label>Filed</label>
      <select class="nsel fd-year" style="width:auto;margin-bottom:8px"></select>
      <div class="fd-year-slot"></div>
    </div>
    <div class="mf"><label>Regulator</label><div class="fd-regulator" style="font-size:12px;color:#374151"></div></div>
    <div class="mf"><label>Next due date</label><input type="date" class="fd-date"></div>
    <div class="mf"><label class="fd-toggle-lbl"><input type="checkbox" class="fd-has-provider"> This filing is paid to a provider (has an invoice)</label></div>
    <div class="fd-provider-wrap">
      <div class="mf"><label>Provider</label><input class="fd-provider" placeholder="Who we pay for this..."></div>
      <div class="mf"><label>Invoice</label><div class="fd-invoice"></div></div>
    </div>
    <div class="mf fd-notes-wrap" hidden><label>Notes</label><div class="fd-notes" style="font-size:11px;color:#6B7280;line-height:1.5"></div></div>
    <div class="mbtns"><button class="btn fd-close" type="button">Close</button></div>
  </div>`;
  document.getElementById('cmp-root').appendChild(detailsModal);
  const close = () => detailsModal.classList.remove('open');
  detailsModal.querySelector('.fd-close').onclick = close;
  detailsModal.addEventListener('click', (e) => { if (e.target === detailsModal) close(); });
  return detailsModal;
}

async function uploadInvoiceFor(f, file) {
  const existing = findInvoiceDoc(f.id);
  const path = `filings/${f.id}-invoice-${file.name}`;
  const up = await api.uploadDocumentFile(path, file);
  if (!up.success) { alert('Could not upload the file: ' + up.error); return; }
  const saved = existing
    ? await api.updateDocument(existing.id, { storage_path: path })
    : await api.insertDocument({ entity_id: f.entity_id, filing_id: f.id, category: 'invoice', title: 'Invoice — ' + f.name, storage_path: path, visibility: f.visibility });
  if (!saved.success) { alert('The file uploaded but could not be linked to the filing: ' + saved.error); return; }
  await refreshDocuments();
}

function openFilingDetails(f, rerenderRow) {
  const m = ensureDetailsModal();
  m.querySelector('.fd-title').textContent = f.name;
  m.querySelector('.fd-regulator').textContent = f.regulator || '—';
  const notesWrap = m.querySelector('.fd-notes-wrap');
  notesWrap.hidden = !f.notes;
  if (f.notes) m.querySelector('.fd-notes').textContent = f.notes;

  const dateInput = m.querySelector('.fd-date');
  dateInput.value = f.next_due_date || '';
  dateInput.onchange = async () => {
    await api.updateFiling(f.id, { next_due_date: dateInput.value || null });
    f.next_due_date = dateInput.value || null;
    await refreshFilings();
    rerenderRow();
  };

  const providerWrap = m.querySelector('.fd-provider-wrap');
  const hasProviderToggle = m.querySelector('.fd-has-provider');
  hasProviderToggle.checked = !!f.has_provider;
  providerWrap.hidden = !f.has_provider;
  hasProviderToggle.onchange = async () => {
    providerWrap.hidden = !hasProviderToggle.checked;
    await api.updateFiling(f.id, { has_provider: hasProviderToggle.checked });
    f.has_provider = hasProviderToggle.checked;
  };

  const providerInput = m.querySelector('.fd-provider');
  providerInput.value = f.provider_name || '';
  providerInput.onblur = async () => {
    await api.updateFiling(f.id, { provider_name: providerInput.value || null });
    f.provider_name = providerInput.value || null;
  };

  const invSlot = m.querySelector('.fd-invoice');
  const drawInvoice = () => {
    invSlot.innerHTML = filingInvoiceHtml(f);
    const viewLink = invSlot.querySelector('.f-inv-view');
    const uploadInput = invSlot.querySelector('.f-inv-upload');
    if (viewLink) {
      viewLink.onclick = async (e) => {
        e.preventDefault();
        const doc = findInvoiceDoc(f.id);
        if (!doc || !doc.storage_path) return;
        const { data } = await api.getDocumentFileUrl(doc.storage_path);
        if (data && data.signedUrl) openDocPreview(data.signedUrl, 'Invoice — ' + f.name);
      };
    }
    if (uploadInput) {
      uploadInput.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        await uploadInvoiceFor(f, file);
        drawInvoice();
      };
    }
    const deleteBtn = invSlot.querySelector('.f-inv-delete');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        const doc = findInvoiceDoc(f.id);
        if (!doc) return;
        if (!confirm('Delete this invoice? This removes the uploaded file — it can\'t be undone.')) return;
        await api.deleteDocumentAndFile(doc);
        await refreshDocuments();
        drawInvoice();
      };
    }
  };
  drawInvoice();

  // Year picker + that year's file. Uploading IS what marks it filed —
  // replacing an existing year keeps its filing_history row, a new year
  // creates one. Only the most recent year on record updates the filing's
  // own completed status.
  const yearSel = m.querySelector('.fd-year');
  const yearSlot = m.querySelector('.fd-year-slot');

  // Ask for the filed-on date (today for the current calendar year,
  // prompted for a backfilled past year), then mark the filing itself
  // completed if this is the most recent year on record.
  async function resolveFiledDate(year) {
    const currentCalYear = new Date().getFullYear();
    if (year === currentCalYear) return new Date().toISOString().slice(0, 10);
    return prompt(`What date in ${year} was this filed? (YYYY-MM-DD)`, `${year}-12-31`);
  }
  async function markLatestYearCompleted(year, filedOn) {
    const versions = filingVersions(f.id);
    const currentCalYear = new Date().getFullYear();
    const latestYear = Math.max(currentCalYear, ...versions.map(v => v.period_year), year);
    if (year === latestYear) await api.updateFiling(f.id, { status: 'completed', last_completed_date: filedOn });
  }

  const drawYearSlot = () => {
    const year = Number(yearSel.value);
    const versions = filingVersions(f.id);
    yearSlot.innerHTML = yearSlotHtml(year, versions);

    yearSlot.querySelectorAll('.fyear-view').forEach(viewLink => {
      viewLink.onclick = async (e) => {
        e.preventDefault();
        const doc = state.documents.find(d => d.id === viewLink.dataset.docid);
        if (!doc || !doc.storage_path) return;
        const { data } = await api.getDocumentFileUrl(doc.storage_path);
        if (data && data.signedUrl) openDocPreview(data.signedUrl, f.name + ' · ' + year);
      };
    });

    // Replace/attach the file for one specific existing entry.
    yearSlot.querySelectorAll('.f-doc-replace').forEach(input => {
      input.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const hid = input.closest('.fyear-row').dataset.hid;
        const version = versions.find(v => v.id === hid);
        if (!version) return;
        const path = `filings/${f.id}-${year}-${Date.now()}-${file.name}`;
        const up = await api.uploadDocumentFile(path, file);
        if (!up.success) { alert('Could not upload the file: ' + up.error); return; }
        if (version.document_id) {
          await api.updateDocument(version.document_id, { storage_path: path });
        } else {
          const saved = await api.insertDocument({
            entity_id: f.entity_id, filing_id: f.id, category: f.page_group === 'tax' ? 'tax' : 'adv_form',
            title: f.name, storage_path: path, visibility: f.visibility,
          });
          if (!saved.success) { alert('The file uploaded but could not be linked to the filing: ' + saved.error); return; }
          await api.updateFilingHistory(hid, { document_id: saved.data.id });
        }
        await markLatestYearCompleted(year, version.completed_date);
        await Promise.all([refreshDocuments(), refreshFilings(), refreshFilingHistory()]);
        drawYearSlot();
        rerenderRow();
      };
    });

    // Delete a specific entry — removes its uploaded file (if any) and
    // its filing_history row, then recomputes the filing's own
    // completed/pending status from whatever's left on record.
    yearSlot.querySelectorAll('.fyear-delete').forEach(btn => {
      btn.onclick = async () => {
        const hid = btn.closest('.fyear-row').dataset.hid;
        const version = versions.find(v => v.id === hid);
        if (!version) return;
        if (!confirm('Delete this document? This removes the uploaded file and its record — this can\'t be undone.')) return;
        if (version.document_id) {
          const doc = state.documents.find(d => d.id === version.document_id);
          if (doc) await api.deleteDocumentAndFile(doc);
        }
        await api.deleteFilingHistory(hid);
        await Promise.all([refreshDocuments(), refreshFilingHistory()]);
        const remaining = filingVersions(f.id);
        await api.updateFiling(f.id, remaining.length
          ? { status: 'completed', last_completed_date: remaining[0].completed_date }
          : { status: 'pending', last_completed_date: null });
        await refreshFilings();
        drawYearSlot();
        rerenderRow();
      };
    });

    // "+ Add document" — always creates a new filing_history row, so a
    // year that already has one or more documents can carry another
    // (an amendment, a second filing in the same period, etc.).
    const addInput = yearSlot.querySelector('.f-doc-upload');
    if (addInput) {
      addInput.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const filedOn = await resolveFiledDate(year);
        if (!filedOn) return;
        const path = `filings/${f.id}-${year}-${Date.now()}-${file.name}`;
        const up = await api.uploadDocumentFile(path, file);
        if (!up.success) { alert('Could not upload the file: ' + up.error); return; }
        const saved = await api.insertDocument({
          entity_id: f.entity_id, filing_id: f.id, category: f.page_group === 'tax' ? 'tax' : 'adv_form',
          title: f.name, storage_path: path, visibility: f.visibility,
        });
        if (!saved.success) { alert('The file uploaded but could not be linked to the filing: ' + saved.error + '\nHas sql/003_filing_documents.sql been run in Supabase yet?'); return; }
        await api.insertFilingHistory({ filing_id: f.id, period_year: year, completed_date: filedOn, document_id: saved.data.id });
        await markLatestYearCompleted(year, filedOn);
        await Promise.all([refreshDocuments(), refreshFilings(), refreshFilingHistory()]);
        drawYearSlot();
        rerenderRow();
      };
    }
  };
  const versionsNow = filingVersions(f.id);
  const currentYear = new Date().getFullYear();
  const years = [...new Set([currentYear, ...versionsNow.map(v => v.period_year)])].sort((a, b) => b - a);
  const selectedYear = versionsNow.length ? versionsNow[0].period_year : currentYear;
  yearSel.innerHTML = years.map(y => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('');
  yearSel.onchange = drawYearSlot;
  drawYearSlot();

  m.classList.add('open');
}

function wireFilingRow(f, paneId, entityKey, pageGroups) {
  const row = document.querySelector(`#${paneId} [data-fid="${f.id}"]`);
  if (!row) return;
  row.onclick = () => openFilingDetails(f, () => renderEntityFilings(paneId, entityKey, pageGroups));
}
