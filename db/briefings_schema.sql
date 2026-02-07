-- Briefings (integração n8n)
-- Execute no Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists briefings (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  source text not null default 'nao-sabe',
  status text not null default 'new',
  name text,
  email text,
  phone text,
  city text,
  idea text,
  deal_type text,
  rental_details text,
  event_location text,
  summary text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists briefings_created_at_idx on briefings (created_at desc);
create index if not exists briefings_status_idx on briefings (status);
