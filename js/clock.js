import { supabase } from './supabase-client.js';

// ── NYSE HOLIDAYS 2025–2030 ───────────────────────────────
const HOLIDAYS = new Set([
  '2025-01-01','2025-01-20','2025-02-17','2025-04-18',
  '2025-05-26','2025-06-19','2025-07-04','2025-09-01',
  '2025-11-28','2025-12-25',
  '2026-01-01','2026-01-19','2026-02-16','2026-04-03',
  '2026-05-25','2026-06-19','2026-07-03','2026-09-07',
  '2026-11-27','2026-12-25',
  '2027-01-01','2027-01-18','2027-02-15','2027-03-26',
  '2027-05-31','2027-06-18','2027-07-05','2027-09-06',
  '2027-11-26','2027-12-24',
  '2027-12-31','2028-01-17','2028-02-21','2028-04-14',
  '2028-05-29','2028-06-19','2028-07-04','2028-09-04',
  '2028-11-24','2028-12-25',
  '2029-01-01','2029-01-15','2029-02-19','2029-03-30',
  '2029-05-28','2029-06-19','2029-07-04','2029-09-03',
  '2029-11-23','2029-12-25',
  '2030-01-01','2030-01-21','2030-02-18','2030-04-19',
  '2030-05-27','2030-06-19','2030-07-04','2030-09-02',
  '2030-11-22','2030-12-25',
]);

const HOLIDAY_NAMES = {
  "2025-01-01":"New Year's Day","2025-01-20":"MLK Day","2025-02-17":"Presidents Day",
  "2025-04-18":"Good Friday","2025-05-26":"Memorial Day","2025-06-19":"Juneteenth",
  "2025-07-04":"Independence Day","2025-09-01":"Labor Day","2025-11-28":"Thanksgiving",
  "2025-12-25":"Christmas",
  "2026-01-01":"New Year's Day","2026-01-19":"MLK Day","2026-02-16":"Presidents Day",
  "2026-04-03":"Good Friday","2026-05-25":"Memorial Day","2026-06-19":"Juneteenth",
  "2026-07-03":"Independence Day","2026-09-07":"Labor Day","2026-11-27":"Thanksgiving",
  "2026-12-25":"Christmas",
  "2027-01-01":"New Year's Day","2027-01-18":"MLK Day","2027-02-15":"Presidents Day",
  "2027-03-26":"Good Friday","2027-05-31":"Memorial Day","2027-06-18":"Juneteenth",
  "2027-07-05":"Independence Day","2027-09-06":"Labor Day","2027-11-26":"Thanksgiving",
  "2027-12-24":"Christmas",
  "2027-12-31":"New Year's Day (obs)","2028-01-17":"MLK Day","2028-02-21":"Presidents Day",
  "2028-04-14":"Good Friday","2028-05-29":"Memorial Day","2028-06-19":"Juneteenth",
  "2028-07-04":"Independence Day","2028-09-04":"Labor Day","2028-11-24":"Thanksgiving",
  "2028-12-25":"Christmas",
  "2029-01-01":"New Year's Day","2029-01-15":"MLK Day","2029-02-19":"Presidents Day",
  "2029-03-30":"Good Friday","2029-05-28":"Memorial Day","2029-06-19":"Juneteenth",
  "2029-07-04":"Independence Day","2029-09-03":"Labor Day","2029-11-23":"Thanksgiving",
  "2029-12-25":"Christmas",
  "2030-01-01":"New Year's Day","2030-01-21":"MLK Day","2030-02-18":"Presidents Day",
  "2030-04-19":"Good Friday","2030-05-27":"Memorial Day","2030-06-19":"Juneteenth",
  "2030-07-04":"Independence Day","2030-09-02":"Labor Day","2030-11-22":"Thanksgiving",
  "2030-12-25":"Christmas",
};

const DEFAULT_COLORS = {
  'Santiago Carranza':'#3b5bdb','Oscar Cordova':'#099268',
  'Santiago Alvarez':'#e67700','Deborah Posternak':'#c2255c',
  'Pablo Valles':'#7048e8','Frank Rojas':'#c92a2a',
  'Maria Jose Romo':'#a61e4d','Daniel Garibay':'#0c8599',
  'Luis Catan':'#6741d9','Hector Miranda':'#2f9e44',
  'Daniel Alvarez':'#d9480f',
};
const COLOR_PALETTE = ['#3b5bdb','#099268','#e67700','#c2255c','#7048e8','#0c8599','#6741d9','#2f9e44','#d9480f','#a61e4d','#1971c2','#5c7a2d'];

// ── SUPABASE STATE ────────────────────────────────────────
let clkEmployees = {};  // { id: { name, color, is_active } }
let clkNameToId = {};   // { name: id }

// ── V3 DATA STATE ─────────────────────────────────────────
let RAW = [];           // flat records array (v3 format)
let COLORS = {};        // { name: hex }
let activeStatus = {};  // { name: bool }

// ── OTHER V3 STATE ────────────────────────────────────────
let selectedEmp = null;
let selectedMonth = 'ytd';
let activeMetric = 'all';
let activeTab = 'clock';
let CLEAN = {};

// ── SUPABASE LOADING ──────────────────────────────────────
async function loadFromSupabase() {
  const { data: emps, error: empErr } = await supabase
    .from('clock_employees')
    .select('*')
    .order('display_order');
  if (empErr) throw empErr;

  clkEmployees = {};
  clkNameToId = {};
  emps.forEach(e => {
    clkEmployees[e.id] = { name: e.name, color: e.color, is_active: e.is_active };
    clkNameToId[e.name] = e.id;
  });

  const { data: recs, error: recErr } = await supabase
    .from('clock_records')
    .select('*, clock_employees!inner(name)')
    .order('date', { ascending: true });
  if (recErr) throw recErr;

  RAW = recs.map(r => ({
    employee: r.clock_employees.name,
    employee_id: r.employee_id,
    date: r.date,
    day: r.day,
    time_in: r.time_in || '',
    time_out: r.time_out || '',
    work_hours: parseFloat(r.work_hours) || 0,
    missing_out: r.missing_out || false,
  }));
}

async function ensureEmployee(name, color) {
  if (clkNameToId[name]) return clkNameToId[name];
  const empColor = color || DEFAULT_COLORS[name] || COLOR_PALETTE[Object.keys(clkNameToId).length % COLOR_PALETTE.length];
  const { data, error } = await supabase
    .from('clock_employees')
    .upsert({ name, color: empColor, is_active: true }, { onConflict: 'name' })
    .select()
    .single();
  if (error) throw error;
  clkEmployees[data.id] = { name: data.name, color: data.color, is_active: data.is_active };
  clkNameToId[data.name] = data.id;
  COLORS[data.name] = data.color;
  activeStatus[data.name] = true;
  return data.id;
}

// ── BRIDGE ────────────────────────────────────────────────
function bridgeToV3() {
  COLORS = {};
  activeStatus = {};
  Object.values(clkEmployees).forEach(e => {
    COLORS[e.name] = e.color || DEFAULT_COLORS[e.name] || '#888';
    activeStatus[e.name] = e.is_active !== false;
  });
}

// ── HELPERS ───────────────────────────────────────────────
function getAllEmployees() {
  const fromRaw = [...new Set(RAW.map(r => r.employee))];
  const fromDB = Object.values(clkEmployees).map(e => e.name);
  return [...new Set([...fromDB, ...fromRaw])].sort();
}

function getNextColor() {
  const used = new Set(Object.values(COLORS));
  return COLOR_PALETTE.find(c => !used.has(c)) || COLOR_PALETTE[Object.keys(COLORS).length % COLOR_PALETTE.length];
}

// ── PARAMS ────────────────────────────────────────────────
function getParams() {
  const entryStr = document.getElementById('p_entry')?.value || '07:00';
  const [eh, em] = entryStr.split(':').map(Number);
  const entryMin = (eh||7)*60 + (em||0);
  const tol = parseInt(document.getElementById('p_tol')?.value)||15;
  const minHrs = parseFloat(document.getElementById('p_minhrs')?.value)||8;
  return { entryMin, tol, minHrs, lateMin: entryMin+tol, vLateMin: entryMin+60 };
}

