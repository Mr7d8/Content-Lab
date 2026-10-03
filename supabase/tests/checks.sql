-- Behaviour checks for the migrations. Each check raises a PASS notice or fails.
-- Run with: DATABASE_URL=postgres://... pnpm db:check (plain, empty Postgres).

insert into auth.users values ('11111111-1111-1111-1111-111111111111','member@example.com'),('22222222-2222-2222-2222-222222222222','stranger@example.com');
insert into public.team_members (email) values ('member@example.com');

-- 1. Stranger: signed in but not on the team
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","email":"stranger@example.com"}';
do $$ begin
  begin
    insert into public.runs (source, spend_cap_usd) values ('manual_import', 2);
    raise exception 'FAIL stranger could insert';
  exception when insufficient_privilege then raise notice 'PASS stranger insert blocked'; end;
end $$;
rollback;

-- 2. Team member: full flow
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"Member@Example.com"}';
insert into public.runs (source, spend_cap_usd, items_requested) values ('manual_import', 2, 1);
insert into public.items (source, source_url, external_id, advertiser) values ('tiktok_organic','https://www.tiktok.com/@temu/video/123','123','Temu');
insert into public.run_items (run_id, item_id, position) select r.id, i.id, 0 from public.runs r, public.items i;
insert into public.metrics (item_id, metric_name, value, unit) select id, 'likes', 1200, 'count' from public.items;
insert into public.metrics (item_id, metric_name, value_text) select id, 'ctr_tier', 'top_20' from public.items;
insert into public.classifications (item_id, model, prompt_version, vision_version, labels_json, confidence)
  select id, 'test-model', 'taxonomy-v1', 'vision-v1', '{"hook_type":"price_shock","format":"creator_ugc"}', 0.8 from public.items;
do $$ declare n int; who uuid; begin
  select count(*) into n from public.classifications where labels_json @> '{"hook_type":"price_shock"}';
  if n <> 1 then raise exception 'FAIL label filter'; end if;
  select created_by into who from public.runs;
  if who <> '11111111-1111-1111-1111-111111111111' then raise exception 'FAIL created_by default'; end if;
  select count(*) into n from public.team_members;
  if n <> 1 then raise exception 'FAIL team member cannot read team'; end if;
  raise notice 'PASS team member flow, label filter, created_by default';
  begin
    insert into public.team_members (email) values ('friend@example.com');
    raise exception 'FAIL member could add team members';
  exception when insufficient_privilege then raise notice 'PASS member cannot edit allowlist'; end;
end $$;
commit;

-- 3. Stranger sees nothing that exists
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","email":"stranger@example.com"}';
do $$ declare n int; begin
  select (select count(*) from public.items) + (select count(*) from public.runs) + (select count(*) from public.team_members) into n;
  if n <> 0 then raise exception 'FAIL stranger sees % rows', n; end if;
  raise notice 'PASS stranger sees 0 rows';
end $$;
rollback;

-- 4. anon has no table privileges at all
begin;
set local role anon;
do $$ begin
  perform 1 from public.items;
  raise exception 'FAIL anon could select';
exception when insufficient_privilege then raise notice 'PASS anon denied'; end $$;
rollback;

-- 5. Constraints (as owner)
do $$ begin
  begin insert into public.items (source, source_url, external_id) values ('tiktok_organic','https://www.tiktok.com/@temu/video/123','123');
    raise exception 'FAIL duplicate item';
  exception when unique_violation then raise notice 'PASS unique (source, external_id)'; end;
  begin insert into public.items (source, source_url, external_id) values ('TikTok','https://x','9');
    raise exception 'FAIL bad source';
  exception when check_violation then raise notice 'PASS source format check'; end;
  begin insert into public.runs (source) values ('manual_import');
    raise exception 'FAIL run without cap';
  exception when not_null_violation then raise notice 'PASS spend cap required'; end;
  begin insert into public.metrics (item_id, metric_name) select id, 'views' from public.items;
    raise exception 'FAIL empty metric';
  exception when check_violation then raise notice 'PASS no empty metric rows'; end;
  begin insert into public.patterns (period, objective, label_combo, direction, lift, top_count, cohort_count, advertiser_count) values ('2026-13','purchase','{}','winning',1.4,8,40,2);
    raise exception 'FAIL bad period';
  exception when check_violation then raise notice 'PASS period format'; end;
