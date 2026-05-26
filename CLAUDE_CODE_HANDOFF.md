# Summit Admin Portal — Claude Code Handoff

This is the production build spec for the Summit Management internal Admin Portal. A working prototype with all features exists at `summit-admin-prototype.html` and should be treated as **visual truth** — the production build should match its UI exactly, only swapping the data layer for Supabase.

---

## 1. Project context

**Summit Management Technologies ABX** is a $60M AUM hedge fund (Texas + Mexico City). This Admin Portal is one of three internal portals:

- **Admin Portal (this project)** — solo tool for the founder (San) to manage business operations. Deborah (operations) gets limited access.
- **Client Portal** (separate project, maintained by Oscar / Head of IT) — for investors.
- **Research Portal** (separate project, maintained by Oscar) — for the investment team.

Privacy is enforced at the credential boundary: Oscar has zero access to the Admin Portal in v1. RLS at the database level will allow scoped read-only access to Oscar in a later phase, never to payroll.

**Target URL:** `admin.summit-mgmtx.com`
**Estimated cost:** ~$45/mo (Supabase Pro + Netlify Pro tiers)
**Desktop only.** Not optimized for mobile.

---

## 2. Architectural decisions (locked)

### Approach: Hybrid port

The prototype's **UI/CSS/HTML structure stays verbatim**. The **data layer is rewritten** for Supabase. Reasons:

- The prototype's UI patterns (sticky columns, year expansion, projection visual treatment, FX editor, role-based nav, chart toggle groups) took many hours of iteration and are signed off
- The in-memory data layer (`const REVENUE_DATA = [...]`, `payState.yearsOpen = new Set()`) was built without thought to network latency, race conditions, or persistence — these need a proper rewrite
- Reorganizing 6,000 lines of single-file HTML into proper modules is part of the rewrite

### Tech stack (locked)

- **Vanilla HTML/CSS/JS** — no framework. Matches the existing Gaby app workflow.
- **Supabase** — Postgres database + Auth + Row-Level Security. Pro tier.
- **Netlify** — static hosting, auto-deploy from git, custom domain. Pro tier.
- **Chart.js** via CDN — already used in prototype, no change.
- **SheetJS (xlsx)** via CDN — for Amex Excel upload parsing, already used in prototype.
- **No build step.** Vanilla ES modules served directly.

### File structure

```
admin-summit/
├── index.html              # Shell: sidebar nav + page containers
├── login.html              # Magic-link entry (separate page)
├── css/
│   ├── base.css            # Variables, resets, typography
│   ├── layout.css          # Sidebar, page containers, headers
│   ├── tables.css          # Shared table styling (used by all 3 tabular pages)
│   ├── charts.css          # Chart card containers
│   └── components.css      # Buttons, toggles, modals, FX editor, projection styling
├── js/
│   ├── supabase-client.js  # Single Supabase client export
│   ├── auth.js             # Session, sign-in/out, magic-link, role gates
│   ├── nav.js              # Page switching, sidebar, auto-scroll behavior
│   ├── fx.js               # FX rate cache + editor (USD/MXN end-of-month)
│   ├── overview.js         # Overview page (KPI card, chart, table)
│   ├── revenue.js          # Revenue page (28 accounts, 5 banks, projection)
│   ├── payroll.js          # Payroll page (12 employees, USD conversion, margin)
│   ├── office.js           # Office Expenses page (4 buckets, projection, Amex upload)
│   ├── charts.js           # Shared Chart.js config defaults
│   ├── projection.js       # Projection logic (Revenue + Office, shared helpers)
│   └── utils.js            # fmtUsd, fmtMxn, fmtPct, date helpers
└── netlify.toml
```

### Auth flow

- **Magic-link only** (no passwords). Supabase Auth handles delivery via email.
- **2FA via TOTP** required after magic-link. Supabase Auth supports MFA in Pro tier.
- Session stored in `localStorage` (Supabase default). 12-hour expiry, auto-refresh on activity.
- Unauthenticated users hitting `/index.html` are redirected to `/login.html`.
- `login.html` has email field → sends magic-link → user clicks link → returns to `/index.html` with session → MFA challenge if enrolled → app loads.
- First login: enroll in TOTP before reaching the app.