// ── TIME HELPERS ──────────────────────────────────────────
function parseMin(t) {
  if (!t) return null;
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h=+m[1], mn=+m[2], per=m[3].toUpperCase();
  if (per==='PM'&&h!==12) h+=12;
  if (per==='AM'&&h===12) h=0;
  return h*60+mn;
}
function minToStr(m) {
  if (m===null||m===undefined) return '—';
  const rounded = Math.round(m);
  const h=Math.floor(rounded/60), mn=rounded%60;
  const per=h>=12?'PM':'AM', hh=h%12||(12);
  return `${hh}:${String(mn).padStart(2,'0')} ${per}`;
}

// ── DATA CLEANING ─────────────────────────────────────────
function cleanRecord(r) {
  const tiMin = parseMin(r.time_in);
  const toMin = parseMin(r.time_out);
  const inIsOUT = tiMin !== null && tiMin >= 720;
  const cleanIn = inIsOUT ? '' : r.time_in;
  const cleanInMin = inIsOUT ? null : tiMin;
  const mout = !inIsOUT && r.time_in !== '' && (r.time_out === '' || toMin === null) && r.work_hours < 0.1;
  return { ...r, time_in: cleanIn, time_in_min: cleanInMin, time_out: r.time_out, work_hours: r.work_hours, missing_out: mout };
}

function mergeDay(recs) {
  if (recs.length === 1) return cleanRecord(recs[0]);
  const cleaned = recs.map(cleanRecord);
  const withIn = cleaned.filter(r => r.time_in_min !== null);
  const withOut = cleaned.filter(r => r.time_out !== '');
  const bestIn = withIn.length ? withIn.reduce((a,b) => a.time_in_min < b.time_in_min ? a : b) : null;
  const bestOut = withOut.length ? withOut.reduce((a,b) => {
    const am = parseMin(a.time_out), bm = parseMin(b.time_out);
    return (am||0) > (bm||0) ? a : b;
  }) : null;
  const base = cleaned[0];
  const ti = bestIn ? bestIn.time_in : '';
  const to = bestOut ? bestOut.time_out : '';
  const wh = Math.max(...cleaned.map(r=>r.work_hours));
  const mout = ti !== '' && (to === '' || parseMin(to) === null) && wh < 0.1;
  return { ...base, time_in: ti, time_in_min: bestIn?.time_in_min ?? null, time_out: to, work_hours: wh, missing_out: mout };
}

function buildClean() {
  CLEAN = {};
  const grouped = {};
  for (const r of RAW) {
    if (!grouped[r.employee]) grouped[r.employee] = {};
    if (!grouped[r.employee][r.date]) grouped[r.employee][r.date] = [];
    grouped[r.employee][r.date].push(r);
  }
  for (const [emp, days] of Object.entries(grouped)) {
    CLEAN[emp] = {};
    for (const [date, recs] of Object.entries(days)) {
      CLEAN[emp][date] = mergeDay(recs);
    }
  }
}

// ── FILTER ────────────────────────────────────────────────
function getMonths() {
  const s = new Set(RAW.map(r=>r.date.slice(0,7)));
  return [...s].sort();
}

function filterRecords(emp) {
  const days = Object.values(CLEAN[emp]||{});
  if (selectedMonth==='ytd') {
    const now = new Date();
    const cutoff = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return days.filter(r => r.date.slice(0,7) <= cutoff && r.date.startsWith(String(now.getFullYear())));
  }
  if (selectedMonth==='all') return days;
  if (/^\d{4}$/.test(selectedMonth)) return days.filter(r => r.date.startsWith(selectedMonth));
  return days.filter(r => r.date.startsWith(selectedMonth));
}

// ── STATS ─────────────────────────────────────────────────
function calcStats(days) {
  const p = getParams();
  const workdays = days.filter(r=>!HOLIDAYS.has(r.date) && !r._isHoliday);
  const total = workdays.length;
  const present = workdays.filter(r => r.time_in !== '').length;
  const absent  = workdays.filter(r => r.time_in === '' && !r.missing_out).length;
  const mout    = workdays.filter(r => r.missing_out).length;
  const hours   = workdays.reduce((s,r)=>s+r.work_hours,0);
  const arrivals = workdays.filter(r=>r.time_in_min!==null&&r.time_in_min<720);
  const ontime  = arrivals.filter(r=>r.time_in_min<=p.lateMin).length;
  const late    = arrivals.filter(r=>r.time_in_min>p.lateMin&&r.time_in_min<=p.vLateMin).length;
  const vlate   = arrivals.filter(r=>r.time_in_min>p.vLateMin).length;
  const avgArr  = arrivals.length ? arrivals.reduce((s,r)=>s+r.time_in_min,0)/arrivals.length : null;
  const avgHrs  = present>0 ? hours/present : 0;
  const attPct  = total>0 ? (present/total*100) : 0;
  const ontimePct = arrivals.length>0 ? (ontime/arrivals.length*100) : 0;
  return {total,present,absent,mout,hours,arrivals:arrivals.length,ontime,late,vlate,avgArr,avgHrs,attPct,ontimePct};
}

function dayStatus(r) {
  const p = getParams();
  if (r._isHoliday || HOLIDAYS.has(r.date)) return 'holiday';
  if (r.time_in==='') return r.missing_out ? 'mout' : 'absent';
  if (r.missing_out) return 'mout';
  if (r.time_in_min===null) return 'present';
  if (r.time_in_min <= p.lateMin) return 'ontime';
  if (r.time_in_min <= p.vLateMin) return 'late';
  return 'vlate';
}

// ── MONTH FILTERS ─────────────────────────────────────────
function getAvailableYears() {
  return [...new Set(getMonths().map(m => m.slice(0,4)))].sort().reverse();
}

function renderMonthFilters() {
  const container = document.getElementById('monthFilters');
  if (!container) return;
  const years = getAvailableYears();
  let activeYear = null;
  if (selectedMonth !== 'ytd' && selectedMonth !== 'all') {
    activeYear = selectedMonth.slice(0,4);
  } else if (selectedMonth === 'ytd') {
    activeYear = 'ytd';
  }

  let row1 = `<button class="mf-btn ${selectedMonth==='all'?'active':''}" onclick="selectYear('all')">All</button>`;
  row1 += `<button class="mf-btn ${activeYear==='ytd'?'active':''}" onclick="selectYear('ytd')">YTD</button>`;
  years.forEach(y => {
    const isActive = activeYear === y && selectedMonth !== 'ytd';
    row1 += `<button class="mf-btn ${isActive?'active':''}" onclick="selectYear('${y}')">${y}</button>`;
  });

  let row2 = '';
  if (activeYear && activeYear !== 'ytd' && selectedMonth !== 'all') {
    const yearMonths = getMonths().filter(m => m.startsWith(activeYear));
    const SHORT = {'01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'};
    const allYearActive = selectedMonth === activeYear;
    row2 += `<button class="mf-btn ${allYearActive?'active':''}" style="opacity:.7" onclick="selectMonth('${activeYear}')">All</button>`;
    yearMonths.forEach(m => {
      const mo = m.slice(5,7);
      row2 += `<button class="mf-btn ${selectedMonth===m?'active':''}" onclick="selectMonth('${m}')">${SHORT[mo]}</button>`;
    });
  }

  container.innerHTML = `
    <div style="display:flex;gap:2px;align-items:center;">${row1}</div>
    ${row2 ? `<div class="mf-divider-v"></div><div style="display:flex;gap:2px;align-items:center;">${row2}</div>` : ''}
  `;
}

function selectYear(y) {
  selectedMonth = (y === 'all') ? 'all' : (y === 'ytd') ? 'ytd' : y;
  renderMonthFilters();
  renderAll();
}

function selectMonth(m) {
  selectedMonth = m;
  renderMonthFilters();
  renderAll();
}

// ── RENDER ALL ────────────────────────────────────────────
function renderAll() {
  renderTable();
  if (selectedEmp) renderDetail(selectedEmp);
}

