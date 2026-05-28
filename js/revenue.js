// Revenue page module
import { supabase } from './supabase-client.js';
import { YEARS, MONTH_NAMES, MONTH_NAMES_FULL, fmt, fmtTotal, showToast, showInfoModal, showConfirmModal } from './utils.js';
import { recomputeAccountTotals } from './projection.js';

// ─── Constants ───
const BANK_ORDER = ['ML', 'JPM', 'UBS', 'GS'];
const BANK_DISPLAY = {
  ML: 'Merrill Lynch',
  JPM: 'JP Morgan',
  UBS: 'UBS',
  GS: 'Goldman Sachs',
  IBKR: 'Interactive Brokers'
};
const ADVANCE_BILLED_BANKS = new Set(['GS']);

// ─── Data & State ───
export let REVENUE_DATA = [];
let _dataLoaded = false;

const revState = {
  yearsOpen: new Set([2026]),
  banksOpen: new Set(),
  visibleBanks: new Set(['ML', 'JPM', 'UBS', 'GS']),
  inactiveOverrides: new Map(),
  showInactive: false
};

const chartState = {
  granularity: 'monthly',
  type: 'bar',
  range: '12m'
};

let revenueChartInstance = null;

// ─── Data loading ───

async function loadFromSupabase() {
  const { data: accounts, error: accErr } = await supabase
    .from('revenue_accounts')
    .select('id, bank, account_name, is_inactive_override, display_order');
  if (accErr) throw accErr;

  const { data: cells, error: cellErr } = await supabase
    .from('revenue_cells')
    .select('account_id, year_month, amount, is_projected');
  if (cellErr) throw cellErr;

  // Build lookup: account_id -> cells
  const cellsByAcct = {};
  cells.forEach(c => {
    if (!cellsByAcct[c.account_id]) cellsByAcct[c.account_id] = [];
    cellsByAcct[c.account_id].push(c);
  });

  const result = accounts.map(a => {
    const monthly = {};
    const projectedMonths = [];
    (cellsByAcct[a.id] || []).forEach(c => {
      monthly[c.year_month] = parseFloat(c.amount);
      if (c.is_projected) projectedMonths.push(c.year_month);
    });

    const acct = {
      id: a.id,
      bank: a.bank,
      account: a.account_name,
      monthly,
      year_totals: {},
      grand_total: 0,
      auto_active: false,
      projectedMonths,
      display_order: a.display_order
    };

    recomputeAccountTotals(acct);
    // auto_active: has data in the current year (latest year in YEARS)
    const curYear = new Date().getFullYear();
    acct.auto_active = Object.keys(acct.monthly).some(k => k.startsWith(`${curYear}-`));

    // Apply inactive override from DB
    if (a.is_inactive_override === true) {
      revState.inactiveOverrides.set(a.bank + '|' + a.account_name, 'inactive');
    } else if (a.is_inactive_override === false) {
      revState.inactiveOverrides.set(a.bank + '|' + a.account_name, 'active');
    }

    return acct;
  });

  return result;
}

async function loadFromJson() {
  const resp = await fetch('/revenue_data.json');
  if (!resp.ok) throw new Error('Failed to load fallback JSON');
  const data = await resp.json();
  return data.map(d => ({
    ...d,
    projectedMonths: d.projectedMonths || []
  }));
}

export async function loadRevenuePage() {
  if (!_dataLoaded) {
    try {
      REVENUE_DATA = await loadFromSupabase();
    } catch (e) {
      console.warn('Supabase revenue load failed, falling back to JSON:', e);
      try {
        REVENUE_DATA = await loadFromJson();
      } catch (e2) {
        console.error('Revenue fallback also failed:', e2);
        REVENUE_DATA = [];
      }
    }
    _dataLoaded = true;
  }
  renderRevenue();
}

// ─── Persistence helpers ───

async function persistCell(acct, monthKey, value) {
  if (!acct.id) return; // no DB record (JSON fallback)
  try {
    if (value === 0 || value === null || value === undefined) {
      await supabase
        .from('revenue_cells')
        .delete()
        .eq('account_id', acct.id)
        .eq('year_month', monthKey);
    } else {
      await supabase
        .from('revenue_cells')
        .upsert({
          account_id: acct.id,
          year_month: monthKey,
          amount: value,
          is_projected: false
        }, { onConflict: 'account_id,year_month' });
    }
  } catch (e) {
    console.error('Failed to persist cell:', e);
    showToast('Failed to save change', 'error');
  }
}

async function persistYearTotal(acct, year, value) {
  // Year-total edits only apply to years without monthly data.
  // We store these as a single cell with month key "YYYY-00" by convention.
  if (!acct.id) return;
  const monthKey = `${year}-00`;
  try {
    if (value === 0 || value === null || value === undefined) {
      await supabase
        .from('revenue_cells')
        .delete()
        .eq('account_id', acct.id)
        .eq('year_month', monthKey);
    } else {
      await supabase
        .from('revenue_cells')
        .upsert({
          account_id: acct.id,
          year_month: monthKey,
          amount: value,
          is_projected: false
        }, { onConflict: 'account_id,year_month' });
    }
  } catch (e) {
    console.error('Failed to persist year total:', e);
    showToast('Failed to save change', 'error');
  }
}

