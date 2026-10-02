-- Boards scan only when asked: every board moves to the manual schedule.
-- New boards already default to manual (the column default and the New board
-- dialog); a schedule can still be picked per board in its settings.
update public.watchlists set refresh_cadence = 'manual' where refresh_cadence <> 'manual';