// ── TAB SWITCHING ──────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.getElementById('section-clock').classList.toggle('active', tab === 'clock');
  document.getElementById('section-calendar').classList.toggle('active', tab === 'calendar');
  document.getElementById('tab-clock').classList.toggle('active', tab === 'clock');
  document.getElementById('tab-calendar').classList.toggle('active', tab === 'calendar');
  const filterBar = document.getElementById('clkFilterBar');
  if (filterBar) filterBar.style.display = tab === 'clock' ? '' : 'none';
  if (tab === 'calendar') renderBdayAll();
}

// ── EMPLOYEE TABLE ─────────────────────────────────────────
const mpill = (v, cls) => v ? `<span class="pill ${cls}">${v}</span>` : '<span style="color:var(--tx3);font-size:11px;">0</span>';

const METRIC_DEFS = {
  all: {
    cols: '1fr 90px 80px 100px 80px 80px 90px',
    headers: ['Employee', 'Attendance', 'On Time', 'Avg Arrival', 'Avg Hours', 'Absences', 'Missing OUT'],
    row: (e, s) => `
      <div class="emp-name">${e}</div>
      <div class="cell">${s ? s.attPct.toFixed(0)+'%' : '—'}</div>
      <div class="cell">${s && s.arrivals>0 ? s.ontimePct.toFixed(0)+'%' : '—'}</div>
      <div class="cell mono">${s ? minToStr(s.avgArr) : '—'}</div>
      <div class="cell">${s && s.avgHrs>0 ? s.avgHrs.toFixed(1)+'h' : '—'}</div>
      <div class="cell">${s ? mpill(s.absent>0?s.absent+'d':null,'pill-grey') : '—'}</div>
      <div class="cell">${s ? mpill(s.mout>0?s.mout:null,'pill-purple') : '—'}</div>`
  },
  attendance: {
    cols: '1fr 140px',
    headers: ['Employee', 'Attendance'],
    row: (e, s) => `
      <div class="emp-name">${e}</div>
      <div class="cell" style="font-size:15px;font-weight:600;color:var(--tx)">${s ? s.attPct.toFixed(0)+'%' : '—'}</div>`
  },
  arrival: {
    cols: '1fr 140px',
    headers: ['Employee', 'Avg Arrival'],
    row: (e, s) => `
      <div class="emp-name">${e}</div>
      <div class="cell mono" style="font-size:15px;font-weight:600;color:var(--tx)">${s ? minToStr(s.avgArr) : '—'}</div>`
  },
  missing: {
    cols: '1fr 120px 120px',
    headers: ['Employee', 'Absences', 'Missing OUT'],
    row: (e, s) => `
      <div class="emp-name">${e}</div>
      <div class="cell">${s ? mpill(s.absent>0?s.absent+'d':null,'pill-grey') : '—'}</div>
      <div class="cell">${s ? mpill(s.mout>0?s.mout:null,'pill-purple') : '—'}</div>`
  }
};

