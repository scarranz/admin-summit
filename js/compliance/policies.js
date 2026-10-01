// Internal policy library — same one-line-row + click-for-details pattern as
// Filings/Taxes (js/entities.js), including the year picker: every reviewed
// document lives in policy_history (one row per year) so the portal holds
// up across many years of audit history, not just the current cycle.
import { state, refreshDocuments, refreshPolicyHistory, passesVisibility } from './data.js';
import * as api from './api.js';
import { $, fmtDate } from './utils.js';
import { openDocPreview } from './docviewer.js';

export function renderPolicies(containerId) {
  const c = $(containerId); if (!c) return;
  const rows = state.policies.filter(p => passesVisibility({ visibility: 'internal_only' })); // policies are always internal
  c.innerHTML = rows.map(p => policyRowHtml(p)).join('');
  rows.forEach(p => wirePolicyRow(p, containerId));
}

function policyVersions(policyId) {
  return state.policyHistory.filter(h => h.policy_id === policyId).sort((a, b) => b.period_year - a.period_year);
}

function yearSlotHtml(year, versions) {
  const v = versions.find(x => x.period_year === year);
  if (v) {
    return `<span class="fyear-file">${v.document_id ? `<a href="#" class="pyear-view" data-docid="${v.document_id}">${fmtDate(v.completed_date)} · View</a>` : fmtDate(v.completed_date)}</span>
      <span class="fyear-ctl">
        <label class="btn btn-sm" style="cursor:pointer">Replace<input type="file" class="p-doc-upload" style="display:none"></label>
        <button class="btn btn-sm btn-danger p-doc-delete" type="button">Delete</button>
      </span>`;
  }
  return `<span class="fyear-empty">No file for ${year}</span>
    <label class="btn btn-sm" style="cursor:pointer">Upload<input type="file" class="p-doc-upload" style="display:none"></label>`;
}

function policyRowHtml(p) {
  const versions = policyVersions(p.id);
  const hasDoc = versions.length > 0;
  const done = hasDoc && (!p.requires_review || p.review_completed);
  return `<div class="frow1" data-pid="${p.id}">
    <span class="fname1">${p.name}</span>
    <span class="bx ${done ? 'bg' : 'ba'}">${done ? 'Completed ✓' : 'Pending'}</span>
  </div>`;
}

let policyModal = null;
function ensurePolicyModal() {
  if (policyModal) return policyModal;
  policyModal = document.createElement('div');
  policyModal.className = 'modal-bg';
  policyModal.innerHTML = `<div class="modal">
    <h3 class="pm-title"></h3>
    <div class="mf pm-meta-wrap" hidden><div class="pm-meta" style="font-size:11px;color:#6B7280"></div></div>
    <div class="mf"><label>Document</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <select class="nsel pm-year" style="width:auto"></select>
        <span class="pm-year-slot"></span>
      </div>
    </div>
    <div class="mf pm-loc-wrap" hidden><div class="pm-loc" style="font-size:10px;color:#9CA3AF"></div></div>
    <div class="mf pm-review-wrap" hidden><label class="chk"><input type="checkbox" class="pm-review"> Review completed</label></div>
    <div class="mf"><label>Reviewed by</label><input class="pm-reviewer" placeholder="Who reviewed it..."></div>
    <div class="mbtns"><button class="btn pm-close" type="button">Close</button></div>
  </div>`;
  document.getElementById('cmp-root').appendChild(policyModal);
  const close = () => policyModal.classList.remove('open');
  policyModal.querySelector('.pm-close').onclick = close;
  policyModal.addEventListener('click', (e) => { if (e.target === policyModal) close(); });
  return policyModal;
}

