-- Boards may fetch up to 200 ads per scan (was 50). Scans are paid per
-- result and checked against what is left of the monthly cap.
alter table public.watchlists drop constraint watchlists_max_items_check;
alter table public.watchlists add constraint watchlists_max_items_check check (max_items between 1 and 200);
