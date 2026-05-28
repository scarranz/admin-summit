// ═══════════════ PAYROLL ═══════════════
import { supabase } from './supabase-client.js';
import { YEARS, MONTH_NAMES, fmt, fmtMxn, fmtMargin, marginCls, showToast } from './utils.js';
import { FX_RATES, FX_FALLBACK, fxRate, editFxCell } from './fx.js';
import { totalMonth, totalYear } from './revenue.js';
import { destroyChart, storeChart } from './charts.js';

// ─── Data ───
let PAYROLL_DATA = [];
let _dataLoaded = false;

// ─── State ───
const payState = {
  yearsOpen: new Set(),
  showInactive: false,
  inactiveOverrides: new Map(),   // employeeName -> 'active' | 'inactive'
  employeesCollapsed: true,       // true = hide all employee rows, show only Total
  chart: { granularity: 'monthly', type: 'bar', range: '12m', metric: 'amount' }
};

// Default-active employees — the 6 currently on payroll
const DEFAULT_ACTIVE_EMPLOYEES = new Set([
  'San Alvarez', 'Oscar Cordova', 'Pablo Valles',
  'Debby Posternak', 'Daniel Alvarez', 'Luis Catan'
]);

// ─── Employee helpers ───

function employeeKey(e) { return e.name; }

function isEmployeeActive(e) {
  const override = payState.inactiveOverrides.get(e.name);
  if (override === 'active') return true;
  if (override === 'inactive') return false;
  return DEFAULT_ACTIVE_EMPLOYEES.has(e.name);
}

function isEmployeeVisible(e) {
  if (payState.showInactive) return true;
  return isEmployeeActive(e);
}

function toggleEmployeeActive(name) {
  const e = PAYROLL_DATA.find(x => x.name === name);
  if (!e) return;
  const current = isEmployeeActive(e);
  payState.inactiveOverrides.set(name, current ? 'inactive' : 'active');
  renderPayroll();
}

function togglePayrollShowInactive() {
  payState.showInactive = !payState.showInactive;
  renderPayroll();
}

function togglePayYear(year) {
  if (payState.yearsOpen.has(year)) payState.yearsOpen.delete(year);
  else payState.yearsOpen.add(year);
  renderPayroll();
}

function expandAllYearsPayroll() {
  payState.yearsOpen = new Set([2022, 2023, 2024, 2025, 2026]);
  renderPayroll();
}

function collapseAllYearsPayroll() {
  payState.yearsOpen = new Set();
  renderPayroll();
}

function toggleEmployeesCollapsed() {
  payState.employeesCollapsed = !payState.employeesCollapsed;
  renderPayroll();
}

function payHiddenCount() {
  return PAYROLL_DATA.filter(e => !isEmployeeActive(e)).length;
}

// ─── Total aggregations — ALWAYS reflect ALL employees, never filtered by visibility ───

export function payTotalMonth(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return PAYROLL_DATA.reduce((s, e) => s + (e.monthly[key] || 0), 0);
}

function payTotalYearSalary(year) {
  return PAYROLL_DATA.reduce((s, e) => s + (e.year_totals[year] || 0), 0);
}

export function payTotalYearBonus(year) {
  return PAYROLL_DATA.reduce((s, e) => s + ((e.bonuses && e.bonuses[year]) || 0), 0);
}

export function payTotalYear(year) {
  return payTotalYearSalary(year) + payTotalYearBonus(year);
}

function payGrandTotal() {
  return PAYROLL_DATA.reduce((s, e) => s + e.grand_total, 0);
}

function payVisibleEmployees() {
  return PAYROLL_DATA
    .filter(isEmployeeVisible)
    .slice()
    .sort((a, b) => b.latest_monthly - a.latest_monthly);
}

// ─── Metric toggle ───

function setPayMetric(m) {
  payState.chart.metric = m;
  document.querySelectorAll('#payMetricToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.metric === m);
  });
  const title = document.getElementById('payChartTitle');
  if (title) {
    title.textContent = m === 'ratio' ? 'Payroll as % of revenue' : 'Payroll over time · MXN';
  }
  renderPayrollChart();
}

// ─── Chart controls ───

function setPayGranularity(g) {
  payState.chart.granularity = g;
  document.querySelectorAll('#payGranToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.gran === g);
  });
  renderPayrollChart();
}

function setPayChartType(t) {
  payState.chart.type = t;
  document.querySelectorAll('#payTypeToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === t);
  });
  renderPayrollChart();
}

function setPayChartRange(r) {
  payState.chart.range = r;
  renderPayrollChart();
}

