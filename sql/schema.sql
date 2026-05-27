-- ============================================================
-- Summit Admin Portal — Supabase Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ─── 0. Housekeeping ─────────────────────────────────────────

-- Generic updated_at trigger function (reused by all tables)
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ─── 1. user_roles ───────────────────────────────────────────

create table user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users(id),  -- null until first login
  role       text not null check (role in ('san', 'deborah', 'oscar')),
  email      text not null unique
);

-- Seed the two v1 users (user_id filled by post-login trigger)
insert into user_roles (email, role) values
  ('scarranza@summit-mgmtx.com', 'san'),
  ('dposternak@summit-mgmtx.com', 'deborah');

-- Post-login function: backfills user_id when a user signs in
-- for the first time. Called by the auth trigger below.
create or replace function backfill_user_role()
returns trigger as $$
begin
  update user_roles
    set user_id = new.id
  where email = new.email
    and user_id is null;
  return new;
end;
$$ language plpgsql security definer;

-- Fire after a new row appears in auth.users (i.e., first sign-in)
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function backfill_user_role();

-- Callable from the client to backfill user_id for dashboard-created users
create or replace function backfill_user_role_on_login()
returns void as $$
begin
  update user_roles
    set user_id = auth.uid()
  where email = (select email from auth.users where id = auth.uid())
    and user_id is null;
end;
$$ language plpgsql security definer;


-- ─── 2. fx_rates ─────────────────────────────────────────────

create table fx_rates (
  year_month  text primary key,            -- 'YYYY-MM'
  rate        numeric(10, 4) not null check (rate > 0),
  is_real     boolean default true,        -- false = placeholder
  updated_at  timestamptz default now()
);

create trigger fx_rates_updated_at
  before update on fx_rates
  for each row execute function set_updated_at();


-- ─── 3. revenue_accounts ─────────────────────────────────────

create table revenue_accounts (
  id                    uuid primary key default gen_random_uuid(),
  bank                  text not null check (bank in ('ML', 'JPM', 'UBS', 'GS', 'IBKR')),
  account_name          text not null,
  is_inactive_override  boolean,            -- null = auto-detect, true/false = manual
  display_order         int default 0,
  created_at            timestamptz default now(),
  unique(bank, account_name)
);


-- ─── 4. revenue_cells ────────────────────────────────────────

create table revenue_cells (
  account_id   uuid references revenue_accounts(id) on delete cascade,
  year_month   text not null,               -- 'YYYY-MM' or '2022-00' for annual
  amount       numeric(12, 2) not null,
  is_projected boolean default false,
  updated_at   timestamptz default now(),
  primary key (account_id, year_month)
);

create trigger revenue_cells_updated_at
  before update on revenue_cells
  for each row execute function set_updated_at();


-- ─── 5. payroll_employees ────────────────────────────────────

create table payroll_employees (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  is_active      boolean not null default true,
  display_order  int default 0
);


-- ─── 6. payroll_cells ────────────────────────────────────────

create table payroll_cells (
  employee_id  uuid references payroll_employees(id) on delete cascade,
  year_month   text not null,               -- 'YYYY-MM' or 'YYYY-bonus'
  amount_mxn   numeric(12, 2) not null,
  updated_at   timestamptz default now(),
  primary key (employee_id, year_month)
);

create trigger payroll_cells_updated_at
  before update on payroll_cells
  for each row execute function set_updated_at();


-- ─── 7. office_expense_lines ─────────────────────────────────

create table office_expense_lines (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  bucket         text not null check (bucket in ('Office', 'Technology', 'Office Supply/Food', 'Other')),
  is_active      boolean not null default true,
  display_order  int default 0
);


-- ─── 8. office_expense_cells ─────────────────────────────────

create table office_expense_cells (
  line_id       uuid references office_expense_lines(id) on delete cascade,
  year_month    text not null,              -- 'YYYY-MM'
  amount_usd    numeric(12, 2) not null,
  is_projected  boolean default false,
  source        text default 'manual' check (source in ('manual', 'amex', 'projection')),
  updated_at    timestamptz default now(),
  primary key (line_id, year_month)
);

create trigger office_expense_cells_updated_at
  before update on office_expense_cells
  for each row execute function set_updated_at();


-- ─── 9. Indexes ──────────────────────────────────────────────

