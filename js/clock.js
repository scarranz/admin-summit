// Clock module — attendance tracking, CSV upload, employee stats
// Data loaded from Supabase (clock_employees + clock_records)
// Falls back to clock-data.js (global RAW) for seed/migration
import { supabase } from './supabase-client.js';

// ── HOLIDAYS ──────────────────────────────────────────────
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

// ── DEFAULT COLORS (used when creating new employees) ─────
const DEFAULT_COLORS = {
  'Santiago Carranza':'#3b5bdb','Oscar Cordova':'#099268',
  'Santiago Alvarez':'#e67700','Deborah Posternak':'#c2255c',
  'Pablo Valles':'#7048e8','Frank Rojas':'#c92a2a',
  'Maria Jose Romo':'#a61e4d','Daniel Garibay':'#0c8599',
  'Luis Catan':'#6741d9','Hector Miranda':'#2f9e44',
  'Daniel Alvarez':'#d9480f'
};
const PALETTE = ['#3b5bdb','#099268','#e67700','#c2255c','#7048e8','#c92a2a','#0c8599','#6741d9','#2f9e44','#d9480f','#a61e4d'];

// ── STATE ─────────────────────────────────────────────────
let clkEmployees = {};   // { id: { name, color, is_active } }
let clkNameToId = {};    // { name: id }
let clkRecords = [];     // flat array like RAW: { employee, date, day, time_in, time_out, work_hours, missing_out }
let clkSelectedEmp = null;
let clkSelectedMonth = 'ytd';
let clkShowInactive = false;
let clkPendingCSVRecords = [];
let clkPendingCSVFile = '';
let CLEAN = {};

