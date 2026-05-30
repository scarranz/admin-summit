// Overview page module — Operating margin dashboard
// Computes revenue minus all expenses (office USD + payroll MXN->USD)

import { YEARS, MONTH_NAMES, fmtPct, fmtYoy } from './utils.js';
import { totalMonth, totalYear } from './revenue.js';
import { payTotalMonth, payTotalYear, payTotalYearBonus } from './payroll.js';
import { expTotalMonth, expTotalYear } from './office.js';
import { mxnToUsd, fxRate } from './fx.js';
import { destroyChart, storeChart } from './charts.js';

// ─── State ───
const ovState = {
  chart: { granularity: 'monthly', range: '12m' },
  series: { revenue: true, expenses: true, opIncome: true, margin: true },
  expensesCollapsed: false,
  yearsOpen: new Set()
};

// ═══════════════ Series toggle ═══════════════
function toggleOvSeries(series) {
  ovState.series[series] = !ovState.series[series];
  // Don't let user disable all series — keep at least one on
  if (!ovState.series.revenue && !ovState.series.expenses && !ovState.series.opIncome && !ovState.series.margin) {
    ovState.series[series] = true;  // revert
    return;
  }
  document.querySelectorAll('#ovSeriesToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', ovState.series[b.dataset.series]);
  });
  renderOvChart();
}

// ═══════════════ Year expand/collapse ═══════════════
function toggleOvYear(year) {
  if (ovState.yearsOpen.has(year)) ovState.yearsOpen.delete(year);
  else ovState.yearsOpen.add(year);
  renderOvTable();
}

function expandAllOvYears() {
  ovState.yearsOpen = new Set([2022, 2023, 2024, 2025, 2026]);
  renderOvTable();
}

function collapseAllOvYears() {
  ovState.yearsOpen = new Set();
  renderOvTable();
}

// ═══════════════ Expense breakdown toggle ═══════════════
function toggleOvExpenses() {
  ovState.expensesCollapsed = !ovState.expensesCollapsed;
  renderOvTable();
}

// ═══════════════ Core financial math ═══════════════
// Revenue (USD): use totalMonth(y, m) and totalYear(y) from Revenue module
// Payroll (MXN): payTotalMonth(y, m) and payTotalYear(y) — must convert to USD
// Office Expenses (USD): expTotalMonth(y, m) and expTotalYear(y)

function ovPayrollUsdMonth(year, month) {
  const key = `${year}-${String(month).padStart(2,'0')}`;
  const mxn = payTotalMonth(year, month);
  // Bonus is paid in December typically. Add it to December.
  let bonus = 0;
  if (month === 12) {
    bonus = payTotalYearBonus(year);
  }
  return mxnToUsd(mxn + bonus, key);
}

function ovPayrollUsdYear(year) {
  // Sum each month's USD-converted payroll for proper FX-by-month accuracy
  let s = 0;
  for (let m = 1; m <= 12; m++) {
    s += ovPayrollUsdMonth(year, m);
  }
  return s;
}

function ovRevenueMonth(year, month)  { return totalMonth(year, month); }
function ovRevenueYear(year)          { return totalYear(year); }
function ovExpenseMonth(year, month)  { return expTotalMonth(year, month) + ovPayrollUsdMonth(year, month); }
function ovExpenseYear(year)          { return expTotalYear(year) + ovPayrollUsdYear(year); }

function ovOpIncomeMonth(year, month) { return ovRevenueMonth(year, month) - ovExpenseMonth(year, month); }
function ovOpIncomeYear(year)         { return ovRevenueYear(year) - ovExpenseYear(year); }

function ovMarginMonth(year, month) {
  const r = ovRevenueMonth(year, month);
  return r > 0 ? (ovOpIncomeMonth(year, month) / r) * 100 : 0;
}
function ovMarginYear(year) {
  const r = ovRevenueYear(year);
  return r > 0 ? (ovOpIncomeYear(year) / r) * 100 : 0;
}

// ═══════════════ Chart controls ═══════════════
function setOvGranularity(g) {
  ovState.chart.granularity = g;
  document.querySelectorAll('#ovGranToggle .toggle-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.gran === g);
  });
  renderOvChart();
  renderOvTable();
}