async function persistProjections(acct) {
  if (!acct.id) return;
  try {
    const projKeys = acct.projectedMonths || [];
    // Upsert all projected cells
    const rows = projKeys.map(k => ({
      account_id: acct.id,
      year_month: k,
      amount: acct.monthly[k] || 0,
      is_projected: true
    }));
    if (rows.length > 0) {
      await supabase
        .from('revenue_cells')
        .upsert(rows, { onConflict: 'account_id,year_month' });
    }
  } catch (e) {
    console.error('Failed to persist projections:', e);
  }
}

async function persistClearProjections(acct, clearedKeys) {
  if (!acct.id) return;
  try {
    for (const key of clearedKeys) {
      await supabase
        .from('revenue_cells')
        .delete()
        .eq('account_id', acct.id)
        .eq('year_month', key);
    }
  } catch (e) {
    console.error('Failed to clear projections in DB:', e);
  }
}

async function persistInactiveOverride(acct, overrideValue) {
  if (!acct.id) return;
  try {
    const isInactiveOverride = overrideValue === 'inactive' ? true : overrideValue === 'active' ? false : null;
    await supabase
      .from('revenue_accounts')
      .update({ is_inactive_override: isInactiveOverride })
      .eq('id', acct.id);
  } catch (e) {
    console.error('Failed to persist inactive override:', e);
  }
}

// ─── Helper functions ───

function accountKey(r) { return r.bank + '|' + r.account; }

function isAccountActive(r) {
  const override = revState.inactiveOverrides.get(accountKey(r));
  if (override === 'active') return true;
  if (override === 'inactive') return false;
  return r.auto_active;
}

function accountIsVisible(r) {
  if (revState.showInactive) return true;
  return isAccountActive(r);
}

function bankIsVisible(bank) {
  return revState.visibleBanks.has(bank);
}

function visibleAccountsInBank(bank) {
  return REVENUE_DATA.filter(r => r.bank === bank && accountIsVisible(r));
}

function hiddenAccountsCount() {
  return REVENUE_DATA.filter(r => bankIsVisible(r.bank) && !accountIsVisible(r)).length;
}

function groupByBank() {
  const groups = {};
  REVENUE_DATA.filter(r => bankIsVisible(r.bank) && accountIsVisible(r)).forEach(r => {
    if (!groups[r.bank]) groups[r.bank] = [];
    groups[r.bank].push(r);
  });
  Object.values(groups).forEach(arr => arr.sort((a, b) => b.grand_total - a.grand_total));
  return groups;
}

// Bank-level totals reflect ALL accounts in the bank
function bankYearTotal(bank, year) {
  return REVENUE_DATA.filter(r => r.bank === bank)
    .reduce((s, r) => s + (r.year_totals[year] || 0), 0);
}

function bankMonthTotal(bank, year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return REVENUE_DATA.filter(r => r.bank === bank)
    .reduce((s, r) => s + (r.monthly[key] || 0), 0);
}

function bankGrandTotal(bank) {
  return REVENUE_DATA.filter(r => r.bank === bank)
    .reduce((s, r) => s + r.grand_total, 0);
}

// Totals row: ALL accounts, ALL banks
export function totalYear(year) {
  return REVENUE_DATA.reduce((s, r) => s + (r.year_totals[year] || 0), 0);
}

export function totalMonth(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return REVENUE_DATA.reduce((s, r) => s + (r.monthly[key] || 0), 0);
}

export function grandTotal() {
  return REVENUE_DATA.reduce((s, r) => s + r.grand_total, 0);
}

// ─── Projection-aware predicates ───

function isProjectedCell(acct, monthKey) {
  return acct.projectedMonths && acct.projectedMonths.includes(monthKey);
}

function acctYearHasProjection(acct, year) {
  if (!acct.projectedMonths || acct.projectedMonths.length === 0) return false;
  return acct.projectedMonths.some(k => k.startsWith(`${year}-`));
}

function acctGrandHasProjection(acct) {
  return !!(acct.projectedMonths && acct.projectedMonths.length > 0);
}

function bankMonthHasProjection(bank, year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return REVENUE_DATA.filter(r => r.bank === bank)
    .some(r => r.projectedMonths && r.projectedMonths.includes(key));
}

function bankYearHasProjection(bank, year) {
  return REVENUE_DATA.filter(r => r.bank === bank)
    .some(r => acctYearHasProjection(r, year));
}

function bankGrandHasProjection(bank) {
  return REVENUE_DATA.filter(r => r.bank === bank).some(acctGrandHasProjection);
}

function totalMonthHasProjection(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return REVENUE_DATA.some(r => r.projectedMonths && r.projectedMonths.includes(key));
}

