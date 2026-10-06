begin;
-- Optional account sync. Local journals remain usable without an account.
create table public.journal_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  entry jsonb,
  revision uuid not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
-- Receipts make an interrupted request safe to retry even after a newer write.
create table public.journal_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  mutation_id uuid not null,
  operation jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);
alter table public.journal_records enable row level security;
alter table public.journal_mutations enable row level security;
revoke all on public.journal_records, public.journal_mutations from public, anon, authenticated;
grant select on public.journal_records to authenticated;
create policy "Account reads own journal" on public.journal_records
  for select to authenticated using (
    (select auth.uid()) = user_id
    and coalesce((select auth.jwt())->>'is_anonymous', 'false') <> 'true'
  );
-- No direct insert/update/delete grants or policies: all writes use the CAS RPC.

grant all on public.journal_records, public.journal_mutations to service_role;

create function public.validate_cloud_entry(value jsonb, entry_date date)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  intake numeric; weight numeric; cardio boolean;
  minutes numeric; calories numeric; cardio_type text;
begin
  if value = 'null'::jsonb then return null; end if;
  if value is null or jsonb_typeof(value) <> 'object'
     or value->>'date' is distinct from to_char(entry_date, 'YYYY-MM-DD')
     or not (value ? 'intake' and value ? 'weight') then
    raise exception 'Invalid entry object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(value) k where k not in
    ('date','intake','weight','cardio','cardioType','cardioMinutes','cardioCalories')) then
    raise exception 'Unknown entry field' using errcode = '22023';
  end if;
  if jsonb_typeof(value->'intake') not in ('number','null')
     or jsonb_typeof(value->'weight') not in ('number','null') then
    raise exception 'Invalid intake or weight type' using errcode = '22023';
  end if;
  intake := (value->>'intake')::numeric; weight := (value->>'weight')::numeric;
  if intake is not null and (intake < 1 or intake > 5 or trunc(intake) <> intake) then
    raise exception 'Intake must be 1–5' using errcode = '22023';
  end if;
  if weight is not null and (weight <= 0 or weight > 1000) then
    raise exception 'Invalid weight' using errcode = '22023';
  end if;
  if value ? 'cardio' and jsonb_typeof(value->'cardio') not in ('boolean','null') then
    raise exception 'Invalid cardio answer' using errcode = '22023';
  end if;
  cardio := (value->>'cardio')::boolean;
  if value ? 'cardioType' and jsonb_typeof(value->'cardioType') <> 'string' then
    raise exception 'Invalid cardio type' using errcode = '22023';
  end if;
  cardio_type := btrim(coalesce(value->>'cardioType',''));
  if length(coalesce(value->>'cardioType','')) > 100 then
    raise exception 'Cardio type too long' using errcode = '22023';
  end if;
  if (value ? 'cardioMinutes' and jsonb_typeof(value->'cardioMinutes') not in ('number','null'))
     or (value ? 'cardioCalories' and jsonb_typeof(value->'cardioCalories') not in ('number','null')) then
    raise exception 'Invalid cardio number' using errcode = '22023';
  end if;
  minutes := (value->>'cardioMinutes')::numeric;
  calories := (value->>'cardioCalories')::numeric;
  if minutes < 0 or minutes > 1440 or calories < 0 or calories > 10000 then
    raise exception 'Cardio number outside bounds' using errcode = '22023';
  end if;
  if cardio is null and (cardio_type <> '' or minutes is not null or calories is not null) then
    raise exception 'Cardio answer required' using errcode = '22023';
  end if;
  if intake is null and weight is null and cardio is null then
    raise exception 'Empty entry' using errcode = '22023';
  end if;
  return jsonb_build_object('date', to_char(entry_date,'YYYY-MM-DD'),
    'intake',intake,'weight',weight,'cardio',cardio,
    'cardioType',case when cardio then cardio_type else '' end,
    'cardioMinutes',case when cardio then minutes else null end,
    'cardioCalories',case when cardio then calories else null end);
