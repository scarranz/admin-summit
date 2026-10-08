-- Remove the 'oscar' (IT) role entirely. San is now the only role.
--
-- Oscar had no committed seed row, but delete defensively in case one was
-- added manually in the live DB. After this, the only valid role is 'san';
-- the 'oscar' literals left in 004_clock_tables.sql select policies become
-- inert (no user can hold that role).
--
-- Run in the Supabase SQL editor (after 006).

begin;

-- 1. Remove any row assigned the oscar role.
delete from user_roles where role = 'oscar';

-- 2. Tighten the constraint so 'san' is the only assignable role.
alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles
  add constraint user_roles_role_check check (role = 'san');

commit;