function totalYearHasProjection(year) {
  return REVENUE_DATA.some(r => acctYearHasProjection(r, year));
}

function grandTotalHasProjection() {
  return REVENUE_DATA.some(acctGrandHasProjection);
}

function hasAnyProjections() {
  return REVENUE_DATA.some(a => a.projectedMonths && a.projectedMonths.length > 0);
}

function updateClearProjBtnVisibility() {
  const btn = document.getElementById('clearProjBtn');
  if (btn) btn.style.display = hasAnyProjections() ? '' : 'none';
}

// ─── Year/Bank toggle ───

function toggleYear(year) {
  if (revState.yearsOpen.has(year)) revState.yearsOpen.delete(year);
  else revState.yearsOpen.add(year);
  renderRevenue();
}

function toggleBank(bank) {
  if (revState.banksOpen.has(bank)) revState.banksOpen.delete(bank);
  else revState.banksOpen.add(bank);
  renderRevenue();
}

function expandAllYears() {
  revState.yearsOpen = new Set(YEARS);
  renderRevenue();
}

function collapseAllYears() {
  revState.yearsOpen = new Set();
  renderRevenue();
}

// ─── Projections ───

function projectRevenueRestOfYear() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const firstProjectMonth = curMonth;
  let filledCount = 0;
  let touchedAccounts = 0;

  REVENUE_DATA.forEach(acct => {
    const projSet = new Set(acct.projectedMonths || []);
    const currentYearRealKeys = Object.keys(acct.monthly)
      .filter(k => k.startsWith(`${curYear}-`))
      .filter(k => acct.monthly[k] > 0)
      .filter(k => !projSet.has(k))
      .sort();

    if (currentYearRealKeys.length === 0) return;

    const latestKey = currentYearRealKeys[currentYearRealKeys.length - 1];
    const latestVal = acct.monthly[latestKey];
    const [, lm] = latestKey.split('-').map(Number);

    if (!acct.projectedMonths) acct.projectedMonths = [];

    const startMonth = Math.max(lm + 1, firstProjectMonth);

    let accountTouched = false;
    for (let m = startMonth; m <= 12; m++) {
      const key = `${curYear}-${String(m).padStart(2, '0')}`;
      if (!acct.monthly[key] || acct.monthly[key] === 0) {
        acct.monthly[key] = latestVal;
        if (!acct.projectedMonths.includes(key)) acct.projectedMonths.push(key);
        filledCount++;
        accountTouched = true;
      }
    }
    if (accountTouched) {
      touchedAccounts++;
      recomputeAccountTotals(acct);
      persistProjections(acct);
    }
  });

  renderRevenue();
  updateClearProjBtnVisibility();

  if (filledCount === 0) {
    showInfoModal('Nothing to project', 'No changes made', 'All eligible cells already have values, or no accounts have current-year data.');
  }
}

function clearRevenueProjections() {
  showConfirmModal('Clear projections', 'Revenue', 'This will remove all forecasted entries but keep real data intact.', () => {
    REVENUE_DATA.forEach(acct => {
      if (!acct.projectedMonths || acct.projectedMonths.length === 0) return;
      const clearedKeys = [...acct.projectedMonths];
      acct.projectedMonths.forEach(key => {
        delete acct.monthly[key];
      });
      acct.projectedMonths = [];
      recomputeAccountTotals(acct);
      persistClearProjections(acct, clearedKeys);
    });

    renderRevenue();
    updateClearProjBtnVisibility();
  });
}

// ─── Active/Inactive toggle ───

function toggleAccountActive(bank, account) {
  const key = bank + '|' + account;
  const record = REVENUE_DATA.find(r => r.bank === bank && r.account === account);
  const currentlyActive = isAccountActive(record);
  const newOverride = currentlyActive ? 'inactive' : 'active';
  revState.inactiveOverrides.set(key, newOverride);
  persistInactiveOverride(record, newOverride);
  renderRevenue();
}

function toggleShowInactive() {
  revState.showInactive = !revState.showInactive;
  renderRevenue();
}

function toggleBankVisibility(bank) {
  if (revState.visibleBanks.has(bank)) {
    revState.visibleBanks.delete(bank);
  } else {
    revState.visibleBanks.add(bank);
  }
  renderRevenue();
}

// ─── Bank filter pills ───

function renderBankFilter() {
  const el = document.getElementById('bankFilterPills');
  if (!el) return;
  let html = '';
  BANK_ORDER.forEach(bank => {
    const active = revState.visibleBanks.has(bank);
    html += `<button class="bank-pill ${active ? 'active' : ''}" onclick="window._toggleBankVisibility('${bank}')">
      <span class="pill-check">\u2713</span>
      <span>${BANK_DISPLAY[bank]}</span>
    </button>`;
  });
  el.innerHTML = html;
}

// ─── Table header ───

