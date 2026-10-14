-- ============================================================================
-- Chef KnifeWorks · Journey Engine · Foundation schema
--
-- Principle: every customer-facing message is caused by a verified event that
-- was recorded in `journey_events`. Messages are planned into an outbox with a
-- unique dedupe key (so retries can never double-send) and re-checked against
-- live state at send time (so stale reminders are suppressed, not sent).
--
-- Security: RLS is enabled on every table. Anonymous users have no access at
-- all. Signed-in staff (rows in staff_members) can read. All writes go through
-- server code using the service role.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.reservation_status as enum (
  'booked', 'checked_in', 'in_service', 'ready', 'picked_up', 'cancelled', 'no_show'
);
create type public.payment_status as enum ('unpaid', 'link_sent', 'paid', 'comped', 'refunded');
create type public.message_channel as enum ('sms', 'email');
create type public.message_status as enum ('queued', 'sending', 'sent', 'failed', 'canceled', 'skipped');
create type public.journey_stage as enum ('discover', 'reserve', 'experience', 'delight', 'return_refer');

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table public.staff_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff_members where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  phone text unique check (phone ~ '^\+1[0-9]{10}$'),
  email text,
  -- Transactional texts (confirmations, ready-for-pickup) — implied by booking.
  sms_opt_in boolean not null default true,
  -- Reminders, referral invites and seasonal campaigns — explicit checkbox only.
  marketing_opt_in boolean not null default false,
  referral_code text not null unique,
  referred_by uuid references public.customers (id) on delete set null,
  first_source text,
  first_utm jsonb not null default '{}'::jsonb,
  notes text,
  review_requested_at timestamptz,
  review_clicked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_contactable check (phone is not null or email is not null),
  constraint customers_not_self_referred check (referred_by is null or referred_by <> id)
);
create unique index customers_email_lower_key on public.customers (lower(email)) where email is not null;
create index customers_name_search on public.customers using gin (to_tsvector('simple', full_name));

-- ---------------------------------------------------------------------------
-- Drop-off windows (2-hour windows, editable without a deploy)
-- ---------------------------------------------------------------------------
create table public.drop_windows (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time time not null,
  capacity integer not null default 4 check (capacity > 0),
  active boolean not null default true,
  constraint drop_windows_order check (end_time > start_time),
  unique (weekday, start_time)
);

create table public.blackout_dates (
  day date primary key,
  reason text
);

-- ---------------------------------------------------------------------------
-- Reservations (one reservation = one bundle of items through the shop)
-- ---------------------------------------------------------------------------
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                              -- human code, e.g. CKW-7KQ4
  access_token text not null unique,                      -- private customer link token
  customer_id uuid not null references public.customers (id) on delete restrict,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status public.reservation_status not null default 'booked',
  payment_status public.payment_status not null default 'unpaid',
  items jsonb not null default '{}'::jsonb,               -- {"kitchen_knives": 5, "scissors": 1, ...}
  item_count integer not null default 0 check (item_count >= 0),
  amount_due_cents integer check (amount_due_cents is null or amount_due_cents >= 0),
  amount_paid_cents integer check (amount_paid_cents is null or amount_paid_cents >= 0),
  payment_method text,
  square_payment_link_id text,
  square_payment_link_url text,
  square_order_id text unique,
  source text,
  utm jsonb not null default '{}'::jsonb,
  referral_code_used text,
  customer_notes text,
  staff_notes text,
  created_at timestamptz not null default now(),
  checked_in_at timestamptz,
  ready_at timestamptz,
  paid_at timestamptz,
  picked_up_at timestamptz,
  cancelled_at timestamptz,
  constraint reservations_window_order check (window_end > window_start)
);
create index reservations_window_idx on public.reservations (window_start);
create index reservations_customer_idx on public.reservations (customer_id, created_at desc);
create index reservations_status_idx on public.reservations (status);