create index idx_revenue_cells_year_month on revenue_cells(year_month);
create index idx_payroll_cells_year_month on payroll_cells(year_month);
create index idx_office_expense_cells_year_month on office_expense_cells(year_month);
create index idx_revenue_cells_projected on revenue_cells(is_projected) where is_projected = true;
create index idx_office_expense_cells_projected on office_expense_cells(is_projected) where is_projected = true;


-- ─── 10. Row-Level Security ──────────────────────────────────

-- Enable RLS on all tables
alter table user_roles enable row level security;
alter table fx_rates enable row level security;
alter table revenue_accounts enable row level security;
alter table revenue_cells enable row level security;
alter table payroll_employees enable row level security;
alter table payroll_cells enable row level security;
alter table office_expense_lines enable row level security;
alter table office_expense_cells enable row level security;

-- Helper: get current user's role (used in all policies)
create or replace function current_user_role()
returns text as $$
  select role from user_roles where user_id = auth.uid()
$$ language sql security definer stable;


-- ── user_roles: each user can read their own row; san reads all ──
create policy "users_read_own_role" on user_roles
  for select using (user_id = auth.uid());

create policy "san_reads_all_roles" on user_roles
  for select using (current_user_role() = 'san');


-- ── fx_rates: san + deborah full read/write ──
create policy "fx_rates_read" on fx_rates
  for select using (current_user_role() in ('san', 'deborah'));

create policy "fx_rates_write" on fx_rates
  for insert with check (current_user_role() in ('san', 'deborah'));

create policy "fx_rates_update" on fx_rates
  for update using (current_user_role() in ('san', 'deborah'));

create policy "fx_rates_delete" on fx_rates
  for delete using (current_user_role() in ('san', 'deborah'));


-- ── revenue_accounts: san only ──
create policy "revenue_accounts_read" on revenue_accounts
  for select using (current_user_role() = 'san');

create policy "revenue_accounts_write" on revenue_accounts
  for insert with check (current_user_role() = 'san');

create policy "revenue_accounts_update" on revenue_accounts
  for update using (current_user_role() = 'san');

create policy "revenue_accounts_delete" on revenue_accounts
  for delete using (current_user_role() = 'san');


-- ── revenue_cells: san only ──
create policy "revenue_cells_read" on revenue_cells
  for select using (current_user_role() = 'san');

create policy "revenue_cells_write" on revenue_cells
  for insert with check (current_user_role() = 'san');

create policy "revenue_cells_update" on revenue_cells
  for update using (current_user_role() = 'san');

create policy "revenue_cells_delete" on revenue_cells
  for delete using (current_user_role() = 'san');


-- ── payroll_employees: san only ──
create policy "payroll_employees_read" on payroll_employees
  for select using (current_user_role() = 'san');

create policy "payroll_employees_write" on payroll_employees
  for insert with check (current_user_role() = 'san');

create policy "payroll_employees_update" on payroll_employees
  for update using (current_user_role() = 'san');

create policy "payroll_employees_delete" on payroll_employees
  for delete using (current_user_role() = 'san');


-- ── payroll_cells: san only ──
create policy "payroll_cells_read" on payroll_cells
  for select using (current_user_role() = 'san');

create policy "payroll_cells_write" on payroll_cells
  for insert with check (current_user_role() = 'san');

create policy "payroll_cells_update" on payroll_cells
  for update using (current_user_role() = 'san');

create policy "payroll_cells_delete" on payroll_cells
  for delete using (current_user_role() = 'san');


-- ── office_expense_lines: san + deborah full read/write ──
create policy "expense_lines_read" on office_expense_lines
  for select using (current_user_role() in ('san', 'deborah'));

create policy "expense_lines_write" on office_expense_lines
  for insert with check (current_user_role() in ('san', 'deborah'));

create policy "expense_lines_update" on office_expense_lines
  for update using (current_user_role() in ('san', 'deborah'));

create policy "expense_lines_delete" on office_expense_lines
  for delete using (current_user_role() in ('san', 'deborah'));


-- ── office_expense_cells: san + deborah full read/write ──
create policy "expense_cells_read" on office_expense_cells
  for select using (current_user_role() in ('san', 'deborah'));

create policy "expense_cells_write" on office_expense_cells
  for insert with check (current_user_role() in ('san', 'deborah'));

create policy "expense_cells_update" on office_expense_cells
  for update using (current_user_role() in ('san', 'deborah'));

create policy "expense_cells_delete" on office_expense_cells
  for delete using (current_user_role() in ('san', 'deborah'));