function renderRevenueHead() {
  const anyOpen = YEARS.some(y => revState.yearsOpen.has(y));
  const rs = anyOpen ? ' rowspan="2"' : '';

  let row1 = '<tr>';
  row1 += `<th class="sticky-col" style="width:32px;"${rs}></th>`;
  row1 += `<th class="sticky-col-2"${rs}>Bank / Account</th>`;

  YEARS.forEach(y => {
    const open = revState.yearsOpen.has(y);
    if (open) {
      row1 += `<th class="year-th year-divider-left" colspan="13" onclick="window._toggleYear(${y})">
        <span class="year-chev open">\u25B8</span>${y}
      </th>`;
    } else {
      row1 += `<th class="year-th" onclick="window._toggleYear(${y})"${rs}>
        <span class="year-chev">\u25B8</span>${y}
      </th>`;
    }
  });
  row1 += `<th class="grand-total-th num"${rs}>Total</th>`;
  row1 += '</tr>';

  let row2 = '';
  if (anyOpen) {
    row2 = '<tr>';
    YEARS.forEach(y => {
      if (revState.yearsOpen.has(y)) {
        MONTH_NAMES.forEach((m, i) => {
          const cls = i === 0 ? 'month-th num year-divider-left' : 'month-th num';
          row2 += `<th class="${cls}">${m}</th>`;
        });
        row2 += `<th class="year-total-cell num">${y} Total</th>`;
      }
    });
    row2 += '</tr>';
  }

  document.getElementById('revenueHead').innerHTML = row1 + row2;
}

// ─── Table body ───

function renderRevenueBody() {
  const groups = groupByBank();
  let html = '';

  BANK_ORDER.forEach(bank => {
    if (!groups[bank]) return;
    const accounts = groups[bank];
    const bankOpen = revState.banksOpen.has(bank);

    // Bank row
    html += `<tr class="bank-row" onclick="window._toggleBank('${bank}')">`;
    html += `<td class="sticky-col"></td>`;
    html += `<td class="sticky-col-2"><span class="bank-chev ${bankOpen ? 'open' : ''}">\u25B8</span><span class="bank-${bank}">${BANK_DISPLAY[bank]}</span></td>`;

    YEARS.forEach(y => {
      if (revState.yearsOpen.has(y)) {
        for (let m = 1; m <= 12; m++) {
          const pc = bankMonthHasProjection(bank, y, m) ? ' projected-cell' : '';
          html += `<td class="num${pc}">${fmt(bankMonthTotal(bank, y, m))}</td>`;
        }
        const pcYt = bankYearHasProjection(bank, y) ? ' projected-cell' : '';
        html += `<td class="year-total-cell num${pcYt}">${fmt(bankYearTotal(bank, y))}</td>`;
      } else {
        const pcYt = bankYearHasProjection(bank, y) ? ' projected-cell' : '';
        html += `<td class="num${pcYt}" style="font-weight:600;">${fmt(bankYearTotal(bank, y))}</td>`;
      }
    });

    const pcBg = bankGrandHasProjection(bank) ? ' projected-cell' : '';
    html += `<td class="grand-total-cell num display-num${pcBg}">${fmtTotal(bankGrandTotal(bank))}</td>`;
    html += '</tr>';

    // Account rows (if bank is open)
    if (bankOpen) {
      accounts.forEach(acc => {
        const active = isAccountActive(acc);
        const rowCls = active ? 'acct-row' : 'acct-row acct-inactive';
        const safeAcct = acc.account.replace(/'/g, "\\'");
        const safeAcctAttr = acc.account.replace(/"/g, '&quot;');
        const toggleBtn = `<button class="acct-toggle ${active ? 'is-active' : 'is-inactive'}"
          onclick="event.stopPropagation(); window._toggleAccountActive('${bank}', '${safeAcct}')"
          title="${active ? 'Mark as inactive' : 'Mark as active'}">${active ? '\u25CF' : '\u25CB'}</button>`;

        html += `<tr class="${rowCls}">`;
        html += '<td class="sticky-col"></td>';
        html += `<td class="sticky-col-2">${toggleBtn}${acc.account}</td>`;

        YEARS.forEach(y => {
          if (revState.yearsOpen.has(y)) {
            for (let m = 1; m <= 12; m++) {
              const key = `${y}-${String(m).padStart(2, '0')}`;
              const val = acc.monthly[key];
              const projCls = isProjectedCell(acc, key) ? ' projected-cell' : '';
              html += `<td class="num editable-cell${projCls}" data-bank="${bank}" data-account="${safeAcctAttr}" data-month-key="${key}" onclick="window._editCell(this)">${fmt(val)}</td>`;
            }
            const pcAccYt = acctYearHasProjection(acc, y) ? ' projected-cell' : '';
            html += `<td class="year-total-cell num${pcAccYt}">${fmt(acc.year_totals[y])}</td>`;
          } else {
            const hasMonthly = Object.keys(acc.monthly).some(k => k.startsWith(`${y}-`));
            const pcAccYt = acctYearHasProjection(acc, y) ? ' projected-cell' : '';
            if (!hasMonthly) {
              html += `<td class="num editable-cell${pcAccYt}" data-bank="${bank}" data-account="${safeAcctAttr}" data-year="${y}" onclick="window._editCell(this)">${fmt(acc.year_totals[y])}</td>`;
            } else {
              html += `<td class="num${pcAccYt}">${fmt(acc.year_totals[y])}</td>`;
            }
          }
        });

        const pcAccG = acctGrandHasProjection(acc) ? ' projected-cell' : '';
        html += `<td class="grand-total-cell num display-num${pcAccG}">${fmtTotal(acc.grand_total)}</td>`;
        html += '</tr>';
      });
    }
  });

  document.getElementById('revenueBody').innerHTML = html;
}

// ─── Cell editing ───

function editCell(td) {
  if (td.querySelector('input')) return;

  const bank = td.dataset.bank;
  const account = td.dataset.account;
  const monthKey = td.dataset.monthKey;
  const year = td.dataset.year;

  const record = REVENUE_DATA.find(r => r.bank === bank && r.account === account);
  if (!record) return;

  const currentVal = monthKey
    ? (record.monthly[monthKey] || 0)
    : (record.year_totals[parseInt(year)] || 0);

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

      if (!isNaN(newVal)) {
        if (monthKey) {
          if (newVal === 0) {
            delete record.monthly[monthKey];
          } else {
            record.monthly[monthKey] = newVal;
          }
          // If this cell was projected, edit promotes it to real data
          if (record.projectedMonths) {
            record.projectedMonths = record.projectedMonths.filter(k => k !== monthKey);
          }
          // Recompute the year total for this account
          const y = parseInt(monthKey.split('-')[0]);
          let yt = 0;
          for (let m = 1; m <= 12; m++) {
            yt += record.monthly[`${y}-${String(m).padStart(2, '0')}`] || 0;
          }
          if (yt === 0) {
            delete record.year_totals[y];
          } else {
            record.year_totals[y] = yt;
          }
          // Persist optimistically
          persistCell(record, monthKey, newVal === 0 ? null : newVal);
        } else if (year) {
          const y = parseInt(year);
          if (newVal === 0) {
            delete record.year_totals[y];
          } else {
            record.year_totals[y] = newVal;
          }
          persistYearTotal(record, y, newVal === 0 ? null : newVal);
        }
        // Recompute grand_total
        record.grand_total = Object.values(record.year_totals).reduce((s, v) => s + v, 0);
        // Update auto_active flag
        const curYear = new Date().getFullYear();
        record.auto_active = Object.keys(record.monthly).some(k => k.startsWith(`${curYear}-`));
      }
    }

    renderRevenue();
  }

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    } else if (e.key === 'Tab') {
      finish(true);
    }
  });
}

