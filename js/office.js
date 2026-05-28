// Office Expenses page module
import { supabase } from './supabase-client.js';
import { YEARS, MONTH_NAMES, MONTH_NAMES_FULL, fmtUsd, fmtUsdShort, showToast, yearMonthKey } from './utils.js';
import { recomputeLineTotals } from './projection.js';
import { toggleFxEditor, renderFxEditor, FX_RATES } from './fx.js';

// ─── Data ───

let EXPENSE_LINES = [];
// Legacy alias
let EXPENSE_DATA = EXPENSE_LINES;

const EXPENSE_BUCKETS = [
  { name: 'Office',             subs: ['Renta', 'Aire Acondicionado', 'Telmex', 'Luz'] },
  { name: 'Technology',         subs: ['Bloomberg', 'Polygon', 'Google', 'Ycharts', 'ChatGPT', 'Claude', 'Neon.Tech', 'Fiscal.AI', 'Fly.io', 'Microsoft', 'Kumu', 'Servicios Tecnológicos'] },
  { name: 'Office Supply/Food', subs: ['Nespresso', 'Super/Desayunos'] },
  { name: 'Other',              subs: ['Extras', 'Supply oficina', 'Office Expenses'] },
];

const PROJECTABLE_BUCKETS = new Set(['Office', 'Technology', 'Office Supply/Food']);

// Reverse lookup: sub-category -> bucket name
const SUB_TO_BUCKET = {};
EXPENSE_BUCKETS.forEach(b => b.subs.forEach(s => { SUB_TO_BUCKET[s] = b.name; }));

function bucketOf(subcat) {
  return SUB_TO_BUCKET[subcat] || 'Other';
}

// Derived categories sorted by all-time spend desc
let EXPENSE_CATEGORIES = [];

function computeExpenseCategories() {
  return EXPENSE_LINES
    .slice()
    .sort((a, b) => (b.grand_total || 0) - (a.grand_total || 0))
    .map(line => line.name);
}

function getLine(subcat) {
  return EXPENSE_LINES.find(l => l.name === subcat);
}

// ─── State ───

const expState = {
  yearsOpen: new Set([2026]),
  view: 'category',
  showInactive: false,
  inactiveOverrides: new Map(),
  expandedCategory: null,
  collapsedBuckets: new Set(['Office', 'Technology', 'Office Supply/Food', 'Other']),
  chart: { granularity: 'monthly', type: 'bar', range: '12m' }
};

// Category color hints
const CATEGORY_COLORS = {
  'Office':         { bg: 'rgba(30,45,61,0.13)',    fg: '#1e2d3d' },
  'Technology':     { bg: 'rgba(24,95,165,0.13)',   fg: '#185fa5' },
  'Food/Supply':    { bg: 'rgba(45,106,79,0.13)',   fg: '#2d6a4f' },
  'Infrastructure': { bg: 'rgba(61,58,140,0.13)',   fg: '#3d3a8c' },
  'Other':          { bg: 'rgba(168,164,158,0.20)', fg: '#6b6860' },
};

// ─── Data loading ───

let _loaded = false;

async function loadExpenseData() {
  if (_loaded) return;

  try {
    // Load lines (metadata) and cells (values) from Supabase
    const [linesRes, cellsRes] = await Promise.all([
      supabase.from('office_expense_lines').select('id, name, bucket, is_active, display_order').order('display_order'),
      supabase.from('office_expense_cells').select('line_id, year_month, amount_usd, is_projected, source')
    ]);

    if (linesRes.error || cellsRes.error) throw new Error(linesRes.error?.message || cellsRes.error?.message);

    // Transform into EXPENSE_LINES shape
    const linesById = {};
    linesRes.data.forEach(row => {
      linesById[row.id] = {
        _id: row.id,
        name: row.name,
        bucket: row.bucket,
        is_active: row.is_active,
        monthly: {},
        year_totals: {},
        grand_total: 0,
        projectedMonths: []
      };
    });

    cellsRes.data.forEach(cell => {
      const line = linesById[cell.line_id];
      if (!line) return;
      line.monthly[cell.year_month] = parseFloat(cell.amount_usd) || 0;
      if (cell.is_projected) {
        line.projectedMonths.push(cell.year_month);
      }
    });

    EXPENSE_LINES = Object.values(linesById);
    EXPENSE_LINES.forEach(line => recomputeLineTotals(line));

    // Set inactive overrides from is_active
    EXPENSE_LINES.forEach(line => {
      if (!line.is_active) {
        expState.inactiveOverrides.set(line.name, 'inactive');
      }
    });

  } catch (err) {
    console.warn('Supabase load failed, trying fallback JSON:', err);

    try {
      const resp = await fetch('/expense_data_cells.json');
      const json = await resp.json();
      EXPENSE_LINES = json;
      EXPENSE_LINES.forEach(line => {
        if (!line.projectedMonths) line.projectedMonths = [];
        recomputeLineTotals(line);
      });
    } catch (e2) {
      console.error('Fallback also failed:', e2);
      EXPENSE_LINES = [];
    }
  }

  EXPENSE_DATA = EXPENSE_LINES;
  EXPENSE_CATEGORIES = computeExpenseCategories();
  _loaded = true;
}

// ─── Bucket sub-categories ───

function bucketSubcats(bucketName) {
  const b = EXPENSE_BUCKETS.find(x => x.name === bucketName);
  return b ? b.subs : [];
}

// ─── Visibility / Active state ───

function isExpCategoryActive(cat) {
  const override = expState.inactiveOverrides.get(cat);
  if (override === 'active') return true;
  if (override === 'inactive') return false;
  return true;
}

function isExpCategoryVisible(cat) {
  if (expState.showInactive) return true;
  return isExpCategoryActive(cat);
}

function toggleExpCategoryActive(cat) {
  const current = isExpCategoryActive(cat);
  expState.inactiveOverrides.set(cat, current ? 'inactive' : 'active');
  renderOfficeExpenses();
}

function toggleExpShowInactive() {
  expState.showInactive = !expState.showInactive;
  renderOfficeExpenses();
}

function expHiddenCount() {
  return EXPENSE_CATEGORIES.filter(c => !isExpCategoryActive(c)).length;
}

// ─── Aggregation helpers ───

function expCategoryMonth(cat, year, month) {
  const line = getLine(cat);
  if (!line) return 0;
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return line.monthly[key] || 0;
}

function expCategoryYear(cat, year) {
  const line = getLine(cat);
  if (!line) return 0;
  return line.year_totals[year] || 0;
}