function setOvChartRange(r) {
  ovState.chart.range = r;
  renderOvChart();
  renderOvTable();
}

function ovIsInRange(y, m) {
  const r = ovState.chart.range;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;

  if (r === 'all') return true;
  if (r === 'ytd') return y === curYear;

  if (r === '6m' || r === '12m' || r === '24m') {
    const monthsBack = r === '6m' ? 6 : r === '12m' ? 12 : 24;
    const ymIdx = y * 12 + m;
    const curIdx = curYear * 12 + curMonth;
    return ymIdx > curIdx - monthsBack && ymIdx <= curYear * 12 + 12;
  }

  const targetYear = parseInt(r);
  if (!isNaN(targetYear)) return y === targetYear;
  return true;
}

// ═══════════════ Period boundaries ═══════════════
function ovLastCompleteMonth() {
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  return curMonth === 1
    ? { y: curYear - 1, m: 12 }
    : { y: curYear, m: curMonth - 1 };
}

// ═══════════════ KPI projection card ═══════════════
function renderOvKpis() {
  const el = document.getElementById('ov-kpis');
  if (!el) return;

  const { y: lastY, m: lastM } = ovLastCompleteMonth();
  const now = new Date();
  const curYear = now.getFullYear();
  const monthNames = ['','January','February','March','April','May','June','July','August','September','October','November','December'];

  // Latest month: revenue, expenses, OI, margin
  const latestRev = ovRevenueMonth(lastY, lastM);
  const latestExp = ovExpenseMonth(lastY, lastM);
  const latestOI = latestRev - latestExp;
  const latestMargin = latestRev > 0 ? (latestOI / latestRev) * 100 : 0;

  // YTD: sum Jan-lastM in curYear
  let ytdRev = 0, ytdExp = 0;
  if (lastY === curYear) {
    for (let m = 1; m <= lastM; m++) {
      ytdRev += ovRevenueMonth(curYear, m);
      ytdExp += ovExpenseMonth(curYear, m);
    }
  }
  const ytdOI = ytdRev - ytdExp;
  const ytdMargin = ytdRev > 0 ? (ytdOI / ytdRev) * 100 : 0;

  // Projection: sum all 12 months using the same data as the table
  // This uses actual values for complete months and projected values
  // (from revenue/office projection) for future months
  let projRev = 0, projExp = 0;
  for (let m = 1; m <= 12; m++) {
    const rev = ovRevenueMonth(curYear, m);
    const exp = ovExpenseMonth(curYear, m);
    if (m <= lastM) {
      // Complete month — use actuals
      projRev += rev;
      projExp += exp;
    } else {
      // Future month — use latest complete month as run-rate if no projected data
      if (rev > 0 || exp > 0) {
        projRev += rev;
        projExp += exp;
      } else {
        projRev += ovRevenueMonth(lastY, lastM);
        projExp += ovExpenseMonth(lastY, lastM);
      }
    }
  }
  const projOI = projRev - projExp;
  const projMargin = projRev > 0 ? (projOI / projRev) * 100 : 0;

  const latestMonthLabel = `${monthNames[lastM]} ${lastY}`;
  const ytdSpanLabel = lastY === curYear && lastM > 0 ? `Jan – ${monthNames[lastM].substring(0,3)}` : '—';

  // Target: >= 50% margin
  const targetMet = projMargin >= 50;
  const targetLabel = targetMet
    ? `<span class="pos">\u2713</span> Above 50% target`
    : `<span class="neg">\u2717</span> Below 50% target`;

  el.innerHTML = `
    <div class="proj-col">
      <div class="proj-col-label">Latest month margin</div>
      <div class="proj-col-value">${latestMargin.toFixed(1)}%</div>
      <div class="proj-col-sub">${latestMonthLabel} \u00b7 OI $${Math.round(latestOI).toLocaleString()}</div>
    </div>
    <div class="proj-col">
      <div class="proj-col-label">YTD margin</div>
      <div class="proj-col-value">${ytdMargin.toFixed(1)}%</div>
      <div class="proj-col-sub">${ytdSpanLabel} \u00b7 OI $${Math.round(ytdOI).toLocaleString()}</div>
    </div>
    <div class="proj-col">
      <div class="proj-col-label">Projected ${curYear} margin</div>
      <div class="proj-col-value">${projMargin.toFixed(1)}%</div>
      <div class="proj-col-sub">${targetLabel} \u00b7 OI $${Math.round(projOI).toLocaleString()}</div>
    </div>
  `;
}