// ─── Table footer ───

function renderRevenueFoot() {
  let totalHtml = '<tr class="total-row">';
  totalHtml += '<td class="sticky-col"></td>';
  totalHtml += '<td class="sticky-col-2">Total</td>';

  YEARS.forEach(y => {
    if (revState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) {
        const pc = totalMonthHasProjection(y, m) ? ' projected-cell' : '';
        totalHtml += `<td class="num${pc}">${fmt(totalMonth(y, m))}</td>`;
      }
      const pcYt = totalYearHasProjection(y) ? ' projected-cell' : '';
      totalHtml += `<td class="year-total-cell num display-num${pcYt}">${fmtTotal(totalYear(y))}</td>`;
    } else {
      const pcYt = totalYearHasProjection(y) ? ' projected-cell' : '';
      totalHtml += `<td class="num display-num${pcYt}">${fmtTotal(totalYear(y))}</td>`;
    }
  });

  const pcG = grandTotalHasProjection() ? ' projected-cell' : '';
  totalHtml += `<td class="grand-total-cell num display-num${pcG}" style="font-size:16px;">${fmtTotal(grandTotal())}</td>`;
  totalHtml += '</tr>';

  // YoY row
  let yoyHtml = '<tr class="yoy-row">';
  yoyHtml += '<td class="sticky-col"></td>';
  yoyHtml += '<td class="sticky-col-2">% vs prev year</td>';

  YEARS.forEach((y, i) => {
    const cur = totalYear(y);
    const prev = i > 0 ? totalYear(YEARS[i - 1]) : 0;

    if (revState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) yoyHtml += '<td></td>';

      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        const cls = pct >= 0 ? 'yoy-pos' : 'yoy-neg';
        const arrow = pct >= 0 ? '\u25B2' : '\u25BC';
        yoyHtml += `<td class="year-total-cell num ${cls}">${arrow} ${pct.toFixed(1)}%</td>`;
      } else {
        yoyHtml += '<td class="year-total-cell num yoy-na">\u2014</td>';
      }
    } else {
      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        const cls = pct >= 0 ? 'yoy-pos' : 'yoy-neg';
        const arrow = pct >= 0 ? '\u25B2' : '\u25BC';
        yoyHtml += `<td class="num ${cls}">${arrow} ${pct.toFixed(1)}%</td>`;
      } else {
        yoyHtml += '<td class="num yoy-na">\u2014</td>';
      }
    }
  });

  yoyHtml += '<td class="grand-total-cell"></td>';
  yoyHtml += '</tr>';

  document.getElementById('revenueFoot').innerHTML = totalHtml + yoyHtml;
}