function expCategoryGrand(cat) {
  const line = getLine(cat);
  return line ? line.grand_total : 0;
}

// ─── Projection helpers ───

function isLineProjected(line, year, month) {
  if (!line.projectedMonths) return false;
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return line.projectedMonths.includes(key);
}

function lineHasProjectionInYear(line, year) {
  if (!line.projectedMonths) return false;
  return line.projectedMonths.some(k => k.startsWith(`${year}-`));
}

function lineHasAnyProjection(line) {
  return !!(line.projectedMonths && line.projectedMonths.length > 0);
}

function bucketHasProjection(bucketName, year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return EXPENSE_LINES
    .filter(l => bucketOf(l.name) === bucketName)
    .some(l => isLineProjected(l, year, month));
}

function bucketProjectionMonth(bucketName, year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return EXPENSE_LINES
    .filter(l => bucketOf(l.name) === bucketName)
    .filter(l => isLineProjected(l, year, month))
    .reduce((s, l) => s + (l.monthly[key] || 0), 0);
}

function bucketProjectionYear(bucketName, year) {
  return EXPENSE_LINES
    .filter(l => bucketOf(l.name) === bucketName)
    .filter(l => lineHasProjectionInYear(l, year))
    .reduce((s, l) => {
      return s + (l.projectedMonths || [])
        .filter(k => k.startsWith(`${year}-`))
        .reduce((s2, k) => s2 + (l.monthly[k] || 0), 0);
    }, 0);
}

function bucketProjectionGrand(bucketName) {
  return EXPENSE_LINES
    .filter(l => bucketOf(l.name) === bucketName)
    .reduce((s, l) => {
      return s + (l.projectedMonths || []).reduce((s2, k) => s2 + (l.monthly[k] || 0), 0);
    }, 0);
}

// ─── Total aggregations ───

export function expTotalMonth(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return EXPENSE_LINES.reduce((s, l) => s + (l.monthly[key] || 0), 0);
}

export function expTotalYear(year) {
  return EXPENSE_LINES.reduce((s, l) => s + (l.year_totals[year] || 0), 0);
}

function expGrandTotal() {
  return EXPENSE_LINES.reduce((s, l) => s + l.grand_total, 0);
}

// Bucket-level aggregations
function expBucketMonth(bucketName, year, month) {
  return bucketSubcats(bucketName).reduce((s, sc) => s + expCategoryMonth(sc, year, month), 0);
}

function expBucketYear(bucketName, year) {
  return bucketSubcats(bucketName).reduce((s, sc) => s + expCategoryYear(sc, year), 0);
}

function expBucketGrand(bucketName) {
  return bucketSubcats(bucketName).reduce((s, sc) => s + expCategoryGrand(sc), 0);
}

// "Actual-only" aggregates (excludes projected months) — used by projector
function lineRealLatestInYear(line, year) {
  const projSet = new Set(line.projectedMonths || []);
  const realKeys = Object.keys(line.monthly)
    .filter(k => k.startsWith(`${year}-`))
    .filter(k => line.monthly[k] > 0)
    .filter(k => !projSet.has(k))
    .sort();
  if (realKeys.length === 0) return null;
  return { key: realKeys[realKeys.length - 1], value: line.monthly[realKeys[realKeys.length - 1]] };
}

// Chart-specific aggregations — respect category visibility
function expVisibleMonth(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return EXPENSE_LINES
    .filter(l => isExpCategoryVisible(l.name))
    .reduce((s, l) => s + (l.monthly[key] || 0), 0);
}

function expVisibleYear(year) {
  return EXPENSE_LINES
    .filter(l => isExpCategoryVisible(l.name))
    .reduce((s, l) => s + (l.year_totals[year] || 0), 0);
}

// ─── Projection ───

function projectOfficeExpensesRestOfYear() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const firstProjectMonth = curMonth;
  let filled = 0;

  EXPENSE_LINES.forEach(line => {
    if (!PROJECTABLE_BUCKETS.has(bucketOf(line.name))) return;

    const latest = lineRealLatestInYear(line, curYear);
    if (!latest) return;

    const lm = parseInt(latest.key.split('-')[1]);
    const latestVal = latest.value;

    if (!line.projectedMonths) line.projectedMonths = [];

    const startMonth = Math.max(lm + 1, firstProjectMonth);

    for (let m = startMonth; m <= 12; m++) {
      const key = `${curYear}-${String(m).padStart(2, '0')}`;
      if (!line.monthly[key] || line.monthly[key] === 0) {
        line.monthly[key] = latestVal;
        if (!line.projectedMonths.includes(key)) line.projectedMonths.push(key);
        filled++;
      }
    }
    recomputeLineTotals(line);
  });

  renderOfficeExpenses();
  updateExpClearProjBtnVisibility();

  if (filled === 0) {
    alert('Nothing to project — no projectable sub-categories have current-year actuals beyond what is already projected.');
  }
}

function clearOfficeExpenseProjections() {
  if (!confirm('Clear all projected values for office expenses? This keeps all real data intact.')) return;
  EXPENSE_LINES.forEach(line => {
    if (!line.projectedMonths || line.projectedMonths.length === 0) return;
    line.projectedMonths.forEach(key => { delete line.monthly[key]; });
    line.projectedMonths = [];
    recomputeLineTotals(line);
  });
  renderOfficeExpenses();
  updateExpClearProjBtnVisibility();
}

function hasAnyOfficeProjections() {
  return EXPENSE_LINES.some(lineHasAnyProjection);
}

function updateExpClearProjBtnVisibility() {
  const btn = document.getElementById('expClearProjBtn');
  if (btn) btn.style.display = hasAnyOfficeProjections() ? '' : 'none';
}

// ─── State toggles ───

function toggleBucketCollapsed(bucketName) {
  if (expState.collapsedBuckets.has(bucketName)) {
    expState.collapsedBuckets.delete(bucketName);
  } else {
    expState.collapsedBuckets.add(bucketName);
  }
  renderOfficeExpenses();
}

function toggleExpYear(year) {
  if (expState.yearsOpen.has(year)) expState.yearsOpen.delete(year);
  else expState.yearsOpen.add(year);
  renderOfficeExpenses();
}

function toggleExpCategory(cat) {
  if (expState.expandedCategory === cat) expState.expandedCategory = null;
  else expState.expandedCategory = cat;
  renderOfficeExpenses();
}

function toggleExpenseView() {
  expState.view = expState.view === 'category' ? 'log' : 'category';
  renderOfficeExpenses();
}

// ─── Header controls ───