function setMetric(metric, el) {
  activeMetric = metric;
  document.querySelectorAll('.metric-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderTable();
}

function renderTable() {
  const all = getAllEmployees();
  const active = all.filter(e=>activeStatus[e]);
  const inactive = all.filter(e=>!activeStatus[e]);
  const body = document.getElementById('empTableBody');
  const header = document.getElementById('empTableHeader');
  const def = METRIC_DEFS[activeMetric];

  if (header) {
    header.style.gridTemplateColumns = def.cols;
    header.innerHTML = def.headers.map(h=>`<div class="th">${h}</div>`).join('');
  }

  let html = '';
  active.forEach(e=>{
    const days = filterRecords(e);
    const s = days.length ? calcStats(days) : null;
    const isSelected = selectedEmp===e;
    html += `<div class="emp-row-wrap" id="wrap_${e.replace(/ /g,'_')}">
      <div class="emp-row ${isSelected?'selected':''}" style="grid-template-columns:${def.cols}" onclick="toggleDetail('${e}')">
        ${def.row(e, s)}
      </div>
      <div class="detail-panel ${isSelected?'open':''}" id="detail_${e.replace(/ /g,'_')}"></div>
    </div>`;
  });

  if (body) body.innerHTML = html || '<div class="empty">No data for this period.</div>';

  const toggleRow = document.getElementById('toggleRow');
  if (toggleRow) {
    if (inactive.length > 0) {
      toggleRow.style.display = 'flex';
      const btn = document.getElementById('toggleRowBtn');
      if (btn) btn.textContent = `${inactive.length} inactive employee${inactive.length>1?'s':''}`;
    } else {
      toggleRow.style.display = 'none';
    }
  }

  if (selectedEmp) renderDetail(selectedEmp);
}

function openInactiveModal() {
  const all = getAllEmployees();
  const inactive = all.filter(e=>!activeStatus[e]);
  const body = document.getElementById('inactiveModalBody');
  if (!body) return;
  if (!inactive.length) {
    body.innerHTML = '<div style="padding:24px;text-align:center;font-size:12px;color:var(--tx3)">No inactive employees.</div>';
  } else {
    body.innerHTML = inactive.map(e => {
      const days = filterRecords(e);
      const s = days.length ? calcStats(days) : null;
      const col = COLORS[e]||'#888';
      return `<div class="manage-emp-item">
        <div style="background:${col};width:8px;height:8px;border-radius:50%;flex-shrink:0"></div>
        <div style="flex:1">
          <div class="manage-emp-name">${e}</div>
          <div class="manage-emp-status">${s ? `Att. ${s.attPct.toFixed(0)}% · ${s.absent}d absent` : 'No data'}</div>
        </div>
        <button class="manage-emp-toggle" onclick="toggleEmp('${e}');renderInactiveModal()">Set Active</button>
      </div>`;
    }).join('');
  }
  document.getElementById('inactiveModal').classList.add('open');
}

function renderInactiveModal() { openInactiveModal(); }

async function addManualEmployee() {
  const inp = document.getElementById('newEmpName');
  const name = inp.value.trim();
  if (!name) return;
  if (getAllEmployees().includes(name)) { notify('Employee already exists'); return; }
  const color = getNextColor();
  try {
    await ensureEmployee(name, color);
    inp.value = '';
    renderManageModal();
    renderAll();
    notify(`${name} added`);
  } catch (err) {
    console.error(err);
    notify('Error adding employee');
  }
}

async function removeManualEmployee(name) {
  const hasRecords = RAW.some(r => r.employee === name);
  if (hasRecords) {
    notify('Has records — use Active/Inactive toggle instead');
    return;
  }
  if (!confirm(`Remove ${name}?`)) return;
  const id = clkNameToId[name];
  if (id) {
    const { error } = await supabase.from('clock_employees').delete().eq('id', id);
    if (error) { notify('Error removing employee'); return; }
    delete clkEmployees[id];
    delete clkNameToId[name];
  }
  delete activeStatus[name];
  delete COLORS[name];
  renderManageModal();
  renderAll();
  notify(`${name} removed`);
}

function openManageModal() {
  renderManageModal();
  document.getElementById('manageModal').classList.add('open');
}

function renderManageModal() {
  const all = getAllEmployees();
  const fromCsv = new Set(RAW.map(r => r.employee));
  const body = document.getElementById('manageModalBody');
  if (!body) return;
  body.innerHTML = all.map(e => {
    const isActive = !!activeStatus[e];
    const isManualOnly = !fromCsv.has(e);
    return `<div class="manage-emp-item">
      <div style="flex:1">
        <div class="manage-emp-name">${e}</div>
        <div class="manage-emp-status">${isActive ? 'Active' : 'Inactive'}${isManualOnly ? ' · manually added' : ''}</div>
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="manage-emp-toggle ${isActive?'is-active':''}" onclick="toggleEmp('${e}');renderManageModal()">${isActive ? 'Active' : 'Set Active'}</button>
        ${isManualOnly ? `<button class="manage-emp-toggle" style="color:var(--red);border-color:var(--red)" onclick="removeManualEmployee('${e}')">Remove</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function toggleEmp(name) {
  activeStatus[name] = !activeStatus[name];
  if (!activeStatus[name] && selectedEmp===name) selectedEmp=null;
  const id = clkNameToId[name];
  if (id) {
    supabase.from('clock_employees').update({ is_active: activeStatus[name] }).eq('id', id).then(({ error }) => {
      if (error) console.error('Failed to update active status:', error);
      else if (clkEmployees[id]) clkEmployees[id].is_active = activeStatus[name];
    });
  }
  renderAll();
}

// ── DETAIL PANEL ──────────────────────────────────────────
function toggleDetail(emp) {
  if (selectedEmp===emp) { selectedEmp = null; renderTable(); return; }
  selectedEmp = emp;
  renderTable();
}

function renderDetail(emp) {
  const id = `detail_${emp.replace(/ /g,'_')}`;
  const panel = document.getElementById(id);
  if (!panel) return;
  const rawDays = filterRecords(emp);
  const rawDates = new Set(rawDays.map(r=>r.date));
  if (rawDays.length > 0) {
    const minDate = rawDays.reduce((a,b)=>a.date<b.date?a:b).date;
    const maxDate = rawDays.reduce((a,b)=>a.date>b.date?a:b).date;
    HOLIDAYS.forEach(hd=>{
      if (hd >= minDate && hd <= maxDate && !rawDates.has(hd)) {
        const dow = new Date(hd).getDay();
        if (dow>0 && dow<6) {
          rawDays.push({employee:emp,date:hd,day:['SUN','MON','TUE','WED','THU','FRI','SAT'][dow],time_in:'',time_out:'',work_hours:0,missing_in:false,missing_out:false,_isHoliday:true});
        }
      }
    });
  }
  const days = rawDays.sort((a,b)=>b.date.localeCompare(a.date));
  const p = getParams();

  const rows = days.map(r=>{
    const st = dayStatus(r);
    const pill = {
      ontime:`<span class="pill pill-good">On time</span>`,
      late:`<span class="pill pill-warn">Late</span>`,
      vlate:`<span class="pill pill-bad">Very late</span>`,
      absent:`<span class="pill pill-grey">Absent</span>`,
      mout:`<span class="pill pill-purple">Missing OUT</span>`,
      holiday:`<span class="pill" style="background:var(--slatel);color:var(--slate);">${HOLIDAY_NAMES[r.date]||'NYSE Holiday'}</span>`,
      present:`<span class="pill pill-good">Present</span>`,
    }[st]||'';
    const tiStr = r.time_in || '—';
    const toStr = r.time_out || '—';
    const hrsStr = r.work_hours>0.05 ? r.work_hours.toFixed(1)+'h' : '—';
    let lateBy = '';
    if (r.time_in_min!==null && r.time_in_min>p.lateMin && r.time_in_min<720) {
      const diff = r.time_in_min - p.entryMin;
      lateBy = `<span style="color:${diff>60?'var(--red)':'var(--amber)'};font-size:10px;">+${diff}min</span>`;
    }
    const editable = !r._isHoliday;
    return `<tr ${editable?`onclick="openRecordEdit('${emp}','${r.date}')" title="Click to edit"`:'style="cursor:default"'}>
      <td class="mono">${r.date}</td>
      <td style="color:var(--tx3);font-size:10px;">${r.day}</td>
      <td class="mono">${tiStr} ${lateBy}</td>
      <td class="mono">${toStr}</td>
      <td class="mono">${hrsStr}</td>
      <td>${pill}</td>
    </tr>`;
  }).join('');

  const s = calcStats(days);
  panel.innerHTML = `
    <div class="detail-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="detail-name">${emp}</span>
        <span style="font-size:10px;color:var(--tx3);">${s.present} days present · ${s.absent} absent · ${s.mout} missing OUT · avg ${minToStr(s.avgArr)} · ${s.avgHrs.toFixed(1)}h/day</span>
      </div>
      <button class="detail-close" onclick="toggleDetail('${emp}')">Close</button>
    </div>
    <div class="legend">
      <div class="leg-item"><div class="leg-dot" style="background:var(--ontime-bg);border:1px solid var(--ontime);"></div>On time</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--late-bg);border:1px solid var(--late);"></div>Late (&lt;1h)</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--vlate-bg);border:1px solid var(--vlate);"></div>Very late (&gt;1h)</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--absent-bg);border:1px solid #9ca3af;"></div>Absent</div>
      <div class="leg-item"><div class="leg-dot" style="background:var(--mout-bg);border:1px solid var(--mout);"></div>Missing OUT</div>
    </div>
    <table class="log-table">
      <thead><tr><th>Date</th><th>Day</th><th>IN</th><th>OUT</th><th>Hours</th><th>Status</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:20px;">No records for this period.</td></tr>'}</tbody>
    </table>`;
}

// ── RECORD EDITING ─────────────────────────────────────────
let editingEmp = null, editingDate = null;

function openRecordEdit(emp, date) {
  editingEmp = emp;
  editingDate = date;
  const rec = RAW.find(r => r.employee === emp && r.date === date);
  document.getElementById('editRecTitle').textContent = emp;
  document.getElementById('editRecSub').textContent = date;
  document.getElementById('editRecIn').value  = rec ? (rec.time_in  || '') : '';
  document.getElementById('editRecOut').value = rec ? (rec.time_out || '') : '';
  document.getElementById('editRecModal').classList.add('open');
}

async function saveRecordEdit() {
  const timeIn  = document.getElementById('editRecIn').value.trim();
  const timeOut = document.getElementById('editRecOut').value.trim();
  const rec = RAW.find(r => r.employee === editingEmp && r.date === editingDate);
  if (rec) {
    rec.time_in  = timeIn;
    rec.time_out = timeOut;
    if (timeIn && timeOut) {
      const toMin = t => {
        const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
        if (!m) return null;
        let h = parseInt(m[1]), mn = parseInt(m[2]);
        const ampm = (m[3]||'').toUpperCase();
        if (ampm === 'PM' && h !== 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        return h * 60 + mn;
      };
      const inM = toMin(timeIn), outM = toMin(timeOut);
      if (inM !== null && outM !== null && outM > inM) rec.work_hours = (outM - inM) / 60;
    }
    rec.missing_out = !!(timeIn && !timeOut);

    const empId = clkNameToId[editingEmp];
    if (empId) {
      supabase.from('clock_records').update({
        time_in: timeIn,
        time_out: timeOut,
        work_hours: rec.work_hours,
        missing_out: rec.missing_out,
      }).eq('employee_id', empId).eq('date', editingDate).then(({ error }) => {
        if (error) console.error('Failed to save record edit:', error);
      });
    }
  }
  document.getElementById('editRecModal').classList.remove('open');
  buildClean();
  renderAll();
  if (editingEmp) renderDetail(editingEmp);
  notify('Record updated');
}

// ── FILE HISTORY ───────────────────────────────────────────
const HIST_KEY = 'summit_csv_history';
const HIST_MAX = 20;

function loadCSVHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); }
  catch { return []; }
}

function saveCSVToHistory(filename, records, rawCSV) {
  const history = loadCSVHistory();
  const dates = records.map(r=>r.date).sort();
  const employees = [...new Set(records.map(r=>r.employee))].sort();
  const entry = {
    id: Date.now(), filename,
    uploadedAt: new Date().toISOString(),
    recordsAdded: records.filter(r=>r.isNew).length,
    totalRecords: records.length,
    employees,
    dateFrom: dates[0] || '',
    dateTo: dates[dates.length-1] || '',
    rawCSV,
  };
  history.unshift(entry);
  if (history.length > HIST_MAX) history.length = HIST_MAX;
  localStorage.setItem(HIST_KEY, JSON.stringify(history));
}

function openHistoryModal() {
  renderHistoryModal();
  document.getElementById('histModal').classList.add('open');
}

function renderHistoryModal() {
  const history = loadCSVHistory();
  const body = document.getElementById('histModalBody');
  if (!body) return;
  if (!history.length) {
    body.innerHTML = '<div class="hist-empty">No files uploaded yet. Import a CSV to get started.</div>';
    return;
  }
  body.innerHTML = '<div class="hist-list">' + history.map(entry => {
    const dt = new Date(entry.uploadedAt);
    const dateStr = dt.toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'});
    const timeStr = dt.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
    const range = entry.dateFrom && entry.dateTo ? `${entry.dateFrom} → ${entry.dateTo}` : 'unknown range';
    const empList = entry.employees.slice(0,3).join(', ') + (entry.employees.length > 3 ? ` +${entry.employees.length-3}` : '');
    return `<div class="hist-item" onclick="viewHistoryFile(${entry.id})">
      <div class="hist-icon" title="Download CSV">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12L3 7h3V1h4v6h3L8 12zM2 13h12v2H2v-2z"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div class="hist-name">${entry.filename}</div>
        <div class="hist-meta">${dateStr} at ${timeStr} · ${range}</div>
        <div class="hist-meta" style="margin-top:1px">${empList}</div>
      </div>
      <span class="hist-badge">+${entry.recordsAdded} records</span>
      <button class="hist-del" title="Remove from history" onclick="deleteHistoryFile(event, ${entry.id})">✕</button>
    </div>`;
  }).join('') + '</div>';
}

function viewHistoryFile(id) {
  const entry = loadCSVHistory().find(e => e.id === id);
  if (!entry || !entry.rawCSV) return;
  const blob = new Blob([entry.rawCSV], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = entry.filename; a.click();
  URL.revokeObjectURL(url);
}

function deleteHistoryFile(e, id) {
  e.stopPropagation();
  const history = loadCSVHistory().filter(en => en.id !== id);
  localStorage.setItem(HIST_KEY, JSON.stringify(history));
  renderHistoryModal();
}

// ── CSV UPLOAD & PREVIEW ────────────────────────────────────
let pendingCSVRecords = [];
let pendingCSVFile = '';
let pendingRawCSV = '';

function parseCSVRecords(text) {
  const existing = new Set(RAW.map(r=>`${r.employee}|${r.date}`));
  const parsed = []; let cur = null;
  for (const line of text.split('\n')) {
    const parts = line.split(',').map(s=>s.trim());
    if (parts[0]==='Employee') {
      const m=(parts[3]||'').match(/(.+)\s+\(\d+\)/);
      if(m) cur=m[1].trim();
    } else if (['MON','TUE','WED','THU','FRI'].includes(parts[0])&&cur) {
      try {
        const [mo,dy,yr]=parts[1].split('/');
        if (!yr) continue;
        const ds=`${yr}-${mo.padStart(2,'0')}-${dy.padStart(2,'0')}`;
        const key=`${cur}|${ds}`;
        const ti=parts[2]||'', to=parts[3]||'', note=parts[6]||'';
        let wh=0; try{wh=parseFloat(parts[4])||0;}catch(e){}
        const mout=note.includes('Missing OUT')||(ti!==''&&to===''&&wh<0.1);
        parsed.push({employee:cur,date:ds,day:parts[0],time_in:ti,time_out:to,work_hours:wh,missing_in:false,missing_out:mout,isNew:!existing.has(key)});
      } catch(ex){}
    }
  }
  return parsed;
}

function previewCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    const rawCSV = e.target.result;
    const records = parseCSVRecords(rawCSV);
    pendingCSVRecords = records;
    pendingCSVFile = file.name;
    pendingRawCSV = rawCSV;
    showPreviewModal(records, file.name);
  };
  reader.readAsText(file);
}

function showPreviewModal(records, filename) {
  const newRecs = records.filter(r=>r.isNew);
  const dupRecs = records.filter(r=>!r.isNew);
  const byEmp = {};
  records.forEach(r=>{ if (!byEmp[r.employee]) byEmp[r.employee]=[]; byEmp[r.employee].push(r); });
  const dates = records.map(r=>r.date).sort();
  const period = dates.length ? `${dates[0]} → ${dates[dates.length-1]}` : '';
  document.getElementById('modalTitle').textContent = `Preview · ${filename}`;
  let body = `<div class="preview-label">Period: ${period}</div>`;
  Object.entries(byEmp).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([emp, recs])=>{
    const empNew = recs.filter(r=>r.isNew);
    const empDup = recs.filter(r=>!r.isNew);
    const col = COLORS[emp]||'#888';
    body += `<div class="preview-emp-block">
      <div class="preview-emp-name">
        <div style="width:7px;height:7px;border-radius:50%;background:${col};flex-shrink:0;"></div>
        ${emp}
        ${empNew.length ? `<span class="preview-badge preview-new">+${empNew.length} new</span>` : ''}
        ${empDup.length ? `<span class="preview-badge preview-dup">${empDup.length} already exist</span>` : ''}
      </div>
      <div class="preview-rows">`;
    const toShow = empNew.slice(0,6);
    toShow.forEach(r=>{
      const ti = r.time_in||'—', to=r.time_out||'—';
      const wh = r.work_hours>0.05?r.work_hours.toFixed(1)+'h':'—';
      const flag = r.missing_out?' ⚠ missing OUT':'';
      body += `<div class="preview-row-new">+ ${r.date} ${r.day}  IN:${ti}  OUT:${to}  ${wh}${flag}</div>`;
    });
    if (empNew.length > 6) body += `<div style="color:var(--tx3);font-size:10px;">  … and ${empNew.length-6} more new records</div>`;
    if (empDup.length > 0) body += `<div style="color:var(--tx3);font-size:10px;">(${empDup.length} duplicate records will be skipped)</div>`;
    body += `</div></div>`;
  });
  document.getElementById('modalBody').innerHTML = body;
  document.getElementById('modalSummary').textContent = `${newRecs.length} new records · ${dupRecs.length} duplicates skipped`;
  document.getElementById('csvModal').classList.add('open');
}