end $$;
insert into public.patterns (period, objective, label_combo, direction, lift, top_count, cohort_count, advertiser_count) values ('2026-10','purchase','{"hook_type":"price_shock"}','winning',1.4,8,40,2);
do $$ begin
  insert into public.patterns (period, objective, label_combo, direction, lift, top_count, cohort_count, advertiser_count) values ('2026-10','purchase','{"hook_type":"price_shock"}','winning',1.5,9,40,2);
  raise exception 'FAIL duplicate pattern with null region';
exception when unique_violation then raise notice 'PASS pattern unique with null region'; end $$;

-- 6. updated_at trigger and cascade
do $$ declare a timestamptz; b timestamptz; n int; begin
  select updated_at into a from public.runs;
  perform pg_sleep(0.01);
  update public.runs set status = 'running';
  select updated_at into b from public.runs;
  if b <= a then raise exception 'FAIL updated_at'; end if;
  delete from public.items;
  select (select count(*) from public.run_items) + (select count(*) from public.metrics) + (select count(*) from public.classifications) into n;
  if n <> 0 then raise exception 'FAIL cascade'; end if;
  raise notice 'PASS updated_at trigger and item cascade';
end $$;

-- 7. Storage policy
insert into storage.objects (bucket_id, name) values ('frames', 'abc/0.jpg');
begin; set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","email":"stranger@example.com"}';
do $$ declare n int; begin select count(*) into n from storage.objects; if n <> 0 then raise exception 'FAIL stranger sees frames'; end if; end $$;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"member@example.com"}';
do $$ declare n int; begin select count(*) into n from storage.objects; if n <> 1 then raise exception 'FAIL member cannot see frames'; end if; raise notice 'PASS frames bucket policy'; end $$;
rollback;

-- 8. Plan update checks
do $$ declare n int; begin
  select count(*) into n from public.watchlists;
  if n <> 9 then raise exception 'FAIL expected 9 seeded watchlists, got %', n; end if;
  select count(*) into n from public.watchlists where type = 'advertiser' and region is null;
  if n <> 3 then raise exception 'FAIL global advertiser watchlists'; end if;
  select count(*) into n from public.watchlists where type = 'industry' and region in ('MA','MENA','FR');
  if n <> 6 then raise exception 'FAIL category sweeps'; end if;
  raise notice 'PASS first sweep watchlists seeded';
  select count(*) into n from public.watchlists where refresh_cadence <> 'manual';
  if n <> 0 then raise exception 'FAIL % boards left on a schedule', n; end if;
  raise notice 'PASS every board scans only when asked';
  begin insert into public.watchlists (name, type, value, source, region) values ('x','advertiser','Temu','tiktok_creative_center','morocco');
    raise exception 'FAIL lowercase region accepted';
  exception when check_violation then raise notice 'PASS region code check'; end;
  begin insert into public.watchlists (name, type, value, source) values ('dup','advertiser','Temu','tiktok_creative_center');
    raise exception 'FAIL duplicate watchlist';
  exception when unique_violation then raise notice 'PASS watchlist unique with null region/objective'; end;
end $$;
insert into public.items (id, source, source_url, external_id) values ('33333333-3333-3333-3333-333333333333','tiktok_creative_center','https://ads.tiktok.com/business/creativecenter/topads/1/','1');
insert into public.runs (id, source, spend_cap_usd) values ('44444444-4444-4444-4444-444444444444','manual_import', 1);
insert into public.run_items (run_id, item_id, position, stage) values ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',0,'vision');
-- music-only ad: empty transcript, vision output present
insert into public.media (item_id, audio_type, transcript, scene_cuts, width, height, frames_json, ocr_text, vision_model, vision_version)
values ('33333333-3333-3333-3333-333333333333','music_only', null, '{1.2,2.8,4.1}', 1080, 1920,
  '[{"second":0,"description":"Hand holds sneakers","on_screen_text":["-50%"],"elements":{"product":true,"price":true}}]', '-50%', 'gemini-flash', 'vision-v1');