function renderExpHeaderControls() {
  const hidBtn = document.getElementById('expHiddenToggleBtn');
  if (hidBtn) {
    const hidden = expHiddenCount();
    if (expState.showInactive) {
      hidBtn.textContent = 'Hide inactive';
      hidBtn.title = `${hidden} inactive line item${hidden === 1 ? '' : 's'} currently shown`;
    } else {
      hidBtn.textContent = 'Show inactive';
      hidBtn.title = `${hidden} inactive line item${hidden === 1 ? '' : 's'} hidden`;
    }
  }
}

// ─── Table header ───

function renderExpCategoryHead() {
  const anyOpen = YEARS.some(y => expState.yearsOpen.has(y));
  const rs = anyOpen ? ' rowspan="2"' : '';

  let row1 = '<tr>';
  row1 += `<th class="sticky-col" style="width:32px;"${rs}></th>`;
  row1 += `<th class="sticky-col-2"${rs}>Category</th>`;

  YEARS.forEach(y => {
    const open = expState.yearsOpen.has(y);
    if (open) {
      row1 += `<th class="year-th year-divider-left" colspan="13" onclick="window._toggleExpYear(${y})">
        <span class="year-chev open">▸</span>${y}
      </th>`;
    } else {
      row1 += `<th class="year-th" onclick="window._toggleExpYear(${y})"${rs}>
        <span class="year-chev">▸</span>${y}
      </th>`;
    }
  });
  row1 += `<th class="grand-total-th num"${rs}>Total</th>`;
  row1 += '</tr>';

  let row2 = '';
  if (anyOpen) {
    row2 = '<tr>';
    YEARS.forEach(y => {
      if (expState.yearsOpen.has(y)) {
        MONTH_NAMES.forEach((m, i) => {
          const cls = i === 0 ? 'month-th num year-divider-left' : 'month-th num';
          row2 += `<th class="${cls}">${m}</th>`;
        });
        row2 += `<th class="year-total-cell num">${y} Total</th>`;
      }
    });
    row2 += '</tr>';
  }

  document.getElementById('expCategoryHead').innerHTML = row1 + row2;
}

// ─── Table body ───

function renderExpCategoryBody() {
  let html = '';

  EXPENSE_BUCKETS.forEach(bucket => {
    const collapsed = expState.collapsedBuckets.has(bucket.name);
    const chev = collapsed ? '▸' : '▾';

    // Bucket header row
    html += `<tr class="bucket-row" onclick="window._toggleBucketCollapsed('${bucket.name.replace(/'/g, "\\'")}')">`;
    html += '<td class="sticky-col"></td>';
    html += `<td class="sticky-col-2 bucket-label"><span class="bucket-chev">${chev}</span> ${bucket.name}</td>`;

    YEARS.forEach(y => {
      if (expState.yearsOpen.has(y)) {
        for (let m = 1; m <= 12; m++) {
          const pc = bucketHasProjection(bucket.name, y, m) ? ' projected-cell' : '';
          html += `<td class="num${pc}">${fmtUsd(expBucketMonth(bucket.name, y, m))}</td>`;
        }
        const pcYt = bucketProjectionYear(bucket.name, y) > 0 ? ' projected-cell' : '';
        html += `<td class="year-total-cell num${pcYt}">${fmtUsd(expBucketYear(bucket.name, y))}</td>`;
      } else {
        const pcYt = bucketProjectionYear(bucket.name, y) > 0 ? ' projected-cell' : '';
        html += `<td class="num${pcYt}" style="font-weight:600;">${fmtUsd(expBucketYear(bucket.name, y))}</td>`;
      }
    });

    const pcG = bucketProjectionGrand(bucket.name) > 0 ? ' projected-cell' : '';
    html += `<td class="grand-total-cell num display-num${pcG}">${fmtUsdShort(expBucketGrand(bucket.name))}</td>`;
    html += '</tr>';

    if (collapsed) return;

    // Sub-category rows under each bucket
    bucket.subs.forEach(subcat => {
      if (!isExpCategoryVisible(subcat)) return;

      const active = isExpCategoryActive(subcat);
      const rowCls = active ? 'acct-row subcat-row' : 'acct-row subcat-row exp-row-inactive';
      const safeCat = subcat.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const toggleBtn = `<button class="acct-toggle ${active ? 'is-active' : 'is-inactive'}"
        onclick="event.stopPropagation(); window._toggleExpCategoryActive('${safeCat}')"
        title="${active ? 'Mark as inactive' : 'Mark as active'}">${active ? '●' : '○'}</button>`;

      const line = EXPENSE_LINES.find(l => l.name === subcat);

      html += `<tr class="${rowCls}">`;
      html += '<td class="sticky-col"></td>';
      html += `<td class="sticky-col-2 subcat-label">${toggleBtn}${subcat}</td>`;

      YEARS.forEach(y => {
        if (expState.yearsOpen.has(y)) {
          for (let m = 1; m <= 12; m++) {
            const key = `${y}-${String(m).padStart(2, '0')}`;
            const val = expCategoryMonth(subcat, y, m);
            const pc = line && isLineProjected(line, y, m) ? ' projected-cell' : '';
            html += `<td class="num editable-cell${pc}" data-subcat="${safeCat}" data-month-key="${key}" onclick="window._editExpCell(this)">${fmtUsd(val)}</td>`;
          }
          const pcYt = line && lineHasProjectionInYear(line, y) ? ' projected-cell' : '';
          html += `<td class="year-total-cell num${pcYt}">${fmtUsd(expCategoryYear(subcat, y))}</td>`;
        } else {
          const pcYt = line && lineHasProjectionInYear(line, y) ? ' projected-cell' : '';
          html += `<td class="num${pcYt}">${fmtUsd(expCategoryYear(subcat, y))}</td>`;
        }
      });

      const pcG = line && lineHasAnyProjection(line) ? ' projected-cell' : '';
      html += `<td class="grand-total-cell num${pcG}">${fmtUsd(expCategoryGrand(subcat))}</td>`;
      html += '</tr>';
    });
  });

  document.getElementById('expCategoryBody').innerHTML = html;
}

// ─── Table footer (totals + YoY) ───

