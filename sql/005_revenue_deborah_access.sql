-- Grant Deborah read + write access to revenue tables
-- Run in Supabase SQL Editor

-- revenue_accounts
drop policy if exists "revenue_accounts_read" on revenue_accounts;
drop policy if exists "revenue_accounts_write" on revenue_accounts;
drop policy if exists "revenue_accounts_update" on revenue_accounts;
drop policy if exists "revenue_accounts_delete" on revenue_accounts;

create policy "revenue_accounts_read" on revenue_accounts
  for select using (current_user_role() in ('san', 'deborah'));

create policy "revenue_accounts_write" on revenue_accounts
  for insert with check (current_user_role() in ('san', 'deborah'));

create policy "revenue_accounts_update" on revenue_accounts
  for update using (current_user_role() in ('san', 'deborah'));

create policy "revenue_accounts_delete" on revenue_accounts
  for delete using (current_user_role() in ('san', 'deborah'));

-- revenue_cells
drop policy if exists "revenue_cells_read" on revenue_cells;
drop policy if exists "revenue_cells_write" on revenue_cells;
drop policy if exists "revenue_cells_update" on revenue_cells;
drop policy if exists "revenue_cells_delete" on revenue_cells;

create policy "revenue_cells_read" on revenue_cells
  for select using (current_user_role() in ('san', 'deborah'));

create policy "revenue_cells_write" on revenue_cells
  for insert with check (current_user_role() in ('san', 'deborah'));

create policy "revenue_cells_update" on revenue_cells
  for update using (current_user_role() in ('san', 'deborah'));

create policy "revenue_cells_delete" on revenue_cells
  for delete using (current_user_role() in ('san', 'deborah'));