function closeModal() {
  document.getElementById('csvModal').classList.remove('open');
  pendingCSVRecords = [];
}

async function confirmUpload() {
  const newRecs = pendingCSVRecords.filter(r=>r.isNew);
  if (!newRecs.length) { closeModal(); return; }

  const empNames = [...new Set(newRecs.map(r=>r.employee))];
  const empIds = {};
  for (const name of empNames) {
    empIds[name] = await ensureEmployee(name);
  }

  const rows = newRecs.map(r => ({
    employee_id: empIds[r.employee],
    date: r.date,
    day: r.day,
    time_in: r.time_in,
    time_out: r.time_out,
    work_hours: r.work_hours,
    missing_out: r.missing_out,
    source: 'csv',
  }));

  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('clock_records')
      .upsert(batch, { onConflict: 'employee_id,date' });
    if (error) {
      console.error('Clock upload error:', error);
      notify('Error uploading records');
      closeModal();
      return;
    }
    added += batch.length;
  }

  newRecs.forEach(r => {
    RAW.push({
      employee: r.employee,
      employee_id: empIds[r.employee],
      date: r.date,
      day: r.day,
      time_in: r.time_in,
      time_out: r.time_out,
      work_hours: r.work_hours,
      missing_out: r.missing_out,
    });
    if (!activeStatus.hasOwnProperty(r.employee)) activeStatus[r.employee] = true;
  });

  saveCSVToHistory(pendingCSVFile, pendingCSVRecords, pendingRawCSV);
  closeModal();
  buildClean();
  renderMonthFilters();
  renderAll();
  notify(`Imported ${added} records from ${pendingCSVFile}`);
}

// ── NOTIFY ────────────────────────────────────────────────
function notify(msg) {
  const el=document.getElementById('notif');
  if (!el) return;
  el.textContent=msg; el.style.display='block';
  setTimeout(()=>el.style.display='none',2500);
}

// ── BIRTHDAY CALENDAR ──────────────────────────────────────
const BDAY_TODAY = new Date();
BDAY_TODAY.setHours(0,0,0,0);
let bdayCalY = BDAY_TODAY.getFullYear();
let bdayCalM = BDAY_TODAY.getMonth();
let bdayFilter = 'all';
let bdayCalView = 'month';
let bdayTblView = 'birthdays';
let bdayPage = 0;
const BDAY_PAGE_SIZE = 10;