function renderExpCategoryFoot() {
  let totalHtml = '<tr class="total-row">';
  totalHtml += '<td class="sticky-col"></td>';
  totalHtml += '<td class="sticky-col-2">Total</td>';

  function anyBucketHasProjMonth(y, m) {
    return EXPENSE_BUCKETS.some(b => bucketHasProjection(b.name, y, m));
  }
  function anyBucketHasProjYear(y) {
    return EXPENSE_BUCKETS.some(b => bucketProjectionYear(b.name, y) > 0);
  }
  function anyBucketHasProjGrand() {
    return EXPENSE_BUCKETS.some(b => bucketProjectionGrand(b.name) > 0);
  }

  YEARS.forEach(y => {
    if (expState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) {
        const pc = anyBucketHasProjMonth(y, m) ? ' projected-cell' : '';
        totalHtml += `<td class="num${pc}">${fmtUsd(expTotalMonth(y, m))}</td>`;
      }
      const pcYt = anyBucketHasProjYear(y) ? ' projected-cell' : '';
      totalHtml += `<td class="year-total-cell num display-num${pcYt}">${fmtUsdShort(expTotalYear(y))}</td>`;
    } else {
      const pcYt = anyBucketHasProjYear(y) ? ' projected-cell' : '';
      totalHtml += `<td class="num display-num${pcYt}">${fmtUsdShort(expTotalYear(y))}</td>`;
    }
  });

  const pcG = anyBucketHasProjGrand() ? ' projected-cell' : '';
  totalHtml += `<td class="grand-total-cell num display-num${pcG}" style="font-size:16px;">${fmtUsdShort(expGrandTotal())}</td>`;
  totalHtml += '</tr>';

  // YoY row
  let yoyHtml = '<tr class="yoy-row">';
  yoyHtml += '<td class="sticky-col"></td>';
  yoyHtml += '<td class="sticky-col-2">% vs prev year</td>';

  YEARS.forEach((y, i) => {
    const cur = expTotalYear(y);
    const prev = i > 0 ? expTotalYear(YEARS[i - 1]) : 0;

    if (expState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) yoyHtml += '<td></td>';
      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        const cls = pct >= 0 ? 'yoy-neg' : 'yoy-pos';  // For expenses: up = bad
        const arrow = pct >= 0 ? '▲' : '▼';
        yoyHtml += `<td class="year-total-cell num ${cls}">${arrow} ${pct.toFixed(1)}%</td>`;
      } else {
        yoyHtml += '<td class="year-total-cell num yoy-na">—</td>';
      }
    } else {
      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        const cls = pct >= 0 ? 'yoy-neg' : 'yoy-pos';
        const arrow = pct >= 0 ? '▲' : '▼';
        yoyHtml += `<td class="num ${cls}">${arrow} ${pct.toFixed(1)}%</td>`;
      } else {
        yoyHtml += '<td class="num yoy-na">—</td>';
      }
    }
  });

  yoyHtml += '<td class="grand-total-cell"></td>';
  yoyHtml += '</tr>';

  document.getElementById('expCategoryFoot').innerHTML = totalHtml + yoyHtml;
}

// ─── Edit expense cell ───

function editExpCell(td) {
  if (td.querySelector('input')) return;
  const subcat = td.dataset.subcat;
  const monthKey = td.dataset.monthKey;
  if (!subcat || !monthKey) return;

  const line = getLine(subcat);
  if (!line) return;

  const currentVal = line.monthly[monthKey] || 0;

  td.classList.add('editing');
  td.innerHTML = `<input type="number" step="0.01" class="cell-input" value="${currentVal || ''}" placeholder="0" />`;
  const input = td.querySelector('input');
  input.focus();
  input.select();

  let finished = false;
  function finish(save) {
    if (finished) return;
    finished = true;
    if (save) {
      const raw = input.value.trim();
      const newVal = raw === '' ? 0 : parseFloat(raw);
      if (!isNaN(newVal) && newVal >= 0) {
        const oldVal = line.monthly[monthKey] || 0;
        if (newVal === 0) delete line.monthly[monthKey];
        else line.monthly[monthKey] = Math.round(newVal * 100) / 100;
        // If this cell was projected, edit promotes it to real data
        if (line.projectedMonths) {
          line.projectedMonths = line.projectedMonths.filter(k => k !== monthKey);
        }
        recomputeLineTotals(line);

        // Persist to Supabase optimistically
        if (line._id) {
          const upsertVal = newVal === 0 ? null : Math.round(newVal * 100) / 100;
          if (upsertVal === null) {
            supabase.from('office_expense_cells')
              .delete()
              .eq('line_id', line._id)
              .eq('year_month', monthKey)
              .then(({ error }) => { if (error) showToast('Failed to delete cell', 'error'); });
          } else {
            supabase.from('office_expense_cells')
              .upsert({ line_id: line._id, year_month: monthKey, amount_usd: upsertVal, is_projected: false, source: 'manual' })
              .then(({ error }) => { if (error) showToast('Failed to save cell', 'error'); });
          }
        }
      }
    }
    renderOfficeExpenses();
  }

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') finish(true);
  });
}

// No-op: deleteExpense kept as backward compat
function deleteExpense() { /* removed in cell-based model */ }

// ─── Add line item modal ───

function addExpenseLineItem() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const yearOpts = [2026, 2025, 2024, 2023, 2022].map(y =>
    `<option value="${y}" ${y === curYear ? 'selected' : ''}>${y}</option>`
  ).join('');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthOpts = monthNames.map((m, i) =>
    `<option value="${i + 1}" ${(i + 1) === curMonth ? 'selected' : ''}>${m}</option>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card modal-wide" onclick="event.stopPropagation()">
      <div class="modal-title">Add line item</div>

      <div class="modal-field">
        <label class="modal-label">Description</label>
        <input type="text" class="modal-input" id="newLineName" placeholder="e.g. Internet, Microsoft 365" autocomplete="off">
      </div>

      <div class="modal-field">
        <label class="modal-label">Category</label>
        <div class="modal-bucket-options">
          ${EXPENSE_BUCKETS.map((b, i) => `
            <label class="bucket-option">
              <input type="radio" name="newLineBucket" value="${b.name}" ${i === 0 ? 'checked' : ''}>
              <span>${b.name}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="modal-row">
        <div class="modal-field modal-field-3">
          <label class="modal-label">Month</label>
          <select class="modal-input" id="newLineMonth">${monthOpts}</select>
        </div>
        <div class="modal-field modal-field-3">
          <label class="modal-label">Year</label>
          <select class="modal-input" id="newLineYear">${yearOpts}</select>
        </div>
        <div class="modal-field modal-field-3">
          <label class="modal-label">Amount (USD)</label>
          <input type="number" step="0.01" class="modal-input" id="newLineAmount" placeholder="0.00">
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" onclick="window._closeAddLineModal()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="window._confirmAddLineItem()">Add</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', closeAddLineModal);
  document.body.appendChild(overlay);

  setTimeout(() => {
    const input = document.getElementById('newLineName');
    if (input) {
      input.focus();
    }
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.target.tagName !== 'SELECT') {
          e.preventDefault();
          confirmAddLineItem();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeAddLineModal();
      }
    });
  }, 0);
}