### Role-based access (RLS-enforced)

Two roles in v1: `san` (full access) and `deborah` (office expenses only). Hardcoded user mappings in the prototype move to a `user_roles` table:

```sql
create table user_roles (
  user_id uuid primary key references auth.users(id),
  role text not null check (role in ('san', 'deborah', 'oscar')),
  email text not null
);
```

RLS policies (illustrated for revenue table — apply analogous policies to all tables):

```sql
-- Read access: san full, others none on revenue
create policy "san_read_revenue" on revenue
  for select using (
    (select role from user_roles where user_id = auth.uid()) = 'san'
  );

-- Write access: only san
create policy "san_write_revenue" on revenue
  for all using (
    (select role from user_roles where user_id = auth.uid()) = 'san'
  );
```

For `office_expense_lines`, `office_expense_cells`, and `fx_rates`: san has full read/write, deborah has full read/write. For `revenue`, `payroll_employees`, `payroll_cells`: san only.

**Frontend gate:** Pages not allowed for the current user are not rendered in the sidebar. Direct URL navigation (e.g., typing the URL fragment) silently redirects to the user's default page. RLS at the DB level is the real enforcement; the frontend gate is UX, not security.

---

## 3. Database schema

All tables use Postgres + RLS. Timestamps default to `now()`. `updated_at` auto-updates via trigger.

### `fx_rates`
```sql
create table fx_rates (
  year_month text primary key,  -- 'YYYY-MM' format, e.g., '2026-04'
  rate numeric(10, 4) not null check (rate > 0),
  is_real boolean default true,  -- false = placeholder, true = actual end-of-month close
  updated_at timestamptz default now()
);
```
- 60 rows on seed: Jan 2022 through Dec 2026.
- 41 real rates (Jan 2022 – May 2025) seeded from `fx_rates.json`.
- 19 placeholder rates at 17.30 (Jun 2025 onward) with `is_real = false`.
- San can edit any rate; flipping to non-placeholder value sets `is_real = true`.

### `revenue_accounts`
```sql
create table revenue_accounts (
  id uuid primary key default gen_random_uuid(),
  bank text not null check (bank in ('ML', 'JPM', 'UBS', 'GS', 'IBKR')),
  account_name text not null,
  is_inactive_override boolean,  -- null = auto-detect by activity, true/false = manual
  display_order int default 0,
  created_at timestamptz default now(),
  unique(bank, account_name)
);
```
- Seed from `revenue_data.json` (28 accounts).
- "Active" rule (matches prototype `isAccountActive`): no activity in last 18 months and `is_inactive_override` is not `true` → inactive. Override beats auto-detect.

### `revenue_cells`
```sql
create table revenue_cells (
  account_id uuid references revenue_accounts(id) on delete cascade,
  year_month text not null,  -- 'YYYY-MM'
  amount numeric(12, 2) not null,
  is_projected boolean default false,
  updated_at timestamptz default now(),
  primary key (account_id, year_month)
);
```
- One row per (account, month) with a value. Empty months = no row.
- `is_projected = true` marks forecast cells. Editing the cell flips it to `false` (promotes to real).

### `payroll_employees`
```sql
create table payroll_employees (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,  -- default-active set hardcoded for 6 names below
  display_order int default 0
);
```
- Seed from `payroll_data.json` (12 employees).
- **Default-active set** (the 6 currently on payroll): San Alvarez, Oscar Cordova, Pablo Valles, Debby Posternak, Daniel Alvarez, Luis Catan. Set `is_active = true` for these; `false` for the other 6 (Hector Miranda, Daniel Garibay, Fernando Barrios Gomez, Frank Rojas, Majo Romo, Andres Morales).

