-- Briefing attachments (uploads via Supabase Storage)
-- Execute no Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists briefing_attachments (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references briefings(id) on delete cascade,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  storage_bucket text not null,
  storage_path text not null,
  public_url text not null,
  created_at timestamptz not null default now()
);

create index if not exists briefing_attachments_briefing_id_idx on briefing_attachments (briefing_id);
create index if not exists briefing_attachments_created_at_idx on briefing_attachments (created_at desc);
