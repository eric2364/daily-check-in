-- Run as postgres after the cloud migration. All fixtures roll back.
begin;
insert into auth.users(id,email,is_anonymous) values
 ('11111111-1111-4111-8111-111111111111','cloud-test-a@example.invalid',false),
 ('22222222-2222-4222-8222-222222222222','cloud-test-b@example.invalid',false),
 ('33333333-3333-4333-8333-333333333333',null,true);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
do $$
declare result jsonb; first_op jsonb := '[{"date":"2000-01-01","entry":{"date":"2000-01-01","intake":3,"weight":70,"cardio":true,"cardioType":"Run","cardioMinutes":20,"cardioCalories":100},"base_revision":null,"mutation_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}]';
begin
 result := public.journal_sync(first_op);
 assert jsonb_array_length(result->'records')=1;
 assert jsonb_array_length(result->'acknowledged')=1;
 result := public.journal_sync(first_op);
 assert jsonb_array_length(result->'acknowledged')=1;
 -- Stale base must preserve the winning entry, including remote deletion.
 result := public.journal_sync('[{"date":"2000-01-01","entry":null,"base_revision":null,"mutation_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}]');
 assert jsonb_array_length(result->'conflicts')=1;
 assert result->'records'->0->'entry'->>'intake'='3';
 result := public.journal_sync('[{"date":"2000-01-01","entry":null,"base_revision":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","mutation_id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}]');
 assert result->'records'->0->'entry'='null'::jsonb;
 result := public.journal_sync(first_op);
 assert jsonb_array_length(result->'acknowledged')=1;
 assert result->'records'->0->'entry'='null'::jsonb;
 -- A rejected batch is atomic: first valid operation cannot leak through.
 begin
  perform public.journal_sync('[{"date":"2000-01-02","entry":{"date":"2000-01-02","intake":2,"weight":null},"base_revision":null,"mutation_id":"dddddddd-dddd-4ddd-8ddd-dddddddddddd"},{"date":"2000-01-03","entry":{"date":"2000-01-03","intake":9,"weight":null},"base_revision":null,"mutation_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"}]');
  raise exception 'Invalid batch accepted';
 exception when invalid_parameter_value then null; end;
 assert (select count(*) from public.journal_records)=1;
 begin
  insert into public.journal_records(user_id,date,entry,revision) values
   ('22222222-2222-4222-8222-222222222222','2000-01-04',null,'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  raise exception 'Direct write unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.journal_sync('[{"date":"2000-01-01","entry":null,"base_revision":null,"mutation_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}]');
  raise exception 'Reused mutation ID accepted';
 exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
do $$ declare result jsonb; begin
 assert (select count(*) from public.journal_records)=0;
 result := public.journal_sync('[]');
 assert result->'records'='[]'::jsonb;
 -- Same date belongs independently to account B, never modifying account A.
 result := public.journal_sync('[{"date":"2000-01-01","entry":{"date":"2000-01-01","intake":5,"weight":null},"base_revision":null,"mutation_id":"ffffffff-ffff-4fff-8fff-ffffffffffff"}]');
 assert result->'records'->0->'entry'->>'intake'='5';
end $$;
select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":true}',true);
do $$ begin
 assert (select count(*) from public.journal_records)=0;
 begin perform public.journal_sync('[]'); raise exception 'Guest sync accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform public.journal_sync('[]'); raise exception 'Unauthenticated RPC accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 assert (select count(*) from public.journal_records)=2;
 assert (select entry is null from public.journal_records where user_id='11111111-1111-4111-8111-111111111111');
end $$;
rollback;
