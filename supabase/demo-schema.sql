-- Page Steel Material Inventory Map
-- Lightweight proof-of-concept database with no user login.
-- Anyone who can reach the public uploader can read, upload, update, or delete test records.

create extension if not exists pgcrypto;

create table if not exists public.material_records (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null check (char_length(employee_name) between 1 and 100),
  title text not null check (char_length(title) between 1 and 300),
  materials text[] not null default '{}',
  profiles text[] not null default '{}',
  condition text not null,
  length_range text not null,
  size_range text not null,
  quantity_range text not null,
  note text,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  camera_latitude double precision check (camera_latitude between -90 and 90),
  camera_longitude double precision check (camera_longitude between -180 and 180),
  gps_accuracy_meters double precision check (gps_accuracy_meters is null or gps_accuracy_meters >= 0),
  image_path text not null,
  image_url text not null,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'current'
    check (status in ('current', 'superseded', 'deleted')),
  replaces_id uuid references public.material_records(id) on delete set null,
  replaced_by uuid references public.material_records(id) on delete set null,
  check (cardinality(materials) >= 1),
  check (cardinality(profiles) >= 1)
);

-- If an earlier pilot version of the table already exists, add fields used by this uploader.
alter table public.material_records add column if not exists camera_latitude double precision;
alter table public.material_records add column if not exists camera_longitude double precision;
alter table public.material_records add column if not exists gps_accuracy_meters double precision;
alter table public.material_records add column if not exists replaces_id uuid references public.material_records(id) on delete set null;
alter table public.material_records add column if not exists replaced_by uuid references public.material_records(id) on delete set null;

create index if not exists material_records_status_idx
  on public.material_records(status);
create index if not exists material_records_updated_idx
  on public.material_records(updated_at desc);
create index if not exists material_records_location_idx
  on public.material_records(latitude, longitude);

alter table public.material_records enable row level security;

grant select, insert, update on public.material_records to anon;

drop policy if exists "demo public read" on public.material_records;
create policy "demo public read"
on public.material_records
for select
to anon
using (true);

drop policy if exists "demo public insert" on public.material_records;
create policy "demo public insert"
on public.material_records
for insert
to anon
with check (
  status = 'current'
  and cardinality(materials) >= 1
  and cardinality(profiles) >= 1
  and latitude between -90 and 90
  and longitude between -180 and 180
);

drop policy if exists "demo public update" on public.material_records;
create policy "demo public update"
on public.material_records
for update
to anon
using (true)
with check (
  status in ('current', 'superseded', 'deleted')
  and cardinality(materials) >= 1
  and cardinality(profiles) >= 1
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'material-photos',
  'material-photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "demo photo read" on storage.objects;
create policy "demo photo read"
on storage.objects
for select
to anon
using (bucket_id = 'material-photos');

drop policy if exists "demo photo upload" on storage.objects;
create policy "demo photo upload"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'material-photos'
  and storage.extension(name) in ('jpg', 'jpeg', 'png', 'webp')
);

drop policy if exists "demo photo update" on storage.objects;
create policy "demo photo update"
on storage.objects
for update
to anon
using (bucket_id = 'material-photos')
with check (bucket_id = 'material-photos');

drop policy if exists "demo photo delete" on storage.objects;
create policy "demo photo delete"
on storage.objects
for delete
to anon
using (bucket_id = 'material-photos');
