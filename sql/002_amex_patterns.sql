-- Learned Amex merchant-to-category mappings
-- Run this in Supabase SQL Editor

create table amex_patterns (
  id         uuid primary key default gen_random_uuid(),
  pattern    text not null unique,    -- merchant keyword (uppercase substring)
  line_name  text not null,           -- maps to office_expense_lines.name
  created_at timestamptz default now()
);

alter table amex_patterns enable row level security;

-- san + deborah can read and write patterns
create policy "amex_patterns_read" on amex_patterns
  for select using (current_user_role() in ('san', 'deborah'));

create policy "amex_patterns_write" on amex_patterns
  for insert with check (current_user_role() in ('san', 'deborah'));

create policy "amex_patterns_update" on amex_patterns
  for update using (current_user_role() in ('san', 'deborah'));

create policy "amex_patterns_delete" on amex_patterns
  for delete using (current_user_role() in ('san', 'deborah'));