-- ---------------------------------------------------------------------------
-- Journey events — append-only record of verified customer events
-- ---------------------------------------------------------------------------
create table public.journey_events (
  id bigint generated always as identity primary key,
  type text not null,
  stage public.journey_stage not null,
  customer_id uuid references public.customers (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete cascade,
  actor text not null default 'system',                   -- customer | staff:<uuid> | square | system
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  occurred_at timestamptz not null default now()
);
create index journey_events_customer_idx on public.journey_events (customer_id, occurred_at desc);
create index journey_events_type_idx on public.journey_events (type, occurred_at desc);

create or replace function public.journey_events_block_changes()
returns trigger language plpgsql as $$
begin
  raise exception 'journey_events is append-only';
end;
$$;
create trigger journey_events_append_only
  before update or delete on public.journey_events
  for each row execute function public.journey_events_block_changes();

-- ---------------------------------------------------------------------------
-- Campaigns (seasonal reminders sent by staff to a segment)
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  segment text not null check (segment in ('all_opted_in', 'lapsed_90', 'lapsed_180', 'one_and_done')),
  body text not null check (length(body) between 10 and 480),
  created_by uuid references auth.users (id) on delete set null,
  queued_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Message outbox
-- ---------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers (id) on delete cascade,
  reservation_id uuid references public.reservations (id) on delete cascade,
  campaign_id uuid references public.campaigns (id) on delete set null,
  caused_by_event bigint references public.journey_events (id) on delete set null,
  template text not null,
  stage public.journey_stage not null,
  channel public.message_channel not null,
  recipient text not null,
  subject text,
  body text not null,
  send_after timestamptz not null default now(),
  guard text,                                             -- send-time check, see src/engine/guards.ts
  quiet_hours boolean not null default true,              -- defer SMS outside 9am–8pm Central
  status public.message_status not null default 'queued',
  dedupe_key text not null unique,
  attempts integer not null default 0,
  claimed_at timestamptz,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_due_idx on public.messages (send_after) where status = 'queued';
create index messages_customer_idx on public.messages (customer_id, created_at desc);
create index messages_template_idx on public.messages (template, status);

-- Atomically claim due messages so two dispatcher runs never send the same one.
create or replace function public.claim_due_messages(p_limit integer default 25)
returns setof public.messages
language sql
security definer
set search_path = public
as $$
  update public.messages m
     set status = 'sending', attempts = m.attempts + 1, claimed_at = now()
   where m.id in (
     select id from public.messages
      where status = 'queued' and send_after <= now()
      order by send_after
      limit p_limit
      for update skip locked
   )
  returning m.*;
$$;

-- Messages stuck in 'sending' (crashed function) go back to the queue.
create or replace function public.requeue_stuck_messages()
returns integer
language sql
security definer
set search_path = public
as $$
  with r as (
    update public.messages set status = 'queued', last_error = 'requeued after stuck send'
     where status = 'sending' and attempts < 5
       and claimed_at < now() - interval '15 minutes'
    returning 1
  ) select count(*)::int from r;
$$;

-- ---------------------------------------------------------------------------
-- Referrals
-- ---------------------------------------------------------------------------
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.customers (id) on delete cascade,
  referred_id uuid not null unique references public.customers (id) on delete cascade,
  first_reservation_id uuid references public.reservations (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rewarded')),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  reward_note text,
  created_at timestamptz not null default now(),
  constraint referrals_not_self check (referrer_id <> referred_id)
);
create index referrals_referrer_idx on public.referrals (referrer_id);

-- ---------------------------------------------------------------------------
-- Capacity-safe booking. Serialises bookings per window with an advisory lock
-- so two customers can never take the last spot at the same moment.
-- ---------------------------------------------------------------------------
create or replace function public.book_reservation(
  p_customer_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_capacity integer,
  p_code text,
  p_access_token text,
  p_items jsonb,
  p_item_count integer,
  p_source text,
  p_utm jsonb,
  p_referral_code_used text,
  p_customer_notes text
)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken integer;
  v_row public.reservations;
begin
  perform pg_advisory_xact_lock(hashtext('ckw_window:' || p_window_start::text));

  select count(*) into v_taken
    from public.reservations
   where window_start = p_window_start
     and status not in ('cancelled', 'no_show');

  if v_taken >= p_capacity then
    raise exception 'window_full' using errcode = 'P0001';
  end if;

  insert into public.reservations (
    customer_id, window_start, window_end, code, access_token, items, item_count,
    source, utm, referral_code_used, customer_notes
  ) values (
    p_customer_id, p_window_start, p_window_end, p_code, p_access_token, coalesce(p_items, '{}'::jsonb),
    coalesce(p_item_count, 0), p_source, coalesce(p_utm, '{}'::jsonb), p_referral_code_used, p_customer_notes
  ) returning * into v_row;

  return v_row;
end;
$$;

-- Bookings per window in a date range (for the public availability picker).
create or replace function public.window_bookings(p_from timestamptz, p_to timestamptz)
returns table (window_start timestamptz, taken integer)
language sql
stable
security definer
set search_path = public
as $$
  select window_start, count(*)::int
    from public.reservations
   where window_start >= p_from and window_start < p_to
     and status not in ('cancelled', 'no_show')
   group by window_start;
$$;

-- ---------------------------------------------------------------------------
-- Journey metrics — every stage measured from verified events
-- ---------------------------------------------------------------------------
create or replace function public.journey_metrics(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with
  ev as (select * from public.journey_events where occurred_at >= p_since),
  res as (select * from public.reservations where created_at >= p_since),
  msg as (select * from public.messages where created_at >= p_since),
  completed_per_customer as (
    select customer_id, count(*) as n
      from public.reservations where status = 'picked_up' group by customer_id
  )
  select jsonb_build_object(
    'since', p_since,
    'discover', jsonb_build_object(
      'new_customers', (select count(*) from ev where type = 'customer.created'),
      'by_source', coalesce((
        select jsonb_object_agg(src, n) from (
          select coalesce(nullif(payload->>'source', ''), 'direct') as src, count(*) as n
            from ev where type = 'customer.created' group by 1
        ) s), '{}'::jsonb)
    ),
    'reserve', jsonb_build_object(
      'booked', (select count(*) from ev where type = 'reservation.booked'),
      'cancelled', (select count(*) from ev where type = 'reservation.cancelled'),
      'no_show', (select count(*) from ev where type = 'reservation.no_show'),
      'confirmations_sent', (select count(*) from msg where template = 'booking_confirmed' and status = 'sent')
    ),
    'experience', jsonb_build_object(
      'checked_in', (select count(*) from ev where type = 'reservation.checked_in'),
      'ready', (select count(*) from ev where type = 'reservation.ready'),
      'paid', (select count(*) from ev where type = 'payment.received'),
      'picked_up', (select count(*) from ev where type = 'reservation.picked_up'),
      'revenue_cents', (select coalesce(sum((payload->>'amount_cents')::int), 0) from ev where type = 'payment.received'),
      'avg_turnaround_hours', (
        select round(avg(extract(epoch from (ready_at - checked_in_at)) / 3600)::numeric, 1)
          from res where ready_at is not null and checked_in_at is not null)
    ),
    'delight', jsonb_build_object(
      'thank_yous_sent', (select count(*) from msg where template = 'thank_you_aftercare' and status = 'sent'),
      'review_requests_sent', (select count(*) from msg where template = 'review_request' and status = 'sent'),
      'review_link_clicks', (select count(*) from ev where type = 'review.clicked')
    ),
    'return_refer', jsonb_build_object(
      'reminders_sent', (select count(*) from msg where template in ('resharpen_reminder', 'campaign') and status = 'sent'),
      'repeat_bookings', (select count(*) from ev where type = 'reservation.booked' and (payload->>'is_repeat')::boolean),
      'referral_invites_sent', (select count(*) from msg where template = 'referral_invite' and status = 'sent'),
      'referred_bookings', (select count(*) from ev where type = 'reservation.booked' and payload ? 'referred_by'),
      'referrals_qualified', (select count(*) from ev where type = 'referral.qualified'),
      'repeat_customer_rate', (
        select case when count(*) = 0 then 0
                    else round(100.0 * count(*) filter (where n >= 2) / count(*), 1) end
          from completed_per_customer)
    ),
    'messages', jsonb_build_object(
      'sent', (select count(*) from msg where status = 'sent'),
      'failed', (select count(*) from msg where status = 'failed'),
      'suppressed', (select count(*) from msg where status in ('skipped', 'canceled')),
      'queued', (select count(*) from public.messages where status = 'queued')
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: no anonymous access; staff read-only from the browser.
-- ---------------------------------------------------------------------------
alter table public.staff_members enable row level security;
alter table public.customers enable row level security;
alter table public.drop_windows enable row level security;
alter table public.blackout_dates enable row level security;
alter table public.reservations enable row level security;
alter table public.journey_events enable row level security;
alter table public.campaigns enable row level security;
alter table public.messages enable row level security;
alter table public.referrals enable row level security;

create policy staff_read on public.staff_members for select to authenticated using (public.is_staff());
create policy staff_read on public.customers for select to authenticated using (public.is_staff());
create policy staff_read on public.drop_windows for select to authenticated using (public.is_staff());
create policy staff_read on public.blackout_dates for select to authenticated using (public.is_staff());
create policy staff_read on public.reservations for select to authenticated using (public.is_staff());
create policy staff_read on public.journey_events for select to authenticated using (public.is_staff());
create policy staff_read on public.campaigns for select to authenticated using (public.is_staff());
create policy staff_read on public.messages for select to authenticated using (public.is_staff());
create policy staff_read on public.referrals for select to authenticated using (public.is_staff());

-- Server-only functions: never callable from the browser.
revoke execute on function public.claim_due_messages(integer) from public, anon, authenticated;
revoke execute on function public.requeue_stuck_messages() from public, anon, authenticated;
revoke execute on function public.book_reservation(uuid, timestamptz, timestamptz, integer, text, text, jsonb, integer, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.window_bookings(timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.journey_metrics(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Default schedule: Mon–Sat, five 2-hour windows, 4 bundles per window.
-- Edit rows in drop_windows to change hours — no deploy needed.
-- ---------------------------------------------------------------------------
insert into public.drop_windows (weekday, start_time, end_time, capacity)
select d, t::time, (t::time + interval '2 hours')::time, 4
  from generate_series(1, 6) as d,
       unnest(array['08:00', '10:00', '12:00', '14:00', '16:00']) as t;
