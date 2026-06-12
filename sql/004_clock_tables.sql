-- ============================================================
-- Clock (attendance) tables
-- Run in Supabase SQL Editor
-- ============================================================

-- ─── clock_employees ────────────────────────────────────────
create table clock_employees (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  color          text,                          -- hex e.g. '#d9480f'
  is_active      boolean not null default true,
  display_order  int default 0
);

-- ─── clock_records ──────────────────────────────────────────
create table clock_records (
  employee_id  uuid references clock_employees(id) on delete cascade,
  date         date not null,
  day          text not null,                   -- MON, TUE, …
  time_in      text default '',
  time_out     text default '',
  work_hours   numeric(5, 2) not null default 0,
  missing_out  boolean default false,
  source       text default 'csv' check (source in ('csv', 'manual')),
  uploaded_at  timestamptz default now(),
  primary key (employee_id, date)
);

create index idx_clock_records_date on clock_records(date);

-- ─── Row-Level Security ─────────────────────────────────────

alter table clock_employees enable row level security;
alter table clock_records   enable row level security;

-- Everyone can read
create policy "clock_employees_read" on clock_employees
  for select using (current_user_role() in ('san', 'deborah', 'oscar'));

create policy "clock_records_read" on clock_records
  for select using (current_user_role() in ('san', 'deborah', 'oscar'));

-- san + deborah can write
create policy "clock_employees_insert" on clock_employees
  for insert with check (current_user_role() in ('san', 'deborah'));

create policy "clock_employees_update" on clock_employees
  for update using (current_user_role() in ('san', 'deborah'));

create policy "clock_employees_delete" on clock_employees
  for delete using (current_user_role() in ('san', 'deborah'));

create policy "clock_records_insert" on clock_records
  for insert with check (current_user_role() in ('san', 'deborah'));

create policy "clock_records_update" on clock_records
  for update using (current_user_role() in ('san', 'deborah'));

create policy "clock_records_delete" on clock_records
  for delete using (current_user_role() in ('san', 'deborah'));
