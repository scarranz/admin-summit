// FX rate cache, editor, and conversion helpers
import { supabase } from './supabase-client.js';
import { showToast } from './utils.js';

export let FX_RATES = {};
export const FX_FALLBACK = 17.30;
let _loaded = false;

export async function loadFxRates() {
  if (_loaded) return;
  const { data, error } = await supabase.from('fx_rates').select('year_month, rate');
  if (error) {
    console.error('Failed to load FX rates:', error);
    // Fallback: load from JSON
    try {
      const resp = await fetch('/fx_rates.json');
      const json = await resp.json();
      FX_RATES = json;
    } catch (e) {
      console.error('FX fallback also failed:', e);
    }
    _loaded = true;
    return;
  }
  FX_RATES = {};
  data.forEach(r => { FX_RATES[r.year_month] = parseFloat(r.rate); });
  _loaded = true;
}

export function fxRate(yearMonth) {
  return FX_RATES[yearMonth] || FX_FALLBACK;
}

export function mxnToUsd(mxnAmount, yearMonth) {
  const r = fxRate(yearMonth);
  return r > 0 ? mxnAmount / r : 0;
}

// ─── FX Editor ───

const fxState = { open: false };

export function toggleFxEditor() {
  fxState.open = !fxState.open;
  document.getElementById('fxEditorWrap').style.display = fxState.open ? '' : 'none';
  const btn = document.getElementById('fxToggleBtn');
  if (btn) btn.textContent = fxState.open ? 'Hide rates' : 'USD/MXN rates';
  if (fxState.open) renderFxEditor();
}

export function renderFxEditor() {
  const head = document.getElementById('fxEditorHead');
  const body = document.getElementById('fxEditorBody');
  if (!head || !body) return;

  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const yearsToShow = [2022, 2023, 2024, 2025, 2026];

  let headHtml = '<tr><th class="fx-year-th">Year</th>';
  monthNames.forEach(m => { headHtml += `<th class="fx-month-th">${m}</th>`; });
  headHtml += '<th class="fx-avg-th">Avg</th></tr>';
  head.innerHTML = headHtml;

  let bodyHtml = '';
  yearsToShow.forEach(y => {
    bodyHtml += `<tr><td class="fx-year-cell">${y}</td>`;
    let yearTotal = 0, yearCount = 0;
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2,'0')}`;
      const rate = FX_RATES[key];
      if (rate) { yearTotal += rate; yearCount++; }
      const display = rate ? rate.toFixed(2) : '<span style="color:var(--t3);">—</span>';
      bodyHtml += `<td class="fx-rate-cell editable-cell" data-fx-key="${key}" onclick="window._editFxCell(this)">${display}</td>`;
    }
    const avg = yearCount > 0 ? (yearTotal / yearCount).toFixed(2) : '—';
    bodyHtml += `<td class="fx-avg-cell">${avg}</td>`;
    bodyHtml += '</tr>';
  });
  body.innerHTML = bodyHtml;
}

export function editFxCell(td) {
  if (td.querySelector('input')) return;
  const key = td.dataset.fxKey;
  const currentVal = FX_RATES[key] || '';

  td.classList.add('editing');
  td.innerHTML = `<input type="number" step="0.0001" class="cell-input" value="${currentVal}" placeholder="0.00" />`;
  const input = td.querySelector('input');
  input.focus();
  input.select();

  let finished = false;
  function finish(save) {
    if (finished) return;
    finished = true;
    if (save) {
      const raw = input.value.trim();
      if (raw === '') {
        delete FX_RATES[key];
      } else {
        const newVal = parseFloat(raw);
        if (!isNaN(newVal) && newVal > 0) {
          FX_RATES[key] = Math.round(newVal * 10000) / 10000;
          // Persist to Supabase
          supabase.from('fx_rates').upsert({ year_month: key, rate: FX_RATES[key], is_real: true })
            .then(({ error }) => { if (error) showToast('Failed to save FX rate', 'error'); });
        }
      }
    }
    renderFxEditor();
    // Dispatch event so other pages know FX rates changed
    window.dispatchEvent(new CustomEvent('fx-rates-changed'));
  }

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') finish(true);
  });
}

// Expose to window for onclick handlers
window._editFxCell = editFxCell;
window._toggleFxEditor = toggleFxEditor;
