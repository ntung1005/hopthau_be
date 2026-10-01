-- Bản đo nhà do chủ nhà tự đo: các phòng hình chữ nhật trên mặt bằng, cửa đi / cửa sổ trên tường.
-- data do BE kiểm tra (src/measurement.ts) trước khi ghi, nên chỉ BE (service_role) được ghi.
-- ponytail: phòng hình chữ nhật (ghép nhiều phòng ra nhà chữ L...). Thêm đa giác / đo bằng AR
-- (ARKit, ARCore, RoomPlan) khi có bản app native.

create table measurements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  unit_type_id uuid references unit_types on delete set null,
  data jsonb not null check (jsonb_typeof(data->'rooms') = 'array'),
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on measurements (owner_id, updated_at desc);

alter table quote_requests add column measurement_id uuid references measurements on delete set null;
grant insert (measurement_id) on quote_requests to authenticated;

alter table measurements enable row level security;
create policy "chủ nhà xem bản đo của mình" on measurements for select using (owner_id = auth.uid());
-- Nhà thầu được ghép với yêu cầu có đính kèm bản đo thì xem được bản đo đó.
create policy "nhà thầu xem bản đo của yêu cầu được ghép" on measurements for select
  using (id in (select measurement_id from quote_requests where id in (select my_matched_request_ids())));
