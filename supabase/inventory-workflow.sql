-- Page Steel Material Inventory Map
-- Scrap search + tracked inventory + admin review queue.
-- Run once in Supabase SQL Editor before deploying the frontend.

begin;

create table if not exists public.inventory_records (
  id uuid primary key default gen_random_uuid(),
  inventory_number text not null unique,
  employee_name text not null,
  title text not null,
  material text not null,
  profile text not null,
  grade text,
  size_description text,
  exact_quantity numeric(14,3) not null default 0,
  quantity_unit text not null,
  location_code text not null,
  latitude double precision,
  longitude double precision,
  image_path text,
  image_url text,
  last_counted_at timestamptz,
  last_counted_by text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'current'
    check (status in ('current', 'archived', 'deleted'))
);

create index if not exists inventory_records_status_idx
  on public.inventory_records (status, updated_at desc);

create index if not exists inventory_records_location_idx
  on public.inventory_records (latitude, longitude);

create table if not exists public.search_events (
  id uuid primary key default gen_random_uuid(),
  employee_name text not null,
  search_mode text not null
    check (search_mode in ('scrap', 'inventory')),
  inventory_action text,
  material text,
  profile text,
  query_text text,
  results_count integer not null default 0,
  opened_record_id uuid,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists search_events_created_idx
  on public.search_events (created_at desc);

create table if not exists public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  record_type text not null
    check (record_type in ('scrap', 'inventory', 'search')),
  record_id uuid,
  search_event_id uuid references public.search_events(id) on delete set null,
  reason text not null,
  description text,
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  requires_photo boolean not null default false,
  requires_count boolean not null default false,
  status text not null default 'open'
    check (status in ('open', 'completed', 'dismissed')),
  created_by text,
  completed_at timestamptz,
  completed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists review_tasks_one_open_record_reason
  on public.review_tasks (record_type, record_id, reason)
  where status = 'open' and record_id is not null;

create index if not exists review_tasks_status_idx
  on public.review_tasks (status, priority, created_at desc);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  inventory_record_id uuid not null
    references public.inventory_records(id) on delete cascade,
  search_event_id uuid references public.search_events(id) on delete set null,
  employee_name text not null,
  transaction_type text not null
    check (transaction_type in ('verify', 'count', 'remove', 'receive', 'move', 'adjust')),
  quantity numeric(14,3),
  quantity_unit text,
  quantity_before numeric(14,3),
  quantity_after numeric(14,3),
  from_location text,
  to_location text,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists inventory_transactions_record_idx
  on public.inventory_transactions (inventory_record_id, created_at desc);

alter table public.inventory_records enable row level security;
alter table public.search_events enable row level security;
alter table public.review_tasks enable row level security;
alter table public.inventory_transactions enable row level security;

grant select, insert, update on public.inventory_records to anon;
grant select, insert, update on public.search_events to anon;
grant select, insert, update on public.review_tasks to anon;
grant select, insert on public.inventory_transactions to anon;

do $$ begin
  create policy "Demo inventory read" on public.inventory_records
    for select to anon using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo inventory insert" on public.inventory_records
    for insert to anon with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo inventory update" on public.inventory_records
    for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo search read" on public.search_events
    for select to anon using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo search insert" on public.search_events
    for insert to anon with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo search update" on public.search_events
    for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo task read" on public.review_tasks
    for select to anon using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo task insert" on public.review_tasks
    for insert to anon with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo task update" on public.review_tasks
    for update to anon using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo transaction read" on public.inventory_transactions
    for select to anon using (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "Demo transaction insert" on public.inventory_transactions
    for insert to anon with check (true);
exception when duplicate_object then null; end $$;

commit;