// ─── KPI cards ───

function renderRevKpis() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  function lastCompleteMonth(bank) {
    if (ADVANCE_BILLED_BANKS.has(bank)) return { year: curYear, month: curMonth };
    if (curMonth === 1) return { year: curYear - 1, month: 12 };
    return { year: curYear, month: curMonth - 1 };
  }

  function isMonthComplete(bank, y, m) {
    const { year, month } = lastCompleteMonth(bank);
    if (y < year) return true;
    if (y === year && m <= month) return true;
    return false;
  }

  function bankFlatRate(bank) {
    const { year, month } = lastCompleteMonth(bank);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    return REVENUE_DATA.filter(r => r.bank === bank)
      .reduce((s, r) => s + (r.monthly[key] || 0), 0);
  }

  const arrearsLast = curMonth === 1 ? { year: curYear - 1, month: 12 } : { year: curYear, month: curMonth - 1 };
  const arrearsLastKey = `${arrearsLast.year}-${String(arrearsLast.month).padStart(2, '0')}`;
  let arrearsLastTotal = 0;
  REVENUE_DATA.forEach(r => {
    if (!ADVANCE_BILLED_BANKS.has(r.bank)) {
      arrearsLastTotal += (r.monthly[arrearsLastKey] || 0);
    }
  });
  const gsKey = `${arrearsLast.year}-${String(arrearsLast.month).padStart(2, '0')}`;
  let gsTotal = 0;
  REVENUE_DATA.forEach(r => {
    if (ADVANCE_BILLED_BANKS.has(r.bank)) {
      gsTotal += (r.monthly[gsKey] || 0);
    }
  });
  const latestMonthTotal = arrearsLastTotal + gsTotal;

  // YTD actual
  let ytd = 0;
  const banksAll = ['ML', 'JPM', 'UBS', 'GS', 'IBKR'];
  for (let m = 1; m <= 12; m++) {
    banksAll.forEach(b => {
      if (isMonthComplete(b, curYear, m)) {
        const key = `${curYear}-${String(m).padStart(2, '0')}`;
        ytd += REVENUE_DATA.filter(r => r.bank === b)
          .reduce((s, r) => s + (r.monthly[key] || 0), 0);
      }
    });
  }

  // Projection
  let projectedPart = 0;
  for (let m = 1; m <= 12; m++) {
    banksAll.forEach(b => {
      if (!isMonthComplete(b, curYear, m)) {
        projectedPart += bankFlatRate(b);
      }
    });
  }
  const projection = ytd + projectedPart;

  const ytdMonths = arrearsLast.year === curYear ? arrearsLast.month : 0;

  const totalPrev = totalYear(curYear - 1);
  const vsPrev = totalPrev > 0 ? ((projection - totalPrev) / totalPrev) * 100 : 0;
  const vsLabel = vsPrev >= 0
    ? `<span class="pos">\u25B2 ${vsPrev.toFixed(1)}%</span> vs ${curYear - 1} ($${Math.round(totalPrev).toLocaleString()})`
    : `<span class="neg">\u25BC ${Math.abs(vsPrev).toFixed(1)}%</span> vs ${curYear - 1} ($${Math.round(totalPrev).toLocaleString()})`;

  const latestMonthLabel = `${MONTH_NAMES_FULL[arrearsLast.month]} ${arrearsLast.year}`;
  const ytdSpanLabel = ytdMonths > 0 ? `Jan \u2013 ${MONTH_NAMES_FULL[ytdMonths].substring(0, 3)}` : '\u2014';

  // Update inactive link text
  const btn = document.getElementById('hiddenToggleBtn');
  if (btn) {
    const hidden = hiddenAccountsCount();
    if (revState.showInactive) {
      btn.textContent = 'Hide inactive';
      btn.title = `${hidden} inactive account${hidden === 1 ? '' : 's'} currently shown`;
    } else {
      btn.textContent = 'Show inactive';
      btn.title = `${hidden} inactive account${hidden === 1 ? '' : 's'} hidden`;
    }
  }

  document.getElementById('rev-kpis').innerHTML = `
    <div class="proj-col">
      <div class="proj-col-label">Latest month</div>
      <div class="proj-col-value">$${Math.round(latestMonthTotal).toLocaleString()}</div>
      <div class="proj-col-sub">${latestMonthLabel}</div>
    </div>
    <div class="proj-col">
      <div class="proj-col-label">YTD actual</div>
      <div class="proj-col-value">$${Math.round(ytd).toLocaleString()}</div>
      <div class="proj-col-sub">${ytdMonths} months \u00B7 ${ytdSpanLabel}</div>
    </div>
    <div class="proj-col">
      <div class="proj-col-label">Projected ${curYear} revenue</div>
      <div class="proj-col-value">$${Math.round(projection).toLocaleString()}</div>
      <div class="proj-col-sub">${vsLabel}</div>
    </div>
  `;
}