insert into public.classifications (item_id, model, prompt_version, vision_version, labels_json)
values ('33333333-3333-3333-3333-333333333333','jev','taxonomy-v1','vision-v1','{"hook_type":"price_shock"}');
insert into public.classifications (item_id, model, prompt_version, vision_version, labels_json)
values ('33333333-3333-3333-3333-333333333333','jev','taxonomy-v1','vision-v2','{"hook_type":"price_shock"}');
do $$ begin
  begin insert into public.classifications (item_id, model, prompt_version, labels_json)
    values ('33333333-3333-3333-3333-333333333333','jev','taxonomy-v2','{}');
    raise exception 'FAIL classification without vision_version';
  exception when not_null_violation then raise notice 'PASS vision stage, music-only media, versioned classifications'; end;
  begin insert into public.media (item_id, frames_json) values ('11111111-1111-1111-1111-111111111111','{"not":"array"}');
    raise exception 'FAIL frames_json object accepted';
  exception when check_violation then raise notice 'PASS frames_json must be an array'; end;
  if (select file_size_limit from storage.buckets where id = 'frames') <> 524288 then raise exception 'FAIL bucket limit'; end if;
  raise notice 'PASS frames bucket 512 KB WebP';
end $$;

-- 9. Research mode: settings, month spend, sweep columns
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"member@example.com"}';
insert into public.runs (source, spend_cap_usd, cost_actual_usd, trigger) values ('tiktok_creative_center', 0.5, 0.25, 'schedule');
insert into public.runs (source, spend_cap_usd, cost_actual_usd, created_at) values ('manual_import', 2, 1, now() - interval '40 days');
do $$ declare spend numeric; begin
  update public.app_settings set monthly_spend_cap_usd = 7;
  if (select monthly_spend_cap_usd from public.app_settings) <> 7 then raise exception 'FAIL member cannot update settings'; end if;
  begin
    insert into public.app_settings (id) values (true);
    raise exception 'FAIL member inserted a settings row';
  exception when insufficient_privilege then null; end;
  select public.month_spend_usd() into spend;
  if spend <> 0.25 then raise exception 'FAIL month spend %, expected 0.25 (last month excluded)', spend; end if;
  if (select count(*) from public.runs where trigger = 'manual') < 1 then raise exception 'FAIL trigger default'; end if;
  if (select min(max_items) from public.watchlists) <> 10 or (select count(*) from public.watchlists where last_swept_at is not null) <> 0 then
    raise exception 'FAIL watchlist sweep defaults';
  end if;
  begin
    update public.watchlists set max_items = 0;
    raise exception 'FAIL max_items 0 accepted';
  exception when check_violation then null; end;
  begin
    insert into public.runs (source, spend_cap_usd, trigger) values ('tiktok_organic', 1, 'cron');
    raise exception 'FAIL unknown trigger accepted';
  exception when check_violation then null; end;
  raise notice 'PASS app settings, month spend, sweep columns';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","email":"stranger@example.com"}';
do $$ declare n int; begin
  select count(*) into n from public.app_settings;
  if n <> 0 then raise exception 'FAIL stranger reads settings'; end if;
  update public.app_settings set sweeps_enabled = false;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL stranger updated settings'; end if;
  raise notice 'PASS settings hidden from strangers';
end $$;
rollback;

begin;
set local role anon;
do $$ begin
  begin
    perform 1 from public.app_settings;
    raise exception 'FAIL anon reads settings';
  exception when insufficient_privilege then raise notice 'PASS anon denied settings'; end;
end $$;
rollback;

-- 10. Signed-out visitors cannot call the app's functions (Supabase grants
-- EXECUTE on new functions to anon directly, not only through PUBLIC).
do $$ begin
  if has_function_privilege('anon', 'public.is_team_member()', 'execute') then raise exception 'FAIL anon can call is_team_member()'; end if;
  if has_function_privilege('anon', 'public.month_spend_usd()', 'execute') then raise exception 'FAIL anon can call month_spend_usd()'; end if;
  if not has_function_privilege('authenticated', 'public.is_team_member()', 'execute')
     or not has_function_privilege('authenticated', 'public.month_spend_usd()', 'execute') then
    raise exception 'FAIL signed-in users lost access to the app functions';
  end if;
  raise notice 'PASS app functions closed to anon';
end $$;