function closeAddLineModal() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.remove();
}

function confirmAddLineItem() {
  const nameInput = document.getElementById('newLineName');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { if (nameInput) nameInput.focus(); return; }

  const bucketRadio = document.querySelector('input[name="newLineBucket"]:checked');
  if (!bucketRadio) return;
  const bucketName = bucketRadio.value;
  const bucket = EXPENSE_BUCKETS.find(b => b.name === bucketName);
  if (!bucket) { closeAddLineModal(); return; }

  const year = parseInt(document.getElementById('newLineYear').value, 10);
  const month = parseInt(document.getElementById('newLineMonth').value, 10);
  const amountInput = document.getElementById('newLineAmount');
  const amount = parseFloat(amountInput.value);

  if (isNaN(amount) || amount < 0) {
    amountInput.focus();
    return;
  }

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  // Add sub-category to bucket if new
  if (!bucket.subs.includes(name)) {
    bucket.subs.push(name);
    SUB_TO_BUCKET[name] = bucket.name;
  }

  // Get or create the line
  let line = getLine(name);
  if (!line) {
    line = { name: name, monthly: {}, year_totals: {}, grand_total: 0, projectedMonths: [] };
    EXPENSE_LINES.push(line);

    // Persist new line to Supabase
    supabase.from('office_expense_lines')
      .insert({ name: name, bucket: bucketName, is_active: true, display_order: EXPENSE_LINES.length })
      .select('id')
      .single()
      .then(({ data, error }) => {
        if (error) {
          showToast('Failed to save new line item', 'error');
        } else if (data) {
          line._id = data.id;
          // Now persist the cell
          supabase.from('office_expense_cells')
            .upsert({ line_id: line._id, year_month: monthKey, amount_usd: Math.round(amount * 100) / 100, is_projected: false, source: 'manual' })
            .then(({ error: e2 }) => { if (e2) showToast('Failed to save cell', 'error'); });
        }
      });
  } else {
    // Refuse if cell already has a value
    if (line.monthly[monthKey] && line.monthly[monthKey] > 0) {
      alert(`${name} already has $${line.monthly[monthKey].toFixed(2)} for ${monthKey}. To change it, close this modal and click the cell directly to edit.`);
      amountInput.focus();
      return;
    }

    // Persist cell to Supabase
    if (line._id) {
      supabase.from('office_expense_cells')
        .upsert({ line_id: line._id, year_month: monthKey, amount_usd: Math.round(amount * 100) / 100, is_projected: false, source: 'manual' })
        .then(({ error }) => { if (error) showToast('Failed to save cell', 'error'); });
    }
  }

  // Write the value
  line.monthly[monthKey] = Math.round(amount * 100) / 100;
  recomputeLineTotals(line);

  // Refresh derived categories
  EXPENSE_CATEGORIES.length = 0;
  EXPENSE_CATEGORIES.push(...computeExpenseCategories());

  // Auto-open the bucket and the year
  expState.collapsedBuckets.delete(bucket.name);
  expState.yearsOpen.add(year);

  closeAddLineModal();
  renderOfficeExpenses();
}

// ─── Amex file upload ───

let amexPreviewBuffer = [];

function handleAmexUpload(event) {
  console.log('[Amex] handleAmexUpload triggered');
  const file = event.target.files[0];
  if (!file) {
    console.log('[Amex] No file selected');
    return;
  }
  console.log('[Amex] File:', file.name, file.size, 'bytes');

  if (typeof window.XLSX === 'undefined') {
    alert('XLSX library not loaded. Check internet connection and refresh.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      console.log('[Amex] File read, parsing workbook...');
      const data = new Uint8Array(e.target.result);
      const workbook = window.XLSX.read(data, { type: 'array', cellDates: true });
      console.log('[Amex] Sheets:', workbook.SheetNames);

      let parsed = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
        console.log(`[Amex] Sheet "${sheetName}": ${rows.length} rows`);
        const attempt = parseAmexRows(rows);
        if (attempt.length > 0) {
          console.log(`[Amex] Found ${attempt.length} transactions in "${sheetName}"`);
          parsed = attempt;
          break;
        }
      }

      if (parsed.length === 0) {
        alert('No transactions found. Looked for "Date", "Description", and "Amount" columns. Check the file format.');
        event.target.value = '';
        return;
      }

      showAmexPreview(parsed);
    } catch (err) {
      console.error('[Amex] Parse error:', err);
      alert('Failed to parse file: ' + err.message);
    }
    event.target.value = '';
  };
  reader.onerror = (err) => {
    console.error('[Amex] FileReader error:', err);
    alert('Failed to read file');
  };
  reader.readAsArrayBuffer(file);
}