### `payroll_cells`
```sql
create table payroll_cells (
  employee_id uuid references payroll_employees(id) on delete cascade,
  year_month text not null,  -- 'YYYY-MM' OR 'YYYY-bonus' for annual bonuses
  amount_mxn numeric(12, 2) not null,
  updated_at timestamptz default now(),
  primary key (employee_id, year_month)
);
```
- Same shape as revenue. Bonuses stored as special key `'YYYY-bonus'` (e.g., `'2026-bonus'`).
- December payroll projection at 1.5× the prior-month rate is **computed in JS**, not stored.

### `office_expense_lines`
```sql
create table office_expense_lines (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  bucket text not null check (bucket in ('Office', 'Technology', 'Office Supply/Food', 'Other')),
  is_active boolean not null default true,
  display_order int default 0
);
```
- Seed from `expense_data_cells.json`. 21 sub-categories.
- Bucket assignments are hardcoded by sub-category name (prototype has the mapping; see `EXPENSE_BUCKETS` constant).

### `office_expense_cells`
```sql
create table office_expense_cells (
  line_id uuid references office_expense_lines(id) on delete cascade,
  year_month text not null,
  amount_usd numeric(12, 2) not null,
  is_projected boolean default false,
  source text default 'manual' check (source in ('manual', 'amex', 'projection')),
  updated_at timestamptz default now(),
  primary key (line_id, year_month)
);
```
- Cell-based model (NOT transaction-based). One value per (sub-category, month).
- Amex imports aggregate same-month + same-sub-cat transactions into a single value with `source = 'amex'`.

### `user_roles` (already shown above)

### Indexes

```sql
create index idx_revenue_cells_year_month on revenue_cells(year_month);
create index idx_payroll_cells_year_month on payroll_cells(year_month);
create index idx_office_expense_cells_year_month on office_expense_cells(year_month);
create index idx_revenue_cells_projected on revenue_cells(is_projected) where is_projected = true;
create index idx_office_expense_cells_projected on office_expense_cells(is_projected) where is_projected = true;
```

---

## 4. Data layer patterns

### Single supabase client

```js
// js/supabase-client.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = window.ENV.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.ENV.SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

### Page-level data loading pattern

Each page module fetches everything it needs on entry (no real-time subscriptions in v1 — that's a v2 add):

```js
// js/revenue.js (pattern, not literal)
export async function loadRevenuePage() {
  showLoading('revenue');
  const [accounts, cells] = await Promise.all([
    supabase.from('revenue_accounts').select('*').order('display_order'),
    supabase.from('revenue_cells').select('*')
  ]);
  
  if (accounts.error || cells.error) { showError(); return; }
  
  // Build the in-memory shape the prototype's render functions expect:
  // [{ bank, account, monthly: {YYYY-MM: amount}, projectedMonths: [...], year_totals, grand_total }, ...]
  REVENUE_DATA = buildRevenueData(accounts.data, cells.data);
  
  renderRevenue();
  hideLoading('revenue');
}
```

`buildRevenueData()` is the bridge: it reads flat Supabase rows and produces the nested object shape the prototype's render code already consumes. **This means the renderers don't change** — only the data assembly does.

### Optimistic updates pattern

When user edits a cell, update the DOM immediately, then write to Supabase. On error, roll back.

```js
async function editRevenueCell(accountId, yearMonth, newValue) {
  // 1. Optimistic UI: update REVENUE_DATA in memory, re-render
  const acct = findAccount(accountId);
  const oldValue = acct.monthly[yearMonth];
  if (newValue === 0) delete acct.monthly[yearMonth];
  else acct.monthly[yearMonth] = newValue;
  if (acct.projectedMonths) acct.projectedMonths = acct.projectedMonths.filter(k => k !== yearMonth);
  recomputeAccountTotals(acct);
  renderRevenue();
  
  // 2. Persist
  const result = newValue === 0
    ? await supabase.from('revenue_cells').delete().eq('account_id', accountId).eq('year_month', yearMonth)
    : await supabase.from('revenue_cells').upsert({ 
        account_id: accountId, 
        year_month: yearMonth, 
        amount: newValue,
        is_projected: false  // user edit demotes to real
      });
  
  // 3. Roll back on error
  if (result.error) {
    if (oldValue !== undefined) acct.monthly[yearMonth] = oldValue;
    else delete acct.monthly[yearMonth];
    recomputeAccountTotals(acct);
    renderRevenue();
    showToast('Save failed — please retry', 'error');
  }
}
```

### State that stays in memory (not persisted)

These are UI state, not data state, and stay in memory only (lost on refresh — that's fine):

- `revState.yearsOpen`, `revState.banksOpen`, `revState.visibleBanks`, `revState.showInactive`
- `payState.yearsOpen`, `payState.employeesCollapsed`, `payState.showInactive`, `payState.chart`
- `expState.yearsOpen`, `expState.collapsedBuckets`, `expState.showInactive`, `expState.chart`
- `ovState.chart.range`, `ovState.chart.granularity`, `ovState.series.*`, `ovState.expensesCollapsed`, `ovState.yearsOpen`

If saving these per-user matters later, add a `user_preferences` JSON column to `user_roles`. Not v1.

---

## 5. Page-by-page specs

For each page, the visual reference is the prototype HTML. This section calls out only what the production build needs **beyond** what the prototype does.

### 5.1 Overview

Visual: see prototype `#page-overview`.