-- 11. v2: boards, scans, decodes, covers
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"member@example.com"}';
do $$ declare board uuid; item uuid; spend_before numeric; begin
  insert into public.watchlists (name, type, value, source, region, max_items, period_days)
    values ('Noon, UAE', 'advertiser', 'Noon', 'tiktok_creative_center', 'AE', 50, 7) returning id into board;
  insert into public.items (source, source_url, external_id) values ('tiktok_creative_center', 'https://ads.tiktok.com/business/creativecenter/topads/7300000000000000099/', '7300000000000000099') returning id into item;
  insert into public.board_items (watchlist_id, item_id, rank) values (board, item, 1);
  if (select count(*) from public.board_items where watchlist_id = board) <> 1 then raise exception 'FAIL board item'; end if;
  if (select kind from public.runs order by created_at desc limit 1) is null then raise exception 'FAIL run kind'; end if;
  insert into public.runs (source, watchlist_id, spend_cap_usd, apify_dataset_id) values ('tiktok_creative_center', board, 0.5, 'ds1');
  if (select kind from public.runs where apify_dataset_id = 'ds1') <> 'scan' then raise exception 'FAIL scan kind default'; end if;
  select public.month_spend_usd() into spend_before;
  update public.items set decode_status = 'done', decoded_at = now(), decode_cost_usd = 0.0125 where id = item;
  if public.month_spend_usd() - spend_before <> 0.0125 then raise exception 'FAIL month spend leaves out decodes'; end if;
  update public.watchlists set max_items = 200 where id = board;
  begin
    update public.watchlists set max_items = 201 where id = board;
    raise exception 'FAIL 201 ads per scan accepted';
  exception when check_violation then null; end;
  begin
    update public.watchlists set period_days = 14 where id = board;
    raise exception 'FAIL period 14 accepted';
  exception when check_violation then null; end;
  begin
    update public.items set decode_status = 'decoding' where id = item;
    raise exception 'FAIL unknown decode status accepted';
  exception when check_violation then null; end;
  delete from public.watchlists where id = board;
  if exists (select 1 from public.board_items where item_id = item) then raise exception 'FAIL board items outlive their board'; end if;
  raise notice 'PASS boards, scans, decode status and spend';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","email":"stranger@example.com"}';
do $$ begin
  begin
    insert into public.board_items (watchlist_id, item_id) values (gen_random_uuid(), gen_random_uuid());
    raise exception 'FAIL stranger added a board item';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.board_items) <> 0 then raise exception 'FAIL stranger sees board items'; end if;
  raise notice 'PASS board items hidden from strangers';
end $$;
rollback;

do $$ begin
  if not (select public from storage.buckets where id = 'covers') then raise exception 'FAIL covers bucket not public'; end if;
  if has_table_privilege('anon', 'public.board_items', 'select') then raise exception 'FAIL anon can read board items'; end if;
  raise notice 'PASS covers bucket public, board items closed to anon';
end $$;

-- Moroccan boards: the gate, board item status, advertisers, market checks in spend
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","email":"member@example.com"}';
do $$ declare board uuid; item uuid; spend_before numeric; n int; begin
  if exists (select 1 from public.watchlists where region = 'MA' and not moroccan_only) then raise exception 'FAIL Morocco boards without the gate'; end if;
  insert into public.watchlists (name, source, type, value, region) values ('Followed', 'tiktok_creative_center', 'snowball', 'auto', 'MA') returning id into board;
  if (select moroccan_only from public.watchlists where id = board) then raise exception 'FAIL new boards gated by default'; end if;
  begin
    insert into public.watchlists (name, source, type, value) values ('Bad', 'tiktok_creative_center', 'brand', 'x');
    raise exception 'FAIL unknown board type accepted';
  exception when check_violation then null; end;
  insert into public.items (source, source_url, external_id) values ('tiktok_creative_center', 'https://ads.tiktok.com/business/creativecenter/topads/7300000000000000999/', '7300000000000000999') returning id into item;
  insert into public.board_items (watchlist_id, item_id) values (board, item);
  if (select status from public.board_items where item_id = item) <> 'shown' then raise exception 'FAIL board items not shown by default'; end if;
  update public.board_items set status = 'pending' where item_id = item;
  begin
    update public.board_items set status = 'hidden' where item_id = item;
    raise exception 'FAIL unknown board item status accepted';
  exception when check_violation then null; end;
  insert into public.advertisers (key, name, status, origin, item_id) values ('domain:sooknow.com', 'sooknow.com', 'moroccan', 'auto', item);
  begin
    insert into public.advertisers (key, name, status, origin) values ('sooknow', 'x', 'moroccan', 'auto');
    raise exception 'FAIL advertiser key without a kind accepted';
  exception when check_violation then null; end;
  begin
    insert into public.advertisers (key, name, status, origin) values ('brand:x', 'x', 'maybe', 'auto');
    raise exception 'FAIL unknown advertiser status accepted';
  exception when check_violation then null; end;
  select public.month_spend_usd() into spend_before;
  update public.items set market_json = jsonb_build_object('verdict', 'moroccan', 'cost_usd', 0.003, 'checked_at', now()) where id = item;
  if public.month_spend_usd() - spend_before <> 0.003 then raise exception 'FAIL month spend leaves out market checks'; end if;
  begin
    update public.items set market_json = '[]' where id = item;
    raise exception 'FAIL market_json array accepted';
  exception when check_violation then null; end;
  delete from public.items where id = item;
  select count(*) into n from public.advertisers where key = 'domain:sooknow.com' and item_id is null;
  if n <> 1 then raise exception 'FAIL advertiser lost with its ad'; end if;
  raise notice 'PASS Moroccan gate, board item status, advertisers, market spend';
