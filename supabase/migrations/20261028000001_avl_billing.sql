-- Sundays AVL, phase 6: billing and the client portal.
--
-- · Client invoices (job_invoices, job_invoice_lines): deposit, progress (by percent of the
--   contract, by schedule phase, or by budget lines), final, and change-order invoices. Every line
--   that bills part of the contract points at the budget item it bills, so "invoiced" per line and
--   per job is a sum, never typed. ops.invoices is something else: Sundays' own subscription bills.
-- · Payments: the 1.0 payments table (for proposals) now also takes invoice payments: recorded by
--   hand (check, ACH, cash…) or paid by card through the business's own Stripe account.
-- · Connections: a business's own keys for outside services (Stripe now), sealed like email keys.
-- · Client portal: the client signs in with a code sent to their email and sees their proposals,
--   change orders, schedule, shared files, invoices, selections and messages.
-- · Selections: choices the business offers the client after the sale (a finish, an upgrade). The
--   client picks in the portal and the pick joins the job's budget.

-- ── Invoices ──
create table if not exists ops.job_invoices (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  customer_id text references ops.customers(id) on delete set null,
  number text not null,
  kind text not null check (kind in ('DEPOSIT', 'PROGRESS', 'FINAL', 'CHANGE_ORDER', 'OTHER')),
  -- How a progress invoice was worked out.
  method text check (method in ('PERCENT', 'PHASE', 'LINES')),
  -- Percent of the contract billed through this invoice (PERCENT).
  percent_bps int check (percent_bps between 0 and 10000),
  change_order_id text references ops.change_orders(id) on delete set null,
  title text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SENT', 'PAID', 'VOID')),
  issue_date date not null default current_date,
  due_date date,
  tax_bps int not null default 0 check (tax_bps between 0 and 5000),
  -- Show the client one line per group (a phase, "40% of the contract") instead of every budget line.
  summarize boolean not null default false,
  notes text,
  -- Worked out from the lines whenever they change.
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  public_token text unique,
  sent_at timestamptz,
  sent_to text,
  viewed_at timestamptz,
  paid_at timestamptz,
  voided_at timestamptz,
  created_by_id text references ops.users(id) on delete set null on update cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists job_invoices_org_number on ops.job_invoices (org_id, number);
create index if not exists job_invoices_job on ops.job_invoices (job_id, issue_date);
create index if not exists job_invoices_customer on ops.job_invoices (customer_id);
create index if not exists job_invoices_status on ops.job_invoices (org_id, status, due_date);

create table if not exists ops.job_invoice_lines (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  invoice_id text not null references ops.job_invoices(id) on delete cascade,
  -- ITEM bills part of a budget item; DEPOSIT asks for a deposit; DEPOSIT_APPLIED (negative) takes a
  -- paid deposit off a later invoice; OTHER is anything typed by hand.
  kind text not null default 'ITEM' check (kind in ('ITEM', 'DEPOSIT', 'DEPOSIT_APPLIED', 'OTHER')),
  budget_item_id text references ops.budget_items(id) on delete set null,
  phase_id text references ops.job_phases(id) on delete set null,
  -- The heading it's shown under (a cost group, a phase, "40% of the contract").
  group_label text,
  description text not null,
  -- Budget lines: how far along the item is, counting this invoice.
  percent_bps int,
  amount_cents bigint not null,
  taxable boolean not null default false,
  sort_order int not null default 0
);
create index if not exists job_invoice_lines_invoice on ops.job_invoice_lines (invoice_id, sort_order);
create index if not exists job_invoice_lines_budget on ops.job_invoice_lines (budget_item_id);

-- A phase's share of the contract, for billing by schedule phase.
alter table ops.job_phases add column if not exists bill_bps int check (bill_bps between 0 and 10000);

-- ── Payments ──
alter table ops.payments alter column quote_id drop not null;
alter table ops.payments add column if not exists invoice_id text references ops.job_invoices(id) on delete cascade;
alter table ops.payments add column if not exists job_id text references ops.jobs(id) on delete set null;
alter table ops.payments add column if not exists customer_id text references ops.customers(id) on delete set null;
-- CHECK, ACH, CASH, CARD, OTHER.
alter table ops.payments add column if not exists method text;
-- A check number, a transfer reference.
alter table ops.payments add column if not exists reference text;
alter table ops.payments add column if not exists received_on date;
alter table ops.payments add column if not exists note text;
alter table ops.payments add column if not exists recorded_by_id text references ops.users(id) on delete set null on update cascade;
alter table ops.payments add column if not exists receipt_sent_to text;
alter table ops.payments add column if not exists receipt_sent_at timestamptz;
alter table ops.payments drop constraint if exists payments_provider_ref_key;
create unique index if not exists payments_org_provider_ref on ops.payments (org_id, provider_ref) where provider_ref is not null;
create index if not exists payments_invoice on ops.payments (invoice_id);
create index if not exists payments_job on ops.payments (job_id);

-- ── Connections (a business's own Stripe account) ──
create table if not exists ops.connections (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  provider text not null check (provider in ('STRIPE')),
  -- Sealed (AES-GCM) with the same key as email API keys; never sent back to the browser.
  secret_enc text not null,
  account_id text,
  account_name text,
  livemode boolean not null default false,
  connected_by_id text references ops.users(id) on delete set null on update cascade,
  connected_at timestamptz not null default now(),
  unique (org_id, provider)
);

-- ── Selections ──
create table if not exists ops.job_selections (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  title text not null,
  description text,
  due_date date,
  -- OPEN: waiting for the client. CHOSEN: picked (can still change). LOCKED: final.
  status text not null default 'OPEN' check (status in ('OPEN', 'CHOSEN', 'LOCKED')),
  chosen_option_id text,
  chosen_by text,
  chosen_at timestamptz,
  -- The budget line the pick became.
  budget_item_id text references ops.budget_items(id) on delete set null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists job_selections_job on ops.job_selections (job_id, sort_order);
create table if not exists ops.job_selection_options (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  selection_id text not null references ops.job_selections(id) on delete cascade,
  name text not null,
  description text,
  -- What the pick adds to the contract (0: included) and what it costs the business.
  price_cents bigint not null default 0,
  cost_cents bigint not null default 0,
  sort_order int not null default 0
);
create index if not exists job_selection_options_sel on ops.job_selection_options (selection_id, sort_order);

-- ── Messages between the client and the business, per job ──
create table if not exists ops.portal_messages (
  id text primary key default ops.id(),
  org_id text not null default ops.current_org() references ops.organization(id) on delete cascade,
  job_id text not null references ops.jobs(id) on delete cascade,
  from_client boolean not null,
  author_name text,
  author_email text,
  author_user_id text references ops.users(id) on delete set null on update cascade,
  body text not null check (length(body) between 1 and 5000),
  -- Read by the other side.
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists portal_messages_job on ops.portal_messages (job_id, created_at);

do $$ declare t text; begin
  foreach t in array array['job_invoices', 'job_invoice_lines', 'connections', 'job_selections', 'job_selection_options', 'portal_messages'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on ops.%I to ops_app', t);
    if not exists (select 1 from pg_policies where schemaname = 'ops' and tablename = t and policyname = 'org_isolation') then
      execute format('create policy org_isolation on ops.%I to ops_app using (org_id = ops.current_org()) with check (org_id = ops.current_org())', t);
    end if;
  end loop;
end $$;

-- ── Portal sign-in (across organizations: one client email may be a client of several businesses) ──
-- Only the function's own connection uses these, never ops_app.
create table if not exists ops.portal_codes (
  id text primary key default ops.id(),
  email text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists portal_codes_email on ops.portal_codes (lower(email), created_at desc);
create table if not exists ops.portal_sessions (
  token_hash text primary key,
  email text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists portal_sessions_email on ops.portal_sessions (lower(email));
do $$ declare t text; begin
  foreach t in array array['portal_codes', 'portal_sessions'] loop
    execute format('alter table ops.%I enable row level security', t);
    execute format('revoke all on ops.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ── Invoice defaults ──
alter table ops.avl_business add column if not exists invoice_due_days int not null default 30 check (invoice_due_days between 0 and 365);
-- Printed at the bottom of every invoice (how to pay by check or transfer, late fees…).
alter table ops.avl_business add column if not exists invoice_notes text;
grant update (invoice_due_days, invoice_notes) on ops.avl_business to ops_app;