// ─── Chart ───

function setGranularity(g) {
  chartState.granularity = g;
  document.querySelectorAll('#granToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.gran === g);
  });
  renderRevenueChart();
}

function setChartType(t) {
  chartState.type = t;
  document.querySelectorAll('#typeToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === t);
  });
  renderRevenueChart();
}

function setChartRange(r) {
  chartState.range = r;
  renderRevenueChart();
}

function isInRange(y, m) {
  const r = chartState.range;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  if (r === 'all') return true;

  if (r === 'ytd') {
    return y === curYear;
  }

  if (r === '6m' || r === '12m') {
    const monthsBack = r === '6m' ? 6 : 12;
    const ymIdx = y * 12 + m;
    const curIdx = curYear * 12 + curMonth;
    const lowerBound = curIdx - monthsBack;
    const upperBound = curYear * 12 + 12;
    return ymIdx > lowerBound && ymIdx <= upperBound;
  }

  const targetYear = parseInt(r);
  if (!isNaN(targetYear)) {
    return y === targetYear;
  }

  return true;
}

function getChartData() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  function lastCompleteMonth(bank) {
    if (ADVANCE_BILLED_BANKS.has(bank)) {
      return { year: curYear, month: curMonth };
    }
    if (curMonth === 1) return { year: curYear - 1, month: 12 };
    return { year: curYear, month: curMonth - 1 };
  }

  function isMonthComplete(bank, y, m) {
    const { year, month } = lastCompleteMonth(bank);
    if (y < year) return true;
    if (y === year && m <= month) return true;
    return false;
  }

  function bankFlatRate(bank) {
    const { year, month } = lastCompleteMonth(bank);
    const key = `${year}-${String(month).padStart(2, '0')}`;
    return REVENUE_DATA.filter(r => r.bank === bank)
      .reduce((s, r) => s + (r.monthly[key] || 0), 0);
  }

  function monthSplit(y, m) {
    let actualPart = 0;
    let projectedPart = 0;
    const banks = ['ML', 'JPM', 'UBS', 'GS', 'IBKR'];
    const isCurrentMonth = (y === curYear && m === curMonth);

    banks.forEach(b => {
      if (isMonthComplete(b, y, m)) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const v = REVENUE_DATA.filter(r => r.bank === b)
          .reduce((s, r) => s + (r.monthly[key] || 0), 0);
        if (isCurrentMonth) {
          projectedPart += v;
        } else {
          actualPart += v;
        }
      } else {
        projectedPart += bankFlatRate(b);
      }
    });
    return { actualPart, projectedPart };
  }

  if (chartState.granularity === 'yearly') {
    let yearsToShow = YEARS.slice();
    if (chartState.range === 'ytd') {
      yearsToShow = [curYear];
    } else if (chartState.range === '6m' || chartState.range === '12m') {
      const monthsBack = chartState.range === '6m' ? 6 : 12;
      const earliestIdx = (curYear * 12 + curMonth) - monthsBack;
      const earliestYear = Math.ceil(earliestIdx / 12);
      yearsToShow = YEARS.filter(y => y >= earliestYear);
    } else if (chartState.range !== 'all') {
      const targetYear = parseInt(chartState.range);
      if (!isNaN(targetYear)) yearsToShow = [targetYear];
    }

    const labels = yearsToShow.map(y => y.toString());
    const actual = [];
    const projected = [];
    yearsToShow.forEach(y => {
      if (y === curYear) {
        let aSum = 0, pSum = 0;
        for (let m = 1; m <= 12; m++) {
          const { actualPart, projectedPart } = monthSplit(y, m);
          aSum += actualPart;
          pSum += projectedPart;
        }
        actual.push(aSum);
        projected.push(pSum);
      } else if (y < curYear) {
        actual.push(totalYear(y));
        projected.push(0);
      } else {
        actual.push(0);
        projected.push(0);
      }
    });
    return { labels, fullLabels: labels.slice(), actual, projected, isMonthly: false };
  } else {
    const labels = [];
    const fullLabels = [];
    const actual = [];
    const projected = [];
    const shortMonths = MONTH_NAMES;

    // Include 2022 only when range is 'all'
    if (chartState.range === 'all') {
      labels.push('2022');
      fullLabels.push('2022');
      actual.push(totalYear(2022));
      projected.push(0);
    }

    [2023, 2024, 2025, 2026].forEach(y => {
      for (let m = 1; m <= 12; m++) {
        if (!isInRange(y, m)) continue;

        const label = m === 1 ? `${shortMonths[m - 1]} ${String(y).slice(-2)}` : shortMonths[m - 1];
        const fullLabel = `${shortMonths[m - 1]} ${y}`;
        const { actualPart, projectedPart } = monthSplit(y, m);

        if (actualPart === 0 && projectedPart === 0) continue;

        labels.push(label);
        fullLabels.push(fullLabel);

        if (projectedPart === 0) {
          actual.push(actualPart);
          projected.push(null);
        } else if (actualPart === 0) {
          actual.push(null);
          projected.push(projectedPart);
        } else {
          actual.push(actualPart);
          projected.push(projectedPart);
        }
      }
    });

    // For line charts: bridge the last actual point to first projected point
    if (chartState.type === 'line') {
      for (let i = 0; i < projected.length; i++) {
        if (projected[i] !== null && actual[i] === null && i > 0 && actual[i - 1] !== null) {
          projected[i - 1] = actual[i - 1];
          break;
        }
      }
    }

    return { labels, fullLabels, actual, projected, isMonthly: true };
  }
}

