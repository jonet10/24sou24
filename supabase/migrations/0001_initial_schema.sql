-- STREAM24 — schéma initial, RLS et fonctions de base
-- À appliquer dans l'éditeur SQL Supabase ou via `supabase db push`.
-- Aucune donnée de démonstration n'est insérée.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Fonctions utilitaires
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- SECURITY DEFINER évite une récursion de la RLS de profiles lors des contrôles admin.
create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_user_id and role = 'admin'
  );
$$;

revoke all on function public.is_admin(uuid) from public;
grant execute on function public.is_admin(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  max_videos integer not null default 20 check (max_videos >= 0),
  max_streams integer not null default 5 check (max_streams >= 0),
  max_concurrent_streams integer not null default 1 check (max_concurrent_streams >= 0),
  max_storage_bytes bigint not null default 10737418240 check (max_storage_bytes >= 0),
  monthly_egress_gb integer not null default 100 check (monthly_egress_gb >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin" on public.profiles
for select to authenticated
using (id = (select auth.uid()) or public.is_admin((select auth.uid())));

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Un utilisateur ne peut modifier que son nom affiché : les quotas restent gérés par le Worker admin.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. videos
-- ---------------------------------------------------------------------------
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  r2_key text not null unique,
  title text not null check (char_length(title) between 1 and 200),
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  duration_seconds numeric(10, 2),
  status text not null default 'uploading'
    check (status in ('uploading', 'ready', 'failed', 'deleting')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists videos_user_created_idx on public.videos (user_id, created_at desc);
create index if not exists videos_user_status_idx on public.videos (user_id, status);

drop trigger if exists videos_updated_at on public.videos;
create trigger videos_updated_at before update on public.videos
for each row execute function public.set_updated_at();

alter table public.videos enable row level security;

drop policy if exists "videos_select_own" on public.videos;
create policy "videos_select_own" on public.videos
for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

drop policy if exists "videos_insert_own" on public.videos;
create policy "videos_insert_own" on public.videos
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "videos_update_own" on public.videos;
create policy "videos_update_own" on public.videos
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "videos_delete_own" on public.videos;
create policy "videos_delete_own" on public.videos
for delete to authenticated
using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. youtube_channels + jetons OAuth (table secrète)
-- ---------------------------------------------------------------------------
create table if not exists public.youtube_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  google_channel_id text not null,
  title text not null,
  handle text,
  avatar_url text,
  status text not null default 'connected'
    check (status in ('connected', 'revoked', 'error')),
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_channel_id)
);

create index if not exists youtube_channels_user_idx on public.youtube_channels (user_id, created_at desc);

drop trigger if exists youtube_channels_updated_at on public.youtube_channels;
create trigger youtube_channels_updated_at before update on public.youtube_channels
for each row execute function public.set_updated_at();

alter table public.youtube_channels enable row level security;

drop policy if exists "youtube_channels_select_own" on public.youtube_channels;
create policy "youtube_channels_select_own" on public.youtube_channels
for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

drop policy if exists "youtube_channels_insert_own" on public.youtube_channels;
create policy "youtube_channels_insert_own" on public.youtube_channels
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "youtube_channels_update_own" on public.youtube_channels;
create policy "youtube_channels_update_own" on public.youtube_channels
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "youtube_channels_delete_own" on public.youtube_channels;
create policy "youtube_channels_delete_own" on public.youtube_channels
for delete to authenticated
using (user_id = (select auth.uid()));

-- Jetons chiffrés par le Worker (AES-GCM). Aucune politique SELECT/UPDATE pour les utilisateurs.
create table if not exists public.youtube_channel_tokens (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null unique references public.youtube_channels(id) on delete cascade,
  ciphertext bytea not null,
  iv bytea not null,
  scope text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists youtube_channel_tokens_updated_at on public.youtube_channel_tokens;
create trigger youtube_channel_tokens_updated_at before update on public.youtube_channel_tokens
for each row execute function public.set_updated_at();

alter table public.youtube_channel_tokens enable row level security;
revoke all on public.youtube_channel_tokens from anon, authenticated;
grant all on public.youtube_channel_tokens to service_role;

-- ---------------------------------------------------------------------------
-- 4. streams, secrets, logs
-- ---------------------------------------------------------------------------
create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete restrict,
  channel_id uuid not null references public.youtube_channels(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  scheduled_at timestamptz,
  repeat_enabled boolean not null default true,
  desired_status text not null default 'stopped'
    check (desired_status in ('stopped', 'starting', 'live', 'paused', 'restarting')),
  reported_status text not null default 'idle'
    check (reported_status in ('idle', 'starting', 'live', 'paused', 'stopped', 'error')),
  status_reason text,
  engine_run_id uuid,
  engine_instance_id text,
  last_heartbeat_at timestamptz,
  started_at timestamptz,
  stopped_at timestamptz,
  stop_reason text,
  restart_count integer not null default 0 check (restart_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists streams_user_created_idx on public.streams (user_id, created_at desc);
create index if not exists streams_desired_idx on public.streams (desired_status, reported_status);
create index if not exists streams_heartbeat_idx on public.streams (last_heartbeat_at desc)
  where reported_status = 'live';

drop trigger if exists streams_updated_at on public.streams;
create trigger streams_updated_at before update on public.streams
for each row execute function public.set_updated_at();

alter table public.streams enable row level security;

drop policy if exists "streams_select_own" on public.streams;
create policy "streams_select_own" on public.streams
for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

drop policy if exists "streams_insert_own" on public.streams;
create policy "streams_insert_own" on public.streams
for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "streams_update_own" on public.streams;
create policy "streams_update_own" on public.streams
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "streams_delete_own" on public.streams;
create policy "streams_delete_own" on public.streams
for delete to authenticated
using (user_id = (select auth.uid()));

-- Clé RTMP chiffrée par le Worker. Jamais lisible par le frontend.
create table if not exists public.stream_secrets (
  stream_id uuid primary key references public.streams(id) on delete cascade,
  ciphertext bytea not null,
  iv bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists stream_secrets_updated_at on public.stream_secrets;
create trigger stream_secrets_updated_at before update on public.stream_secrets
for each row execute function public.set_updated_at();

alter table public.stream_secrets enable row level security;
revoke all on public.stream_secrets from anon, authenticated;
grant all on public.stream_secrets to service_role;

create table if not exists public.stream_logs (
  id bigint generated always as identity primary key,
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  level text not null check (level in ('info', 'warning', 'error')),
  message text not null check (char_length(message) <= 4000),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists stream_logs_stream_created_idx on public.stream_logs (stream_id, created_at desc);
create index if not exists stream_logs_user_created_idx on public.stream_logs (user_id, created_at desc);

alter table public.stream_logs enable row level security;

drop policy if exists "stream_logs_select_own" on public.stream_logs;
create policy "stream_logs_select_own" on public.stream_logs
for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

revoke insert, update, delete on public.stream_logs from anon, authenticated;
grant all on public.stream_logs to service_role;

-- ---------------------------------------------------------------------------
-- 5. usage_records (quotas et facturation)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  stream_id uuid references public.streams(id) on delete set null,
  kind text not null check (kind in ('storage', 'egress', 'stream_minutes', 'api')),
  quantity numeric(14, 3) not null check (quantity >= 0),
  unit text not null check (unit in ('bytes', 'gb', 'minutes', 'requests')),
  period_start timestamptz not null default date_trunc('month', now()),
  recorded_at timestamptz not null default now()
);

create index if not exists usage_records_user_period_idx on public.usage_records (user_id, period_start desc);
create index if not exists usage_records_kind_idx on public.usage_records (kind, period_start desc);

alter table public.usage_records enable row level security;

drop policy if exists "usage_records_select_own" on public.usage_records;
create policy "usage_records_select_own" on public.usage_records
for select to authenticated
using (user_id = (select auth.uid()) or public.is_admin((select auth.uid())));

revoke insert, update, delete on public.usage_records from anon, authenticated;
grant all on public.usage_records to service_role;

-- ---------------------------------------------------------------------------
-- 6. Statistiques du tableau de bord (RLS appliquée via SECURITY INVOKER)
-- ---------------------------------------------------------------------------
create or replace function public.get_dashboard_stats()
returns jsonb
language sql
stable
set search_path = public
as $$
  with mine_videos as (
    select count(*) as total, coalesce(sum(size_bytes), 0) as bytes
    from public.videos
    where user_id = (select auth.uid()) and deleted_at is null
  ),
  mine_streams as (
    select
      count(*) filter (where desired_status <> 'stopped') as active,
      count(*) as total
    from public.streams where user_id = (select auth.uid())
  ),
  mine_channels as (
    select count(*) as total from public.youtube_channels
    where user_id = (select auth.uid()) and status = 'connected'
  ),
  mine_minutes as (
    select coalesce(sum(quantity), 0) as minutes
    from public.usage_records
    where user_id = (select auth.uid())
      and kind = 'stream_minutes'
      and period_start = date_trunc('month', now())
  )
  select jsonb_build_object(
    'videos', (select total from mine_videos),
    'storage_bytes', (select bytes from mine_videos),
    'streams', (select total from mine_streams),
    'active_streams', (select active from mine_streams),
    'channels', (select total from mine_channels),
    'stream_minutes_this_month', (select minutes from mine_minutes)
  );
$$;

revoke all on function public.get_dashboard_stats() from public;
grant execute on function public.get_dashboard_stats() to authenticated;