// ═══════════════ Chart ═══════════════
function getOvChartData() {
  const now = new Date();
  const curYear = now.getFullYear();
  const { y: lastY, m: lastM } = ovLastCompleteMonth();

  function isComplete(y, m) {
    if (y < lastY) return true;
    if (y === lastY && m <= lastM) return true;
    return false;
  }

  if (ovState.chart.granularity === 'yearly') {
    let yearsToShow = [2022, 2023, 2024, 2025, 2026];
    if (ovState.chart.range === 'ytd') yearsToShow = [curYear];
    else if (ovState.chart.range === '6m' || ovState.chart.range === '12m' || ovState.chart.range === '24m') {
      const monthsBack = ovState.chart.range === '6m' ? 6 : ovState.chart.range === '12m' ? 12 : 24;
      const earliestIdx = (curYear * 12 + (now.getMonth() + 1)) - monthsBack;
      const earliestYear = Math.ceil(earliestIdx / 12);
      yearsToShow = yearsToShow.filter(y => y >= earliestYear);
    } else if (ovState.chart.range !== 'all') {
      const t = parseInt(ovState.chart.range);
      if (!isNaN(t)) yearsToShow = [t];
    }

    const labels = yearsToShow.map(y => y.toString());
    const revData = [], expData = [], opIncomeData = [], marginData = [];
    yearsToShow.forEach(y => {
      let rev = 0, exp = 0;
      // For current year, sum only complete months
      if (y === curYear) {
        for (let m = 1; m <= 12; m++) {
          if (isComplete(y, m)) {
            rev += ovRevenueMonth(y, m);
            exp += ovExpenseMonth(y, m);
          }
        }
      } else {
        rev = ovRevenueYear(y);
        exp = ovExpenseYear(y);
      }
      revData.push(rev);
      expData.push(exp);
      opIncomeData.push(rev - exp);
      marginData.push(rev > 0 ? ((rev - exp) / rev) * 100 : 0);
    });
    return { labels, fullLabels: labels.slice(), revData, expData, opIncomeData, marginData, projectedFlags: [] };
  }

  // Monthly
  const labels = [], fullLabels = [], revData = [], expData = [], opIncomeData = [], marginData = [];
  const projectedFlags = [];
  const shortMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Determine the 3 forward months after last complete month
  const fwdMonths = [];
  for (let i = 1; i <= 3; i++) {
    let fY = lastY, fM = lastM + i;
    if (fM > 12) { fY += 1; fM -= 12; }
    fwdMonths.push({ y: fY, m: fM });
  }
  function isFwdMonth(y, m) {
    return fwdMonths.some(f => f.y === y && f.m === m);
  }

  [2022, 2023, 2024, 2025, 2026, 2027].forEach(y => {
    for (let m = 1; m <= 12; m++) {
      if (!ovIsInRange(y, m) && !isFwdMonth(y, m)) continue;
      const fwd = isFwdMonth(y, m);
      if (!isComplete(y, m) && !fwd) continue;

      const rev = ovRevenueMonth(y, m);
      const exp = ovExpenseMonth(y, m);
      // For forward months, use last complete month data as fallback
      const fwdRev = fwd && rev === 0 ? ovRevenueMonth(lastY, lastM) : rev;
      const fwdExp = fwd && exp === 0 ? ovExpenseMonth(lastY, lastM) : exp;
      const useRev = fwd ? fwdRev : rev;
      const useExp = fwd ? fwdExp : exp;

      if (!fwd && useRev === 0 && useExp === 0) continue;  // empty months

      const label = m === 1 ? `${shortMonths[m-1]} ${String(y).slice(-2)}` : shortMonths[m-1];
      labels.push(label);
      fullLabels.push(`${shortMonths[m-1]} ${y}`);
      revData.push(useRev);
      expData.push(useExp);
      opIncomeData.push(useRev - useExp);
      marginData.push(useRev > 0 ? ((useRev - useExp) / useRev) * 100 : 0);
      projectedFlags.push(fwd);
    }
  });

  return { labels, fullLabels, revData, expData, opIncomeData, marginData, projectedFlags };
}