end $$;
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","email":"stranger@example.com"}';
do $$ begin
  begin
    insert into public.advertisers (key, name, status, origin) values ('brand:x', 'x', 'blocked', 'manual');
    raise exception 'FAIL stranger added an advertiser';
  exception when insufficient_privilege then null; end;
  if has_table_privilege('anon', 'public.advertisers', 'select') then raise exception 'FAIL anon can read advertisers'; end if;
  raise notice 'PASS advertisers closed to strangers and anon';
end $$;
rollback;

-- The Moroccan check's claims: one check per ad, stale claims expire, server only
begin;
do $$ declare board uuid; a uuid; b uuid; c uuid; n int; got uuid; begin
  insert into public.watchlists (name, source, type, value, region, moroccan_only) values ('Claims', 'tiktok_creative_center', 'keyword', 'maroc', 'MA', true) returning id into board;
  insert into public.items (source, source_url, external_id) values ('tiktok_creative_center', 'https://x/1', '7300000000000001001') returning id into a;
  insert into public.items (source, source_url, external_id) values ('tiktok_creative_center', 'https://x/2', '7300000000000001002') returning id into b;
  insert into public.items (source, source_url, external_id, market_json) values ('tiktok_creative_center', 'https://x/3', '7300000000000001003', '{"verdict":"moroccan"}') returning id into c;
  insert into public.board_items (watchlist_id, item_id, rank, status) values (board, a, 1, 'pending'), (board, b, 2, 'pending'), (board, c, 3, 'pending');
  select item_id into got from public.claim_market_checks(board, 1);
  if got <> a then raise exception 'FAIL claim does not take the top ranked ad first'; end if;
  if not (select market_json ? 'checking_at' from public.items where id = a) then raise exception 'FAIL claim not marked'; end if;
  select count(*) into n from public.claim_market_checks(board, 5);
  if n <> 1 then raise exception 'FAIL claimed ads taken twice or a checked ad taken (%)', n; end if;
  select count(*) into n from public.claim_market_checks(board, 5, interval '-1 second');
  if n <> 2 then raise exception 'FAIL stale claims not taken back (%)', n; end if;
  if has_function_privilege('authenticated', 'public.claim_market_checks(uuid, integer, interval)', 'execute') then raise exception 'FAIL members can claim'; end if;
  raise notice 'PASS Moroccan check claims';
end $$;
rollback;

-- Combined boards: several searches on one board, scan runs grouped by batch
begin;
do $$ declare board uuid; batch uuid := gen_random_uuid(); n int; begin
  insert into public.watchlists (name, source, type, value, region, searches)
    values ('Combined', 'meta_ad_library', 'combined', 'meta-ecom,seller-words', 'MA',
      '[{"source":"meta_ad_library","type":"keyword","value":"youcan.shop"},{"source":"tiktok_creative_center","type":"keyword","value":"maroc"}]')
    returning id into board;
  begin
    insert into public.watchlists (name, source, type, value, searches) values ('Bad', 'meta_ad_library', 'combined', 'x', '{"a":1}');
    raise exception 'FAIL searches must be a list';
  exception when check_violation then null; end;
  insert into public.runs (source, watchlist_id, kind, status, spend_cap_usd, batch_id, search_json)
    values ('meta_ad_library', board, 'scan', 'running', 0.1, batch, '{"source":"meta_ad_library"}'),
           ('tiktok_creative_center', board, 'scan', 'running', 0.1, batch, '{"source":"tiktok_creative_center"}');
  select count(*) into n from public.runs where batch_id = batch;
  if n <> 2 then raise exception 'FAIL batch runs (%)', n; end if;
  if (select jsonb_array_length(searches) from public.watchlists where id = board) <> 2 then raise exception 'FAIL searches stored'; end if;
  raise notice 'PASS combined boards and scan batches';
end $$;
rollback;
