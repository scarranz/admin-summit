// Communication — what's been sent to Advisory clients and Fund LP
// investors (letters, notices, statements). documents.category = 'investor_communication'.
import { state, refreshDocuments } from './data.js';
import * as api from './api.js';
import { $, fmtDate } from './utils.js';
import { openDocPreview } from './docviewer.js';

const ENTITIES_WITH_INVESTORS = [
  { key: 'advisory', label: 'Advisory clients' },
  { key: 'fund_lp', label: 'Fund LP investors' },
];

function entityLabel(key) {
  const found = ENTITIES_WITH_INVESTORS.find(e => e.key === key);
  return found ? found.label : 'Firmwide';
}

export function renderCommunications(containerId) {
  const c = $(containerId); if (!c) return;
  const rows = state.documents.filter(d => d.category === 'investor_communication')
    .sort((a, b) => (b.effective_date || '').localeCompare(a.effective_date || ''));

  const today = new Date().toISOString().slice(0, 10);
  c.innerHTML = `<div class="card">
    <div class="ch"><div><div class="ct">Communication</div><div class="csub">What's been sent to Advisory clients and Fund LP investors</div></div></div>
    <div class="comm-form">
      <select class="nsel" id="${containerId}-ent">${ENTITIES_WITH_INVESTORS.map(e => `<option value="${e.key}">${e.label}</option>`).join('')}</select>
      <input class="linp" id="${containerId}-title" placeholder="What is this? (e.g. Q2 2026 investor letter)" style="min-width:220px;flex:1">
      <input type="date" class="dinp" id="${containerId}-date" value="${today}">
      <label class="btn" style="cursor:pointer" id="${containerId}-file-lbl">Choose file<input type="file" id="${containerId}-file" style="display:none"></label>
      <button class="btn btn-pri" id="${containerId}-add">Add</button>
    </div>
    <div id="${containerId}-list"></div>
  </div>`;

  const fileInput = $(`${containerId}-file`);
  const fileLbl = $(`${containerId}-file-lbl`);
  let chosenFile = null;
  fileInput.onchange = (e) => {
    chosenFile = e.target.files[0] || null;
    fileLbl.firstChild.textContent = chosenFile ? chosenFile.name : 'Choose file';
  };

  $(`${containerId}-add`).onclick = async () => {
    const entKey = $(`${containerId}-ent`).value;
    const title = $(`${containerId}-title`).value.trim();
    const date = $(`${containerId}-date`).value;
    if (!title) { alert('Give this communication a short title first.'); return; }
    if (!chosenFile) { alert('Choose a file to upload.'); return; }
    const entity = state.entityByKey[entKey];
    const path = `communications/${entKey}-${Date.now()}-${chosenFile.name}`;
    const up = await api.uploadDocumentFile(path, chosenFile);
    if (!up.success) { alert('Could not upload the file: ' + up.error); return; }
    const saved = await api.insertDocument({
      entity_id: entity ? entity.id : null, category: 'investor_communication',
      title, storage_path: path, visibility: 'external_filed', effective_date: date || null,
    });
    if (!saved.success) { alert('Uploaded, but could not save the record: ' + saved.error); return; }
    await refreshDocuments();
    renderCommunications(containerId);
  };

  const listEl = $(`${containerId}-list`);
  if (!rows.length) { listEl.innerHTML = `<div class="pane-empty">Nothing logged yet — the form above adds the first one.</div>`; return; }
  listEl.innerHTML = rows.map(d => {
    const entKey = d.entities ? d.entities.key : null;
    return `<div class="frow" data-did="${d.id}">
      <div class="finfo">
        <div class="fname">${d.title}</div>
        <div class="fmeta">${entityLabel(entKey)}${d.effective_date ? ' · ' + fmtDate(d.effective_date) : ''}</div>
      </div>
      <div class="comm-actions">
        <button class="btn comm-view">View</button>
        <button class="btn btn-danger comm-delete" type="button">Delete</button>
      </div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.comm-view').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.closest('[data-did]').dataset.did;
      const doc = state.documents.find(d => d.id === id);
      if (!doc || !doc.storage_path) return;
      const { data } = await api.getDocumentFileUrl(doc.storage_path);
      if (data && data.signedUrl) openDocPreview(data.signedUrl, doc.title);
    };
  });
  listEl.querySelectorAll('.comm-delete').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.closest('[data-did]').dataset.did;
      const doc = state.documents.find(d => d.id === id);
      if (!doc) return;
      if (!confirm(`Delete "${doc.title}"? This removes the uploaded file — it can't be undone.`)) return;
      await api.deleteDocumentAndFile(doc);
      await refreshDocuments();
      renderCommunications(containerId);
    };
  });
}