function renderOvChart() {
  const canvas = document.getElementById('ovChart');
  if (!canvas) return;
  destroyChart('overview');

  const { labels, fullLabels, revData, expData, opIncomeData, marginData, projectedFlags } = getOvChartData();

  const REV_COLOR = '#1e2d3d';
  const EXP_COLOR = '#a8a49e';
  const OI_COLOR = '#2d6a4f';  // muted green
  const MARGIN_COLOR = '#1a1a18';  // near-black

  function withAlpha(hex, alpha) {
    if (hex.startsWith('rgba')) {
      return hex.replace(/[\d.]+\)$/, alpha + ')');
    }
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // Create diagonal stripe pattern for projected bars (matches table .projected-cell style)
  function createStripePattern(baseColor, alpha) {
    const patCanvas = document.createElement('canvas');
    patCanvas.width = 8;
    patCanvas.height = 8;
    const pctx = patCanvas.getContext('2d');
    pctx.fillStyle = withAlpha(baseColor, alpha);
    pctx.fillRect(0, 0, 8, 8);
    pctx.strokeStyle = 'rgba(255,255,255,0.35)';
    pctx.lineWidth = 1.5;
    pctx.beginPath();
    pctx.moveTo(-1, 9); pctx.lineTo(9, -1);
    pctx.moveTo(-1, 1); pctx.lineTo(1, -1);
    pctx.moveTo(7, 9); pctx.lineTo(9, 7);
    pctx.stroke();
    return canvas.getContext('2d').createPattern(patCanvas, 'repeat');
  }

  // Per-bar colors: stripe pattern for projected months
  const hasProj = projectedFlags && projectedFlags.some(p => p);
  function perBarColors(baseColor, alphaActual, alphaProjected) {
    if (!hasProj) return typeof alphaActual === 'number' ? withAlpha(baseColor, alphaActual) : baseColor;
    const solidColor = typeof alphaActual === 'number' ? withAlpha(baseColor, alphaActual) : baseColor;
    const stripe = createStripePattern(baseColor, alphaProjected);
    return projectedFlags.map(p => p ? stripe : solidColor);
  }

  // Build datasets conditionally
  const datasets = [];
  if (ovState.series.revenue) {
    datasets.push({
      type: 'bar', label: 'Revenue', data: revData,
      backgroundColor: perBarColors(REV_COLOR, 1, 0.55),
      borderColor: hasProj ? projectedFlags.map(p => p ? withAlpha(REV_COLOR, 0.4) : 'transparent') : 'transparent',
      borderWidth: hasProj ? projectedFlags.map(p => p ? 1 : 0) : 0,
      borderDash: [3, 3],
      borderRadius: 3,
      barPercentage: 0.7, categoryPercentage: 0.7,
      yAxisID: 'y', order: 2
    });
  }
  if (ovState.series.expenses) {
    datasets.push({
      type: 'bar', label: 'Expenses', data: expData,
      backgroundColor: perBarColors('rgba(168,164,158,1)', 0.6, 0.4),
      borderColor: hasProj ? projectedFlags.map(p => p ? 'rgba(168,164,158,0.5)' : 'transparent') : 'transparent',
      borderWidth: hasProj ? projectedFlags.map(p => p ? 1 : 0) : 0,
      borderDash: [3, 3],
      borderRadius: 3,
      barPercentage: 0.7, categoryPercentage: 0.7,
      yAxisID: 'y', order: 2
    });
  }
  if (ovState.series.opIncome) {
    datasets.push({
      type: 'bar', label: 'Operating income', data: opIncomeData,
      backgroundColor: perBarColors(OI_COLOR, 1, 0.55),
      borderColor: hasProj ? projectedFlags.map(p => p ? withAlpha(OI_COLOR, 0.4) : 'transparent') : 'transparent',
      borderWidth: hasProj ? projectedFlags.map(p => p ? 1 : 0) : 0,
      borderDash: [3, 3],
      borderRadius: 3,
      barPercentage: 0.7, categoryPercentage: 0.7,
      yAxisID: 'y', order: 2
    });
  }
  if (ovState.series.margin) {
    // Dashed line segment for projected portion
    const projSegment = hasProj
      ? { borderDash: (ctx) => projectedFlags[ctx.p1DataIndex] ? [4, 4] : [] }
      : undefined;
    datasets.push({
      type: 'line', label: 'Operating margin', data: marginData,
      borderColor: MARGIN_COLOR, backgroundColor: MARGIN_COLOR,
      borderWidth: 2,
      pointRadius: hasProj ? projectedFlags.map(p => p ? 2 : 3) : 3,
      pointHoverRadius: 5,
      pointBackgroundColor: hasProj
        ? projectedFlags.map(p => p ? withAlpha(MARGIN_COLOR, 0.4) : MARGIN_COLOR) : MARGIN_COLOR,
      pointStyle: hasProj ? projectedFlags.map(p => p ? 'rectRot' : 'circle') : 'circle',
      tension: 0.32,
      yAxisID: 'y1', order: 1,
      segment: projSegment
    });
  }

  // Build scales conditionally
  const scales = {
    x: {
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: { font: { family: 'Jost', size: 10 }, color: '#a8a49e', maxRotation: 0, autoSkip: true, autoSkipPadding: 10 }
    }
  };
  // y-axis (USD): show when any dollar series is visible
  const anyUsd = ovState.series.revenue || ovState.series.expenses || ovState.series.opIncome;
  if (anyUsd) {
    scales.y = {
      position: 'left',
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        font: { family: 'Jost', size: 10 },
        color: '#a8a49e',
        callback: v => '$' + (v >= 1000 ? Math.round(v/1000) + 'k' : v)
      }
    };
  }
  // y1 only if margin is visible
  if (ovState.series.margin) {
    scales.y1 = {
      position: 'right',
      grid: { display: false },
      ticks: {
        font: { family: 'Jost', size: 10 },
        color: MARGIN_COLOR,
        callback: v => v.toFixed(0) + '%'
      },
      min: 0,
      max: 100
    };
  }
  // If margin is the ONLY series, move it to the left axis with full grid (cleaner)
  if (ovState.series.margin && !anyUsd) {
    datasets[0].yAxisID = 'y';
    delete scales.y1;
    scales.y = {
      position: 'left',
      grid: { color: 'rgba(0,0,0,0.04)' },
      ticks: {
        font: { family: 'Jost', size: 10 },
        color: MARGIN_COLOR,
        callback: v => v.toFixed(0) + '%'
      },
      min: 0,
      max: 100
    };
  }

  const instance = new Chart(canvas, {
    type: 'bar',
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
            usePointStyle: false
          }
        },
        tooltip: {
          backgroundColor: '#1a1a18',
          titleFont: { family: 'Jost', size: 11 },
          bodyFont: { family: 'Jost', size: 12, weight: '500' },
          padding: 10,
          callbacks: {
            title: (items) => items.length ? (fullLabels[items[0].dataIndex] || items[0].label) : '',
            label: (c) => {
              if (c.dataset.label === 'Operating margin') {
                return `${c.dataset.label}: ${c.parsed.y.toFixed(1)}%`;
              }
              return `${c.dataset.label}: $${Math.round(c.parsed.y).toLocaleString()}`;
            }
          }
        }
      },
      scales
    }
  });
  storeChart('overview', instance);
}