**Behavior:**
- KPI card with 3 columns (Latest month / YTD / Projected year margin)
- Chart with 4 toggleable series (Revenue, Expenses, Op Income, Margin), range dropdown, monthly/yearly toggle
- Supporting table with 7 metric rows, year columns (2022–2026), click-year-to-expand-to-months, Total column on right, Total expenses row click-to-collapse-breakdown
- All math depends on revenue + payroll + office expense + FX data. Page fetches all four datasets in parallel on load.
- Margin definition: Revenue (USD) − Office expenses (USD) − Payroll (MXN ÷ FX rate per month) = Op Income; Op Income ÷ Revenue × 100 = margin

**Production-specific:**
- Load all four datasets on entry; show loading skeleton until done
- If any dataset fails to load, show "Couldn't load Overview — retry" with a button

### 5.2 Revenue

Visual: see prototype `#page-revenue`.

**Behavior:**
- 28 accounts across 5 banks (IBKR hidden by default — dormant)
- 2022 stored as annual only; 2023+ stored monthly
- Years collapsed by default except current year (2026)
- Auto-scroll to far right on page entry so latest months visible
- "Projection" button: fills future months (current month onward) of accounts with current-year data, carrying latest non-empty month forward
- "Clear projections" button: appears when any projections exist; clears all
- Projected cells: gray italic with diagonal hatch background. Aggregate cells (account year-total, bank monthly subtotal, bank year-total, bank grand total, footer total cells, grand totals) inherit gray styling when any contributing cell is projected
- Editing a projected cell promotes it to real (flips `is_projected` to false in DB)
- Manually marking an account inactive (via the green/gray dot toggle on the account row) writes to `is_inactive_override`

### 5.3 Payroll

Visual: see prototype `#page-payroll`.

**Behavior:**
- 12 employees in MXN, with 6 visible by default (the `is_active = true` set)
- "Show inactive" reveals the other 6
- Bonus column (`year-bonus` cells), amber-tinted, editable
- December payroll projection: 1.5× the prior-month flat rate, computed in JS (Mexican aguinaldo)
- Click "Employee" header → collapse all employee rows, show only Total/USD/Margin rows
- Footer: Total MXN, USD/MXN (editable per month, average for year column), Total USD (per-month conversion), YoY %, Margin % (Payroll USD ÷ Revenue)
- USD/MXN cells in footer pull from the `fx_rates` table; editing writes to that table
- Chart with metric toggle: Payroll | % Revenue

**Production-specific:**
- The Margin % row needs Revenue data — load `revenue_cells` alongside payroll on page entry
- Editing a USD/MXN cell in the payroll footer is a write to `fx_rates`, not to a payroll table

### 5.4 Office Expenses

Visual: see prototype `#page-office`.

