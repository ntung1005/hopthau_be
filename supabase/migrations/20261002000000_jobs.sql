-- Công trình sau khi chủ nhà chọn báo giá: mốc thanh toán / nghiệm thu, phát sinh, đánh giá, ảnh.
-- Ghi qua hàm security definer (kiểm tra vai trò, thứ tự trạng thái); bảng chỉ cho đọc.

-- Công trình -------------------------------------------------------------------

create type job_status as enum ('active', 'completed', 'cancelled');

create table jobs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references quote_requests on delete cascade,
  -- Giữ lịch sử công trình (và đánh giá) khi chủ nhà xoá tài khoản.
  owner_id uuid references profiles on delete set null,
  contractor_id uuid not null references contractors on delete cascade,
  -- Giá và thời gian theo báo giá được chọn. Giá hiện tại = price + tổng phát sinh đã duyệt.
  price bigint not null check (price >= 0),
  duration_days integer not null check (duration_days > 0),
  warranty_months integer not null default 12 check (warranty_months >= 0),
  status job_status not null default 'active',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index on jobs (owner_id);
create index on jobs (contractor_id, created_at desc);

create type milestone_status as enum ('pending', 'submitted', 'approved', 'rejected');

create table job_milestones (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs on delete cascade,
  seq smallint not null,
  title text not null,
  amount bigint not null check (amount >= 0),
  status milestone_status not null default 'pending',
  -- Nhà thầu báo xong mốc: ghi chú + ảnh. Chủ nhà duyệt hoặc trả lại kèm góp ý.
  note text check (length(note) <= 2000),
  photos text[] not null default '{}' check (cardinality(photos) <= 10),
  owner_feedback text check (length(owner_feedback) <= 2000),
  submitted_at timestamptz,
  approved_at timestamptz,
  -- Nhà thầu xác nhận đã nhận tiền mốc này. Nền tảng chỉ ghi nhận, không giữ tiền (xem ideas: escrow).
  paid_at timestamptz,
  unique (job_id, seq)
);

create type change_status as enum ('pending', 'approved', 'rejected');

-- Đề nghị phát sinh: chỉ có hiệu lực khi chủ nhà đồng ý trong app.
create table job_changes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (length(description) <= 2000),
  amount bigint not null,                       -- âm: bớt hạng mục
  days_delta integer not null default 0,
  status change_status not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index on job_changes (job_id);

create function my_job_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.jobs where owner_id = auth.uid() or contractor_id = public.my_contractor_id()
$$;

alter table jobs enable row level security;
alter table job_milestones enable row level security;
alter table job_changes enable row level security;
create policy "hai bên xem công trình" on jobs for select using (id in (select my_job_ids()));
create policy "hai bên xem mốc" on job_milestones for select using (job_id in (select my_job_ids()));
create policy "hai bên xem phát sinh" on job_changes for select using (job_id in (select my_job_ids()));

-- Chọn báo giá thì tạo công trình với 4 mốc mặc định --------------------------