// ─── Chart range helpers ───

function payIsInRange(y, m) {
  const r = payState.chart.range;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  if (r === 'all') return true;
  if (r === 'ytd') return y === curYear;

  if (r === '6m' || r === '12m') {
    const monthsBack = r === '6m' ? 6 : 12;
    const ymIdx = y * 12 + m;
    const curIdx = curYear * 12 + curMonth;
    const lowerBound = curIdx - monthsBack;
    const upperBound = curYear * 12 + 12;
    return ymIdx > lowerBound && ymIdx <= upperBound;
  }

  const targetYear = parseInt(r);
  if (!isNaN(targetYear)) return y === targetYear;
  return true;
}

// ─── Data loading ───

function transformSupabaseData(employees, cells) {
  // employees: [{id, name, is_active, display_order}]
  // cells: [{employee_id, year_month, amount_mxn}]
  const cellsByEmp = {};
  cells.forEach(c => {
    if (!cellsByEmp[c.employee_id]) cellsByEmp[c.employee_id] = [];
    cellsByEmp[c.employee_id].push(c);
  });

  return employees.map(emp => {
    const monthly = {};
    const bonuses = {};
    const empCells = cellsByEmp[emp.id] || [];

    empCells.forEach(c => {
      if (c.year_month.endsWith('-bonus')) {
        const yr = parseInt(c.year_month.split('-')[0]);
        bonuses[yr] = parseFloat(c.amount_mxn);
      } else {
        monthly[c.year_month] = parseFloat(c.amount_mxn);
      }
    });

    // Compute year_totals from monthly (excludes bonuses)
    const year_totals = {};
    Object.entries(monthly).forEach(([key, val]) => {
      const yr = parseInt(key.split('-')[0]);
      year_totals[yr] = (year_totals[yr] || 0) + val;
    });

    // grand_total = sum of year_totals + sum of bonuses
    const ytSum = Object.values(year_totals).reduce((s, v) => s + v, 0);
    const bSum = Object.values(bonuses).reduce((s, v) => s + v, 0);
    const grand_total = ytSum + bSum;

    // latest_monthly: value of highest year_month key
    const sortedKeys = Object.keys(monthly).sort();
    const latest_monthly = sortedKeys.length > 0 ? monthly[sortedKeys[sortedKeys.length - 1]] : 0;

    return { name: emp.name, monthly, year_totals, bonuses, grand_total, latest_monthly };
  });
}

export async function loadPayrollPage() {
  if (!_dataLoaded) {
    try {
      const [empRes, cellRes] = await Promise.all([
        supabase.from('payroll_employees').select('id, name, is_active, display_order').order('display_order'),
        supabase.from('payroll_cells').select('employee_id, year_month, amount_mxn')
      ]);

      if (empRes.error || cellRes.error) throw new Error('Supabase payroll query failed');

      PAYROLL_DATA = transformSupabaseData(empRes.data, cellRes.data);
    } catch (err) {
      console.error('Supabase payroll load failed, falling back to JSON:', err);
      try {
        const resp = await fetch('/payroll_data.json');
        PAYROLL_DATA = await resp.json();
      } catch (e2) {
        console.error('Payroll JSON fallback also failed:', e2);
        PAYROLL_DATA = [];
      }
    }
    _dataLoaded = true;
  }
  renderPayroll();
}

// ─── Supabase persistence helpers ───

async function persistPayCell(employeeName, yearMonth, amount) {
  // Find employee id
  const { data: empRows } = await supabase
    .from('payroll_employees')
    .select('id')
    .eq('name', employeeName)
    .limit(1);
  if (!empRows || empRows.length === 0) return;
  const empId = empRows[0].id;

  if (amount === 0 || amount === null || amount === undefined) {
    await supabase.from('payroll_cells')
      .delete()
      .eq('employee_id', empId)
      .eq('year_month', yearMonth);
  } else {
    const { error } = await supabase.from('payroll_cells')
      .upsert({ employee_id: empId, year_month: yearMonth, amount_mxn: amount });
    if (error) showToast('Failed to save payroll cell', 'error');
  }
}

async function persistPayBonus(employeeName, year, amount) {
  const yearMonth = `${year}-bonus`;
  await persistPayCell(employeeName, yearMonth, amount);
}

// ─── Table renderers ───