let BDAYS = [
  {name:'Alberto Doniga Lara',dob:'1985-04-23',type:'Inversionista'},
  {name:'Alejandra Barrios Gomez',dob:'1962-04-19',type:'Inversionista'},
  {name:'Alejandro Espinosa Rivera',dob:'1999-09-24',type:'Inversionista'},
  {name:'Ana Maria Lopez',dob:'1970-07-29',type:'Inversionista'},
  {name:'Andres Ollivier',dob:'1995-01-09',type:'Inversionista'},
  {name:'Celine Boutier',dob:'1993-11-10',type:'Inversionista'},
  {name:'Christopher Freimund',dob:'1992-10-01',type:'Inversionista'},
  {name:'Daniel Tobon Camelo',dob:'1985-01-26',type:'Inversionista'},
  {name:'Daniel Uruñuela Lopez',dob:'1992-10-20',type:'Inversionista'},
  {name:'Daniel Álvarez',dob:'2002-12-01',type:'Empleado'},
  {name:'Daniela Rivera-Torres',dob:'1991-04-03',type:'Inversionista'},
  {name:'Deborah Posternak',dob:'2002-08-15',type:'Empleado'},
  {name:'Diego Vargas Rivero',dob:'1983-04-29',type:'Inversionista'},
  {name:'Eduardo Torres Marcellan',dob:'1986-03-07',type:'Inversionista'},
  {name:'Erick Nasser Nehme',dob:'1989-04-04',type:'Inversionista'},
  {name:'Ernesto Vargas Guajardo',dob:'1955-08-20',type:'Inversionista'},
  {name:'Esteban P Gonzalez Beckmann',dob:'2000-05-19',type:'Inversionista'},
  {name:'Gabino Fraga Jesterhoudt',dob:'1996-11-16',type:'Inversionista'},
  {name:'Gazi Nacif Borge',dob:'1944-12-28',type:'Inversionista'},
  {name:'Gerardo Nasser Nehme',dob:'1986-04-23',type:'Inversionista'},
  {name:'Griselda O Cadiz Salazar',dob:'1955-02-13',type:'Inversionista'},
  {name:'Guillermo Manzur Juan',dob:'1982-07-19',type:'Inversionista'},
  {name:'Horacio Morales Reyes',dob:'1974-07-19',type:'Inversionista'},
  {name:'Héctor Miranda',dob:'2000-09-03',type:'Empleado'},
  {name:'Jacobo Levy Chayo',dob:'1969-09-25',type:'Inversionista'},
  {name:'Javier Amescua Lopez',dob:'1996-08-10',type:'Inversionista'},
  {name:'Jorge Alberto Lopez Perera',dob:'1965-05-14',type:'Inversionista'},
  {name:'Jose Antonio Juan Chelala',dob:'2002-08-15',type:'Inversionista'},
  {name:'Jose Antonio Manzur Juan',dob:'1994-05-19',type:'Inversionista'},
  {name:'Jose Patricio Manzur Juan',dob:'1993-01-10',type:'Inversionista'},
  {name:'Juan Pablo Alverde Gonzalez',dob:'1982-04-02',type:'Inversionista'},
  {name:'Luis Catan',dob:'1995-06-06',type:'Empleado'},
  {name:"Luis Rodrigo Martinez O'Cadiz",dob:'1983-08-25',type:'Inversionista'},
  {name:'Marco Antonio Fraiha Haddad',dob:'1971-03-31',type:'Inversionista'},
  {name:'Maria Fernanda Lira Solis',dob:'1995-04-07',type:'Inversionista'},
  {name:'Maria Gabriela Lopez Butron',dob:'1993-11-09',type:'Inversionista'},
  {name:'Mariana Rivera-Torres',dob:'1993-08-23',type:'Inversionista'},
  {name:'Miguel Angel Osorio',dob:'1996-06-15',type:'Inversionista'},
  {name:'Miguel Ángel Gonzalez',dob:'1991-10-17',type:'Inversionista'},
  {name:'Mimoun Cadosch',dob:'1991-07-05',type:'Inversionista'},
  {name:'Neto Vargas',dob:'1981-03-10',type:'Inversionista'},
  {name:'Octavio Zavala',dob:'1994-04-07',type:'Inversionista'},
  {name:'Oliver Brett',dob:'1990-11-14',type:'Inversionista'},
  {name:'Pablo Valles',dob:'1996-08-05',type:'Empleado'},
  {name:'Robegrill Group LLC',dob:'1968-07-10',type:'Inversionista'},
  {name:'Santiago Alvarez Bringas',dob:'1998-10-07',type:'Empleado'},
  {name:'Santiago Bernardo Tobon Salazar',dob:'1987-09-05',type:'Inversionista'},
  {name:'Santiago Carranza',dob:'1992-05-19',type:'Empleado'},
  {name:'Óscar Córdova',dob:'1988-05-04',type:'Empleado'},
];

function bdayDaysUntil(dob) {
  const d = new Date(dob + 'T00:00:00');
  const next = new Date(BDAY_TODAY.getFullYear(), d.getMonth(), d.getDate());
  if (next < BDAY_TODAY) next.setFullYear(BDAY_TODAY.getFullYear() + 1);
  return Math.round((next - BDAY_TODAY) / 864e5);
}
function bdayAge(dob) {
  const d = new Date(dob + 'T00:00:00');
  const n = new Date(BDAY_TODAY.getFullYear(), d.getMonth(), d.getDate());
  return BDAY_TODAY.getFullYear() - d.getFullYear() - (BDAY_TODAY < n ? 1 : 0);
}
function bdayInitials(name) {
  return name.split(' ').slice(0,2).map(x=>x[0]||'').join('').toUpperCase();
}
function bdayFmtDate(dob) {
  const d = new Date(dob + 'T00:00:00');
  return d.toLocaleDateString('en-US', {month:'long', day:'numeric'});
}
function filteredBdays() {
  if (bdayFilter === 'all') return BDAYS;
  return BDAYS.filter(b => b.type === bdayFilter);
}

function renderBdayUpcoming() {
  const list = BDAYS
    .map(b => ({...b, days: bdayDaysUntil(b.dob)}))
    .filter(b => b.days <= 30)
    .sort((a,b) => a.days - b.days);
  const el = document.getElementById('bdayUpcomingList');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = '<div class="bday-empty">No birthdays in the next 30 days</div>';
    return;
  }
  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  el.innerHTML = list.map(b => {
    const ini = bdayInitials(b.name);
    const avCls = b.type === 'Empleado' ? 'bday-av-emp' : 'bday-av-inv';
    const d = new Date(b.dob + 'T00:00:00');
    const fd = MN[d.getMonth()] + ' ' + d.getDate();
    const isToday = b.days === 0;
    const isSoon = b.days <= 3;
    const rowCls = isToday ? 'today-row' : '';
    const badgeCls = isToday ? 'bday-badge-today' : isSoon ? 'bday-badge-soon' : 'bday-badge-normal';
    const badgeTxt = isToday ? '🎂 Today!' : b.days === 1 ? 'Tomorrow' : b.days + 'd';
    const typeLbl = b.type === 'Empleado' ? 'Employee' : 'Investor';
    return `<div class="bday-upcoming-item ${rowCls}">
      <div class="bday-av ${avCls}">${ini}</div>
      <div style="flex:1;min-width:0">
        <div class="bday-name">${b.name}</div>
        <div class="bday-date-lbl">${fd} · ${typeLbl}</div>
      </div>
      <div class="bday-days-badge ${badgeCls}">${badgeTxt}</div>
    </div>`;
  }).join('');
}

function renderBdayCalendar() {
  if (bdayCalView === 'month') renderBdayMonthView();
  else renderBdayYearView();
}