create or replace function accept_quote(p_request uuid, p_contractor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_price bigint;
  v_days integer;
  v_warranty integer;
  v_job uuid;
begin
  perform 1 from public.quote_requests where id = p_request and owner_id = auth.uid() and status = 'open' for update;
  if not found then
    if exists (select 1 from public.quote_requests where id = p_request and owner_id = auth.uid()) then
      raise exception 'request_closed';
    end if;
    raise exception 'request_not_found';
  end if;
  update public.quote_matches set status = 'accepted'
  where request_id = p_request and contractor_id = p_contractor and status = 'quoted'
  returning price, duration_days into v_price, v_days;
  if not found then raise exception 'quote_not_found'; end if;
  update public.quote_matches set status = 'declined'
  where request_id = p_request and contractor_id <> p_contractor;
  update public.quote_requests set status = 'matched' where id = p_request;

  -- Bảo hành theo gói nếu yêu cầu đi từ gói của chính nhà thầu này, không thì 12 tháng.
  select p.warranty_months into v_warranty
  from public.quote_requests r join public.packages p on p.id = r.package_id
  where r.id = p_request and p.contractor_id = p_contractor;

  insert into public.jobs (request_id, owner_id, contractor_id, price, duration_days, warranty_months)
  values (p_request, auth.uid(), p_contractor, v_price, v_days, coalesce(v_warranty, 12))
  returning id into v_job;

  -- Cọc 30% · sản xuất 40% · lắp đặt 25% · nghiệm thu phần còn lại (để tổng luôn đúng bằng giá).
  insert into public.job_milestones (job_id, seq, title, amount) values
    (v_job, 1, 'Đặt cọc, chốt thiết kế', round(v_price * 0.30)),
    (v_job, 2, 'Sản xuất xong tại xưởng', round(v_price * 0.40)),
    (v_job, 3, 'Lắp đặt xong tại nhà', round(v_price * 0.25)),
    (v_job, 4, 'Nghiệm thu, bàn giao', v_price - round(v_price * 0.30) - round(v_price * 0.40) - round(v_price * 0.25));
end $$;

-- Mốc ---------------------------------------------------------------------------

/** Nhà thầu báo xong một mốc. Làm lần lượt: mốc trước phải được chủ nhà duyệt. */
create function submit_milestone(p_milestone uuid, p_note text, p_photos text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.job_milestones;
begin
  select ms.* into m from public.job_milestones ms join public.jobs j on j.id = ms.job_id
  where ms.id = p_milestone and j.contractor_id = public.my_contractor_id() and j.status = 'active'
  for update of ms;
  if not found then raise exception 'milestone_not_found'; end if;
  if m.status not in ('pending', 'rejected') then raise exception 'milestone_not_open'; end if;
  if exists (select 1 from public.job_milestones where job_id = m.job_id and seq < m.seq and status <> 'approved') then
    raise exception 'previous_milestone_open';
  end if;
  update public.job_milestones set
    status = 'submitted', note = nullif(trim(p_note), ''), photos = coalesce(p_photos, '{}'),
    owner_feedback = null, submitted_at = now()
  where id = p_milestone;
end $$;

/** Chủ nhà duyệt hoặc trả lại mốc nhà thầu vừa báo. Duyệt mốc cuối thì công trình hoàn thành. */
create function review_milestone(p_milestone uuid, p_approve boolean, p_feedback text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.job_milestones;
begin
  select ms.* into m from public.job_milestones ms join public.jobs j on j.id = ms.job_id
  where ms.id = p_milestone and j.owner_id = auth.uid() and j.status = 'active'
  for update of ms;
  if not found then raise exception 'milestone_not_found'; end if;
  if m.status <> 'submitted' then raise exception 'milestone_not_submitted'; end if;
  if not p_approve and coalesce(trim(p_feedback), '') = '' then raise exception 'missing_feedback'; end if;
  update public.job_milestones set
    status = case when p_approve then 'approved'::public.milestone_status else 'rejected' end,
    owner_feedback = nullif(trim(p_feedback), ''),
    approved_at = case when p_approve then now() end
  where id = p_milestone;
  if p_approve and not exists (select 1 from public.job_milestones where job_id = m.job_id and status <> 'approved') then
    update public.jobs set status = 'completed', completed_at = now() where id = m.job_id;
    -- Phát sinh chưa quyết coi như bị từ chối khi đã bàn giao.
    update public.job_changes set status = 'rejected', decided_at = now() where job_id = m.job_id and status = 'pending';
  end if;
end $$;

/** Nhà thầu xác nhận đã nhận tiền của một mốc đã duyệt. */
create function confirm_payment(p_milestone uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.job_milestones ms set paid_at = now()
  from public.jobs j
  where ms.id = p_milestone and j.id = ms.job_id and j.contractor_id = public.my_contractor_id()
    and ms.status = 'approved' and ms.paid_at is null;
  if not found then raise exception 'milestone_not_found'; end if;
end $$;

-- Phát sinh -----------------------------------------------------------------------

create function propose_change(p_job uuid, p_title text, p_description text, p_amount bigint, p_days integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  perform 1 from public.jobs where id = p_job and contractor_id = public.my_contractor_id() and status = 'active';
  if not found then raise exception 'job_not_found'; end if;
  if p_amount is null then raise exception 'invalid_amount'; end if;
  insert into public.job_changes (job_id, title, description, amount, days_delta)
  values (p_job, trim(p_title), nullif(trim(p_description), ''), p_amount, coalesce(p_days, 0))
  returning id into v_id;
  return v_id;
end $$;

create function decide_change(p_change uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.job_changes c set
    status = case when p_approve then 'approved'::public.change_status else 'rejected' end,
    decided_at = now()
  from public.jobs j
  where c.id = p_change and j.id = c.job_id and j.owner_id = auth.uid() and j.status = 'active' and c.status = 'pending';
  if not found then raise exception 'change_not_found'; end if;
end $$;

-- Đánh giá ------------------------------------------------------------------------

alter table contractors add column review_count integer not null default 0;
grant select (review_count) on contractors to anon, authenticated;

create table reviews (
  job_id uuid primary key references jobs on delete cascade,
  contractor_id uuid not null references contractors on delete cascade,
  owner_name text not null default '',          -- chụp lại lúc đánh giá, hiển thị công khai
  quality smallint not null check (quality between 1 and 5),
  punctuality smallint not null check (punctuality between 1 and 5),
  price_honesty smallint not null check (price_honesty between 1 and 5),
  attitude smallint not null check (attitude between 1 and 5),
  content text check (length(content) <= 3000),
  photos text[] not null default '{}' check (cardinality(photos) <= 10),
  reply text check (length(reply) <= 2000),
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index on reviews (contractor_id, created_at desc);

-- Đánh giá công khai (hồ sơ nhà thầu), chỉ ghi qua hàm.
alter table reviews enable row level security;
create policy "ai cũng đọc được đánh giá" on reviews for select using (true);

/** Chủ nhà đánh giá công trình đã hoàn thành, một lần. */
create function submit_review(p_job uuid, p_quality integer, p_punctuality integer, p_price_honesty integer,
                              p_attitude integer, p_content text, p_photos text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  j public.jobs;
begin
  select * into j from public.jobs where id = p_job and owner_id = auth.uid();
  if not found then raise exception 'job_not_found'; end if;
  if j.status <> 'completed' then raise exception 'job_not_completed'; end if;
  insert into public.reviews (job_id, contractor_id, owner_name, quality, punctuality, price_honesty, attitude, content, photos)
  select p_job, j.contractor_id, coalesce(p.full_name, ''), p_quality, p_punctuality, p_price_honesty, p_attitude,
         nullif(trim(p_content), ''), coalesce(p_photos, '{}')
  from public.profiles p where p.id = auth.uid();
exception when unique_violation then
  raise exception 'already_reviewed';
end $$;

create function reply_review(p_job uuid, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.reviews set reply = nullif(trim(p_reply), ''), replied_at = now()
  where job_id = p_job and contractor_id = public.my_contractor_id();
  if not found then raise exception 'review_not_found'; end if;
end $$;

-- Điểm nhà thầu = trung bình 4 tiêu chí của mọi đánh giá.
create function refresh_contractor_rating() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.contractors c set
    rating = s.avg, review_count = s.n
  from (
    select round(avg((quality + punctuality + price_honesty + attitude) / 4.0), 1) as avg, count(*)::int as n
    from public.reviews where contractor_id = new.contractor_id
  ) s
  where c.id = new.contractor_id;
  return new;
end $$;

create trigger on_review_created after insert on reviews
  for each row execute function refresh_contractor_rating();

-- Ảnh ------------------------------------------------------------------------------

-- ponytail: bucket công khai, đường dẫn ngẫu nhiên theo người upload. Ảnh tiến độ trong nhà
-- chủ nhà cũng công khai nếu biết URL; chuyển sang bucket riêng + signed URL khi cần riêng tư.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 8 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Gói có ảnh: save_package nhận thêm p_fields.images.
create or replace function save_package(p_id uuid, p_fields jsonb, p_items jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid := p_id;
  v_contractor uuid := my_contractor_id();
  v_status package_status;
  v_images text[] := coalesce(array(select jsonb_array_elements_text(p_fields->'images')), '{}');
begin
  if v_contractor is null then raise exception 'not_contractor'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'missing_items';
  end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'too_many_items'; end if;

  if v_id is null then
    insert into packages (contractor_id, unit_type_id, name, style, duration_days, warranty_months, images)
    values (v_contractor, (p_fields->>'unit_type_id')::uuid, p_fields->>'name', p_fields->>'style',
            (p_fields->>'duration_days')::int, (p_fields->>'warranty_months')::int, v_images)
    returning id into v_id;
  else
    select status into v_status from packages where id = v_id and contractor_id = v_contractor;
    if not found then raise exception 'package_not_found'; end if;
    update packages set
      unit_type_id = (p_fields->>'unit_type_id')::uuid,
      name = p_fields->>'name',
      style = p_fields->>'style',
      duration_days = (p_fields->>'duration_days')::int,
      warranty_months = (p_fields->>'warranty_months')::int,
      images = v_images,
      updated_at = now()
    where id = v_id;
    if v_status = 'published' then perform repend_package(v_id); end if;
    delete from package_items where package_id = v_id;
  end if;

  insert into package_items (package_id, room, name, material, size, qty, unit, unit_price, is_optional, sort)
  select v_id, i->>'room', i->>'name', nullif(i->>'material', ''), nullif(i->>'size', ''),
         (i->>'qty')::numeric, coalesce(nullif(i->>'unit', ''), 'bộ'), (i->>'unit_price')::bigint,
         coalesce((i->>'is_optional')::boolean, false), n::int
  from jsonb_array_elements(p_items) with ordinality as t(i, n);

  return v_id;
end $$;

-- Xoá tài khoản: yêu cầu, công trình, đánh giá ở lại (ẩn danh), để nhà thầu còn lịch sử và điểm.
alter table quote_requests alter column owner_id drop not null,
  drop constraint quote_requests_owner_id_fkey,
  add foreign key (owner_id) references profiles on delete set null;

revoke execute on function my_job_ids, submit_milestone, review_milestone, confirm_payment, propose_change,
  decide_change, submit_review, reply_review from public, anon;
grant execute on function my_job_ids, submit_milestone, review_milestone, confirm_payment, propose_change,
  decide_change, submit_review, reply_review to authenticated;