function renderPayrollHead() {
  const anyOpen = YEARS.some(y => payState.yearsOpen.has(y));
  const rs = anyOpen ? ' rowspan="2"' : '';

  let row1 = '<tr>';
  row1 += `<th class="sticky-col" style="width:32px;"${rs}></th>`;
  const empChev = payState.employeesCollapsed ? '▸' : '▾';
  row1 += `<th class="sticky-col-2 employee-header"${rs} onclick="window._toggleEmployeesCollapsed()" title="${payState.employeesCollapsed ? 'Show all employees' : 'Hide all employees'}"><span class="employee-chev">${empChev}</span> Employee</th>`;

  YEARS.forEach(y => {
    const open = payState.yearsOpen.has(y);
    if (open) {
      row1 += `<th class="year-th year-divider-left" colspan="14" onclick="window._togglePayYear(${y})">
        <span class="year-chev open">▸</span>${y}
      </th>`;
    } else {
      row1 += `<th class="year-th" onclick="window._togglePayYear(${y})"${rs}>
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
      if (payState.yearsOpen.has(y)) {
        MONTH_NAMES.forEach((m, i) => {
          const cls = i === 0 ? 'month-th num year-divider-left' : 'month-th num';
          row2 += `<th class="${cls}">${m}</th>`;
        });
        row2 += `<th class="month-th num bonus-th">Bonus</th>`;
        row2 += `<th class="year-total-cell num">${y} Total</th>`;
      }
    });
    row2 += '</tr>';
  }

  document.getElementById('payrollHead').innerHTML = row1 + row2;
}

function renderPayrollBody() {
  if (payState.employeesCollapsed) {
    document.getElementById('payrollBody').innerHTML = '';
    return;
  }
  const employees = payVisibleEmployees();
  let html = '';

  employees.forEach(emp => {
    const active = isEmployeeActive(emp);
    const rowCls = active ? 'acct-row' : 'acct-row acct-inactive';
    const safeName = emp.name.replace(/'/g, "\\'");
    const safeNameAttr = emp.name.replace(/"/g, '&quot;');
    const toggleBtn = `<button class="acct-toggle ${active ? 'is-active' : 'is-inactive'}"
      onclick="event.stopPropagation(); window._toggleEmployeeActive('${safeName}')"
      title="${active ? 'Mark as inactive' : 'Mark as active'}">${active ? '●' : '○'}</button>`;

    html += `<tr class="${rowCls}">`;
    html += '<td class="sticky-col"></td>';
    html += `<td class="sticky-col-2">${toggleBtn}${emp.name}</td>`;

    YEARS.forEach(y => {
      const salary = emp.year_totals[y] || 0;
      const bonus = (emp.bonuses && emp.bonuses[y]) || 0;
      const yearTotal = salary + bonus;

      if (payState.yearsOpen.has(y)) {
        // 12 month cells
        for (let m = 1; m <= 12; m++) {
          const key = `${y}-${String(m).padStart(2, '0')}`;
          const val = emp.monthly[key];
          const decFlag = m === 12 ? ' title="December includes 1.5x bump"' : '';
          html += `<td class="num editable-cell" data-paycell="1" data-employee="${safeNameAttr}" data-month-key="${key}"${decFlag} onclick="window._editPayCell(this)">${fmtMxn(val)}</td>`;
        }
        // Bonus cell
        html += `<td class="num editable-cell bonus-cell" data-paycell="1" data-employee="${safeNameAttr}" data-bonus-year="${y}" onclick="window._editPayBonus(this)">${fmtMxn(bonus || null)}</td>`;
        // Year total cell
        html += `<td class="year-total-cell num">${fmtMxn(yearTotal || null)}</td>`;
      } else {
        // Collapsed: single year-total cell
        const hasMonthly = Object.keys(emp.monthly).some(k => k.startsWith(`${y}-`));
        if (!hasMonthly && bonus === 0) {
          html += `<td class="num editable-cell" data-paycell="1" data-employee="${safeNameAttr}" data-year="${y}" onclick="window._editPayCell(this)">${fmtMxn(yearTotal || null)}</td>`;
        } else {
          html += `<td class="num">${fmtMxn(yearTotal || null)}</td>`;
        }
      }
    });

    html += `<td class="grand-total-cell num display-num">${fmtMxn(emp.grand_total)}</td>`;
    html += '</tr>';
  });

  document.getElementById('payrollBody').innerHTML = html;
}

// ─── Edit bonus value (per employee per year) ───

function editPayBonus(td) {
  if (td.querySelector('input')) return;
  const name = td.dataset.employee;
  const year = parseInt(td.dataset.bonusYear);
  const emp = PAYROLL_DATA.find(e => e.name === name);
  if (!emp) return;
  if (!emp.bonuses) emp.bonuses = {};
  const currentVal = emp.bonuses[year] || 0;

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
        if (newVal === 0) delete emp.bonuses[year];
        else emp.bonuses[year] = newVal;
        // Recompute grand_total = year_totals + bonuses
        const ytSum = Object.values(emp.year_totals).reduce((s, v) => s + v, 0);
        const bSum = Object.values(emp.bonuses).reduce((s, v) => s + v, 0);
        emp.grand_total = ytSum + bSum;
        // Persist optimistically
        persistPayBonus(name, year, newVal === 0 ? null : newVal);
      }
    }
    renderPayroll();
  }

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') finish(true);
  });
}

// ─── Footer rows ───

function renderPayrollFoot() {
  // ─── Total MXN row ───
  let totalHtml = '<tr class="total-row">';
  totalHtml += '<td class="sticky-col"></td>';
  totalHtml += '<td class="sticky-col-2">Total MXN</td>';

  YEARS.forEach(y => {
    if (payState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) {
        totalHtml += `<td class="num">${fmtMxn(payTotalMonth(y, m))}</td>`;
      }
      totalHtml += `<td class="num bonus-cell">${fmtMxn(payTotalYearBonus(y) || null)}</td>`;
      totalHtml += `<td class="year-total-cell num display-num">${fmtMxn(payTotalYear(y))}</td>`;
    } else {
      totalHtml += `<td class="num display-num">${fmtMxn(payTotalYear(y))}</td>`;
    }
  });

  totalHtml += `<td class="grand-total-cell num display-num" style="font-size:16px;">${fmtMxn(payGrandTotal())}</td>`;
  totalHtml += '</tr>';

  // ─── USD/MXN rate row ───
  let fxHtml = '<tr class="fx-row">';
  fxHtml += '<td class="sticky-col"></td>';
  fxHtml += '<td class="sticky-col-2">USD/MXN</td>';

  YEARS.forEach(y => {
    if (payState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const rate = FX_RATES[key];
        const display = rate ? rate.toFixed(2) : '<span style="color:var(--t3);">—</span>';
        fxHtml += `<td class="num fx-rate-display editable-cell" data-fx-key="${key}" onclick="window._editFxCell(this)">${display}</td>`;
      }
      // Bonus column gets the December rate (bonuses paid in Dec)
      const decKey = `${y}-12`;
      const decRate = FX_RATES[decKey];
      fxHtml += `<td class="num bonus-cell fx-rate-display editable-cell" data-fx-key="${decKey}" onclick="window._editFxCell(this)">${decRate ? decRate.toFixed(2) : '—'}</td>`;
      // Year total cell: average rate for the year (not editable — derived)
      let yearRates = [];
      for (let m = 1; m <= 12; m++) {
        const r = FX_RATES[`${y}-${String(m).padStart(2, '0')}`];
        if (r) yearRates.push(r);
      }
      const yearAvg = yearRates.length > 0 ? (yearRates.reduce((s, v) => s + v, 0) / yearRates.length).toFixed(2) : '—';
      fxHtml += `<td class="year-total-cell num fx-rate-display">${yearAvg} <span style="font-size:9px;color:var(--t3);">avg</span></td>`;
    } else {
      // Collapsed year: show year average (not editable)
      let yearRates = [];
      for (let m = 1; m <= 12; m++) {
        const r = FX_RATES[`${y}-${String(m).padStart(2, '0')}`];
        if (r) yearRates.push(r);
      }
      const yearAvg = yearRates.length > 0 ? (yearRates.reduce((s, v) => s + v, 0) / yearRates.length).toFixed(2) : '—';
      fxHtml += `<td class="num fx-rate-display">${yearAvg}</td>`;
    }
  });
  fxHtml += '<td class="grand-total-cell"></td>';
  fxHtml += '</tr>';

  // ─── Total USD row (Total MXN / rate per month) ───
  let usdHtml = '<tr class="total-row total-usd-row">';
  usdHtml += '<td class="sticky-col"></td>';
  usdHtml += '<td class="sticky-col-2">Total USD</td>';

  function payTotalYearUsd(year) {
    let s = 0;
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const rate = FX_RATES[key] || FX_FALLBACK;
      s += payTotalMonth(year, m) / rate;
    }
    // Bonus paid in December — convert at Dec rate
    const decRate = FX_RATES[`${year}-12`] || FX_FALLBACK;
    s += payTotalYearBonus(year) / decRate;
    return s;
  }

  YEARS.forEach(y => {
    if (payState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const rate = FX_RATES[key] || FX_FALLBACK;
        const mxn = payTotalMonth(y, m);
        const usd = mxn / rate;
        usdHtml += `<td class="num usd-cell">${usd > 0 ? '$' + Math.round(usd).toLocaleString() : '<span style="color:var(--t3);">—</span>'}</td>`;
      }
      // Bonus in USD (Dec rate)
      const bonus = payTotalYearBonus(y);
      const decRate = FX_RATES[`${y}-12`] || FX_FALLBACK;
      const bonusUsd = bonus / decRate;
      usdHtml += `<td class="num bonus-cell usd-cell">${bonusUsd > 0 ? '$' + Math.round(bonusUsd).toLocaleString() : '<span style="color:var(--t3);">—</span>'}</td>`;
      // Year total USD
      const ytUsd = payTotalYearUsd(y);
      usdHtml += `<td class="year-total-cell num display-num usd-cell">${ytUsd > 0 ? '$' + Math.round(ytUsd).toLocaleString() : '<span style="color:var(--t3);">—</span>'}</td>`;
    } else {
      const ytUsd = payTotalYearUsd(y);
      usdHtml += `<td class="num display-num usd-cell">${ytUsd > 0 ? '$' + Math.round(ytUsd).toLocaleString() : '<span style="color:var(--t3);">—</span>'}</td>`;
    }
  });

  // Grand total USD
  let grandUsd = 0;
  YEARS.forEach(y => { grandUsd += payTotalYearUsd(y); });
  usdHtml += `<td class="grand-total-cell num display-num usd-cell" style="font-size:16px;">${grandUsd > 0 ? '$' + Math.round(grandUsd).toLocaleString() : '—'}</td>`;
  usdHtml += '</tr>';

  // ─── YoY row (in MXN) ───
  let yoyHtml = '<tr class="yoy-row">';
  yoyHtml += '<td class="sticky-col"></td>';
  yoyHtml += '<td class="sticky-col-2">YoY %</td>';

  YEARS.forEach((y, i) => {
    const cur = payTotalYear(y);
    const prev = i > 0 ? payTotalYear(YEARS[i - 1]) : 0;

    if (payState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) yoyHtml += '<td></td>';
      yoyHtml += '<td class="bonus-cell"></td>';
      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        const cls = pct >= 0 ? 'yoy-pos' : 'yoy-neg';
        const arrow = pct >= 0 ? '▲' : '▼';
        yoyHtml += `<td class="year-total-cell num ${cls}">${arrow} ${pct.toFixed(1)}%</td>`;
      } else {
        yoyHtml += '<td class="year-total-cell num yoy-na">—</td>';
      }
    } else {
      if (prev > 0) {
        const pct = ((cur - prev) / prev) * 100;
        const cls = pct >= 0 ? 'yoy-pos' : 'yoy-neg';
        const arrow = pct >= 0 ? '▲' : '▼';
        yoyHtml += `<td class="num ${cls}">${arrow} ${pct.toFixed(1)}%</td>`;
      } else {
        yoyHtml += '<td class="num yoy-na">—</td>';
      }
    }
  });

  yoyHtml += '<td class="grand-total-cell"></td>';
  yoyHtml += '</tr>';

  // ─── Margin % row: Payroll USD / Revenue, monthly + yearly ───
  let marginHtml = '<tr class="margin-row">';
  marginHtml += '<td class="sticky-col"></td>';
  marginHtml += '<td class="sticky-col-2">Margin %</td>';

  function payMarginMonth(y, m) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const rate = FX_RATES[key] || FX_FALLBACK;
    const payUsd = payTotalMonth(y, m) / rate;
    const rev = totalMonth(y, m);
    return rev > 0 ? (payUsd / rev) * 100 : null;
  }

  function payMarginYear(y) {
    let payUsdYear = 0;
    for (let m = 1; m <= 12; m++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const rate = FX_RATES[key] || FX_FALLBACK;
      payUsdYear += payTotalMonth(y, m) / rate;
    }
    const decRate = FX_RATES[`${y}-12`] || FX_FALLBACK;
    payUsdYear += payTotalYearBonus(y) / decRate;
    const rev = totalYear(y);
    return rev > 0 ? (payUsdYear / rev) * 100 : null;
  }

  YEARS.forEach(y => {
    if (payState.yearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) {
        const v = payMarginMonth(y, m);
        marginHtml += `<td class="num ${marginCls(v)}">${fmtMargin(v)}</td>`;
      }
      marginHtml += '<td class="bonus-cell"></td>';
      const vy = payMarginYear(y);
      marginHtml += `<td class="year-total-cell num ${marginCls(vy)}" style="font-weight:500;">${fmtMargin(vy)}</td>`;
    } else {
      const vy = payMarginYear(y);
      marginHtml += `<td class="num ${marginCls(vy)}" style="font-weight:500;">${fmtMargin(vy)}</td>`;
    }
  });
  marginHtml += '<td class="grand-total-cell"></td>';
  marginHtml += '</tr>';

  document.getElementById('payrollFoot').innerHTML = totalHtml + fxHtml + usdHtml + yoyHtml + marginHtml;
}

// ─── Cell editing for payroll ───

function editPayCell(td) {
  if (td.querySelector('input')) return;

  const name = td.dataset.employee;
  const monthKey = td.dataset.monthKey;
  const year = td.dataset.year;

  const emp = PAYROLL_DATA.find(e => e.name === name);
  if (!emp) return;

  const currentVal = monthKey ? (emp.monthly[monthKey] || 0) : (emp.year_totals[parseInt(year)] || 0);

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
          if (newVal === 0) delete emp.monthly[monthKey];
          else emp.monthly[monthKey] = newVal;
          // Recompute year total
          const y = parseInt(monthKey.split('-')[0]);
          let yt = 0;
          for (let m = 1; m <= 12; m++) {
            yt += emp.monthly[`${y}-${String(m).padStart(2, '0')}`] || 0;
          }
          if (yt === 0) delete emp.year_totals[y];
          else emp.year_totals[y] = yt;
          // Persist optimistically
          persistPayCell(name, monthKey, newVal === 0 ? null : newVal);
        } else if (year) {
          const y = parseInt(year);
          if (newVal === 0) delete emp.year_totals[y];
          else emp.year_totals[y] = newVal;
          // For year-level edits without monthly breakdown, persist as year total
          // (We don't have a month key, so we skip Supabase for now —
          //  the user should expand the year and edit individual months)
        }
        const ytSum = Object.values(emp.year_totals).reduce((s, v) => s + v, 0);
        const bSum = emp.bonuses ? Object.values(emp.bonuses).reduce((s, v) => s + v, 0) : 0;
        emp.grand_total = ytSum + bSum;
        // Recompute latest_monthly
        const keys = Object.keys(emp.monthly).sort();
        emp.latest_monthly = keys.length > 0 ? emp.monthly[keys[keys.length - 1]] : 0;
      }
    }

    renderPayroll();
  }

  input.addEventListener('blur', () => finish(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') finish(true);
  });
}

// ─── Payroll projection KPIs ───

function renderPayKpis() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  // Payroll is paid end-of-month -> last complete month = curMonth - 1
  const lastY = curMonth === 1 ? curYear - 1 : curYear;
  const lastM = curMonth === 1 ? 12 : curMonth - 1;
  const lastKey = `${lastY}-${String(lastM).padStart(2, '0')}`;

  const latestMonthTotal = PAYROLL_DATA.reduce((s, e) => s + (e.monthly[lastKey] || 0), 0);

  // YTD: sum of all months from Jan curYear through lastM
  let ytd = 0;
  if (lastY === curYear) {
    for (let m = 1; m <= lastM; m++) {
      ytd += payTotalMonth(curYear, m);
    }
  } else {
    ytd = 0;
  }

  // Projection: YTD + (latest_month x remaining regular months) + (latest_month x 1.5 for December)
  let projection = ytd;
  if (lastY === curYear) {
    for (let m = lastM + 1; m <= 12; m++) {
      const mult = m === 12 ? 1.5 : 1.0;
      projection += latestMonthTotal * mult;
    }
  } else {
    // We're in January of a new year with prior year fully done
    projection = latestMonthTotal * 11 + latestMonthTotal * 1.5;
  }

  // Comparison vs prior year full year
  const totalPrev = payTotalYear(curYear - 1);
  const vsPrev = totalPrev > 0 ? ((projection - totalPrev) / totalPrev) * 100 : 0;
  const vsLabel = vsPrev >= 0
    ? `<span class="pos">▲ ${vsPrev.toFixed(1)}%</span> vs ${curYear - 1} ($${Math.round(totalPrev).toLocaleString()})`
    : `<span class="neg">▼ ${Math.abs(vsPrev).toFixed(1)}%</span> vs ${curYear - 1} ($${Math.round(totalPrev).toLocaleString()})`;

  const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const latestMonthLabel = `${monthNames[lastM]} ${lastY}`;
  const ytdSpanLabel = lastY === curYear && lastM > 0 ? `Jan – ${monthNames[lastM].substring(0, 3)}` : '—';

  // Update inactive link text and tooltip
  const btn = document.getElementById('payHiddenToggleBtn');
  if (btn) {
    const hidden = payHiddenCount();
    if (payState.showInactive) {
      btn.textContent = 'Hide inactive';
      btn.title = `${hidden} inactive employee${hidden === 1 ? '' : 's'} currently shown`;
    } else {
      btn.textContent = 'Show inactive';
      btn.title = `${hidden} inactive employee${hidden === 1 ? '' : 's'} hidden`;
    }
  }

  const kpiEl = document.getElementById('pay-kpis');
  if (!kpiEl) return;
  kpiEl.innerHTML = `
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
      <div class="proj-col-label">Projected ${curYear} payroll</div>
      <div class="proj-col-value">$${Math.round(projection).toLocaleString()}</div>
      <div class="proj-col-sub">${vsLabel}</div>
    </div>
  `;
}

// ─── Payroll chart ───

function getPayChartData() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  // Payroll: arrears only (end-of-month for everyone) -> last complete = curMonth - 1
  const lastY = curMonth === 1 ? curYear - 1 : curYear;
  const lastM = curMonth === 1 ? 12 : curMonth - 1;
  const lastKey = `${lastY}-${String(lastM).padStart(2, '0')}`;
  const flatRate = PAYROLL_DATA.reduce((s, e) => s + (e.monthly[lastKey] || 0), 0);

  function isComplete(y, m) {
    if (y < lastY) return true;
    if (y === lastY && m <= lastM) return true;
    return false;
  }

  if (payState.chart.granularity === 'yearly') {
    let yearsToShow = YEARS.slice();
    if (payState.chart.range === 'ytd') {
      yearsToShow = [curYear];
    } else if (payState.chart.range === '6m' || payState.chart.range === '12m') {
      const monthsBack = payState.chart.range === '6m' ? 6 : 12;
      const earliestIdx = (curYear * 12 + curMonth) - monthsBack;
      const earliestYear = Math.ceil(earliestIdx / 12);
      yearsToShow = YEARS.filter(y => y >= earliestYear);
    } else if (payState.chart.range !== 'all') {
      const targetYear = parseInt(payState.chart.range);
      if (!isNaN(targetYear)) yearsToShow = [targetYear];
    }

    const labels = yearsToShow.map(y => y.toString());
    const actual = [];
    const projected = [];
    yearsToShow.forEach(y => {
      if (y === curYear) {
        let aSum = 0;
        for (let m = 1; m <= 12; m++) {
          if (isComplete(y, m)) aSum += payTotalMonth(y, m);
        }
        let pSum = 0;
        for (let m = lastM + 1; m <= 12; m++) {
          pSum += flatRate * (m === 12 ? 1.5 : 1.0);
        }
        actual.push(aSum);
        projected.push(pSum);
      } else if (y < curYear) {
        actual.push(payTotalYear(y));
        projected.push(0);
      } else {
        actual.push(0);
        projected.push(0);
      }
    });
    return { labels, fullLabels: labels.slice(), actual, projected };
  }

  // Monthly view
  const labels = [];
  const fullLabels = [];
  const actual = [];
  const projected = [];
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  if (payState.chart.range === 'all') {
    // Include 2022 annual as single point
    const t2022 = payTotalYear(2022);
    if (t2022 > 0) {
      labels.push('2022');
      fullLabels.push('2022');
      actual.push(t2022);
      projected.push(null);
    }
  }

  [2023, 2024, 2025, 2026].forEach(y => {
    for (let m = 1; m <= 12; m++) {
      if (!payIsInRange(y, m)) continue;

      const label = m === 1 ? `${shortMonths[m - 1]} ${String(y).slice(-2)}` : shortMonths[m - 1];
      const fullLabel = `${shortMonths[m - 1]} ${y}`;

      if (isComplete(y, m)) {
        const v = payTotalMonth(y, m);
        if (v > 0 || y < curYear) {
          labels.push(label);
          fullLabels.push(fullLabel);
          actual.push(v);
          projected.push(null);
        }
      } else if (y === curYear) {
        // Future month in current year — project at flatRate, with Dec x 1.5
        labels.push(label);
        fullLabels.push(fullLabel);
        actual.push(null);
        projected.push(flatRate * (m === 12 ? 1.5 : 1.0));
      }
    }
  });

  // Bridge last actual to first projected (for line chart)
  if (payState.chart.type === 'line') {
    for (let i = 0; i < projected.length; i++) {
      if (projected[i] !== null && actual[i] === null && i > 0 && actual[i - 1] !== null) {
        projected[i - 1] = actual[i - 1];
        break;
      }
    }
  }

  // If metric is 'ratio', convert MXN values to payroll-USD / revenue %
  if (payState.chart.metric === 'ratio') {
    const monthMap = { 'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6, 'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12 };

    function ratioForLabel(fullLabel, isProjected) {
      const parts = fullLabel.split(' ');
      let year, month;
      if (parts.length === 2) {
        month = monthMap[parts[0]];
        year = parseInt(parts[1]);
      } else {
        year = parseInt(parts[0]);
        month = null;
      }
      if (!year) return null;

      // For projected periods, we don't have a meaningful ratio
      if (isProjected) return null;

      if (month) {
        const payMxn = payTotalMonth(year, month);
        const fxKey = `${year}-${String(month).padStart(2, '0')}`;
        const rate = FX_RATES[fxKey] || FX_FALLBACK;
        const payUsd = payMxn / rate;
        const rev = totalMonth(year, month);
        return rev > 0 ? (payUsd / rev) * 100 : null;
      } else {
        let payUsdYear = 0;
        for (let m = 1; m <= 12; m++) {
          const fxKey = `${year}-${String(m).padStart(2, '0')}`;
          const rate = FX_RATES[fxKey] || FX_FALLBACK;
          payUsdYear += payTotalMonth(year, m) / rate;
        }
        const decRate = FX_RATES[`${year}-12`] || FX_FALLBACK;
        payUsdYear += payTotalYearBonus(year) / decRate;
        const rev = totalYear(year);
        return rev > 0 ? (payUsdYear / rev) * 100 : null;
      }
    }

    const ratioActual = actual.map((v, i) => v !== null && v > 0 ? ratioForLabel(fullLabels[i], false) : null);
    const ratioProjected = projected.map(v => null);

    return { labels, fullLabels, actual: ratioActual, projected: ratioProjected, isRatio: true };
  }

  return { labels, fullLabels, actual, projected };
}

function renderPayrollChart() {
  const canvas = document.getElementById('payrollChart');
  if (!canvas) return;
  destroyChart('payroll');

  const chartData = getPayChartData();
  const { labels, fullLabels, actual, projected } = chartData;
  const isRatio = chartData.isRatio === true;
  const ctx = canvas.getContext('2d');

  // Tight Y axis
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
  const isLine = payState.chart.type === 'line';

  const gradActual = ctx.createLinearGradient(0, 0, 0, 280);
  gradActual.addColorStop(0, 'rgba(30,45,61,0.18)');
  gradActual.addColorStop(1, 'rgba(30,45,61,0)');
  const gradProj = ctx.createLinearGradient(0, 0, 0, 280);
  gradProj.addColorStop(0, 'rgba(168,164,158,0.18)');
  gradProj.addColorStop(1, 'rgba(168,164,158,0)');

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
      stack: 'pay'
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
      stack: 'pay'
    }
  ];

  // Formatting helpers depend on the metric
  const fmtVal = isRatio
    ? (v) => v.toFixed(1) + '%'
    : (v) => '$' + Math.round(v).toLocaleString();
  const fmtTick = isRatio
    ? (v) => v.toFixed(0) + '%'
    : (v) => '$' + (v >= 1000 ? Math.round(v / 1000) + 'k' : v);

  const chartInstance = new Chart(canvas, {
    type: payState.chart.type,
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
            generateLabels: () => isRatio ? [
              { text: 'Payroll / Revenue', fillStyle: NAVY, strokeStyle: NAVY, lineWidth: 0, hidden: false, index: 0 }
            ] : [
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
            label: (c) => `${c.dataset.label}: ${fmtVal(c.parsed.y)}`
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
            callback: fmtTick
          }
        }
      }
    }
  });

  storeChart('payroll', chartInstance);
}

// ─── Main render ───

export function renderPayroll() {
  renderPayKpis();
  renderPayrollHead();
  renderPayrollBody();
  renderPayrollFoot();
  renderPayrollChart();
}

// ─── Expose to window for onclick handlers ───

window._toggleEmployeeActive = toggleEmployeeActive;
window._togglePayrollShowInactive = togglePayrollShowInactive;
window._togglePayYear = togglePayYear;
window._expandAllYearsPayroll = expandAllYearsPayroll;
window._collapseAllYearsPayroll = collapseAllYearsPayroll;
window._toggleEmployeesCollapsed = toggleEmployeesCollapsed;
window._editPayCell = editPayCell;
window._editPayBonus = editPayBonus;
window._setPayMetric = setPayMetric;
window._setPayGranularity = setPayGranularity;
window._setPayChartType = setPayChartType;
window._setPayChartRange = setPayChartRange;

// Re-render when FX rates change (e.g. edited on another page)
window.addEventListener('fx-rates-changed', () => {
  renderPayroll();
});