function renderBdayMonthView() {
  const MN_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const lbl = document.getElementById('bdayMonthLbl');
  const grid = document.getElementById('bdayGrid');
  if (!lbl || !grid) return;
  lbl.textContent = MN_LONG[bdayCalM] + ' ' + bdayCalY;

  const first = new Date(bdayCalY, bdayCalM, 1).getDay();
  const dim   = new Date(bdayCalY, bdayCalM + 1, 0).getDate();
  const prevDim = new Date(bdayCalY, bdayCalM, 0).getDate();
  const todayStr = BDAY_TODAY.toISOString().slice(0,10);
  const mm = String(bdayCalM + 1).padStart(2,'0');

  const dayMap = {};
  filteredBdays().forEach(b => {
    const d = new Date(b.dob + 'T00:00:00');
    if (d.getMonth() === bdayCalM) {
      const day = d.getDate();
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(b);
    }
  });

  let html = '';
  for (let i = 0; i < first; i++) {
    html += `<div class="bday-cell other-month"><div class="bday-num">${prevDim - first + 1 + i}</div></div>`;
  }
  for (let d = 1; d <= dim; d++) {
    const dd = String(d).padStart(2,'0');
    const dateStr = `${bdayCalY}-${mm}-${dd}`;
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    const isToday   = dateStr === todayStr;
    const isHoliday = HOLIDAYS.has(dateStr);
    const isWeekend = dow === 0 || dow === 6;
    const bds = dayMap[d] || [];
    const hasBday = bds.length > 0;
    let cls = 'bday-cell';
    if (isToday)   cls += ' today-cell';
    if (isHoliday) cls += ' is-holiday';
    if (isWeekend) cls += ' is-weekend';
    if (hasBday)   cls += ' has-bday';
    const dotsHtml = bds.map(b =>
      `<div class="bday-dot ${b.type==='Empleado'?'bday-dot-emp':'bday-dot-inv'}" title="${b.name}"></div>`
    ).join('');
    const holidayName = isHoliday ? (HOLIDAY_NAMES[dateStr] || 'NYSE Holiday') : '';
    const shortHol = holidayName.replace("'s Day","").replace(" Day","").replace("Independence","Indep.").replace("Thanksgiving","Thanks.");
    html += `<div class="${cls}" ${hasBday?`onclick="showBdayPopover(event,${d})"`:''}}>
      <div class="bday-num">${d}</div>
      ${hasBday ? `<div class="bday-dots">${dotsHtml}</div>` : ''}
      ${isHoliday ? `<div class="bday-holiday-lbl" title="${holidayName}">${shortHol}</div>` : ''}
    </div>`;
  }
  const trailing = (7 - ((first + dim) % 7)) % 7;
  for (let i = 1; i <= trailing; i++) {
    html += `<div class="bday-cell other-month"><div class="bday-num">${i}</div></div>`;
  }
  grid.innerHTML = html;
}

function renderBdayYearView() {
  const lbl = document.getElementById('bdayYearLbl');
  const grid = document.getElementById('bdayAnnualGrid');
  if (!lbl || !grid) return;
  lbl.textContent = bdayCalY;
  const MN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const todayStr = BDAY_TODAY.toISOString().slice(0,10);
  const bdayDates = new Set();
  filteredBdays().forEach(b => {
    const d = new Date(b.dob + 'T00:00:00');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    bdayDates.add(`${bdayCalY}-${mm}-${dd}`);
  });

  let html = '';
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(bdayCalY, m, 1).getDay();
    const daysInMonth = new Date(bdayCalY, m + 1, 0).getDate();
    const mm = String(m + 1).padStart(2,'0');
    let mHtml = `<div class="mini-cal"><div class="mini-cal-title">${MN[m]}</div><div class="mini-cal-grid">`;
    mHtml += 'SMTWTFS'.split('').map(c=>`<div class="mini-dow">${c}</div>`).join('');
    for (let i = 0; i < firstDay; i++) mHtml += `<div class="mini-day other-month"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dd2 = String(d).padStart(2,'0');
      const dateStr = `${bdayCalY}-${mm}-${dd2}`;
      const dow = new Date(dateStr + 'T00:00:00').getDay();
      const isToday   = dateStr === todayStr;
      const isHoliday = HOLIDAYS.has(dateStr);
      const isWeekend = dow === 0 || dow === 6;
      const hasBday   = bdayDates.has(dateStr);
      let cls = 'mini-day';
      if (isToday)        cls += ' today';
      else if (isHoliday) cls += ' holiday';
      else if (isWeekend) cls += ' weekend';
      if (hasBday && !isToday) cls += ' has-bday-dot';
      const tip = isHoliday ? ` title="${HOLIDAY_NAMES[dateStr]||'NYSE Holiday'}"` : '';
      mHtml += `<div class="${cls}"${tip}>${d}</div>`;
    }
    const trailing = (7 - ((firstDay + daysInMonth) % 7)) % 7;
    for (let i = 0; i < trailing; i++) mHtml += `<div class="mini-day other-month"></div>`;
    mHtml += `</div></div>`;
    html += mHtml;
  }
  grid.innerHTML = html;
}

function showBdayPopover(e, day) {
  const pop = document.getElementById('bdayPopover');
  const bds = filteredBdays().filter(b => {
    const d = new Date(b.dob + 'T00:00:00');
    return d.getMonth() === bdayCalM && d.getDate() === day;
  });
  if (!bds.length) { pop.classList.remove('open'); return; }
  const MN_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  pop.innerHTML = `<div class="bday-pop-date">${MN_SHORT[bdayCalM]} ${day}, ${bdayCalY}</div>` +
    bds.map(b => `<div class="bday-pop-item">
      <div class="bday-av ${b.type==='Empleado'?'bday-av-emp':'bday-av-inv'}" style="width:26px;height:26px;font-size:10px">${bdayInitials(b.name)}</div>
      <div><div class="bday-pop-name">${b.name}</div><div class="bday-pop-type">${b.type==='Empleado'?'Employee':'Investor'} · turns ${bdayAge(b.dob)}</div></div>
    </div>`).join('');
  const rect = e.currentTarget.getBoundingClientRect();
  pop.style.left = Math.min(rect.left + rect.width / 2, window.innerWidth - 260) + 'px';
  pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';
  pop.classList.add('open');
  e.stopPropagation();
}

function renderBdayTable() {
  if (bdayTblView === 'birthdays') renderBdayBirthdays();
  else renderBdayHolidays();
}

function renderBdayBirthdays() {
  const q = (document.getElementById('bdaySearch')?.value || '').toLowerCase();
  let rows = filteredBdays()
    .map(b => ({...b, days: bdayDaysUntil(b.dob), age: bdayAge(b.dob)}))
    .filter(b => !q || b.name.toLowerCase().includes(q))
    .sort((a,b) => a.days - b.days);

  const total = rows.length;
  const totalPages = Math.ceil(total / BDAY_PAGE_SIZE) || 1;
  if (bdayPage >= totalPages) bdayPage = 0;
  const slice = rows.slice(bdayPage * BDAY_PAGE_SIZE, (bdayPage + 1) * BDAY_PAGE_SIZE);

  const countEl = document.getElementById('bdayTblCount');
  if (countEl) countEl.textContent = total + ' people';
  renderBdayPagination(total, totalPages);

  const bodyEl = document.getElementById('bdayTblBody');
  if (!bodyEl) return;
  bodyEl.innerHTML = slice.map(b => {
    const fd = bdayFmtDate(b.dob);
    const isToday = b.days === 0;
    const isSoon  = b.days <= 7;
    let badgeBg, badgeColor;
    if (isToday)     { badgeBg='var(--vlate-bg)'; badgeColor='var(--vlate)'; }
    else if (isSoon) { badgeBg='var(--late-bg)'; badgeColor='var(--late)'; }
    else             { badgeBg='var(--s2)'; badgeColor='var(--tx3)'; }
    const badgeTxt = isToday ? '🎂 Today!' : b.days + ' days';
    const typeBadge = b.type === 'Empleado'
      ? `<span style="display:inline-flex;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;background:var(--late-bg);color:var(--late)">Employee</span>`
      : `<span style="display:inline-flex;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;background:#dbeafe;color:#1d4ed8">Investor</span>`;
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="bday-av ${b.type==='Empleado'?'bday-av-emp':'bday-av-inv'}" style="width:26px;height:26px;font-size:9px;flex-shrink:0">${bdayInitials(b.name)}</div>
          <span style="font-weight:500">${b.name}</span>
        </div>
      </td>
      <td>${typeBadge}</td>
      <td style="color:var(--tx2)">${fd}</td>
      <td style="color:var(--tx3)">${b.age} yrs</td>
      <td><span style="display:inline-flex;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;background:${badgeBg};color:${badgeColor}">${badgeTxt}</span></td>
      <td><button class="bday-rm-btn" onclick="removeBday('${b.name.replace(/'/g,"\\'")}')">✕</button></td>
    </tr>`;
  }).join('');
}

