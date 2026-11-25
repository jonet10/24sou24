-- STREAM24 — diagnostic d'import vidéo (phase 4)
alter table public.videos
  add column if not exists error_message text;

comment on column public.videos.error_message is 'Raison d’un échec d’import. Ne contient jamais de secret.';