// ═══════════════ Supporting data table ═══════════════
function renderOvTable() {
  const head = document.getElementById('ovTableHead');
  const body = document.getElementById('ovTableBody');
  if (!head || !body) return;

  const YEARS_OV = [2022, 2023, 2024, 2025, 2026];
  const MONTH_NAMES_OV = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ─── Per-cell helpers ───
  // Year totals are computed by summing 12 months to stay consistent with monthly columns
  function sumYear(monthFn, y) {
    let s = 0;
    for (let m = 1; m <= 12; m++) s += monthFn(y, m);
    return s;
  }
  function cellRev(y, m) { return m ? ovRevenueMonth(y, m) : sumYear(ovRevenueMonth, y); }
  function cellOffice(y, m) { return m ? expTotalMonth(y, m) : sumYear(expTotalMonth, y); }
  function cellPayroll(y, m) { return m ? ovPayrollUsdMonth(y, m) : sumYear(ovPayrollUsdMonth, y); }
  function cellTotalExp(y, m) { return cellOffice(y, m) + cellPayroll(y, m); }
  function cellOI(y, m) { return cellRev(y, m) - cellTotalExp(y, m); }
  function cellMargin(y, m) {
    const r = cellRev(y, m);
    return r > 0 ? (cellOI(y, m) / r) * 100 : null;
  }
  function cellYoY(y, m) {
    const cur = cellOI(y, m);
    const prev = cellOI(y - 1, m);
    if (!prev || prev === 0) return null;
    return ((cur - prev) / Math.abs(prev)) * 100;
  }

  // Grand totals across the 5 years
  function grandRev() { return YEARS_OV.reduce((s, y) => s + cellRev(y, null), 0); }
  function grandOffice() { return YEARS_OV.reduce((s, y) => s + cellOffice(y, null), 0); }
  function grandPayroll() { return YEARS_OV.reduce((s, y) => s + cellPayroll(y, null), 0); }
  function grandTotalExp() { return grandOffice() + grandPayroll(); }
  function grandOI() { return grandRev() - grandTotalExp(); }
  function grandMargin() { return grandRev() > 0 ? (grandOI() / grandRev()) * 100 : null; }

  // ─── Formatters (local to table, not the shared utils versions) ───
  function fmtUsd(v) {
    if (!v || v === 0) return '<span style="color:var(--t3);">\u2014</span>';
    return '$' + Math.round(v).toLocaleString();
  }
  function fmtUsdNeg(v) {
    if (!v || v === 0) return '<span style="color:var(--t3);">\u2014</span>';
    return v < 0 ? '-$' + Math.round(Math.abs(v)).toLocaleString() : '$' + Math.round(v).toLocaleString();
  }
  function fmtPctLocal(v) {
    if (v === null || isNaN(v)) return '<span style="color:var(--t3);">\u2014</span>';
    return v.toFixed(1) + '%';
  }
  function fmtYoyLocal(v) {
    if (v === null || isNaN(v)) return '<span style="color:var(--t3);">\u2014</span>';
    const arrow = v >= 0 ? '\u25b2' : '\u25bc';
    return `${arrow} ${v.toFixed(1)}%`;
  }

  // ─── Header (2 rows when any year is expanded) ───
  const anyOpen = YEARS_OV.some(y => ovState.yearsOpen.has(y));
  const rs = anyOpen ? ' rowspan="2"' : '';

  let row1 = '<tr>';
  row1 += `<th class="sticky-col" style="width:32px;"${rs}></th>`;
  row1 += `<th class="sticky-col-2"${rs} style="text-align:left;">Metric</th>`;

  YEARS_OV.forEach(y => {
    const open = ovState.yearsOpen.has(y);
    if (open) {
      row1 += `<th class="year-th year-divider-left" colspan="13" onclick="window._toggleOvYear(${y})">
        <span class="year-chev open">\u25b8</span>${y}
      </th>`;
    } else {
      row1 += `<th class="year-th" onclick="window._toggleOvYear(${y})"${rs}>
        <span class="year-chev">\u25b8</span>${y}
      </th>`;
    }
  });
  row1 += `<th class="grand-total-th num"${rs}>Total</th>`;
  row1 += '</tr>';

  let row2 = '';
  if (anyOpen) {
    row2 = '<tr>';
    YEARS_OV.forEach(y => {
      if (ovState.yearsOpen.has(y)) {
        MONTH_NAMES_OV.forEach((mn, i) => {
          const cls = i === 0 ? 'month-th num year-divider-left' : 'month-th num';
          row2 += `<th class="${cls}">${mn}</th>`;
        });
        row2 += `<th class="year-total-cell num">${y} Total</th>`;
      }
    });
    row2 += '</tr>';
  }

  head.innerHTML = row1 + row2;

  // ─── Helper: render a metric row across all year columns ───
  function renderMetricRow(rowClass, label, valueFn, grandFn, formatter, cellStyler) {
    let html = `<tr class="${rowClass}">`;
    html += '<td class="sticky-col"></td>';
    html += `<td class="sticky-col-2">${label}</td>`;

    YEARS_OV.forEach(y => {
      if (ovState.yearsOpen.has(y)) {
        for (let m = 1; m <= 12; m++) {
          const v = valueFn(y, m);
          const cls = cellStyler ? cellStyler(v) : '';
          html += `<td class="num ${cls}">${formatter(v)}</td>`;
        }
        const yv = valueFn(y, null);
        const ycls = cellStyler ? cellStyler(yv) : '';
        html += `<td class="year-total-cell num ${ycls}">${formatter(yv)}</td>`;
      } else {
        const yv = valueFn(y, null);
        const ycls = cellStyler ? cellStyler(yv) : '';
        html += `<td class="num ${ycls}">${formatter(yv)}</td>`;
      }
    });

    // Grand total
    const gv = grandFn ? grandFn() : null;
    const gcls = (grandFn && cellStyler) ? cellStyler(gv) : '';
    if (grandFn) {
      html += `<td class="grand-total-cell num display-num ${gcls}">${formatter(gv)}</td>`;
    } else {
      html += '<td class="grand-total-cell"></td>';
    }
    html += '</tr>';
    return html;
  }

  let bodyHtml = '';

  // Revenue
  bodyHtml += renderMetricRow('total-row', '<span style="font-weight:600;">Revenue</span>', cellRev, grandRev, fmtUsd, null);

  // Office + Payroll (hidden when collapsed)
  if (!ovState.expensesCollapsed) {
    bodyHtml += renderMetricRow('acct-row ov-exp-detail',
      '<span style="color:var(--t2); padding-left:16px; display:inline-block;">Office expenses</span>',
      cellOffice, grandOffice, fmtUsd, () => 'ov-muted-cell');
    bodyHtml += renderMetricRow('acct-row ov-exp-detail',
      '<span style="color:var(--t2); padding-left:16px; display:inline-block;">Payroll</span>',
      cellPayroll, grandPayroll, fmtUsd, () => 'ov-muted-cell');
  }

  // Total expenses (clickable)
  const chev = ovState.expensesCollapsed ? '\u25b8' : '\u25be';
  const collapseHint = ovState.expensesCollapsed ? 'Show breakdown' : 'Hide breakdown';
  const totalExpLabel = `<span style="font-weight:600; cursor:pointer; user-select:none;" onclick="window._toggleOvExpenses()" title="${collapseHint}"><span class="ov-exp-chev">${chev}</span> Total expenses</span>`;
  bodyHtml += renderMetricRow('total-row', totalExpLabel, cellTotalExp, grandTotalExp, fmtUsd, null);

  // Operating income
  bodyHtml += renderMetricRow('total-row ov-oi-row',
    '<span style="font-weight:600;">Operating income</span>',
    cellOI, grandOI, fmtUsdNeg, (v) => v < 0 ? 'ov-neg' : '');

  // YoY %
  bodyHtml += renderMetricRow('yoy-row', 'YoY %', cellYoY, null, fmtYoyLocal,
    (v) => v === null ? 'yoy-na' : v >= 0 ? 'yoy-pos' : 'yoy-neg');

  // Operating margin % (gold-colored label)
  bodyHtml += renderMetricRow('margin-row',
    '<span style="color:var(--gold); font-weight:600;">Operating margin %</span>',
    cellMargin, grandMargin, fmtPctLocal,
    (v) => v === null ? '' : v >= 50 ? 'margin-good' : v >= 0 ? 'margin-ok' : 'margin-bad');

  body.innerHTML = bodyHtml;
}

// ═══════════════ Public API ═══════════════
export function renderOverview() {
  renderOvKpis();
  renderOvChart();
  renderOvTable();
}

export async function loadOverviewPage() {
  // Overview depends on all three data sources — load them if not already loaded
  const { loadRevenuePage } = await import('./revenue.js');
  const { loadPayrollPage } = await import('./payroll.js');
  const { loadOfficePage } = await import('./office.js');

  await Promise.all([
    loadRevenuePage(),
    loadPayrollPage(),
    loadOfficePage(),
  ]);

  renderOverview();
}

// ═══════════════ Window bindings for onclick handlers ═══════════════
window._toggleOvSeries = toggleOvSeries;
window._toggleOvYear = toggleOvYear;
window._expandAllOvYears = expandAllOvYears;
window._collapseAllOvYears = collapseAllOvYears;
window._toggleOvExpenses = toggleOvExpenses;
window._setOvGranularity = setOvGranularity;
window._setOvChartRange = setOvChartRange;