function renderRevenueChart() {
  const canvas = document.getElementById('revenueChart');
  if (!canvas) return;
  if (revenueChartInstance) { revenueChartInstance.destroy(); revenueChartInstance = null; }

  const { labels, fullLabels, actual, projected, isMonthly } = getChartData();
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

  const gradActual = ctx.createLinearGradient(0, 0, 0, 280);
  gradActual.addColorStop(0, 'rgba(30,45,61,0.18)');
  gradActual.addColorStop(1, 'rgba(30,45,61,0)');

  const gradProj = ctx.createLinearGradient(0, 0, 0, 280);
  gradProj.addColorStop(0, 'rgba(168,164,158,0.18)');
  gradProj.addColorStop(1, 'rgba(168,164,158,0)');

  const isLine = chartState.type === 'line';

  const datasets = [
    {
      label: 'Actual',
      data: actual,
      borderColor: NAVY,
      backgroundColor: isLine ? gradActual : NAVY,
      fill: isLine,
      tension: 0.32,
      borderWidth: isLine ? 2 : 0,
      pointRadius: isLine ? 0 : undefined,
      pointHoverRadius: isLine ? 5 : undefined,
      pointBackgroundColor: NAVY,
      borderRadius: !isLine ? 3 : undefined,
      barPercentage: 0.7,
      categoryPercentage: 0.85,
      stack: 'rev',
      spanGaps: false
    },
    {
      label: 'Projected',
      data: projected,
      borderColor: PROJ_COLOR,
      backgroundColor: isLine ? gradProj : 'rgba(168,164,158,0.5)',
      fill: isLine,
      tension: 0.32,
      borderWidth: isLine ? 2 : 0,
      borderDash: isLine ? [6, 4] : undefined,
      pointRadius: isLine ? 0 : undefined,
      pointHoverRadius: isLine ? 5 : undefined,
      pointBackgroundColor: PROJ_COLOR,
      borderRadius: !isLine ? 3 : undefined,
      barPercentage: 0.7,
      categoryPercentage: 0.85,
      stack: 'rev',
      spanGaps: false
    }
  ];

  revenueChartInstance = new window.Chart(canvas, {
    type: chartState.type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: {
            font: { family: 'Jost', size: 10 },
            color: '#6b6860',
            boxWidth: 14,
            boxHeight: 10,
            padding: 14,
            usePointStyle: false,
            generateLabels: (chart) => [
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
            title: (items) => {
              if (!items.length) return '';
              const idx = items[0].dataIndex;
              return fullLabels[idx] || items[0].label;
            },
            label: (c) => `${c.dataset.label}: $${Math.round(c.parsed.y).toLocaleString()}`
          }
        }
      },
      scales: {
        x: {
          stacked: !isLine,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: {
            font: { family: 'Jost', size: 10 },
            color: '#a8a49e',
            maxRotation: 0,
            autoSkip: true,
            autoSkipPadding: 10
          }
        },
        y: {
          stacked: !isLine,
          min: yMin,
          max: yMax,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: {
            font: { family: 'Jost', size: 10 },
            color: '#a8a49e',
            callback: v => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v)
          }
        }
      }
    }
  });
}

// ─── Main render ───

export function renderRevenue() {
  renderBankFilter();
  renderRevKpis();
  renderRevenueHead();
  renderRevenueBody();
  renderRevenueFoot();
  renderRevenueChart();
  updateClearProjBtnVisibility();
}

// ─── Window-level handlers (for onclick in HTML) ───

window._toggleYear = toggleYear;
window._toggleBank = toggleBank;
window._expandAllYears = expandAllYears;
window._collapseAllYears = collapseAllYears;
window._toggleBankVisibility = toggleBankVisibility;
window._toggleShowInactive = toggleShowInactive;
window._toggleAccountActive = toggleAccountActive;
window._editCell = editCell;
window._projectRevenueRestOfYear = projectRevenueRestOfYear;
window._clearRevenueProjections = clearRevenueProjections;
window._setGranularity = setGranularity;
window._setChartType = setChartType;
window._setChartRange = setChartRange;