function parseAmexRows(rows) {
  let headerIdx = -1;
  let dateCol = -1, descCol = -1, amountCol = -1;

  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const row = rows[i] || [];
    const lower = row.map(c => String(c || '').toLowerCase().trim());
    const dIdx = lower.findIndex(c => c === 'date');
    const desIdx = lower.findIndex(c => c === 'description');
    const amtIdx = lower.findIndex(c => c === 'amount');
    if (dIdx >= 0 && desIdx >= 0 && amtIdx >= 0) {
      headerIdx = i;
      dateCol = dIdx;
      descCol = desIdx;
      amountCol = amtIdx;
      console.log(`[Amex] Header found at row ${i}: Date=col${dIdx}, Description=col${desIdx}, Amount=col${amtIdx}`);
      break;
    }
  }

  if (headerIdx < 0) {
    console.log('[Amex] No header row found in first 30 rows');
    return [];
  }

  const transactions = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const dateRaw = row[dateCol];
    const desc = row[descCol];
    const amt = row[amountCol];

    if (!dateRaw || !desc || amt === undefined || amt === null || amt === '') continue;

    // Parse date
    let dateStr;
    if (dateRaw instanceof Date) {
      const yr = dateRaw.getFullYear();
      const mo = String(dateRaw.getMonth() + 1).padStart(2, '0');
      const da = String(dateRaw.getDate()).padStart(2, '0');
      dateStr = `${yr}-${mo}-${da}`;
    } else {
      const m = String(dateRaw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        dateStr = `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      } else {
        try {
          const d = new Date(dateRaw);
          if (isNaN(d.getTime())) continue;
          dateStr = d.toISOString().split('T')[0];
        } catch { continue; }
      }
    }

    const amount = parseFloat(String(amt).replace(/[,$]/g, ''));
    if (isNaN(amount) || amount <= 0) continue;

    const merchant = String(desc).split(/\s{3,}/)[0].trim().slice(0, 50);

    transactions.push({
      date: dateStr,
      description: merchant,
      amount: amount,
      category: autoCategorizeAmex(merchant),
      include: true
    });
  }

  console.log(`[Amex] Parsed ${transactions.length} transactions`);
  return transactions;
}

function autoCategorizeAmex(desc) {
  const d = desc.toUpperCase();

  const patterns = [
    [/BLOOMBERG/, 'Bloomberg'],
    [/CLAUDE|ANTHROPIC/, 'Claude'],
    [/OPENAI|CHATGPT/, 'ChatGPT'],
    [/NEON\.?TECH|NEON/, 'Neon.Tech'],
    [/FLY\.?IO/, 'Fly.io'],
    [/POLYGON/, 'Polygon'],
    [/YCHARTS/, 'Ycharts'],
    [/FISCAL\.?AI/, 'Fiscal.AI'],
    [/KUMU/, 'Kumu'],
    [/MICROSOFT/, 'Microsoft'],
    [/GOOGLE/, 'Google'],
    [/MASSIVE/, 'Servicios Tecnológicos'],
    [/TELMEX|TELCEL/, 'Telmex'],
    [/CFE|LUZ/, 'Luz'],
    [/AIRE|AC /, 'Aire Acondicionado'],
    [/RENT|RENTA/, 'Renta'],
    [/NESPRESSO/, 'Nespresso'],
    [/SUMESA|SUPERAMA|7-ELEVEN|SUPER/, 'Super/Desayunos'],
    [/AMAZON|OFFICE|PAPER/, 'Supply oficina'],
  ];

  for (const [pat, cat] of patterns) {
    if (pat.test(d)) return cat;
  }

  return 'Extras';
}

// ─── Amex preview modal ───

function showAmexPreview(transactions) {
  amexPreviewBuffer = transactions;

  const allSubcats = [];
  EXPENSE_BUCKETS.forEach(b => b.subs.forEach(s => allSubcats.push(s)));

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card amex-preview-card" onclick="event.stopPropagation()">
      <div class="modal-title">Review Amex import · ${transactions.length} transactions</div>
      <div class="amex-preview-sub">Auto-categorized based on merchant. Adjust any row before importing. Untick to skip a row.</div>

      <div class="amex-preview-table-wrap">
        <table class="amex-preview-table">
          <thead>
            <tr>
              <th style="width:30px;"></th>
              <th style="width:90px;">Date</th>
              <th>Description</th>
              <th class="num" style="width:90px;">Amount</th>
              <th style="width:180px;">Category</th>
            </tr>
          </thead>
          <tbody id="amexPreviewBody"></tbody>
        </table>
      </div>

      <div class="amex-preview-summary" id="amexPreviewSummary"></div>

      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" onclick="window._closeAmexPreview()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="window._commitAmexImport()">Import selected</button>
      </div>
    </div>
  `;
  overlay.addEventListener('click', closeAmexPreview);
  document.body.appendChild(overlay);

  renderAmexPreviewRows(allSubcats);
}

function renderAmexPreviewRows(allSubcats) {
  const tbody = document.getElementById('amexPreviewBody');
  if (!tbody) return;

  const catOptionsHtml = allSubcats.map(c => `<option value="${c}">${c}</option>`).join('');

  let html = '';
  amexPreviewBuffer.forEach((tx, idx) => {
    html += `<tr class="${tx.include ? '' : 'amex-row-excluded'}">
      <td><input type="checkbox" ${tx.include ? 'checked' : ''} onchange="window._toggleAmexPreviewRow(${idx})"></td>
      <td style="color: var(--t2); font-size: 11px;">${tx.date}</td>
      <td style="font-size: 12px;">${tx.description}</td>
      <td class="num" style="font-weight: 500;">$${tx.amount.toFixed(2)}</td>
      <td>
        <select class="amex-cat-select" onchange="window._updateAmexPreviewCat(${idx}, this.value)">
          ${allSubcats.map(c => `<option value="${c}" ${c === tx.category ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </td>
    </tr>`;
  });
  tbody.innerHTML = html;

  updateAmexPreviewSummary();
}

function toggleAmexPreviewRow(idx) {
  amexPreviewBuffer[idx].include = !amexPreviewBuffer[idx].include;
  const rows = document.querySelectorAll('#amexPreviewBody tr');
  if (rows[idx]) {
    rows[idx].classList.toggle('amex-row-excluded', !amexPreviewBuffer[idx].include);
  }
  updateAmexPreviewSummary();
}

function updateAmexPreviewCat(idx, cat) {
  amexPreviewBuffer[idx].category = cat;
  updateAmexPreviewSummary();
}

function updateAmexPreviewSummary() {
  const el = document.getElementById('amexPreviewSummary');
  if (!el) return;
  const included = amexPreviewBuffer.filter(t => t.include);
  const total = included.reduce((s, t) => s + t.amount, 0);
  el.innerHTML = `<strong>${included.length}</strong> of ${amexPreviewBuffer.length} selected · total <strong>$${total.toFixed(2)}</strong>`;
}

function closeAmexPreview() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.remove();
  amexPreviewBuffer = [];
}

function commitAmexImport() {
  const included = amexPreviewBuffer.filter(t => t.include);
  if (included.length === 0) { closeAmexPreview(); return; }

  // Aggregate by (category, year-month)
  const aggregated = {};
  included.forEach(tx => {
    const ym = tx.date.slice(0, 7);
    const key = `${tx.category}::${ym}`;
    aggregated[key] = (aggregated[key] || 0) + tx.amount;
  });

  // Apply to EXPENSE_LINES
  Object.entries(aggregated).forEach(([key, amount]) => {
    const [subcat, ym] = key.split('::');
    let line = getLine(subcat);
    if (!line) {
      line = { name: subcat, monthly: {}, year_totals: {}, grand_total: 0, projectedMonths: [] };
      EXPENSE_LINES.push(line);

      // Persist new line to Supabase
      supabase.from('office_expense_lines')
        .insert({ name: subcat, bucket: bucketOf(subcat), is_active: true, display_order: EXPENSE_LINES.length })
        .select('id')
        .single()
        .then(({ data, error }) => {
          if (!error && data) {
            line._id = data.id;
            supabase.from('office_expense_cells')
              .upsert({ line_id: line._id, year_month: ym, amount_usd: Math.round(amount * 100) / 100, is_projected: false, source: 'amex' })
              .then(({ error: e2 }) => { if (e2) showToast('Failed to save imported cell', 'error'); });
          }
        });
    } else {
      line.monthly[ym] = Math.round(amount * 100) / 100;
      recomputeLineTotals(line);

      // Persist cell to Supabase
      if (line._id) {
        supabase.from('office_expense_cells')
          .upsert({ line_id: line._id, year_month: ym, amount_usd: Math.round(amount * 100) / 100, is_projected: false, source: 'amex' })
          .then(({ error }) => { if (error) showToast('Failed to save imported cell', 'error'); });
      }
    }
    line.monthly[ym] = Math.round(amount * 100) / 100;
    recomputeLineTotals(line);
  });

  // Refresh category list
  EXPENSE_CATEGORIES.length = 0;
  EXPENSE_CATEGORIES.push(...computeExpenseCategories());

  closeAmexPreview();
  renderOfficeExpenses();
}

// ─── KPI cards ───

function renderExpKpis() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  const lastY = curMonth === 1 ? curYear - 1 : curYear;
  const lastM = curMonth === 1 ? 12 : curMonth - 1;

  const latestMonthTotal = expTotalMonth(lastY, lastM);

  // YTD: sum Jan through lastM in curYear
  let ytd = 0;
  if (lastY === curYear) {
    for (let m = 1; m <= lastM; m++) ytd += expTotalMonth(curYear, m);
  }

  // Projection
  const remaining = lastY === curYear ? (12 - lastM) : 12;
  const projection = ytd + (latestMonthTotal * remaining);

  const totalPrev = expTotalYear(curYear - 1);
  const vsPrev = totalPrev > 0 ? ((projection - totalPrev) / totalPrev) * 100 : 0;
  const vsLabel = vsPrev >= 0
    ? `<span class="neg">▲ ${vsPrev.toFixed(1)}%</span> vs ${curYear - 1} ($${Math.round(totalPrev).toLocaleString()})`
    : `<span class="pos">▼ ${Math.abs(vsPrev).toFixed(1)}%</span> vs ${curYear - 1} ($${Math.round(totalPrev).toLocaleString()})`;

  const latestMonthLabel = `${MONTH_NAMES_FULL[lastM]} ${lastY}`;
  const ytdSpanLabel = lastY === curYear && lastM > 0 ? `Jan – ${MONTH_NAMES[lastM - 1]}` : '—';

  document.getElementById('exp-kpis').innerHTML = `
    <div class="proj-col">
      <div class="proj-col-label">Latest month</div>
      <div class="proj-col-value">$${Math.round(latestMonthTotal).toLocaleString()}</div>
      <div class="proj-col-sub">${latestMonthLabel}</div>
    </div>
    <div class="proj-col">
      <div class="proj-col-label">YTD actual</div>
      <div class="proj-col-value">$${Math.round(ytd).toLocaleString()}</div>
      <div class="proj-col-sub">${lastM} months · ${ytdSpanLabel}</div>
    </div>
    <div class="proj-col">
      <div class="proj-col-label">Projected ${curYear} expenses</div>
      <div class="proj-col-value">$${Math.round(projection).toLocaleString()}</div>
      <div class="proj-col-sub">${vsLabel}</div>
    </div>
  `;
}

// ─── Chart ───

let expenseChartInstance = null;

function setExpGranularity(g) {
  expState.chart.granularity = g;
  document.querySelectorAll('#expGranToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.gran === g);
  });
  renderExpenseChart();
}

function setExpChartType(t) {
  expState.chart.type = t;
  document.querySelectorAll('#expTypeToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === t);
  });
  renderExpenseChart();
}

function setExpChartRange(r) {
  expState.chart.range = r;
  renderExpenseChart();
}

function expIsInRange(y, m) {
  const r = expState.chart.range;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  if (r === 'all') return true;
  if (r === 'ytd') return y === curYear;

  if (r === '6m' || r === '12m') {
    const monthsBack = r === '6m' ? 6 : 12;
    const ymIdx = y * 12 + m;
    const curIdx = curYear * 12 + curMonth;
    return ymIdx > curIdx - monthsBack && ymIdx <= curYear * 12 + 12;
  }

  const targetYear = parseInt(r);
  if (!isNaN(targetYear)) return y === targetYear;
  return true;
}

function getExpChartData() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const lastY = curMonth === 1 ? curYear - 1 : curYear;
  const lastM = curMonth === 1 ? 12 : curMonth - 1;
  const flatRate = expVisibleMonth(lastY, lastM);

  function isComplete(y, m) {
    if (y < lastY) return true;
    if (y === lastY && m <= lastM) return true;
    return false;
  }

  if (expState.chart.granularity === 'yearly') {
    let yearsToShow = YEARS.slice();
    if (expState.chart.range === 'ytd') yearsToShow = [curYear];
    else if (expState.chart.range === '6m' || expState.chart.range === '12m') {
      const monthsBack = expState.chart.range === '6m' ? 6 : 12;
      const earliestIdx = (curYear * 12 + curMonth) - monthsBack;
      const earliestYear = Math.ceil(earliestIdx / 12);
      yearsToShow = YEARS.filter(y => y >= earliestYear);
    } else if (expState.chart.range !== 'all') {
      const t = parseInt(expState.chart.range);
      if (!isNaN(t)) yearsToShow = [t];
    }

    const labels = yearsToShow.map(y => y.toString());
    const actual = [], projected = [];
    yearsToShow.forEach(y => {
      if (y === curYear) {
        let aSum = 0;
        for (let m = 1; m <= 12; m++) if (isComplete(y, m)) aSum += expVisibleMonth(y, m);
        const projMonths = 12 - lastM;
        actual.push(aSum);
        projected.push(flatRate * projMonths);
      } else if (y < curYear) {
        actual.push(expVisibleYear(y));
        projected.push(0);
      } else {
        actual.push(0);
        projected.push(0);
      }
    });
    return { labels, fullLabels: labels.slice(), actual, projected };
  }

  // Monthly
  const labels = [], fullLabels = [], actual = [], projected = [];
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  [2023, 2024, 2025, 2026].forEach(y => {
    for (let m = 1; m <= 12; m++) {
      if (!expIsInRange(y, m)) continue;
      const label = m === 1 ? `${shortMonths[m - 1]} ${String(y).slice(-2)}` : shortMonths[m - 1];
      const fullLabel = `${shortMonths[m - 1]} ${y}`;

      if (isComplete(y, m)) {
        const v = expVisibleMonth(y, m);
        if (v > 0 || y < curYear) {
          labels.push(label);
          fullLabels.push(fullLabel);
          actual.push(v);
          projected.push(null);
        }
      } else if (y === curYear) {
        labels.push(label);
        fullLabels.push(fullLabel);
        actual.push(null);
        projected.push(flatRate);
      }
    }
  });

  if (expState.chart.type === 'line') {
    for (let i = 0; i < projected.length; i++) {
      if (projected[i] !== null && actual[i] === null && i > 0 && actual[i - 1] !== null) {
        projected[i - 1] = actual[i - 1];
        break;
      }
    }
  }

  return { labels, fullLabels, actual, projected };
}

function renderExpenseChart() {
  const canvas = document.getElementById('expenseChart');
  if (!canvas) return;
  if (expenseChartInstance) { expenseChartInstance.destroy(); expenseChartInstance = null; }

  const { labels, fullLabels, actual, projected } = getExpChartData();
  const ctx = canvas.getContext('2d');

  const allVals = [...actual, ...projected].filter(v => v !== null && v !== undefined && v > 0);
  let yMin, yMax;
  if (allVals.length > 0) {
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const range = maxV - minV || maxV * 0.1 || 1;
    yMin = Math.max(0, minV - range * 0.3);
    yMax = maxV + range * 0.15;
  }

  const NAVY = '#1e2d3d';
  const PROJ_COLOR = '#a8a49e';
  const isLine = expState.chart.type === 'line';

  const gradActual = ctx.createLinearGradient(0, 0, 0, 280);
  gradActual.addColorStop(0, 'rgba(30,45,61,0.18)');
  gradActual.addColorStop(1, 'rgba(30,45,61,0)');
  const gradProj = ctx.createLinearGradient(0, 0, 0, 280);
  gradProj.addColorStop(0, 'rgba(168,164,158,0.18)');
  gradProj.addColorStop(1, 'rgba(168,164,158,0)');

  const datasets = [
    {
      label: 'Actual', data: actual,
      borderColor: NAVY, backgroundColor: isLine ? gradActual : NAVY, fill: isLine,
      tension: 0.32, borderWidth: isLine ? 2 : 0,
      pointRadius: isLine ? 0 : undefined, pointHoverRadius: isLine ? 5 : undefined,
      pointBackgroundColor: NAVY, borderRadius: !isLine ? 3 : undefined,
      barPercentage: 0.7, categoryPercentage: 0.85, stack: 'exp'
    },
    {
      label: 'Projected', data: projected,
      borderColor: PROJ_COLOR, backgroundColor: isLine ? gradProj : 'rgba(168,164,158,0.5)', fill: isLine,
      tension: 0.32, borderWidth: isLine ? 2 : 0, borderDash: isLine ? [6, 4] : undefined,
      pointRadius: isLine ? 0 : undefined, pointHoverRadius: isLine ? 5 : undefined,
      pointBackgroundColor: PROJ_COLOR, borderRadius: !isLine ? 3 : undefined,
      barPercentage: 0.7, categoryPercentage: 0.85, stack: 'exp'
    }
  ];

  expenseChartInstance = new Chart(canvas, {
    type: expState.chart.type,
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true, position: 'bottom',
          labels: {
            font: { family: 'Jost', size: 10 }, color: '#6b6860',
            boxWidth: 14, boxHeight: 10, padding: 14,
            generateLabels: () => [
              { text: 'Actual', fillStyle: NAVY, strokeStyle: NAVY, lineWidth: 0, hidden: false, index: 0 },
              { text: 'Projected', fillStyle: 'rgba(168,164,158,0.5)', strokeStyle: PROJ_COLOR, lineWidth: 1, lineDash: [4, 2], hidden: false, index: 1 }
            ]
          }
        },
        tooltip: {
          backgroundColor: '#1a1a18',
          titleFont: { family: 'Jost', size: 11 },
          bodyFont: { family: 'Jost', size: 12, weight: '500' },
          padding: 10,
          filter: (item) => item.parsed.y !== null && item.parsed.y !== 0,
          callbacks: {
            title: (items) => items.length ? (fullLabels[items[0].dataIndex] || items[0].label) : '',
            label: (c) => `${c.dataset.label}: $${Math.round(c.parsed.y).toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          stacked: !isLine,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { font: { family: 'Jost', size: 10 }, color: '#a8a49e', maxRotation: 0, autoSkip: true, autoSkipPadding: 10 }
        },
        y: {
          stacked: !isLine, min: yMin, max: yMax,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { font: { family: 'Jost', size: 10 }, color: '#a8a49e', callback: v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v) }
        }
      }
    }
  });
}

