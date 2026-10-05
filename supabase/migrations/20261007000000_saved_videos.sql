-- Content Lab: decoded ads keep their video
--
-- A scan's video links expire (Creative Center after about 6 hours, Meta
-- after about a day) and a rescan replaces them. A decoded ad's video is
-- saved here instead, so it plays, decodes again and gives its frames for
-- good. items.video_url is the saved copy's address.

alter table public.items
  add column video_url text check (video_url is null or video_url ~ '^https://');

-------------------------------------------------------------------------------
-- Public bucket, like covers: videos of public ads under unguessable item
-- ids, so the player needs no signed URL. Only the server writes. 20 MB is
-- above what a decode takes (14 MB).
-------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 20971520, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do nothing;