**Behavior:**
- 21 sub-categories grouped into 4 buckets (Office, Technology, Office Supply/Food, Other)
- All buckets collapsed by default; click a bucket to expand its sub-categories
- Years collapsed by default except current year (2026)
- "Projection" button: per-sub-category, only for buckets Office/Technology/Office Supply/Food (skips Other), only fills future months (current month onward)
- "Clear projections" button: appears when any projections exist
- "USD/MXN rates" link opens an expandable 60-month FX editor (5 years × 12 months grid)
- "Show inactive" reveals inactive sub-categories
- "+ Add line item" modal for adding values to empty cells
- "Amex upload" button (file input): SheetJS parses, preview modal with checkbox + category dropdown, "Import selected" aggregates same-month + same-sub-cat and overwrites cells with `source = 'amex'`

**Production-specific:**
- FX editor changes propagate to Payroll Total USD row AND Overview margin math (other pages re-fetch on next entry, but if both pages are open in the same session, dispatch a 'fx-rates-changed' event)

---

## 6. Setup and deployment

### Local development

```bash
git clone <repo>
cd admin-summit
cp env.example.js env.js  # fill in SUPABASE_URL and SUPABASE_ANON_KEY
npx http-server -p 3000   # or any static server
```

### Environment variables

`env.js` (gitignored):
```js
window.ENV = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...'
};
```

Loaded via `<script src="env.js"></script>` in both `index.html` and `login.html` before any other script.

### Netlify deployment

`netlify.toml`:
```toml
[build]
  publish = "."
  command = ""  # no build step

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

For Netlify build env vars: set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the Netlify dashboard, then generate `env.js` at deploy time via a small build step (or inject as `<script>` tags directly).

**Custom domain:** `admin.summit-mgmtx.com` — point an A or CNAME record at Netlify.

### Seed data

Three JSON files in `/home/claude/work/` ship with the prototype:
- `revenue_data.json` — 28 accounts, 5 banks, monthly values 2022–2026
- `payroll_data.json` — 12 employees, monthly + bonuses
- `expense_data_cells.json` — 21 sub-categories, cell values
- `fx_rates.json` — 60 months USD/MXN (41 real + 19 placeholder)

Write a `seed.sql` or `seed.js` script that reads these and inserts into the appropriate Supabase tables. Run once at project setup.

---

## 7. Out of scope for v1

- Real-time sync between sessions (use page reloads to refresh)
- Mobile responsive design
- Oscar's read-only role (extend `user_roles` later; RLS already supports it structurally)
- Audit log / change history
- Export to Excel / PDF
- User preferences persistence (chart toggles, expanded sections)
- Email notifications

These are noted because the database schema already accommodates most of them — adding a `user_preferences` JSON column or an `audit_log` table later is trivial.

---

## 8. Acceptance checklist

Before ship, verify:

- [ ] Magic-link login works end-to-end for both `san` and `deborah` email accounts
- [ ] TOTP enrollment works on first login; MFA challenge on every subsequent session
- [ ] San sees all 4 pages in sidebar; Deborah sees only Office Expenses
- [ ] Deborah cannot read revenue/payroll data via direct table queries (RLS blocks)
- [ ] All four pages render with seed data and match the prototype visually
- [ ] Editing any cell on any page persists across refresh
- [ ] FX rate edits propagate to Payroll Total USD and Overview margin
- [ ] Revenue projection creates projected cells; clear projections removes only flagged cells
- [ ] Office projection skips "Other" bucket; respects current-month boundary
- [ ] Amex upload parses, previews, and imports correctly
- [ ] All charts render and toggle as in prototype
- [ ] Auto-scroll right on Revenue / Payroll / Office entry
- [ ] Year-2026 expanded by default on tabular pages
- [ ] Margin row colors (green ≥50%, gray, red <0) match prototype
- [ ] No console errors on any page

---

## 9. Reference files

Ship these alongside the spec:

- `summit-admin-prototype.html` — visual + behavioral source of truth
- `revenue_data.json` — seed data
- `payroll_data.json` — seed data
- `expense_data_cells.json` — seed data
- `fx_rates.json` — seed data

The prototype HTML is the single source of truth for any visual/behavioral decision not covered by this spec. If something in this spec contradicts the prototype, ask before changing.
