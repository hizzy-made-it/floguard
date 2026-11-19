-- 020: additive columns for the Estimates feature (agent G).
-- Depends on 017 (public.lead_estimates, public.lead_jobs). Purely additive and idempotent:
-- only `add column if not exists` and `create index if not exists`. Nothing is dropped or rewritten,
-- and the 017 status check constraint is left alone (void/expired are derived, see below).
--
--   void     = voided_at is not null            (status column keeps its last value)
--   expired  = status 'sent' and valid_until < today (America/New_York); computed by the API
--   viewed   = viewed_at is not null            (first time the customer opened the link)
--
-- No card data, bank data or payment identifiers are stored anywhere in these tables.

alter table public.lead_estimates add column if not exists org_id                uuid;
alter table public.lead_estimates add column if not exists customer              jsonb not null default '{}'::jsonb;  -- {name, address, city, zip} snapshot shown to the customer
alter table public.lead_estimates add column if not exists scope_notes           text;     -- "notes to customer" (customer-visible)
alter table public.lead_estimates add column if not exists internal_notes        text;     -- rep-only, never returned by the public endpoint
alter table public.lead_estimates add column if not exists discount_reason       text;     -- rep-only
alter table public.lead_estimates add column if not exists viewed_at             timestamptz;
alter table public.lead_estimates add column if not exists view_count            integer not null default 0;
alter table public.lead_estimates add column if not exists declined_at           timestamptz;
alter table public.lead_estimates add column if not exists decline_reason        text;
alter table public.lead_estimates add column if not exists accepted_ua           text;
alter table public.lead_estimates add column if not exists accepted_consent_text text;     -- exact wording the customer agreed to
alter table public.lead_estimates add column if not exists voided_at             timestamptz;
alter table public.lead_estimates add column if not exists void_reason           text;
alter table public.lead_estimates add column if not exists sent_by               text;
alter table public.lead_estimates add column if not exists token_issued_at       timestamptz;

create index if not exists lead_estimates_org_number_idx on public.lead_estimates (org_id, number desc);

alter table public.lead_jobs add column if not exists org_id           uuid;
alter table public.lead_jobs add column if not exists invoice_sent_at  timestamptz;
alter table public.lead_jobs add column if not exists created_by       text;

-- One job per estimate (makes "create job from estimate" idempotent even under a double click).
-- Skipped with a NOTICE if duplicate estimate_id rows already exist.
do $$
begin
  create unique index if not exists lead_jobs_estimate_uidx on public.lead_jobs (estimate_id) where estimate_id is not null;
exception when others then
  raise notice 'lead_jobs_estimate_uidx not created: %', sqlerrm;
end $$;

-- Make PostgREST see the new columns immediately.
notify pgrst, 'reload schema';