function openPolicyDetails(p, rerenderRow) {
  const m = ensurePolicyModal();
  m.querySelector('.pm-title').textContent = p.name;
  const metaWrap = m.querySelector('.pm-meta-wrap');
  metaWrap.hidden = !p.meta;
  if (p.meta) m.querySelector('.pm-meta').textContent = p.meta;

  const locWrap = m.querySelector('.pm-loc-wrap');
  locWrap.hidden = !p.location;
  if (p.location) m.querySelector('.pm-loc').textContent = 'Indexed at: ' + p.location;

  const reviewWrap = m.querySelector('.pm-review-wrap');
  reviewWrap.hidden = !p.requires_review;
  const reviewChk = m.querySelector('.pm-review');
  reviewChk.checked = !!p.review_completed;
  reviewChk.onchange = async () => {
    const { data } = await api.updatePolicy(p.id, { review_completed: reviewChk.checked });
    if (data) { Object.assign(p, data); rerenderRow(); }
  };

  const reviewerInput = m.querySelector('.pm-reviewer');
  reviewerInput.value = p.reviewed_by || '';
  reviewerInput.onblur = async () => {
    const { data } = await api.updatePolicy(p.id, { reviewed_by: reviewerInput.value || null });
    if (data) Object.assign(p, data);
  };

  // Year picker + that year's document — same logic as Filings/Taxes.
  // Uploading a year's file marks that cycle reviewed; only the most recent
  // year on record updates review_date so backfilling an old year never
  // disturbs the current cycle.
  const yearSel = m.querySelector('.pm-year');
  const yearSlot = m.querySelector('.pm-year-slot');
  const drawYearSlot = () => {
    const year = Number(yearSel.value);
    const versions = policyVersions(p.id);
    yearSlot.innerHTML = yearSlotHtml(year, versions);
    const uploadInput = yearSlot.querySelector('.p-doc-upload');
    const viewLink = yearSlot.querySelector('.pyear-view');
    if (viewLink) {
      viewLink.onclick = async (e) => {
        e.preventDefault();
        const doc = state.documents.find(d => d.id === viewLink.dataset.docid);
        if (!doc || !doc.storage_path) return;
        const { data } = await api.getDocumentFileUrl(doc.storage_path);
        if (data && data.signedUrl) openDocPreview(data.signedUrl, p.name + ' · ' + year);
      };
    }
    if (uploadInput) {
      uploadInput.onchange = async (e) => {
        const file = e.target.files[0]; if (!file) return;
        const currentCalYear = new Date().getFullYear();
        let filedOn = year === currentCalYear ? new Date().toISOString().slice(0, 10) : null;
        if (!filedOn) {
          const input = prompt(`What date in ${year} was this reviewed? (YYYY-MM-DD)`, `${year}-12-31`);
          if (!input) return;
          filedOn = input;
        }
        const existingVersion = versions.find(v => v.period_year === year);
        const path = `policies/${p.id}-${year}-${file.name}`;
        const up = await api.uploadDocumentFile(path, file);
        if (!up.success) { alert('Could not upload the file: ' + up.error); return; }
        let docId = existingVersion && existingVersion.document_id;
        if (docId) {
          await api.updateDocument(docId, { storage_path: path });
        } else {
          const saved = await api.insertDocument({ policy_id: p.id, category: 'policy', title: p.name, storage_path: path, visibility: 'internal_only' });
          if (!saved.success) { alert('The file uploaded but could not be linked to the policy: ' + saved.error + '\nHas sql/010_policy_documents.sql and sql/011_policy_history.sql been run in Supabase yet?'); return; }
          docId = saved.data.id;
        }
        // Replacing an existing year's file just swaps its storage_path — the
        // policy_history row (year/date) it already has stays put.
        if (!existingVersion) await api.insertPolicyHistory({ policy_id: p.id, period_year: year, completed_date: filedOn, document_id: docId });
        const latestYear = Math.max(currentCalYear, ...versions.map(v => v.period_year), year);
        if (year === latestYear) await api.updatePolicy(p.id, { review_date: filedOn });
        await Promise.all([refreshDocuments(), refreshPolicyHistory()]);
        drawYearSlot();
        rerenderRow();
      };
    }
    const deleteBtn = yearSlot.querySelector('.p-doc-delete');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        const version = versions.find(v => v.period_year === year);
        if (!version) return;
        if (!confirm('Delete this document? This removes the uploaded file and its record — this can\'t be undone.')) return;
        if (version.document_id) {
          const doc = state.documents.find(d => d.id === version.document_id);
          if (doc) await api.deleteDocumentAndFile(doc);
        }
        await api.deletePolicyHistory(version.id);
        await Promise.all([refreshDocuments(), refreshPolicyHistory()]);
        const remaining = policyVersions(p.id);
        await api.updatePolicy(p.id, { review_date: remaining.length ? remaining[0].completed_date : null });
        drawYearSlot();
        rerenderRow();
      };
    }
  };
  const versionsNow = policyVersions(p.id);
  const currentYear = new Date().getFullYear();
  const years = [...new Set([currentYear, ...versionsNow.map(v => v.period_year)])].sort((a, b) => b - a);
  const selectedYear = versionsNow.length ? versionsNow[0].period_year : currentYear;
  yearSel.innerHTML = years.map(y => `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`).join('');
  yearSel.onchange = drawYearSlot;
  drawYearSlot();

  m.classList.add('open');
}

function wirePolicyRow(p, containerId) {
  const row = document.querySelector(`#${containerId} [data-pid="${p.id}"]`); if (!row) return;
  row.onclick = () => openPolicyDetails(p, () => renderPolicies(containerId));
}
