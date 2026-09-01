-- 060 — manager dashboards (widget catalog, block 2).
--
-- ⚠⚠ WHY A SERVER TABLE AND NOT localStorage, WHICH IS WHERE EVERY OTHER
-- PREFERENCE IN THIS PRODUCT LIVES. `Customize View` stores its hidden-panel set
-- in localStorage, and that is correct for a panel toggle: it is a per-device
-- convenience. A DASHBOARD IS NOT THAT. A manager builds a board on their laptop
-- and expects it on their phone, and a board that exists on one machine only
-- reads as data loss rather than as a device preference.
--
-- ⚠⚠ STORE THE DEVIATION, NOT THE DEFAULT — third application of that rule, and
-- the two before it are precedent rather than analogy (`Customize View` stores
-- the HIDDEN set; the pivot-state reset keeps an opt-in list). A MANAGER WHO HAS
-- NEVER CUSTOMISED ANYTHING HAS NO ROW HERE. They inherit whatever Performance
-- renders today, from code.
--   ⚠ THE COROLLARY IS THE HALF THAT GETS LOST: THE DEFAULT MUST NEVER BE
--   MATERIALISED INTO ROWS. The moment a default board is written out per
--   manager, adding a widget stops reaching anyone who already has one —
--   silently and permanently, which is the exact defect the rule exists to
--   prevent, wearing a migration's clothes.
--
-- ⚠ TEN BOARDS PER MANAGER. The cap exists only so a dropdown cannot become
-- unusable; it is not a storage concern (a board is ~350 bytes, and 1,000
-- managers with three boards each is ~2 MB). Enforced in code, not by a
-- constraint, because the limit is a UI judgement and a 23514 on save would
-- surface to a manager as an error rather than as "you have ten already".
--
-- ⚠ PINNING IS PER-MANAGER — it is their board. A partial unique index makes
-- "two pinned boards" unrepresentable rather than merely discouraged.
--
-- ⚠⚠ NO FOREIGN KEY TO auth.users AND NO CASCADE, DELIBERATELY. The user-purge
-- path (lib/user-purge.js) already enumerates what a deletion removes; adding a
-- silent cascade here would mean a table that path does not know about quietly
-- losing rows. Purge adds this table explicitly or it does not touch it — and an
-- orphan board is inert, which is the safe direction.

create table if not exists public.dashboards (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null,
  name       text        not null,
  layout     jsonb       not null default '[]'::jsonb,
  pinned     boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.dashboards is
  'Manager dashboard layouts. A manager with NO ROW inherits the code default — '
  'the default is never materialised here, or new widgets stop reaching anyone '
  'who already has a board.';
comment on column public.dashboards.layout is
  'Array of {metric, view, w, h}. The catalog (lib/widget-catalog.js) is the '
  'authority: an unknown metric is dropped ON READ and LEFT IN THE ROW, because '
  'a metric can come back and pruning on read makes that unrecoverable.';

create index if not exists idx_dashboards_user on public.dashboards (user_id, updated_at desc);

-- ⚠ At most ONE pinned board per manager, enforced rather than assumed.
create unique index if not exists idx_dashboards_one_pinned
  on public.dashboards (user_id) where pinned;

alter table public.dashboards enable row level security;
-- no policies: service-role writes only, exactly like the other backend tables
