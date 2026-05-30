// Office Expenses page module
import { supabase } from './supabase-client.js';
import { YEARS, MONTH_NAMES, MONTH_NAMES_FULL, fmtUsd, fmtUsdShort, fmtMxn, showToast, showInfoModal, showConfirmModal, yearMonthKey } from './utils.js';
import { recomputeLineTotals } from './projection.js';
import { toggleFxEditor, renderFxEditor, FX_RATES, fxRate, mxnToUsd } from './fx.js';

// ─── Data ───

let EXPENSE_LINES = [];
let _dataLoaded = false;
// Legacy alias
let EXPENSE_DATA = EXPENSE_LINES;

const EXPENSE_BUCKETS = [
  { name: 'Office',             subs: ['Renta', 'Luz', 'Limpieza', 'AMICSA'], currency: 'MXN' },
  { name: 'Technology',         subs: ['Bloomberg', 'Polygon', 'Google', 'Ycharts', 'ChatGPT', 'Claude', 'Neon.Tech', 'Fiscal.AI', 'Fly.io', 'Microsoft', 'Kumu', 'Servicios Tecnológicos'] },
  { name: 'Office Supply/Food', subs: ['Nespresso', 'Super/Desayunos', 'Telmex', 'AQA', 'AC'] },
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
  chart: { granularity: 'monthly', type: 'bar', range: '12m' },
  monthCompare: 'mom'  // 'yoy' = same month last year, 'mom' = vs previous month
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

    // One-time cleanup: delete junk lines from DB
    const DELETE_LINES = new Set(['test', 'test2', 'renta', 'test3287', 'hello']);
    EXPENSE_LINES.forEach(line => {
      if (DELETE_LINES.has(line.name) && line._id) {
        supabase.from('office_expense_cells').delete().eq('line_id', line._id).then(() => {
          supabase.from('office_expense_lines').delete().eq('id', line._id).then(() => {});
        });
      }
    });
    EXPENSE_LINES = EXPENSE_LINES.filter(l => !DELETE_LINES.has(l.name));

    // One-time renames (migrates old names to new)
    const RENAMES = { 'Aire Acondicionado': 'AC' };
    EXPENSE_LINES.forEach(line => {
      if (RENAMES[line.name]) {
        const newName = RENAMES[line.name];
        if (line._id) {
          supabase.from('office_expense_lines').update({ name: newName }).eq('id', line._id).then(() => {});
        }
        line.name = newName;
      }
    });

    EXPENSE_LINES.forEach(line => recomputeLineTotals(line));

    // Ensure every loaded line appears in its EXPENSE_BUCKETS subs list
    EXPENSE_LINES.forEach(line => {
      // Check if line is already in a hardcoded bucket (takes priority over DB)
      const hardcodedBucket = EXPENSE_BUCKETS.find(b => b.subs.includes(line.name));
      let bucket;
      if (hardcodedBucket) {
        bucket = hardcodedBucket;
        // Update DB bucket if it differs
        if (line._id && line.bucket !== bucket.name) {
          supabase.from('office_expense_lines').update({ bucket: bucket.name }).eq('id', line._id).then(() => {});
        }
      } else {
        let bName = line.bucket || 'Other';
        // Don't dynamically add lines to MXN buckets — send to Other
        const candidate = EXPENSE_BUCKETS.find(b => b.name === bName);
        if (candidate && candidate.currency) bName = 'Other';
        bucket = EXPENSE_BUCKETS.find(b => b.name === bName);
        if (!bucket) bucket = EXPENSE_BUCKETS.find(b => b.name === 'Other');
        if (bucket && !bucket.subs.includes(line.name)) {
          bucket.subs.push(line.name);
        }
      }
      SUB_TO_BUCKET[line.name] = bucket ? bucket.name : 'Other';
    });

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

// ─── Learned patterns ───

async function loadLearnedPatterns() {
  try {
    const { data, error } = await supabase.from('amex_patterns').select('id, pattern, line_name');
    if (error) throw error;
    learnedPatterns = data || [];
  } catch (err) {
    console.warn('Could not load learned patterns (table may not exist yet):', err.message);
    learnedPatterns = [];
  }
}

async function learnPattern(patternOrDesc, lineName) {
  // patternOrDesc can be a pre-extracted keyword or a raw description
  // If it looks like a raw description (lowercase or long), extract keyword
  let keyword = patternOrDesc;
  if (keyword !== keyword.toUpperCase() || keyword.split(/\s+/).length > 3) {
    const words = patternOrDesc.trim().split(/\s+/).slice(0, 2);
    keyword = words.join(' ').toUpperCase();
  }
  if (!keyword) return;

  try {
    const { data, error } = await supabase.from('amex_patterns')
      .insert({ pattern: keyword, line_name: lineName })
      .select('id, pattern, line_name')
      .single();
    if (error) throw error;
    if (data) learnedPatterns.push(data);
    showToast(`Learned: "${keyword}" \u2192 ${lineName}`, 'success');
  } catch (err) {
    console.warn('Failed to save pattern:', err.message);
    showToast('Failed to save pattern', 'error');
  }
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

// ─── Currency helpers ───

function isMxnBucket(bucketName) {
  const b = EXPENSE_BUCKETS.find(x => x.name === bucketName);
  return b && b.currency === 'MXN';
}

function isMxnLine(subcat) {
  return isMxnBucket(bucketOf(subcat));
}

// Raw MXN total for a bucket (no conversion)
function expBucketMonthMxn(bucketName, year, month) {
  return bucketSubcats(bucketName).reduce((s, sc) => s + expCategoryMonth(sc, year, month), 0);
}

function expBucketYearMxn(bucketName, year) {
  let total = 0;
  for (let m = 1; m <= 12; m++) total += expBucketMonthMxn(bucketName, year, m);
  return total;
}

function expBucketGrandMxn(bucketName) {
  let total = 0;
  YEARS.forEach(y => { total += expBucketYearMxn(bucketName, y); });
  return total;
}

// ─── Total aggregations (all in USD) ───

export function expTotalMonth(year, month) {
  let total = 0;
  EXPENSE_BUCKETS.forEach(b => {
    total += expBucketMonth(b.name, year, month);
  });
  return total;
}

export function expTotalYear(year) {
  let total = 0;
  EXPENSE_BUCKETS.forEach(b => {
    total += expBucketYear(b.name, year);
  });
  return total;
}

function expGrandTotal() {
  let total = 0;
  EXPENSE_BUCKETS.forEach(b => {
    total += expBucketGrand(b.name);
  });
  return total;
}

// Bucket-level aggregations (returns USD)
function expBucketMonth(bucketName, year, month) {
  const raw = bucketSubcats(bucketName).reduce((s, sc) => s + expCategoryMonth(sc, year, month), 0);
  if (isMxnBucket(bucketName)) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    // If no FX rate is set for this month, treat as $0
    if (!FX_RATES[key]) return 0;
    return mxnToUsd(raw, key);
  }
  return raw;
}

function expBucketYear(bucketName, year) {
  // Sum monthly USD values to account for varying FX rates
  let total = 0;
  for (let m = 1; m <= 12; m++) total += expBucketMonth(bucketName, year, m);
  return total;
}

function expBucketGrand(bucketName) {
  let total = 0;
  YEARS.forEach(y => { total += expBucketYear(bucketName, y); });
  return total;
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

// Chart-specific aggregations — respect category visibility (all in USD)
function expVisibleMonth(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  let total = 0;
  EXPENSE_LINES
    .filter(l => isExpCategoryVisible(l.name))
    .forEach(l => {
      const val = l.monthly[key] || 0;
      total += isMxnLine(l.name) ? mxnToUsd(val, key) : val;
    });
  return total;
}

function expVisibleYear(year) {
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`;
    EXPENSE_LINES
      .filter(l => isExpCategoryVisible(l.name))
      .forEach(l => {
        const val = l.monthly[key] || 0;
        total += isMxnLine(l.name) ? mxnToUsd(val, key) : val;
      });
  }
  return total;
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
  updateExpProjBtnLabel();

  if (filled === 0) {
    showInfoModal('Nothing to project', 'No changes made', 'No projectable sub-categories have current-year actuals beyond what is already projected.');
  }
}

function clearOfficeExpenseProjections() {
  showConfirmModal('Clear projections', 'Office Expenses', 'This will remove all projected values but keep real data intact.', () => {
    EXPENSE_LINES.forEach(line => {
      if (!line.projectedMonths || line.projectedMonths.length === 0) return;
      line.projectedMonths.forEach(key => { delete line.monthly[key]; });
      line.projectedMonths = [];
      recomputeLineTotals(line);
    });
    renderOfficeExpenses();
    updateExpProjBtnLabel();
  });
}

function hasAnyOfficeProjections() {
  return EXPENSE_LINES.some(lineHasAnyProjection);
}

function updateExpProjBtnLabel() {
  const btn = document.getElementById('expProjToggleBtn');
  if (btn) btn.textContent = hasAnyOfficeProjections() ? 'Clear projections' : 'Projection';
}

function toggleExpProjection() {
  if (hasAnyOfficeProjections()) {
    clearOfficeExpenseProjections();
  } else {
    projectOfficeExpensesRestOfYear();
  }
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

function toggleMonthCompare() {
  expState.monthCompare = expState.monthCompare === 'yoy' ? 'mom' : 'yoy';
  renderExpCategoryFoot();
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

    const isMxn = bucket.currency === 'MXN';
    const fmt = isMxn ? fmtMxn : fmtUsd;

    // Sub-category rows under each bucket
    bucket.subs.forEach(subcat => {
      if (!isExpCategoryVisible(subcat)) return;

      const active = isExpCategoryActive(subcat);
      const rowCls = active ? 'acct-row subcat-row' : 'acct-row subcat-row exp-row-inactive';
      const safeCat = subcat.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      const toggleBtn = `<button class="line-toggle-btn"
        onclick="event.stopPropagation(); window._toggleExpCategoryActive('${safeCat}')"
        title="${active ? 'Hide' : 'Show'}">${active ? 'hide' : 'show'}</button>`;
      const deleteBtn = `<button class="line-delete-btn"
        onclick="event.stopPropagation(); window._deleteExpenseLine('${safeCat}')"
        title="Delete line item">✕</button>`;

      const line = EXPENSE_LINES.find(l => l.name === subcat);

      html += `<tr class="${rowCls}">`;
      html += '<td class="sticky-col"></td>';
      html += `<td class="sticky-col-2"><div class="subcat-inner"><span class="subcat-name">${subcat}</span><span class="subcat-actions">${toggleBtn}${deleteBtn}</span></div></td>`;

      YEARS.forEach(y => {
        if (expState.yearsOpen.has(y)) {
          for (let m = 1; m <= 12; m++) {
            const key = `${y}-${String(m).padStart(2, '0')}`;
            const val = expCategoryMonth(subcat, y, m);
            const pc = line && isLineProjected(line, y, m) ? ' projected-cell' : '';
            html += `<td class="num editable-cell${pc}" data-subcat="${safeCat}" data-month-key="${key}" onclick="window._editExpCell(this)">${fmt(val)}</td>`;
          }
          const pcYt = line && lineHasProjectionInYear(line, y) ? ' projected-cell' : '';
          html += `<td class="year-total-cell num${pcYt}">${fmt(expCategoryYear(subcat, y))}</td>`;
        } else {
          const pcYt = line && lineHasProjectionInYear(line, y) ? ' projected-cell' : '';
          html += `<td class="num${pcYt}">${fmt(expCategoryYear(subcat, y))}</td>`;
        }
      });

      const pcG = line && lineHasAnyProjection(line) ? ' projected-cell' : '';
      html += `<td class="grand-total-cell num${pcG}">${fmt(expCategoryGrand(subcat))}</td>`;
      html += '</tr>';
    });

    // MXN bucket: add Total MXN, USD/MXN rate, and Total USD rows
    if (isMxn) {
      // Total MXN row
      html += '<tr class="subcat-row mxn-summary-row">';
      html += '<td class="sticky-col"></td>';
      html += '<td class="sticky-col-2" style="font-weight:600; font-style:italic;">Total MXN</td>';
      YEARS.forEach(y => {
        if (expState.yearsOpen.has(y)) {
          for (let m = 1; m <= 12; m++) {
            html += `<td class="num" style="font-weight:600;">${fmtMxn(expBucketMonthMxn(bucket.name, y, m))}</td>`;
          }
          html += `<td class="year-total-cell num" style="font-weight:600;">${fmtMxn(expBucketYearMxn(bucket.name, y))}</td>`;
        } else {
          html += `<td class="num" style="font-weight:600;">${fmtMxn(expBucketYearMxn(bucket.name, y))}</td>`;
        }
      });
      html += `<td class="grand-total-cell num" style="font-weight:600;">${fmtMxn(expBucketGrandMxn(bucket.name))}</td>`;
      html += '</tr>';

      // USD/MXN rate row
      html += '<tr class="subcat-row mxn-rate-row">';
      html += '<td class="sticky-col"></td>';
      html += '<td class="sticky-col-2" style="font-style:italic; color:var(--t2);">USD/MXN</td>';
      YEARS.forEach(y => {
        if (expState.yearsOpen.has(y)) {
          for (let m = 1; m <= 12; m++) {
            const key = `${y}-${String(m).padStart(2, '0')}`;
            const rate = FX_RATES[key];
            const display = rate ? rate.toFixed(2) : '<span style="color:var(--t3);">—</span>';
            html += `<td class="num editable-cell" data-fx-key="${key}" onclick="window._editFxCellInline(this)" style="color:var(--t2);">${display}</td>`;
          }
          // Year avg
          let yrTotal = 0, yrCount = 0;
          for (let m = 1; m <= 12; m++) {
            const key = `${y}-${String(m).padStart(2, '0')}`;
            if (FX_RATES[key]) { yrTotal += FX_RATES[key]; yrCount++; }
          }
          const avg = yrCount > 0 ? (yrTotal / yrCount).toFixed(2) : '—';
          html += `<td class="year-total-cell num" style="color:var(--t2);">${avg}</td>`;
        } else {
          let yrTotal = 0, yrCount = 0;
          for (let m = 1; m <= 12; m++) {
            const key = `${y}-${String(m).padStart(2, '0')}`;
            if (FX_RATES[key]) { yrTotal += FX_RATES[key]; yrCount++; }
          }
          const avg = yrCount > 0 ? (yrTotal / yrCount).toFixed(2) : '—';
          html += `<td class="num" style="color:var(--t2);">${avg}</td>`;
        }
      });
      html += '<td class="grand-total-cell num" style="color:var(--t2);"></td>';
      html += '</tr>';

      // Total USD row (converted)
      html += '<tr class="subcat-row mxn-usd-row">';
      html += '<td class="sticky-col"></td>';
      html += '<td class="sticky-col-2" style="font-weight:600; font-style:italic;">Total USD</td>';
      YEARS.forEach(y => {
        if (expState.yearsOpen.has(y)) {
          for (let m = 1; m <= 12; m++) {
            html += `<td class="num" style="font-weight:600;">${fmtUsd(expBucketMonth(bucket.name, y, m))}</td>`;
          }
          html += `<td class="year-total-cell num" style="font-weight:600;">${fmtUsd(expBucketYear(bucket.name, y))}</td>`;
        } else {
          html += `<td class="num" style="font-weight:600;">${fmtUsd(expBucketYear(bucket.name, y))}</td>`;
        }
      });
      html += `<td class="grand-total-cell num" style="font-weight:600;">${fmtUsd(expBucketGrand(bucket.name))}</td>`;
      html += '</tr>';
    }
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

  // Check if any year is expanded (to show month-level toggle)
  const anyExpanded = YEARS.some(y => expState.yearsOpen.has(y));
  const mode = expState.monthCompare; // 'yoy' or 'mom'

  // Growth comparison helper
  function growthCell(cur, prev, extraCls) {
    if (prev > 0) {
      const pct = ((cur - prev) / prev) * 100;
      const cls = pct >= 0 ? 'yoy-neg' : 'yoy-pos';  // For expenses: up = bad
      const arrow = pct >= 0 ? '▲' : '▼';
      return `<td class="${extraCls} num ${cls}">${arrow} ${pct.toFixed(1)}%</td>`;
    }
    if (cur > 0) return `<td class="${extraCls} num yoy-na">new</td>`;
    return `<td class="${extraCls} num yoy-na">—</td>`;
  }

  // Month comparison helper — returns the comparison value for a given month
  function getCompMonth(y, m, yi) {
    if (mode === 'yoy') {
      // Same month, previous year
      return yi > 0 ? expTotalMonth(YEARS[yi - 1], m) : 0;
    } else {
      // Previous month
      if (m > 1) return expTotalMonth(y, m - 1);
      return yi > 0 ? expTotalMonth(YEARS[yi - 1], 12) : 0;
    }
  }

  // Label with toggle
  const yoyLabel = mode === 'yoy' ? 'vs same month last year' : 'vs previous month';
  const toggleHtml = anyExpanded
    ? `<span style="cursor:pointer; text-decoration:underline; text-decoration-style:dotted;" onclick="window._toggleMonthCompare()" title="Click to switch">${yoyLabel}</span>`
    : '% vs prev year';

  let yoyHtml = '<tr class="yoy-row">';
  yoyHtml += '<td class="sticky-col"></td>';
  yoyHtml += `<td class="sticky-col-2">${toggleHtml}</td>`;

  YEARS.forEach((y, yi) => {
    const cur = expTotalYear(y);
    const prev = yi > 0 ? expTotalYear(YEARS[yi - 1]) : 0;

    if (expState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) {
        const curM = expTotalMonth(y, m);
        const prevM = getCompMonth(y, m, yi);
        yoyHtml += growthCell(curM, prevM, '');
      }
      yoyHtml += growthCell(cur, prev, 'year-total-cell');
    } else {
      yoyHtml += growthCell(cur, prev, '');
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

  let line = getLine(subcat);
  if (!line) {
    // Auto-create line for subcategories defined in EXPENSE_BUCKETS but not yet in DB
    line = { name: subcat, monthly: {}, year_totals: {}, grand_total: 0, projectedMonths: [] };
    EXPENSE_LINES.push(line);
    const bkt = bucketOf(subcat);
    supabase.from('office_expense_lines')
      .insert({ name: subcat, bucket: bkt, is_active: true, display_order: EXPENSE_LINES.length })
      .select('id')
      .single()
      .then(({ data, error }) => {
        if (!error && data) line._id = data.id;
        else if (error) showToast('Failed to create line', 'error');
      });
  }

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
              <input type="radio" name="newLineBucket" value="${b.name}" ${i === 0 ? 'checked' : ''} onchange="window._updateAmountLabel()">
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
          <label class="modal-label" id="newLineAmountLabel">Amount (${EXPENSE_BUCKETS[0].currency === 'MXN' ? 'MXN' : 'USD'})</label>
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

  // Check if line already exists
  const existingLine = getLine(name);
  if (existingLine) {
    closeAddLineModal();
    showInfoModal('Line item already exists', name, 'This line item is already in the table. Close this and click its cells directly to edit values.');
    return;
  }

  // Add sub-category to bucket
  if (!bucket.subs.includes(name)) {
    bucket.subs.push(name);
    SUB_TO_BUCKET[name] = bucket.name;
  }

  // Create the line
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
      closeAddLineModal();
      showInfoModal('Cell already has a value', `$${line.monthly[monthKey].toFixed(2)} in ${monthKey}`, 'Close this and click the cell directly to edit its value.');
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
let learnedPatterns = [];

function handleAmexUpload(event) {
  console.log('[Amex] handleAmexUpload triggered');
  const file = event.target.files[0];
  if (!file) {
    console.log('[Amex] No file selected');
    return;
  }
  console.log('[Amex] File:', file.name, file.size, 'bytes');

  if (typeof window.XLSX === 'undefined') {
    showInfoModal('Upload failed', 'Library not loaded', 'The Excel parser could not load. Check your internet connection and refresh the page.');
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
        showInfoModal('No transactions found', file.name, 'Could not find columns labeled "Date", "Description", and "Amount". Make sure you are uploading the correct Amex statement file.');
        event.target.value = '';
        return;
      }

      showAmexPreview(parsed);
    } catch (err) {
      console.error('[Amex] Parse error:', err);
      showInfoModal('Failed to parse file', file.name, err.message);
    }
    event.target.value = '';
  };
  reader.onerror = (err) => {
    console.error('[Amex] FileReader error:', err);
    showInfoModal('Failed to read file', file.name, 'The file could not be read. Please try again.');
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

    const autoCategory = autoCategorizeAmex(merchant);
    transactions.push({
      date: dateStr,
      description: merchant,
      amount: amount,
      category: autoCategory,
      originalCategory: autoCategory,
      include: true
    });
  }

  console.log(`[Amex] Parsed ${transactions.length} transactions`);
  return transactions;
}

function autoCategorizeAmex(desc) {
  const d = desc.toUpperCase();

  // Check learned patterns first (simple substring match, case-insensitive)
  for (const lp of learnedPatterns) {
    if (d.includes(lp.pattern.toUpperCase())) return lp.line_name;
  }

  const patterns = [
    [/BLOOMBERG/, 'Bloomberg'],
    [/CLAUDE|ANTHROPIC/, 'Claude'],
    [/OPENAI|CHATGPT/, 'ChatGPT'],
    [/NEON\.?TECH|NEON/, 'Neon.Tech'],
    [/FLY\.?IO/, 'Fly.io'],
    [/POLYGON|MASSIVE/, 'Polygon'],
    [/YCHARTS/, 'Ycharts'],
    [/FISCAL\.?AI/, 'Fiscal.AI'],
    [/KUMU/, 'Kumu'],
    [/MICROSOFT/, 'Microsoft'],
    [/GOOGLE/, 'Google'],
    [/TELMEX|TELCEL/, 'Telmex'],
    [/AQA/, 'AQA'],
    [/AERAIRES/, 'AC'],
    [/NESPRESSO/, 'Nespresso'],
    [/SUMESA|SUPERAMA|7-ELEVEN|SUPER/, 'Super/Desayunos'],
    [/AMAZON|OFFICE|PAPER/, 'Supply oficina'],
  ];

  for (const [pat, cat] of patterns) {
    if (pat.test(d)) return cat;
  }

  return null;
}

// ─── Amex preview modal ───

function showAmexPreview(transactions) {
  amexPreviewBuffer = transactions;

  const allSubcats = [];
  EXPENSE_BUCKETS.filter(b => !b.currency).forEach(b => b.subs.forEach(s => allSubcats.push(s)));

  // Count uncategorized rows
  const uncatCount = transactions.filter(t => t.category === null).length;
  const uncatNote = uncatCount > 0
    ? `<span style="color:var(--amber, #d97706); font-weight:500;"> · ${uncatCount} uncategorized</span>`
    : '';

  // Compute existing data map for duplicate detection
  const existingData = {};
  amexPreviewBuffer.forEach(tx => {
    if (!tx.category) return;
    const ym = tx.date.slice(0, 7);
    const line = getLine(tx.category);
    if (line && line.monthly[ym]) {
      existingData[`${tx.category}::${ym}`] = line.monthly[ym];
    }
  });

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card amex-preview-card" onclick="event.stopPropagation()">
      <div class="modal-title">Review Amex import · ${transactions.length} transactions</div>
      <div class="amex-preview-sub">Auto-categorized based on merchant. Adjust any row before importing. Untick to skip a row.${uncatNote}</div>

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

  // Store existingData on the buffer for use in rendering
  amexPreviewBuffer._existingData = existingData;

  renderAmexPreviewRows(allSubcats);
}

function renderAmexPreviewRows(allSubcats) {
  const tbody = document.getElementById('amexPreviewBody');
  if (!tbody) return;

  const existingData = amexPreviewBuffer._existingData || {};

  let html = '';
  amexPreviewBuffer.forEach((tx, idx) => {
    const isUncat = tx.category === null;
    const rowCls = !tx.include ? 'amex-row-excluded' : isUncat ? 'amex-row-uncategorized' : '';

    // Check for existing data in the target cell
    let existingNote = '';
    if (tx.category) {
      const ym = tx.date.slice(0, 7);
      const key = `${tx.category}::${ym}`;
      if (existingData[key] !== undefined) {
        existingNote = `<div class="amex-existing" style="font-size:10px; color:#d97706; margin-top:2px;">Current: $${existingData[key].toFixed(2)}</div>`;
      }
    }

    // Build placeholder option for uncategorized
    const placeholderOpt = isUncat ? '<option value="" disabled selected>\u2014 Select \u2014</option>' : '';

    html += `<tr class="${rowCls}">
      <td><input type="checkbox" ${tx.include ? 'checked' : ''} onchange="window._toggleAmexPreviewRow(${idx})"></td>
      <td style="color: var(--t2); font-size: 11px;">${tx.date}</td>
      <td style="font-size: 12px;">${tx.description}</td>
      <td class="num" style="font-weight: 500;">$${tx.amount.toFixed(2)}${existingNote}</td>
      <td>
        <select class="amex-cat-select" onchange="window._updateAmexPreviewCat(${idx}, this.value)">
          ${placeholderOpt}
          ${allSubcats.map(c => `<option value="${c}" ${c === tx.category ? 'selected' : ''}>${c}</option>`).join('')}
          <option value="__new__">+ New line item</option>
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
  const tx = amexPreviewBuffer[idx];

  if (cat === '__new__') {
    // Reset dropdown to previous value while modal is open
    const selects = document.querySelectorAll('#amexPreviewBody .amex-cat-select');
    if (selects[idx]) selects[idx].value = tx.category || '';
    showNewLineFromPreview(idx);
    return;
  }

  const wasUncategorized = tx.originalCategory === null || tx.originalCategory === 'Extras';
  tx.category = cat;
  updateAmexPreviewSummary();

  // Re-render to update existing-data notes and styling
  const allSubcats = [];
  EXPENSE_BUCKETS.filter(b => !b.currency).forEach(b => b.subs.forEach(s => allSubcats.push(s)));
  renderAmexPreviewRows(allSubcats);

  // If originally uncategorized and now assigned a real category, offer to learn
  if (wasUncategorized && cat) {
    showLearnPatternModal(tx.description, cat);
  }
}

function showLearnPatternModal(description, lineName) {
  // Extract keyword preview
  const words = description.trim().split(/\s+/).slice(0, 2);
  const keyword = words.join(' ').toUpperCase();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'learnPatternModal';
  overlay.innerHTML = `
    <div class="modal-card" style="width:360px; text-align:center;" onclick="event.stopPropagation()">
      <div style="font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--t3); font-weight:500; margin-bottom:14px;">Remember this for future uploads?</div>
      <div style="font-size:13px; color:var(--t); margin-bottom:6px;"><strong>"${keyword}"</strong> &rarr; <strong>${lineName}</strong></div>
      <div style="font-size:11px; color:var(--t3); margin-bottom:22px;">Future Amex transactions containing this keyword will auto-categorize.</div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button class="btn btn-outline btn-sm" onclick="window._closeLearnPatternModal()">No</button>
        <button class="btn btn-primary btn-sm" onclick="window._confirmLearnPattern('${keyword.replace(/'/g, "\\'")}', '${lineName.replace(/'/g, "\\'")}')">Yes</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) window._closeLearnPatternModal(); });
}

function closeLearnPatternModal() {
  const modal = document.getElementById('learnPatternModal');
  if (modal) modal.remove();
}

async function confirmLearnPattern(keyword, lineName) {
  closeLearnPatternModal();
  await learnPattern(keyword, lineName);
}

function showNewLineFromPreview(txIdx) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'newLineFromPreviewModal';
  overlay.innerHTML = `
    <div class="modal-card" style="width:360px;" onclick="event.stopPropagation()">
      <div class="modal-title">New line item</div>

      <div class="modal-field">
        <label class="modal-label">Name</label>
        <input type="text" class="modal-input" id="newPreviewLineName" placeholder="e.g. Internet, Stripe" autocomplete="off">
      </div>

      <div class="modal-field">
        <label class="modal-label">Category</label>
        <div class="modal-bucket-options">
          ${EXPENSE_BUCKETS.map((b, i) => `
            <label class="bucket-option">
              <input type="radio" name="newPreviewBucket" value="${b.name}" ${i === 0 ? 'checked' : ''}>
              <span>${b.name}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" onclick="window._closeNewLineFromPreview()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="window._confirmNewLineFromPreview(${txIdx})">Create</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) window._closeNewLineFromPreview(); });
  setTimeout(() => {
    const inp = document.getElementById('newPreviewLineName');
    if (inp) inp.focus();
  }, 0);
}

function closeNewLineFromPreview() {
  const modal = document.getElementById('newLineFromPreviewModal');
  if (modal) modal.remove();
}

function confirmNewLineFromPreview(txIdx) {
  const nameInput = document.getElementById('newPreviewLineName');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) { if (nameInput) nameInput.focus(); return; }

  const bucketRadio = document.querySelector('#newLineFromPreviewModal input[name="newPreviewBucket"]:checked');
  if (!bucketRadio) return;
  const bucketName = bucketRadio.value;
  const bucket = EXPENSE_BUCKETS.find(b => b.name === bucketName);
  if (!bucket) { closeNewLineFromPreview(); return; }

  // Add sub-category to bucket if not already present
  if (!bucket.subs.includes(name)) {
    bucket.subs.push(name);
    SUB_TO_BUCKET[name] = bucket.name;
  }

  // Create the line in EXPENSE_LINES if it doesn't exist
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
        if (!error && data) line._id = data.id;
      });
  }

  // Set the transaction's category
  const tx = amexPreviewBuffer[txIdx];
  tx.category = name;

  closeNewLineFromPreview();

  // Refresh derived categories
  EXPENSE_CATEGORIES.length = 0;
  EXPENSE_CATEGORIES.push(...computeExpenseCategories());

  // Re-render preview rows with updated subcats
  const allSubcats = [];
  EXPENSE_BUCKETS.filter(b => !b.currency).forEach(b => b.subs.forEach(s => allSubcats.push(s)));
  renderAmexPreviewRows(allSubcats);

  // Offer to learn the pattern
  showLearnPatternModal(tx.description, name);
}

function updateAmexPreviewSummary() {
  const el = document.getElementById('amexPreviewSummary');
  if (!el) return;
  const included = amexPreviewBuffer.filter(t => t.include);
  const total = included.reduce((s, t) => s + t.amount, 0);

  // Count cells that will overwrite existing data
  const existingData = amexPreviewBuffer._existingData || {};
  const overwriteKeys = new Set();
  included.forEach(tx => {
    if (!tx.category) return;
    const ym = tx.date.slice(0, 7);
    const key = `${tx.category}::${ym}`;
    if (existingData[key] !== undefined) overwriteKeys.add(key);
  });
  const overwriteNote = overwriteKeys.size > 0
    ? ` · <span style="color:#d97706;">${overwriteKeys.size} cell${overwriteKeys.size === 1 ? '' : 's'} will be updated with new values</span>`
    : '';

  el.innerHTML = `<strong>${included.length}</strong> of ${amexPreviewBuffer.length} selected · total <strong>$${total.toFixed(2)}</strong>${overwriteNote}`;
}

function closeAmexPreview() {
  const overlay = document.querySelector('.modal-overlay');
  if (overlay) overlay.remove();
  amexPreviewBuffer = [];
}

function commitAmexImport() {
  const included = amexPreviewBuffer.filter(t => t.include && t.category);
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
      const newVal = Math.round(amount * 100) / 100;
      line.monthly[ym] = newVal;
      recomputeLineTotals(line);

      // Persist cell to Supabase
      if (line._id) {
        supabase.from('office_expense_cells')
          .upsert({ line_id: line._id, year_month: ym, amount_usd: newVal, is_projected: false, source: 'amex' })
          .then(({ error }) => { if (error) showToast('Failed to save imported cell', 'error'); });
      }
    }
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

  // Projection: use the year total (includes actuals + projections)
  const projection = expTotalYear(curYear);

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
  updateExpProjBtnLabel();
}

// ─── Page loader ───

export async function loadOfficePage() {
  if (!_dataLoaded) {
    await Promise.all([loadExpenseData(), loadLearnedPatterns()]);
    _dataLoaded = true;
  }
  renderOfficeExpenses();
}

// ─── Delete line item ───

let _pendingDeleteSubcat = null;

function deleteExpenseLine(subcat) {
  _pendingDeleteSubcat = subcat;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'deleteConfirmModal';
  overlay.innerHTML = `
    <div class="modal-card" style="width:340px; text-align:center;">
      <div style="font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--t3); font-weight:500; margin-bottom:14px;">Delete line item</div>
      <div style="font-size:14px; color:var(--t); margin-bottom:6px; font-weight:500;">${subcat}</div>
      <div style="font-size:11px; color:var(--t3); margin-bottom:22px;">This will remove the line and all its data.<br>This action cannot be undone.</div>
      <div style="display:flex; gap:8px; justify-content:center;">
        <button class="btn btn-outline btn-sm" onclick="window._closeDeleteModal()">Cancel</button>
        <button class="btn btn-sm" style="background:var(--red);color:#fff;" onclick="window._confirmDeleteLine()">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) window._closeDeleteModal(); });
}

function closeDeleteModal() {
  const modal = document.getElementById('deleteConfirmModal');
  if (modal) modal.remove();
  _pendingDeleteSubcat = null;
}

async function confirmDeleteLine() {
  const subcat = _pendingDeleteSubcat;
  closeDeleteModal();
  if (!subcat) return;

  const line = EXPENSE_LINES.find(l => l.name === subcat);
  if (!line) return;

  // Remove from data array
  const idx = EXPENSE_LINES.indexOf(line);
  if (idx !== -1) EXPENSE_LINES.splice(idx, 1);

  // Remove from bucket subs so the row disappears
  EXPENSE_BUCKETS.forEach(b => {
    const si = b.subs.indexOf(subcat);
    if (si !== -1) b.subs.splice(si, 1);
  });

  // Remove from SUB_TO_BUCKET
  delete SUB_TO_BUCKET[subcat];

  renderOfficeExpenses();

  if (line.id) {
    const { error } = await supabase.from('office_expense_lines').delete().eq('id', line.id);
    if (error) {
      showToast('Failed to delete — please refresh', 'error');
      console.error('Delete expense line failed:', error);
    }
  }
}

// ─── Inline FX rate editor (within expense table) ───

function editFxCellInline(td) {
  if (td.querySelector('input')) return;
  const key = td.dataset.fxKey;
  const currentVal = FX_RATES[key] || '';

  td.classList.add('editing');
  td.innerHTML = `<input type="number" step="0.01" class="cell-input" value="${currentVal}" placeholder="0.00" style="width:60px;" />`;
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
          supabase.from('fx_rates').upsert({ year_month: key, rate: FX_RATES[key], is_real: true })
            .then(({ error }) => { if (error) showToast('Failed to save FX rate', 'error'); });
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

// ─── Expose to window for onclick handlers ───

function updateAmountLabel() {
  const radio = document.querySelector('input[name="newLineBucket"]:checked');
  const label = document.getElementById('newLineAmountLabel');
  if (radio && label) {
    const bucket = EXPENSE_BUCKETS.find(b => b.name === radio.value);
    label.textContent = `Amount (${bucket && bucket.currency === 'MXN' ? 'MXN' : 'USD'})`;
  }
}

window._updateAmountLabel = updateAmountLabel;
window._editFxCellInline = editFxCellInline;
window._toggleBucketCollapsed = toggleBucketCollapsed;
window._toggleExpYear = toggleExpYear;
window._toggleExpCategory = toggleExpCategory;
window._toggleExpenseView = toggleExpenseView;
window._toggleMonthCompare = toggleMonthCompare;
window._toggleExpCategoryActive = toggleExpCategoryActive;
window._toggleExpShowInactive = toggleExpShowInactive;
window._editExpCell = editExpCell;
window._deleteExpenseLine = deleteExpenseLine;
window._closeDeleteModal = closeDeleteModal;
window._confirmDeleteLine = confirmDeleteLine;
window._addExpenseLineItem = addExpenseLineItem;
window._closeAddLineModal = closeAddLineModal;
window._confirmAddLineItem = confirmAddLineItem;
window._handleAmexUpload = handleAmexUpload;
window._closeAmexPreview = closeAmexPreview;
window._commitAmexImport = commitAmexImport;
window._toggleAmexPreviewRow = toggleAmexPreviewRow;
window._updateAmexPreviewCat = updateAmexPreviewCat;
window._toggleExpProjection = toggleExpProjection;
window._setExpGranularity = setExpGranularity;
window._setExpChartType = setExpChartType;
window._setExpChartRange = setExpChartRange;
window._deleteExpense = deleteExpense;
window._closeLearnPatternModal = closeLearnPatternModal;
window._confirmLearnPattern = confirmLearnPattern;
window._closeNewLineFromPreview = closeNewLineFromPreview;
window._confirmNewLineFromPreview = confirmNewLineFromPreview;

// Re-render when FX rates change (e.g. from the FX editor)
window.addEventListener('fx-rates-changed', () => {
  if (_dataLoaded) renderOfficeExpenses();
});
