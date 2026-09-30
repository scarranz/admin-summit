// Document library — filtered by entity scope, category, and the global
// external/internal visibility filter. Files are indexed by local_path
// (reference to the source file on disk) until someone explicitly
// uploads via the "Upload" button, which writes storage_path.
import { state, refreshDocuments, passesVisibility } from './data.js';
import * as api from './api.js';
import { $ } from './utils.js';
import { openDocPreview } from './docviewer.js';

const CATEGORY_LABEL = {
  policy: 'Policy', adv_form: 'ADV Form', agreement: 'Agreement', formation: 'Formation / Corporate',
  kyc_manual: 'KYC Manual', org_structure: 'Org Structure', financial_statement: 'Financial Statement',
  u4: 'Form U4', tax: 'Tax', invoice: 'Invoice', other: 'Other',
};

export function renderDocuments(containerId, entityKeys) {
  const c = $(containerId); if (!c) return;
  const rows = state.documents.filter(d => {
    const key = d.entities ? d.entities.key : null;
    const scopeMatch = entityKeys === null ? key === null : entityKeys.includes(key);
    return scopeMatch && passesVisibility(d);
  });

  const cats = [...new Set(rows.map(d => d.category))];

  c.innerHTML = `<div class="card">
    <div class="ch">
      <div><div class="ct">Document Library</div><div class="csub">${rows.length} documents indexed</div></div>
      <select class="nsel" id="${containerId}-cat-filter"><option value="">All categories</option>${cats.map(cat => `<option value="${cat}">${CATEGORY_LABEL[cat] || cat}</option>`).join('')}</select>
    </div>
    <div id="${containerId}-list"></div>
  </div>`;

  const draw = () => {
    const catFilter = $(containerId + '-cat-filter').value;
    const list = rows.filter(d => !catFilter || d.category === catFilter);
    const listEl = $(containerId + '-list');
    if (!list.length) { listEl.innerHTML = `<div style="padding:16px;color:#9CA3AF;font-size:11px">No documents in this view.</div>`; return; }
    listEl.innerHTML = list.map(d => docRowHtml(d)).join('');
    list.forEach(d => wireDocRow(d, containerId));
  };
  $(containerId + '-cat-filter').onchange = draw;
  draw();
}

function docRowHtml(d) {
  const visTag = d.visibility === 'external_filed' ? '<span class="pill p-b" style="font-size:9px">External</span>' : '<span class="pill p-gr" style="font-size:9px">Internal</span>';
  return `<div class="frow" data-did="${d.id}">
    <div class="finfo">
      <div class="fname">${d.title} ${visTag} <span class="pill p-a" style="font-size:9px">${CATEGORY_LABEL[d.category] || d.category}</span></div>
      <div class="fmeta">${d.local_path || 'No reference path'}</div>
      ${d.notes ? `<div class="doc-loc">${d.notes}</div>` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end">
      ${d.storage_path
        ? `<div class="comm-actions"><button class="btn d-view">View file</button><button class="btn btn-danger d-delete" type="button">Delete</button></div>`
        : `<label class="btn" style="cursor:pointer">Upload<input type="file" class="d-upload" style="display:none"></label>`}
    </div>
  </div>`;
}

function wireDocRow(d, containerId) {
  const row = document.querySelector(`#${containerId}-list [data-did="${d.id}"]`); if (!row) return;
  const uploadInput = row.querySelector('.d-upload');
  if (uploadInput) {
    uploadInput.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const path = `${d.category}/${d.id}-${file.name}`;
      const up = await api.uploadDocumentFile(path, file);
      if (up.success) {
        const { data } = await api.updateDocument(d.id, { storage_path: path });
        if (data) { Object.assign(d, data); await refreshDocuments(); renderDocuments(containerId, containerId.includes('int') ? null : (containerId.includes('adv') ? ['advisory'] : ['fund_llc', 'fund_lp'])); }
      }
    };
  }
  const viewBtn = row.querySelector('.d-view');
  if (viewBtn) {
    viewBtn.onclick = async () => {
      const { data } = await api.getDocumentFileUrl(d.storage_path);
      if (data && data.signedUrl) openDocPreview(data.signedUrl, d.title);
    };
  }
  const deleteBtn = row.querySelector('.d-delete');
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete the uploaded file for "${d.title}"? The index entry stays — just without a file attached. This can't be undone.`)) return;
      await api.deleteDocumentFile(d.storage_path);
      const { data } = await api.updateDocument(d.id, { storage_path: null });
      if (data) {
        Object.assign(d, data);
        await refreshDocuments();
        renderDocuments(containerId, containerId.includes('int') ? null : (containerId.includes('adv') ? ['advisory'] : ['fund_llc', 'fund_lp']));
      }
    };
  }
}
