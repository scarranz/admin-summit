-- Revoke all access for Deborah (dposternak@summit-mgmtx.com).
--
-- current_user_role() derives a user's role from user_roles, and every RLS
-- policy keys off it. Deleting her row removes her role entirely, so every
-- `in ('san', 'deborah')` grant fails for her and initAuth() signs out any
-- session whose user_id has no role row. The 'deborah' literals remaining in
-- older policies (002, 004, 005, schema.sql) are inert — no user holds that
-- role anymore.
--
-- Run in the Supabase SQL editor.

begin;

-- 1. Remove her role row — the effective kill switch.
delete from user_roles where email = 'dposternak@summit-mgmtx.com';

-- 2. Tighten the constraint so the role can't be re-seeded by accident.
alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles
  add constraint user_roles_role_check check (role in ('san', 'oscar'));

commit;
