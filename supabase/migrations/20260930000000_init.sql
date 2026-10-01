-- Hợp Thầu: dự án, mẫu căn, nhà thầu, gói nội thất, yêu cầu báo giá, lead từ landing.
-- Tiền lưu bằng bigint (đồng), không dùng số thực.

-- Người dùng -------------------------------------------------------------------

create type user_role as enum ('owner', 'contractor', 'admin');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  phone text not null unique check (phone ~ '^84[35789][0-9]{8}$'),
  full_name text not null default '' check (length(full_name) <= 100),
  roles user_role[] not null default '{owner}',
  created_at timestamptz not null default now()
);

-- BE tạo tài khoản với user_metadata {phone, full_name} (src/auth.ts).
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, phone, full_name)
  values (new.id, new.raw_user_meta_data->>'phone', coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

alter table profiles enable row level security;
create policy "xem hồ sơ của mình" on profiles for select using (id = auth.uid());
create policy "sửa hồ sơ của mình" on profiles for update using (id = auth.uid());
-- Chỉ cho sửa tên. Vai trò do admin cấp, số điện thoại gắn với tài khoản.
revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

-- Dự án & mẫu căn (công khai, admin nhập qua Studio) ---------------------------

create table projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  developer text,
  province text not null,
  address text,
  handover_date date,
  cover_url text,
  is_social_housing boolean not null default true,
  created_at timestamptz not null default now()
);

create table unit_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects on delete cascade,
  name text not null,
  area_m2 numeric(6, 2) not null check (area_m2 > 0),
  bedrooms smallint not null check (bedrooms >= 0),
  bathrooms smallint not null check (bathrooms >= 0),
  floorplan_url text,
  unique (project_id, name)
);
create index on unit_types (project_id);

alter table projects enable row level security;
alter table unit_types enable row level security;
create policy "ai cũng xem được" on projects for select using (true);
create policy "ai cũng xem được" on unit_types for select using (true);

-- Nhà thầu ---------------------------------------------------------------------

create type verify_status as enum ('pending', 'verified', 'rejected');

create table contractors (
  id uuid primary key default gen_random_uuid(),
  -- Trống khi vận hành tạo hồ sơ trước, nhà thầu nhận tài khoản sau.
  owner_id uuid unique references profiles on delete set null,
  name text not null,
  tax_code text,
  address text,
  areas text[] not null default '{}',
  styles text[] not null default '{}',
  logo_url text,
  bio text,
  status verify_status not null default 'pending',
  rating numeric(2, 1) check (rating between 0 and 5),
  created_at timestamptz not null default now()
);

alter table contractors enable row level security;
create policy "xem nhà thầu đã xác minh hoặc của mình" on contractors for select
  using (status = 'verified' or owner_id = auth.uid());
-- MST, giấy tờ: chỉ admin xem (service_role). Chủ nhà chỉ cần biết đã xác minh hay chưa.
revoke select on contractors from anon, authenticated;
grant select (id, owner_id, name, address, areas, styles, logo_url, bio, status, rating, created_at)
  on contractors to anon, authenticated;

-- Gói nội thất theo mẫu căn ---------------------------------------------------

create type package_status as enum ('draft', 'pending', 'published', 'hidden');

create table packages (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors on delete cascade,
  unit_type_id uuid not null references unit_types on delete cascade,
  name text not null,
  style text not null,
  duration_days integer not null check (duration_days > 0),
  warranty_months integer not null check (warranty_months >= 0),
  images text[] not null default '{}',
  status package_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on packages (unit_type_id) where status = 'published';

-- Giá gói không lưu riêng: BE cộng từ hạng mục (src/pricing.ts) để luôn khớp.
create table package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages on delete cascade,
  room text not null,
  name text not null,
  material text,
  size text,
  qty numeric(8, 2) not null check (qty > 0),
  unit text not null default 'bộ',
  unit_price bigint not null check (unit_price >= 0),
  is_optional boolean not null default false,
  sort integer not null default 0
);
create index on package_items (package_id);

alter table packages enable row level security;
alter table package_items enable row level security;
create policy "xem gói đã đăng hoặc của mình" on packages for select
  using (status = 'published'
    or contractor_id in (select id from contractors where owner_id = auth.uid()));
create policy "xem hạng mục của gói xem được" on package_items for select
  using (package_id in (select id from packages));

-- Yêu cầu báo giá -------------------------------------------------------------

create type request_status as enum ('open', 'matched', 'closed');

create table quote_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references profiles on delete cascade,
  unit_type_id uuid references unit_types,
  package_id uuid references packages,
  address text check (length(address) <= 300),
  budget bigint check (budget >= 0),
  style text check (length(style) <= 50),
  note text check (length(note) <= 2000),
  status request_status not null default 'open',
  created_at timestamptz not null default now(),
  -- Phải biết căn nào: theo mẫu căn hoặc địa chỉ tự do.
  check (unit_type_id is not null or address is not null)
);
create index on quote_requests (owner_id, created_at desc);

alter table quote_requests enable row level security;
create policy "xem yêu cầu của mình" on quote_requests for select using (owner_id = auth.uid());
create policy "tạo yêu cầu cho mình" on quote_requests for insert with check (owner_id = auth.uid());
revoke insert on quote_requests from authenticated;
grant insert (unit_type_id, package_id, address, budget, style, note) on quote_requests to authenticated;

-- Lead từ landing page (chưa đăng nhập) ----------------------------------------

create table leads (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 100),
  phone text not null check (phone ~ '^84[35789][0-9]{8}$'),
  project_id uuid references projects,
  package_id uuid references packages,
  note text check (length(note) <= 1000),
  source text check (length(source) <= 100),
  created_at timestamptz not null default now()
);

-- Không có policy: chỉ BE (service_role) ghi và đọc.
alter table leads enable row level security;
