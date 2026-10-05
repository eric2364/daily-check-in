-- The database contains notification addresses and schedules only, no intake or weight.
create table public.reminder_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  subscription jsonb not null,
  reminder_time time not null default '09:00',
  last_dispatched_on date,
  last_test_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint valid_subscription check (
    jsonb_typeof(subscription) = 'object' and
    subscription ? 'endpoint' and subscription ? 'keys'
  )
);

alter table public.reminder_subscriptions enable row level security;
revoke all on public.reminder_subscriptions from anon, authenticated;
grant select on public.reminder_subscriptions to authenticated;
create policy "Read own reminder subscription"
  on public.reminder_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
-- All mutations happen in the authenticated Edge Function, keeping delivery
-- bookkeeping and rate limits inaccessible to direct client edits.
grant all on public.reminder_subscriptions to service_role;

create function public.claim_due_reminders()
returns table (user_id uuid, subscription jsonb)
language sql security definer set search_path = '' as $$
  with local_clock as (
    select timezone('Asia/Hong_Kong', now()) as local_now
  ), candidates as (
    select s.user_id
    from public.reminder_subscriptions s, local_clock c
    where s.last_dispatched_on is distinct from c.local_now::date
      and s.reminder_time <= c.local_now::time
      and c.local_now < c.local_now::date + s.reminder_time + interval '10 minutes'
    order by s.user_id
    limit 50
    for update of s skip locked
  )
  update public.reminder_subscriptions s
  set last_dispatched_on = (select local_now::date from local_clock)
  from candidates c where s.user_id = c.user_id
  returning s.user_id, s.subscription;
$$;

create function public.claim_reminder_test(target_user uuid)
returns table (subscription jsonb)
language sql security definer set search_path = '' as $$
  update public.reminder_subscriptions s
  set last_test_at = now()
  where s.user_id = target_user
    and (s.last_test_at is null or s.last_test_at < now() - interval '1 minute')
  returning s.subscription;
$$;

revoke all on function public.claim_due_reminders() from public, anon, authenticated;
revoke all on function public.claim_reminder_test(uuid) from public, anon, authenticated;
grant execute on function public.claim_due_reminders() to service_role;
grant execute on function public.claim_reminder_test(uuid) to service_role;
