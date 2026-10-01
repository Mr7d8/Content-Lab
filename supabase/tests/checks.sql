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
  select count(*) into n from public.watchlists where type = 'advertiser' and region is null and refresh_cadence = 'weekly';
  if n <> 3 then raise exception 'FAIL global advertiser watchlists'; end if;
  select count(*) into n from public.watchlists where type = 'industry' and region in ('MA','MENA','FR') and refresh_cadence = 'monthly';
  if n <> 6 then raise exception 'FAIL category sweeps'; end if;
  raise notice 'PASS first sweep watchlists seeded';
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
