// Shared document-preview popup — click any "View" link in the portal to see
// the file without leaving the page. One instance, built lazily.
let modalEl = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement('div');
  modalEl.className = 'modal-bg doc-modal-bg';
  modalEl.innerHTML = `
    <div class="modal doc-modal">
      <div class="doc-modal-hd">
        <span class="doc-modal-title"></span>
        <div class="doc-modal-actions">
          <a class="doc-modal-open" target="_blank" rel="noopener">Open in new tab</a>
          <button class="doc-modal-close" aria-label="Close">✕</button>
        </div>
      </div>
      <div class="doc-modal-body"></div>
    </div>`;
  document.getElementById('cmp-root').appendChild(modalEl);
  modalEl.querySelector('.doc-modal-close').onclick = closeDocPreview;
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeDocPreview(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDocPreview(); });
  return modalEl;
}

export function closeDocPreview() {
  if (modalEl) { modalEl.classList.remove('open'); modalEl.querySelector('.doc-modal-body').innerHTML = ''; }
}

export function openDocPreview(url, title) {
  const m = ensureModal();
  m.querySelector('.doc-modal-title').textContent = title || 'Document';
  m.querySelector('.doc-modal-open').href = url;
  const body = m.querySelector('.doc-modal-body');
  const clean = url.split('?')[0];
  if (/\.(png|jpe?g|gif|webp)$/i.test(clean)) body.innerHTML = `<img src="${url}" alt="">`;
  else if (/\.pdf$/i.test(clean)) body.innerHTML = `<iframe src="${url}"></iframe>`;
  else body.innerHTML = `<div class="doc-modal-fallback">Preview isn't available for this file type.<br><a href="${url}" target="_blank" rel="noopener">Open in new tab</a> to view it.</div>`;
  m.classList.add('open');
}
