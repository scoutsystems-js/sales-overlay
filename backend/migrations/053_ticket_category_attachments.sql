-- 053 · Ticket category, one screenshot, one video link.
--
-- ⚠ THE CATEGORIES ARE GROUNDED IN WHAT WAS ACTUALLY REPORTED, not a generic
-- taxonomy: both real tickets were sync/grading, and most of the defects Justin
-- raised from screenshots were a wrong number or a wrong message.
--   sync_grading      "my calls aren't syncing or being graded"
--   wrong_data        "a number or a panel looks wrong"
--   wrong_coaching    "the coaching or feedback is wrong"
--   cant_find         "I can't find or use something"
--   other             everything else, rather than forcing a wrong pick
--
-- ⚠⚠ NO BILLING/ACCESS CATEGORY, DELIBERATELY. Nobody can be invited or billed
-- yet, so it would be a category nobody could pick — and an unpickable option
-- teaches people the list is wrong. It becomes necessary the moment seats exist;
-- recorded against the invite-onboarding row so it is not rediscovered.
--
-- ⚠ NULLABLE. Tickets raised before this shipped have no category, and that is a
-- different fact from "they chose Other". Defaulting them would invent an answer.
alter table public.support_tickets
  add column if not exists category text,
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  -- ⚠⚠ WRITE-THE-NULL, same as snapshot_error: "no attachment" and "the upload
  -- failed" are different facts to whoever reads the ticket. A blank read as
  -- "they didn't send one" loses the evidence that they tried.
  add column if not exists attachment_error text,
  add column if not exists link_url text;

do $$ begin
  alter table public.support_tickets
    add constraint support_tickets_category_check
    check (category is null or category in
      ('sync_grading', 'wrong_data', 'wrong_coaching', 'cant_find', 'other'));
exception when duplicate_object then null; end $$;

comment on column public.support_tickets.category is
  'Filter only — never a replacement for the message. A category with no message is a ticket you cannot action.';
comment on column public.support_tickets.attachment_path is
  'Object path in the PRIVATE support-attachments bucket. Never a public URL — reachable only via a short-lived signed URL.';