// ─── Main render ───

export function renderOfficeExpenses() {
  renderExpKpis();
  renderExpHeaderControls();
  renderExpCategoryHead();
  renderExpCategoryBody();
  renderExpCategoryFoot();
  renderExpenseChart();
  updateExpClearProjBtnVisibility();
}

// ─── Page loader ───

export async function loadOfficePage() {
  await loadExpenseData();
  renderOfficeExpenses();
}

// ─── Expose to window for onclick handlers ───

window._toggleBucketCollapsed = toggleBucketCollapsed;
window._toggleExpYear = toggleExpYear;
window._toggleExpCategory = toggleExpCategory;
window._toggleExpenseView = toggleExpenseView;
window._toggleExpCategoryActive = toggleExpCategoryActive;
window._toggleExpShowInactive = toggleExpShowInactive;
window._editExpCell = editExpCell;
window._addExpenseLineItem = addExpenseLineItem;
window._closeAddLineModal = closeAddLineModal;
window._confirmAddLineItem = confirmAddLineItem;
window._handleAmexUpload = handleAmexUpload;
window._closeAmexPreview = closeAmexPreview;
window._commitAmexImport = commitAmexImport;
window._toggleAmexPreviewRow = toggleAmexPreviewRow;
window._updateAmexPreviewCat = updateAmexPreviewCat;
window._projectOfficeExpensesRestOfYear = projectOfficeExpensesRestOfYear;
window._clearOfficeExpenseProjections = clearOfficeExpenseProjections;
window._setExpGranularity = setExpGranularity;
window._setExpChartType = setExpChartType;
window._setExpChartRange = setExpChartRange;
window._deleteExpense = deleteExpense;