function renderBdayHolidays() {
  const todayStr = BDAY_TODAY.toISOString().slice(0,10);
  const dates = [...HOLIDAYS].sort();
  const total = dates.length;
  const totalPages = Math.ceil(total / BDAY_PAGE_SIZE) || 1;
  if (bdayPage >= totalPages) bdayPage = 0;
  const slice = dates.slice(bdayPage * BDAY_PAGE_SIZE, (bdayPage + 1) * BDAY_PAGE_SIZE);

  const countEl = document.getElementById('bdayTblCount');
  if (countEl) countEl.textContent = total + ' holidays';
  renderBdayPagination(total, totalPages);

  const bodyEl = document.getElementById('bdayHolBody');
  if (!bodyEl) return;
  const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  bodyEl.innerHTML = slice.map(d => {
    const dow = new Date(d + 'T00:00:00').getDay();
    const name = HOLIDAY_NAMES[d] || 'NYSE Holiday';
    const fmt = new Date(d + 'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
    let pill;
    if (d < todayStr)       pill = `<span style="display:inline-flex;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;background:var(--s2);color:var(--tx3)">Past</span>`;
    else if (d === todayStr) pill = `<span style="display:inline-flex;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;background:var(--late-bg);color:var(--late)">Today</span>`;
    else                    pill = `<span style="display:inline-flex;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;background:var(--ontime-bg);color:var(--ontime)">Upcoming</span>`;
    return `<tr>
      <td style="color:var(--tx2)">${fmt}</td>
      <td style="color:var(--tx3)">${DAY_NAMES[dow]}</td>
      <td style="font-weight:500">${name}</td>
      <td>${pill}</td>
    </tr>`;
  }).join('');
}

function renderBdayPagination(total, totalPages) {
  const info = document.getElementById('bdayPageInfo');
  const prev = document.getElementById('bdayPrevBtn');
  const next = document.getElementById('bdayNextBtn');
  if (!info) return;
  const from = total ? bdayPage * BDAY_PAGE_SIZE + 1 : 0;
  const to   = Math.min((bdayPage + 1) * BDAY_PAGE_SIZE, total);
  info.textContent = total ? `${from}–${to} of ${total}` : '0';
  if (prev) prev.disabled = bdayPage === 0;
  if (next) next.disabled = bdayPage >= totalPages - 1;
}

function setCalView(view) {
  bdayCalView = view;
  document.getElementById('vtoggleMonth').classList.toggle('active', view === 'month');
  document.getElementById('vtoggleYear').classList.toggle('active', view === 'year');
  document.getElementById('bdayMonthView').style.display    = view === 'month' ? '' : 'none';
  document.getElementById('bdayYearView').style.display     = view === 'year'  ? '' : 'none';
  document.getElementById('bdayMonthNavWrap').style.display  = view === 'month' ? '' : 'none';
  document.getElementById('bdayYearNavWrap').style.display   = view === 'year'  ? '' : 'none';
  document.getElementById('bdayFilterWrap').style.display    = view === 'month' ? '' : 'none';
  renderBdayCalendar();
}

function setTblView(view, el) {
  bdayTblView = view;
  bdayPage = 0;
  document.querySelectorAll('.bday-tbl-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  const bdayTbl = document.getElementById('bdayBdayTable');
  const holTbl  = document.getElementById('bdayHolidayTable');
  const searchEl = document.getElementById('bdaySearch');
  if (bdayTbl)  bdayTbl.style.display  = view === 'birthdays' ? '' : 'none';
  if (holTbl)   holTbl.style.display   = view === 'holidays'  ? '' : 'none';
  if (searchEl) searchEl.style.display = view === 'birthdays' ? '' : 'none';
  renderBdayTable();
}

function onBdaySearch() { bdayPage = 0; renderBdayBirthdays(); }
function bdayPagePrev() { if (bdayPage > 0) { bdayPage--; renderBdayTable(); } }
function bdayPageNext() {
  const total = bdayTblView === 'birthdays' ? filteredBdays().length : [...HOLIDAYS].length;
  if ((bdayPage + 1) * BDAY_PAGE_SIZE < total) { bdayPage++; renderBdayTable(); }
}
function changeBdayYear(dir) { bdayCalY += dir; renderBdayYearView(); }
function changeBdayMonth(dir) {
  bdayCalM += dir;
  if (bdayCalM > 11) { bdayCalM = 0; bdayCalY++; }
  if (bdayCalM < 0)  { bdayCalM = 11; bdayCalY--; }
  renderBdayMonthView();
}
function setBdayFilter(f, el) {
  bdayFilter = f;
  document.querySelectorAll('.bday-pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  renderBdayCalendar();
  renderBdayUpcoming();
  renderBdayTable();
}
function addBday() {
  const name = document.getElementById('bdayName').value.trim();
  const dob  = document.getElementById('bdayDOB').value;
  const type = document.getElementById('bdayType').value;
  if (!name || !dob) return;
  BDAYS.push({name, dob, type});
  document.getElementById('bdayAddModal').classList.remove('open');
  ['bdayName','bdayDOB','bdayEmail'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  renderBdayAll();
}
function removeBday(name) {
  if (!confirm('Remove ' + name + '?')) return;
  BDAYS = BDAYS.filter(b => b.name !== name);
  renderBdayAll();
}
function renderBdayAll() {
  renderBdayUpcoming();
  renderBdayCalendar();
  renderBdayTable();
}

// ── INIT ──────────────────────────────────────────────────
async function clockInit() {
  try {
    await loadFromSupabase();
    bridgeToV3();
  } catch (err) {
    console.warn('Clock: Supabase load failed', err);
  }

  buildClean();
  renderMonthFilters();
  renderAll();

  // Modal overlay close-on-backdrop-click
  ['editRecModal','inactiveModal','manageModal','histModal','csvModal','bdayAddModal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
    });
  });

  // Close birthday popover on outside click
  document.addEventListener('click', e => {
    const pop = document.getElementById('bdayPopover');
    if (pop && !pop.contains(e.target)) pop.classList.remove('open');
  });
}

// ── EXPORT ────────────────────────────────────────────────
export function loadClockPage() {
  clockInit();
}

// ── WINDOW EXPORTS (for inline onclick handlers) ──────────
window.switchTab = switchTab;
window.selectYear = selectYear;
window.selectMonth = selectMonth;
window.toggleDetail = toggleDetail;
window.toggleEmp = toggleEmp;
window.openManageModal = openManageModal;
window.openInactiveModal = openInactiveModal;
window.renderInactiveModal = renderInactiveModal;
window.renderManageModal = renderManageModal;
window.addManualEmployee = addManualEmployee;
window.removeManualEmployee = removeManualEmployee;
window.previewCSV = previewCSV;
window.closeModal = closeModal;
window.confirmUpload = confirmUpload;
window.saveRecordEdit = saveRecordEdit;
window.openHistoryModal = openHistoryModal;
window.viewHistoryFile = viewHistoryFile;
window.deleteHistoryFile = deleteHistoryFile;
window.setMetric = setMetric;
window.openRecordEdit = openRecordEdit;
window.renderAll = renderAll;
window.changeBdayMonth = changeBdayMonth;
window.changeBdayYear = changeBdayYear;
window.setBdayFilter = setBdayFilter;
window.setCalView = setCalView;
window.setTblView = setTblView;
window.onBdaySearch = onBdaySearch;
window.bdayPagePrev = bdayPagePrev;
window.bdayPageNext = bdayPageNext;
window.addBday = addBday;
window.removeBday = removeBday;
window.showBdayPopover = showBdayPopover;
