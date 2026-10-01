-- Content Lab: first sweep watchlists
--
-- Category sweeps in TikTok Creative Center for Morocco, MENA and France, one
-- per objective, refreshed monthly. Advertiser watchlists for the global
-- e-commerce leaders in any region, refreshed weekly.
--
-- Region group MENA and the mapping from our objectives to Creative Center
-- filters (app_install: App Installs, purchase: Conversions) live in
-- packages/core. Confirm Creative Center offers Morocco before the first run.

insert into public.watchlists (name, type, value, source, region, objective, refresh_cadence)
values
  ('Morocco e-commerce, App Install',  'industry', 'ecommerce', 'tiktok_creative_center', 'MA',   'app_install', 'monthly'),
  ('Morocco e-commerce, Purchase',     'industry', 'ecommerce', 'tiktok_creative_center', 'MA',   'purchase',    'monthly'),
  ('MENA e-commerce, App Install',     'industry', 'ecommerce', 'tiktok_creative_center', 'MENA', 'app_install', 'monthly'),
  ('MENA e-commerce, Purchase',        'industry', 'ecommerce', 'tiktok_creative_center', 'MENA', 'purchase',    'monthly'),
  ('France e-commerce, App Install',   'industry', 'ecommerce', 'tiktok_creative_center', 'FR',   'app_install', 'monthly'),
  ('France e-commerce, Purchase',      'industry', 'ecommerce', 'tiktok_creative_center', 'FR',   'purchase',    'monthly'),
  ('Temu, any region',                 'advertiser', 'Temu',       'tiktok_creative_center', null, null, 'weekly'),
  ('Shein, any region',                'advertiser', 'Shein',      'tiktok_creative_center', null, null, 'weekly'),
  ('AliExpress, any region',           'advertiser', 'AliExpress', 'tiktok_creative_center', null, null, 'weekly')
on conflict on constraint watchlists_target_key do nothing;
