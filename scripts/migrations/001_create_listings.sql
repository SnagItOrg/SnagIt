-- Migration: 001_create_listings
-- Run this in the Supabase SQL Editor

create table if not exists listings (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  price       integer,
  currency    text default 'DKK',
  url         text unique not null,
  image_url   text,
  location    text,
  scraped_at  timestamptz not null default now(),
  source      text not null default 'dba.dk'
);

-- Index for fast lookups by source and time
create index if not exists listings_source_scraped_at
  on listings (source, scraped_at desc);

-- Enable Row Level Security (we'll configure policies later)
alter table listings enable row level security;

-- Allow anonymous reads (public classifieds data)
create policy "Public read access"
  on listings for select
  using (true);