// ── SUPABASE DATA LOADING ─────────────────────────────────
async function loadFromSupabase() {
  // Load employees
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

  // Load records with employee name joined
  const { data: recs, error: recErr } = await supabase
    .from('clock_records')
    .select('*, clock_employees!inner(name)')
    .order('date', { ascending: true });

  if (recErr) throw recErr;

  clkRecords = recs.map(r => ({
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

// Ensure an employee exists in the DB; return their id
async function ensureEmployee(name) {
  if (clkNameToId[name]) return clkNameToId[name];

  const color = DEFAULT_COLORS[name] || PALETTE[Object.keys(clkNameToId).length % PALETTE.length];
  const { data, error } = await supabase
    .from('clock_employees')
    .upsert({ name, color, is_active: true }, { onConflict: 'name' })
    .select()
    .single();

  if (error) throw error;
  clkEmployees[data.id] = { name: data.name, color: data.color, is_active: data.is_active };
  clkNameToId[data.name] = data.id;
  return data.id;
}

// ── HELPERS ───────────────────────────────────────────────
function getColor(empName) {
  const id = clkNameToId[empName];
  return (id && clkEmployees[id]?.color) || DEFAULT_COLORS[empName] || '#888';
}

function isActive(empName) {
  const id = clkNameToId[empName];
  return id ? (clkEmployees[id]?.is_active !== false) : true;
}

// ── PARAMS ────────────────────────────────────────────────
function getParams() {
  const entryStr = document.getElementById('clk_entry')?.value || '07:00';
  const [eh, em] = entryStr.split(':').map(Number);
  const entryMin = (eh||7)*60 + (em||0);
  const tol = parseInt(document.getElementById('clk_tol')?.value)||15;
  const minHrs = parseFloat(document.getElementById('clk_minhrs')?.value)||8;
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
  for (const r of clkRecords) {
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
  const s = new Set(clkRecords.map(r=>r.date.slice(0,7)));
  return [...s].sort();
}

function filterRecords(emp) {
  const days = Object.values(CLEAN[emp]||{});
  if (clkSelectedMonth==='ytd') {
    const now = new Date();
    const cutoff = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    return days.filter(r => r.date.slice(0,7) <= cutoff && r.date.startsWith(String(now.getFullYear())));
  }
  if (clkSelectedMonth==='all') return days;
  if (/^\d{4}$/.test(clkSelectedMonth)) return days.filter(r => r.date.startsWith(clkSelectedMonth));
  return days.filter(r => r.date.startsWith(clkSelectedMonth));
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

// ── INIT ──────────────────────────────────────────────────
async function clockInit() {
  try {
    await loadFromSupabase();
  } catch (err) {
    console.warn('Clock: Supabase load failed, falling back to local data', err);
    // Fallback to global RAW from clock-data.js if tables don't exist yet
    if (typeof RAW !== 'undefined' && RAW.length) {
      clkRecords = RAW.map(r => ({
        employee: r.employee,
        date: r.date,
        day: r.day,
        time_in: r.time_in || '',
        time_out: r.time_out || '',
        work_hours: r.work_hours || 0,
        missing_out: r.missing_out || false,
      }));
      // Build employee map from RAW
      const names = [...new Set(RAW.map(r=>r.employee))].sort();
      names.forEach((name, i) => {
        const fakeId = `local_${i}`;
        clkEmployees[fakeId] = { name, color: DEFAULT_COLORS[name] || PALETTE[i % PALETTE.length], is_active: !['Frank Rojas','Maria Jose Romo'].includes(name) };
        clkNameToId[name] = fakeId;
      });
    }
  }

  buildClean();
  clkRenderMonthFilters();
  clkRenderAll();
}

// ── MONTH FILTERS ─────────────────────────────────────────
function getAvailableYears() {
  return [...new Set(getMonths().map(m => m.slice(0,4)))].sort().reverse();
}

function clkRenderMonthFilters() {
  const container = document.getElementById('clkMonthFilters');
  if (!container) return;
  const years = getAvailableYears();

  let activeYear = null;
  if (clkSelectedMonth !== 'ytd' && clkSelectedMonth !== 'all') {
    activeYear = clkSelectedMonth.slice(0,4);
  } else if (clkSelectedMonth === 'ytd') {
    activeYear = 'ytd';
  }

  let row1 = `<button class="cf-btn ${clkSelectedMonth==='all'?'active':''}" onclick="window._clkSelectYear('all')">All</button>`;
  row1 += `<button class="cf-btn ${activeYear==='ytd'?'active':''}" onclick="window._clkSelectYear('ytd')">YTD</button>`;
  years.forEach(y => {
    const isActive = activeYear === y && clkSelectedMonth !== 'ytd';
    row1 += `<button class="cf-btn ${isActive?'active':''}" onclick="window._clkSelectYear('${y}')">${y}</button>`;
  });

  let row2 = '';
  if (activeYear && activeYear !== 'ytd' && clkSelectedMonth !== 'all') {
    const yearMonths = getMonths().filter(m => m.startsWith(activeYear));
    const SHORT = {'01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec'};
    const allYearActive = clkSelectedMonth === activeYear;
    row2 += `<button class="cf-btn ${allYearActive?'active':''}" onclick="window._clkSelectMonth('${activeYear}')">All</button>`;
    yearMonths.forEach(m => {
      const mo = m.slice(5,7);
      row2 += `<button class="cf-btn ${clkSelectedMonth===m?'active':''}" onclick="window._clkSelectMonth('${m}')">${SHORT[mo]}</button>`;
    });
  }

  container.innerHTML = `
    <div style="display:flex;gap:2px;align-items:center;">${row1}</div>
    ${row2 ? `<div class="cf-divider"></div><div style="display:flex;gap:2px;align-items:center;">${row2}</div>` : ''}
  `;
}

function clkSelectYear(y) {
  if (y === 'all') {
    clkSelectedMonth = clkSelectedMonth === 'all' ? 'ytd' : 'all';
  } else if (y === 'ytd') {
    clkSelectedMonth = 'ytd';
  } else {
    // If clicking the same year that's already active, collapse back to YTD
    const currentYear = clkSelectedMonth.slice(0,4);
    clkSelectedMonth = (currentYear === y) ? 'ytd' : y;
  }
  clkRenderMonthFilters();
  clkRenderAll();
}

function clkSelectMonth(m) {
  clkSelectedMonth = m;
  clkRenderMonthFilters();
  clkRenderAll();
}

// ── RENDER ALL ────────────────────────────────────────────
function clkRenderAll() {
  clkRenderTable();
  clkRenderHoursTable();
  if (clkSelectedEmp) clkRenderDetail(clkSelectedEmp);
}

// ── EMPLOYEE TABLE ────────────────────────────────────────
function clkRenderTable() {
  const all = [...new Set(clkRecords.map(r=>r.employee))].sort();
  const active = all.filter(e=>isActive(e));
  const inactive = all.filter(e=>!isActive(e));
  const body = document.getElementById('clkTableBody');
  if (!body) return;
  let html = '';

  active.forEach(e => {
    const days = filterRecords(e);
    const s = days.length ? calcStats(days) : null;
    const col = getColor(e);
    const isSelected = clkSelectedEmp===e;
    html += `<div class="clock-emp-wrap" id="clkWrap_${e.replace(/ /g,'_')}">
      <div class="clock-emp-row ${isSelected?'selected':''}" onclick="window._clkToggleDetail('${e}')">
        <div class="clock-emp-name"><div class="clock-emp-dot" style="background:${col}"></div>${e}</div>
        <div class="clock-cell">${s ? s.attPct.toFixed(0)+'%' : '<span style="color:var(--t3)">—</span>'}</div>
        <div class="clock-cell">${s && s.arrivals>0 ? s.ontimePct.toFixed(0)+'%' : '—'}</div>
        <div class="clock-cell">${s ? minToStr(s.avgArr) : '—'}</div>
        <div class="clock-cell">${s && s.avgHrs>0 ? s.avgHrs.toFixed(1)+'h' : '—'}</div>
        <div>${s && s.absent>0 ? `<span class="clock-pill clock-pill-grey">${s.absent}d</span>` : (s?'<span style="color:var(--t3);font-size:11px;">0</span>':'—')}</div>
        <div>${s && s.mout>0 ? `<span class="clock-pill clock-pill-purple">${s.mout}</span>` : (s?'<span style="color:var(--t3);font-size:11px;">0</span>':'—')}</div>
      </div>
      <div class="clock-detail ${isSelected?'open':''}" id="clkDetail_${e.replace(/ /g,'_')}"></div>
    </div>`;
  });

  if (inactive.length > 0 && clkShowInactive) {
    inactive.forEach(e => {
      const days = filterRecords(e);
      const s = days.length ? calcStats(days) : null;
      const col = getColor(e);
      html += `<div class="clock-emp-wrap" id="clkWrap_${e.replace(/ /g,'_')}" style="opacity:.45;">
        <div class="clock-emp-row clock-emp-inactive" onclick="window._clkToggleDetail('${e}')">
          <div class="clock-emp-name"><div class="clock-emp-dot" style="background:${col}"></div>${e} <span style="font-size:10px;color:var(--t3);font-weight:400;">inactive</span></div>
          <div class="clock-cell">${s ? s.attPct.toFixed(0)+'%' : '—'}</div>
          <div class="clock-cell">${s && s.arrivals>0 ? s.ontimePct.toFixed(0)+'%' : '—'}</div>
          <div class="clock-cell">${s ? minToStr(s.avgArr) : '—'}</div>
          <div class="clock-cell">${s && s.avgHrs>0 ? s.avgHrs.toFixed(1)+'h' : '—'}</div>
          <div>${s && s.absent>0 ? `<span class="clock-pill clock-pill-grey">${s.absent}d</span>` : (s?'<span style="color:var(--t3);font-size:11px;">0</span>':'—')}</div>
          <div>${s && s.mout>0 ? `<span class="clock-pill clock-pill-purple">${s.mout}</span>` : (s?'<span style="color:var(--t3);font-size:11px;">0</span>':'—')}</div>
        </div>
        <div class="clock-detail ${clkSelectedEmp===e?'open':''}" id="clkDetail_${e.replace(/ /g,'_')}"></div>
      </div>`;
    });
  }

  body.innerHTML = html || '<div class="clock-empty">No data for this period.</div>';

  // Toggle row
  const toggleRow = document.getElementById('clkToggleRow');
  if (toggleRow) {
    if (inactive.length > 0) {
      toggleRow.style.display = 'flex';
      document.getElementById('clkToggleRowBtn').textContent = clkShowInactive
        ? `Hide inactive (${inactive.length})`
        : `Show inactive (${inactive.length})`;
    } else {
      toggleRow.style.display = 'none';
    }
  }

  // Per-employee toggle buttons
  const toggleGroup = document.getElementById('clkToggleGroup');
  if (toggleGroup) {
    toggleGroup.innerHTML = all.map(e=>`
      <button class="clock-emp-toggle ${!isActive(e)?'inactive-t':''}" onclick="window._clkToggleEmp('${e}')">
        <div class="ct-dot" style="background:${getColor(e)}"></div>${e.split(' ')[0]}
      </button>`).join('');
  }

  if (clkSelectedEmp) clkRenderDetail(clkSelectedEmp);
}

async function clkToggleEmp(name) {
  const id = clkNameToId[name];
  if (!id) return;
  const newActive = !isActive(name);
  clkEmployees[id].is_active = newActive;
  if (!newActive && clkSelectedEmp===name) clkSelectedEmp=null;

  // Persist to Supabase (non-blocking for local IDs from fallback)
  if (!id.startsWith('local_')) {
    supabase.from('clock_employees').update({ is_active: newActive }).eq('id', id).then();
  }

  clkRenderAll();
  clkNotify(`${name.split(' ')[0]} ${newActive?'active':'hidden'}`);
}

function clkToggleShowInactive() {
  clkShowInactive = !clkShowInactive;
  clkRenderTable();
}

// ── DETAIL PANEL ──────────────────────────────────────────
function clkToggleDetail(emp) {
  if (clkSelectedEmp===emp) { clkSelectedEmp = null; clkRenderTable(); return; }
  clkSelectedEmp = emp;
  clkRenderTable();
}

function clkRenderDetail(emp) {
  const id = `clkDetail_${emp.replace(/ /g,'_')}`;
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
      ontime:`<span class="clock-pill clock-pill-good">On time</span>`,
      late:`<span class="clock-pill clock-pill-warn">Late</span>`,
      vlate:`<span class="clock-pill clock-pill-bad">Very late</span>`,
      absent:`<span class="clock-pill clock-pill-grey">Absent</span>`,
      mout:`<span class="clock-pill clock-pill-purple">Missing OUT</span>`,
      holiday:`<span class="clock-pill" style="background:var(--slatel);color:var(--slate);">${HOLIDAY_NAMES[r.date]||'NYSE Holiday'}</span>`,
      present:`<span class="clock-pill clock-pill-good">Present</span>`,
    }[st]||'';
    const tiStr = r.time_in || '—';
    const toStr = r.time_out || '—';
    const hrsStr = r.work_hours>0.05 ? r.work_hours.toFixed(1)+'h' : '—';
    let lateBy = '';
    if (r.time_in_min!==null && r.time_in_min>p.lateMin && r.time_in_min<720) {
      const diff = r.time_in_min - p.entryMin;
      lateBy = `<span style="color:${diff>60?'var(--red)':'var(--amber)'};font-size:10px;">+${diff}min</span>`;
    }
    return `<tr>
      <td>${r.date}</td>
      <td style="color:var(--t3);font-size:10px;">${r.day}</td>
      <td>${tiStr} ${lateBy}</td>
      <td>${toStr}</td>
      <td>${hrsStr}</td>
      <td>${pill}</td>
    </tr>`;
  }).join('');

  const s = calcStats(days);
  panel.innerHTML = `
    <div class="clock-detail-header">
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${getColor(emp)};"></div>
        <span class="clock-detail-name">${emp}</span>
        <span style="font-size:10px;color:var(--t3);">${s.present} days present · ${s.absent} absent · ${s.mout} missing OUT · avg ${minToStr(s.avgArr)} · ${s.avgHrs.toFixed(1)}h/day</span>
      </div>
      <button class="clock-detail-close" onclick="window._clkToggleDetail('${emp}')">Close</button>
    </div>
    <div class="clock-legend">
      <div class="clock-leg-item"><div class="clock-leg-dot" style="background:var(--greenl);border:1px solid var(--green);"></div>On time</div>
      <div class="clock-leg-item"><div class="clock-leg-dot" style="background:var(--amberl);border:1px solid var(--amber);"></div>Late (&lt;1h)</div>
      <div class="clock-leg-item"><div class="clock-leg-dot" style="background:var(--redl);border:1px solid var(--red);"></div>Very late (&gt;1h)</div>
      <div class="clock-leg-item"><div class="clock-leg-dot" style="background:var(--slatel);border:1px solid var(--slate);"></div>Absent</div>
      <div class="clock-leg-item"><div class="clock-leg-dot" style="background:var(--indigol);border:1px solid var(--indigo);"></div>Missing OUT</div>
    </div>
    <table class="clock-log">
      <thead><tr><th>Date</th><th>Day</th><th>IN</th><th>OUT</th><th>Hours</th><th>Status</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:20px;">No records for this period.</td></tr>'}</tbody>
    </table>`;
}

// ── HOURS TABLE (revenue-style) ─────────────────────────────
const CLK_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let clkYearsOpen = new Set();
let clkMetric = 'hours'; // 'hours', 'attendance', 'ontime'
let clkTableShowInactive = false;

function clkGetYears() {
  const s = new Set(clkRecords.map(r => parseInt(r.date.slice(0,4))));
  return [...s].sort();
}

function clkToggleYear(y) {
  if (clkYearsOpen.has(y)) clkYearsOpen.delete(y);
  else clkYearsOpen.add(y);
  clkRenderHoursTable();
}

function clkExpandAllYears() {
  clkGetYears().forEach(y => clkYearsOpen.add(y));
  clkRenderHoursTable();
}

function clkCollapseAllYears() {
  clkYearsOpen.clear();
  clkRenderHoursTable();
}

function clkSetMetric(m) {
  clkMetric = m;
  clkRenderHoursTable();
  document.querySelectorAll('#clkMetricToggle .toggle-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.metric === m);
  });
}

function clkToggleTableInactive() {
  clkTableShowInactive = !clkTableShowInactive;
  const btn = document.getElementById('clkTableInactiveBtn');
  if (btn) btn.textContent = clkTableShowInactive ? 'Hide inactive' : 'Show inactive';
  clkRenderHoursTable();
}

function clkEmpIsVisibleInTable(emp) {
  if (clkTableShowInactive) return true;
  return isActive(emp);
}

// Compute per-employee, per-month stats from CLEAN data
function clkEmpMonthStats(emp, year, month) {
  const prefix = `${year}-${String(month).padStart(2,'0')}`;
  const days = Object.values(CLEAN[emp] || {}).filter(r => r.date.startsWith(prefix));
  const workdays = days.filter(r => !HOLIDAYS.has(r.date) && !r._isHoliday);
  const total = workdays.length;
  const present = workdays.filter(r => r.time_in !== '').length;
  const hours = workdays.reduce((s, r) => s + r.work_hours, 0);
  const p = getParams();
  const arrivals = workdays.filter(r => r.time_in_min !== null && r.time_in_min < 720);
  const ontime = arrivals.filter(r => r.time_in_min <= p.lateMin).length;
  return { total, present, hours, arrivals: arrivals.length, ontime };
}

function clkEmpYearStats(emp, year) {
  let total = 0, present = 0, hours = 0, arrivals = 0, ontime = 0;
  for (let m = 1; m <= 12; m++) {
    const s = clkEmpMonthStats(emp, year, m);
    total += s.total; present += s.present; hours += s.hours;
    arrivals += s.arrivals; ontime += s.ontime;
  }
  return { total, present, hours, arrivals, ontime };
}

function clkEmpGrandStats(emp) {
  let total = 0, present = 0, hours = 0, arrivals = 0, ontime = 0;
  clkGetYears().forEach(y => {
    const s = clkEmpYearStats(emp, y);
    total += s.total; present += s.present; hours += s.hours;
    arrivals += s.arrivals; ontime += s.ontime;
  });
  return { total, present, hours, arrivals, ontime };
}

function clkFmtMetric(stats) {
  if (clkMetric === 'hours') {
    return stats.hours > 0 ? stats.hours.toFixed(0) : '';
  }
  if (clkMetric === 'attendance') {
    if (stats.total === 0) return '';
    return (stats.present / stats.total * 100).toFixed(0) + '%';
  }
  if (clkMetric === 'ontime') {
    if (stats.arrivals === 0) return '';
    return (stats.ontime / stats.arrivals * 100).toFixed(0) + '%';
  }
  return '';
}

function clkFmtTotal(stats) {
  if (clkMetric === 'hours') {
    return stats.hours > 0 ? stats.hours.toFixed(0) : '';
  }
  if (clkMetric === 'attendance') {
    if (stats.total === 0) return '';
    return (stats.present / stats.total * 100).toFixed(0) + '%';
  }
  if (clkMetric === 'ontime') {
    if (stats.arrivals === 0) return '';
    return (stats.ontime / stats.arrivals * 100).toFixed(0) + '%';
  }
  return '';
}

function clkRenderHoursTable() {
  const YEARS = clkGetYears();
  if (!YEARS.length) return;

  // Default: open the latest year
  if (clkYearsOpen.size === 0) clkYearsOpen.add(YEARS[YEARS.length - 1]);

  const allEmps = [...new Set(clkRecords.map(r => r.employee))].sort();
  const activeEmps = allEmps.filter(e => isActive(e));
  const inactiveEmps = allEmps.filter(e => !isActive(e));

  const anyOpen = YEARS.some(y => clkYearsOpen.has(y));
  const rs = anyOpen ? ' rowspan="2"' : '';

  // ── HEAD ──
  let row1 = '<tr>';
  row1 += `<th class="sticky-col" style="width:32px;"${rs}></th>`;
  row1 += `<th class="sticky-col-2"${rs}>
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span>Employee</span>
      <div class="toggle-group" id="clkMetricToggle" style="margin-left:8px;">
        <button class="toggle-btn ${clkMetric==='hours'?'active':''}" data-metric="hours" onclick="event.stopPropagation();window._clkSetMetric('hours')" style="font-size:9px;padding:2px 6px;">Hours</button>
        <button class="toggle-btn ${clkMetric==='attendance'?'active':''}" data-metric="attendance" onclick="event.stopPropagation();window._clkSetMetric('attendance')" style="font-size:9px;padding:2px 6px;">Attend %</button>
        <button class="toggle-btn ${clkMetric==='ontime'?'active':''}" data-metric="ontime" onclick="event.stopPropagation();window._clkSetMetric('ontime')" style="font-size:9px;padding:2px 6px;">On Time %</button>
      </div>
    </div>
  </th>`;

  YEARS.forEach(y => {
    const open = clkYearsOpen.has(y);
    if (open) {
      row1 += `<th class="year-th year-divider-left" colspan="13" onclick="window._clkToggleYear(${y})">
        <span class="year-chev open">\u25B8</span>${y}
      </th>`;
    } else {
      row1 += `<th class="year-th" onclick="window._clkToggleYear(${y})"${rs}>
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
      if (clkYearsOpen.has(y)) {
        CLK_MONTH_NAMES.forEach((m, i) => {
          const cls = i === 0 ? 'month-th num year-divider-left' : 'month-th num';
          row2 += `<th class="${cls}">${m}</th>`;
        });
        row2 += `<th class="year-total-cell num">${y} Total</th>`;
      }
    });
    row2 += '</tr>';
  }

  document.getElementById('clkHoursHead').innerHTML = row1 + row2;

  // ── BODY ──
  let html = '';

  function renderEmpRow(emp) {
    const col = getColor(emp);
    const active = isActive(emp);
    const rowCls = active ? 'acct-row subcat-row' : 'acct-row acct-inactive subcat-row';
    const safeEmp = emp.replace(/'/g, "\\'");
    const toggleBtn = `<button class="line-toggle-btn"
      onclick="event.stopPropagation(); window._clkToggleEmp('${safeEmp}')"
      title="${active ? 'Hide' : 'Show'}">${active ? 'hide' : 'show'}</button>`;

    html += `<tr class="${rowCls}">`;
    html += '<td class="sticky-col"></td>';
    html += `<td class="sticky-col-2"><div class="subcat-inner"><span class="subcat-name"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col};margin-right:8px;vertical-align:middle;"></span>${emp}</span><span class="subcat-actions">${toggleBtn}</span></div></td>`;

    YEARS.forEach(y => {
      if (clkYearsOpen.has(y)) {
        for (let m = 1; m <= 12; m++) {
          const s = clkEmpMonthStats(emp, y, m);
          const val = clkFmtMetric(s);
          html += `<td class="num">${val}</td>`;
        }
        const ys = clkEmpYearStats(emp, y);
        html += `<td class="year-total-cell num" style="font-weight:600;">${clkFmtTotal(ys)}</td>`;
      } else {
        const ys = clkEmpYearStats(emp, y);
        html += `<td class="num" style="font-weight:600;">${clkFmtTotal(ys)}</td>`;
      }
    });

    const gs = clkEmpGrandStats(emp);
    html += `<td class="grand-total-cell num display-num">${clkFmtTotal(gs)}</td>`;
    html += '</tr>';
  }

  const visibleEmpsForTable = allEmps.filter(e => clkEmpIsVisibleInTable(e));
  visibleEmpsForTable.forEach(e => renderEmpRow(e));

  document.getElementById('clkHoursBody').innerHTML = html || '<tr><td colspan="99" class="clock-empty">No data.</td></tr>';

  // ── FOOT (totals) ──
  let footHtml = '<tr class="total-row">';
  footHtml += '<td class="sticky-col"></td>';
  footHtml += '<td class="sticky-col-2">Total</td>';

  const visibleEmps = allEmps.filter(e => clkEmpIsVisibleInTable(e));

  YEARS.forEach(y => {
    if (clkYearsOpen.has(y)) {
      for (let m = 1; m <= 12; m++) {
        let agg = { total: 0, present: 0, hours: 0, arrivals: 0, ontime: 0 };
        visibleEmps.forEach(e => {
          const s = clkEmpMonthStats(e, y, m);
          agg.total += s.total; agg.present += s.present; agg.hours += s.hours;
          agg.arrivals += s.arrivals; agg.ontime += s.ontime;
        });
        footHtml += `<td class="num">${clkFmtTotal(agg)}</td>`;
      }
      let aggY = { total: 0, present: 0, hours: 0, arrivals: 0, ontime: 0 };
      visibleEmps.forEach(e => {
        const s = clkEmpYearStats(e, y);
        aggY.total += s.total; aggY.present += s.present; aggY.hours += s.hours;
        aggY.arrivals += s.arrivals; aggY.ontime += s.ontime;
      });
      footHtml += `<td class="year-total-cell num display-num">${clkFmtTotal(aggY)}</td>`;
    } else {
      let aggY = { total: 0, present: 0, hours: 0, arrivals: 0, ontime: 0 };
      visibleEmps.forEach(e => {
        const s = clkEmpYearStats(e, y);
        aggY.total += s.total; aggY.present += s.present; aggY.hours += s.hours;
        aggY.arrivals += s.arrivals; aggY.ontime += s.ontime;
      });
      footHtml += `<td class="num display-num">${clkFmtTotal(aggY)}</td>`;
    }
  });

  let aggG = { total: 0, present: 0, hours: 0, arrivals: 0, ontime: 0 };
  visibleEmps.forEach(e => {
    const gs = clkEmpGrandStats(e);
    aggG.total += gs.total; aggG.present += gs.present; aggG.hours += gs.hours;
    aggG.arrivals += gs.arrivals; aggG.ontime += gs.ontime;
  });
  footHtml += `<td class="grand-total-cell num display-num" style="font-size:16px;">${clkFmtTotal(aggG)}</td>`;
  footHtml += '</tr>';

  document.getElementById('clkHoursFoot').innerHTML = footHtml;
}

// ── CSV UPLOAD & PREVIEW ────────────────────────────────────
function clkParseCSV(text) {
  const existing = new Set(clkRecords.map(r=>`${r.employee}|${r.date}`));
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

function clkPreviewCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const reader = new FileReader();
  reader.onload = e => {
    const records = clkParseCSV(e.target.result);
    clkPendingCSVRecords = records;
    clkPendingCSVFile = file.name;
    clkShowPreviewModal(records, file.name);
  };
  reader.readAsText(file);
}

function clkShowPreviewModal(records, filename) {
  const newRecs = records.filter(r=>r.isNew);
  const dupRecs = records.filter(r=>!r.isNew);
  const byEmp = {};
  records.forEach(r=>{ if (!byEmp[r.employee]) byEmp[r.employee]=[]; byEmp[r.employee].push(r); });
  const dates = records.map(r=>r.date).sort();
  const period = dates.length ? `${dates[0]} → ${dates[dates.length-1]}` : '';
  document.getElementById('clkModalTitle').textContent = `Preview · ${filename}`;
  let body = `<div class="clock-preview-label">Period: ${period}</div>`;
  Object.entries(byEmp).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([emp, recs])=>{
    const empNew = recs.filter(r=>r.isNew);
    const empDup = recs.filter(r=>!r.isNew);
    const col = getColor(emp);
    body += `<div class="clock-preview-block">
      <div class="clock-preview-name">
        <div style="width:7px;height:7px;border-radius:50%;background:${col};flex-shrink:0;"></div>
        ${emp}
        ${empNew.length ? `<span class="clock-preview-badge clock-preview-new">+${empNew.length} new</span>` : ''}
        ${empDup.length ? `<span class="clock-preview-badge clock-preview-dup">${empDup.length} already exist</span>` : ''}
      </div>
      <div class="clock-preview-rows">`;
    const toShow = empNew.slice(0,6);
    toShow.forEach(r=>{
      const ti = r.time_in||'—', to=r.time_out||'—';
      const wh = r.work_hours>0.05?r.work_hours.toFixed(1)+'h':'—';
      const flag = r.missing_out?' ⚠ missing OUT':'';
      body += `<div class="clock-preview-row-new">+ ${r.date} ${r.day}  IN:${ti}  OUT:${to}  ${wh}${flag}</div>`;
    });
    if (empNew.length > 6) body += `<div style="color:var(--t3);font-size:10px;">  ... and ${empNew.length-6} more new records</div>`;
    if (empDup.length > 0) body += `<div style="color:var(--t3);font-size:10px;">(${empDup.length} duplicate records will be skipped)</div>`;
    body += `</div></div>`;
  });
  document.getElementById('clkModalBody').innerHTML = body;
  document.getElementById('clkModalSummary').textContent = `${newRecs.length} new records · ${dupRecs.length} duplicates skipped`;
  document.getElementById('clkModal').classList.add('open');
}

function clkCloseModal() {
  document.getElementById('clkModal').classList.remove('open');
  clkPendingCSVRecords = [];
}

async function clkConfirmUpload() {
  const newRecs = clkPendingCSVRecords.filter(r=>r.isNew);
  if (!newRecs.length) { clkCloseModal(); return; }

  // Group by employee to ensure all employees exist
  const empNames = [...new Set(newRecs.map(r=>r.employee))];
  const empIds = {};
  for (const name of empNames) {
    empIds[name] = await ensureEmployee(name);
  }

  // Build rows for upsert
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

  // Upsert in batches of 500
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error } = await supabase
      .from('clock_records')
      .upsert(batch, { onConflict: 'employee_id,date' });

    if (error) {
      console.error('Clock upload error:', error);
      clkNotify('Error uploading records');
      clkCloseModal();
      return;
    }
    added += batch.length;
  }

  // Also update local state so UI refreshes without re-fetching
  newRecs.forEach(r => {
    clkRecords.push({
      employee: r.employee,
      employee_id: empIds[r.employee],
      date: r.date,
      day: r.day,
      time_in: r.time_in,
      time_out: r.time_out,
      work_hours: r.work_hours,
      missing_out: r.missing_out,
    });
  });

  clkCloseModal();
  buildClean();
  clkRenderMonthFilters();
  clkRenderAll();
  clkNotify(`Imported ${added} records from ${clkPendingCSVFile}`);
}

// ── NOTIFY ────────────────────────────────────────────────
function clkNotify(msg) {
  const el=document.getElementById('clkNotif');
  if (!el) return;
  el.textContent=msg; el.style.display='block';
  setTimeout(()=>el.style.display='none',2500);
}

// ── EXPORT TO WINDOW ──────────────────────────────────────
export function loadClockPage() {
  clockInit();
}

window._clkSelectYear = clkSelectYear;
window._clkSelectMonth = clkSelectMonth;
window._clkToggleDetail = clkToggleDetail;
window._clkToggleEmp = clkToggleEmp;
window._clkToggleShowInactive = clkToggleShowInactive;
window._clkPreviewCSV = clkPreviewCSV;
window._clkCloseModal = clkCloseModal;
window._clkConfirmUpload = clkConfirmUpload;
window._clkRenderAll = clkRenderAll;
window._clkToggleYear = clkToggleYear;
window._clkExpandAllYears = clkExpandAllYears;
window._clkCollapseAllYears = clkCollapseAllYears;
window._clkSetMetric = clkSetMetric;
window._clkToggleTableInactive = clkToggleTableInactive;
