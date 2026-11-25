-- STREAM24 — comptage des minutes par exécution de diffusion (phase 6/8)
alter table public.usage_records
  add column if not exists run_id uuid;

-- Une seule ligne de minutes par exécution, même si l'agent rapporte plusieurs arrêts.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'usage_records_stream_run_unique'
      and conrelid = 'public.usage_records'::regclass
  ) then
    alter table public.usage_records
      add constraint usage_records_stream_run_unique unique (stream_id, run_id, kind);
  end if;
end $$;

comment on column public.usage_records.run_id is 'Identifiant de l’exécution FFmpeg correspondante (engine_run_id).';