end;
$$;
revoke all on function public.validate_cloud_entry(jsonb,date) from public, anon, authenticated;

create function public.journal_sync(p_operations jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  operation jsonb; saved_operation jsonb; normalized jsonb;
  entry_date date; mutation uuid; base uuid; current_record public.journal_records%rowtype;
  seen_dates date[] := '{}'; seen_mutations uuid[] := '{}';
  acknowledged jsonb := '[]'; conflicts jsonb := '[]'; records jsonb;
begin
  if caller is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true'
     or not exists (select 1 from auth.users u where u.id = caller and not coalesce(u.is_anonymous,false)) then
    raise exception 'Sign in to sync your journal' using errcode = '42501';
  end if;
  if p_operations is null or jsonb_typeof(p_operations) <> 'array'
     or jsonb_array_length(p_operations) > 200 or octet_length(p_operations::text) > 262144 then
    raise exception 'Invalid sync batch (maximum 200 operations)' using errcode = '22023';
  end if;
  -- Serialize requests for this account, including inserts of previously absent dates.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));
  for operation in select value from jsonb_array_elements(p_operations) loop
    if jsonb_typeof(operation) <> 'object' or not (operation ?& array['date','entry','base_revision','mutation_id'])
       or jsonb_typeof(operation->'date') <> 'string'
       or (operation->>'date') !~ '^\d{4}-\d{2}-\d{2}$'
       or jsonb_typeof(operation->'mutation_id') <> 'string'
       or jsonb_typeof(operation->'base_revision') not in ('string','null') then
      raise exception 'Invalid sync operation' using errcode = '22023';
    end if;
    entry_date := (operation->>'date')::date;
    if to_char(entry_date,'YYYY-MM-DD') <> operation->>'date'
       or entry_date > timezone('Asia/Hong_Kong',now())::date then
      raise exception 'Invalid or future date' using errcode = '22023';
    end if;
    mutation := (operation->>'mutation_id')::uuid;
    base := (operation->>'base_revision')::uuid;
    if entry_date = any(seen_dates) or mutation = any(seen_mutations) then
      raise exception 'Duplicate date or mutation in batch' using errcode = '22023';
    end if;
    seen_dates := array_append(seen_dates,entry_date);
    seen_mutations := array_append(seen_mutations,mutation);
    normalized := public.validate_cloud_entry(operation->'entry', entry_date);
    select m.operation into saved_operation from public.journal_mutations m
      where m.user_id = caller and m.mutation_id = mutation;
    if found then
      if saved_operation <> operation then
        raise exception 'Mutation ID reused for a different operation' using errcode = '22023';
      end if;
      acknowledged := acknowledged || jsonb_build_array(mutation);
      continue;
    end if;
    select * into current_record from public.journal_records r
      where r.user_id = caller and r.date = entry_date;
    if (found and current_record.revision is distinct from base) or (not found and base is not null) then
      conflicts := conflicts || jsonb_build_array(jsonb_build_object('date',to_char(entry_date,'YYYY-MM-DD'),
        'entry',current_record.entry,'revision',current_record.revision));
      continue;
    end if;
    insert into public.journal_records(user_id,date,entry,revision)
      values(caller,entry_date,normalized,mutation)
      on conflict(user_id,date) do update set entry=excluded.entry, revision=excluded.revision, updated_at=now();
    insert into public.journal_mutations(user_id,mutation_id,operation) values(caller,mutation,operation);
    acknowledged := acknowledged || jsonb_build_array(mutation);
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('date',to_char(r.date,'YYYY-MM-DD'),
    'entry',r.entry,'revision',r.revision) order by r.date),'[]') into records
    from public.journal_records r where r.user_id=caller;
  return jsonb_build_object('records',records,'conflicts',conflicts,'acknowledged',acknowledged);
end;
$$;
revoke all on function public.journal_sync(jsonb) from public, anon;
grant execute on function public.journal_sync(jsonb) to authenticated;

commit;
