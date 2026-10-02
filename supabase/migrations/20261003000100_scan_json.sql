-- Content Lab v2: the scraper's latest row for each ad
--
-- Every scan overwrites scan_json with the source's current row (metrics,
-- fresh video and cover links), without touching raw_json, which keeps what
-- decoding stored.

alter table public.items
  add column scan_json  jsonb check (scan_json is null or jsonb_typeof(scan_json) = 'object'),
  add column scanned_at timestamptz;

update public.items
set scan_json = raw_json -> 'discovered', scanned_at = collected_at
where raw_json ? 'discovered' and jsonb_typeof(raw_json -> 'discovered') = 'object';
