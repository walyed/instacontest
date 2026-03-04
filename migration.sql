-- ============================================================
-- Contest Entry — Supabase Migration
-- Run this in the Supabase SQL Editor (https://supabase.com/dashboard)
-- ============================================================

-- 1. Create the entries table
create table if not exists public.entries (
  id          uuid default gen_random_uuid() primary key,
  handle      text not null,
  contact     text,
  image_url   text not null,
  status      text not null default 'pending'
                check (status in ('pending', 'ready')),
  consent     boolean not null default true,
  created_at  timestamptz default now() not null
);

-- 2. Enable Row Level Security
alter table public.entries enable row level security;

-- 3. RLS policies
--    Anon users can insert (form submissions go through our API with service role,
--    but this is a safety net).
create policy "Allow public inserts"
  on public.entries for insert
  with check (true);

--    Anyone can read entries marked as "ready" (public JSON endpoint).
create policy "Allow public select of ready entries"
  on public.entries for select
  using (status = 'ready');

--    Service role (used by API routes) bypasses RLS automatically,
--    so admin reads/updates work without extra policies.

-- 4. Indexes for performance
create index if not exists idx_entries_status
  on public.entries (status);

create index if not exists idx_entries_created_at
  on public.entries (created_at desc);

-- 5. Storage bucket for profile images
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  true,
  5242880,  -- 5 MB
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

-- 6. Storage policies — allow public uploads and reads
create policy "Allow public uploads to profile-images"
  on storage.objects for insert
  with check (bucket_id = 'profile-images');

create policy "Allow public reads from profile-images"
  on storage.objects for select
  using (bucket_id = 'profile-images');
