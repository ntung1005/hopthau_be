-- Vòng lead: nhà thầu tự đăng ký, tạo gói, nhận yêu cầu, gửi báo giá; chủ nhà chọn nhà thầu.
-- Hàm báo lỗi nghiệp vụ bằng `raise exception '<mã>'` (BE giữ nguyên mã cho app, xem src/http.ts).

-- Nhà thầu tự đăng ký ------------------------------------------------------

alter table contractors alter column owner_id set default auth.uid();

create policy "tự tạo hồ sơ nhà thầu" on contractors for insert with check (owner_id = auth.uid());
create policy "sửa hồ sơ nhà thầu của mình" on contractors for update using (owner_id = auth.uid());
-- Trạng thái xác minh, điểm uy tín do admin đặt.
grant insert (name, tax_code, address, areas, styles, bio, logo_url) on contractors to authenticated;
grant update (name, tax_code, address, areas, styles, bio, logo_url) on contractors to authenticated;

-- Có hồ sơ nhà thầu thì tài khoản có thêm vai trò contractor.
create function add_contractor_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.owner_id is not null then
    update public.profiles set roles = array_append(roles, 'contractor')
    where id = new.owner_id and not ('contractor' = any(roles));
  end if;
  return new;
end $$;

create trigger on_contractor_owner after insert or update of owner_id on contractors
  for each row execute function add_contractor_role();

-- Gói của nhà thầu -----------------------------------------------------------

create function my_contractor_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.contractors where owner_id = auth.uid()
$$;

-- Chủ nhà chỉ thấy gói đã đăng của nhà thầu đã xác minh.
drop policy "xem gói đã đăng hoặc của mình" on packages;
create policy "xem gói đã đăng hoặc của mình" on packages for select
  using ((status = 'published' and contractor_id in (select id from contractors where status = 'verified'))
    or contractor_id = my_contractor_id());

create policy "tạo gói của mình" on packages for insert with check (contractor_id = my_contractor_id());
create policy "sửa gói của mình" on packages for update using (contractor_id = my_contractor_id());
create policy "xoá gói nháp của mình" on packages for delete
  using (contractor_id = my_contractor_id() and status in ('draft', 'pending'));
grant insert (contractor_id, unit_type_id, name, style, duration_days, warranty_months, images) on packages to authenticated;
grant update (unit_type_id, name, style, duration_days, warranty_months, images, updated_at) on packages to authenticated;

create policy "sửa hạng mục gói của mình" on package_items for all
  using (package_id in (select id from packages where contractor_id = my_contractor_id()))
  with check (package_id in (select id from packages where contractor_id = my_contractor_id()));

-- Gói đã đăng mà bị sửa (thông tin hoặc hạng mục) thì quay về chờ duyệt, để giá mới được admin xem lại.
create function repend_package(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.packages set status = 'pending', updated_at = now()
  where id = p_id and status = 'published' and contractor_id = public.my_contractor_id()
$$;

/**
 * Tạo hoặc sửa gói cùng toàn bộ hạng mục trong một giao dịch. Chạy bằng quyền người gọi
 * nên RLS áp dụng. p_id null: tạo mới (nháp). Trả về id gói.
 * p_items: [{room, name, material?, size?, qty, unit?, unit_price, is_optional?}]
 */
create function save_package(p_id uuid, p_fields jsonb, p_items jsonb) returns uuid
language plpgsql set search_path = public as $$
declare
  v_id uuid := p_id;
  v_contractor uuid := my_contractor_id();
  v_status package_status;
begin
  if v_contractor is null then raise exception 'not_contractor'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'missing_items';
  end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'too_many_items'; end if;

  if v_id is null then
    insert into packages (contractor_id, unit_type_id, name, style, duration_days, warranty_months)
    values (v_contractor, (p_fields->>'unit_type_id')::uuid, p_fields->>'name', p_fields->>'style',
            (p_fields->>'duration_days')::int, (p_fields->>'warranty_months')::int)
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

-- Tên, phòng, hạng mục không được trống (bảng cũ chưa chặn chuỗi rỗng).
alter table packages add check (length(trim(name)) > 0 and length(trim(style)) > 0);
alter table package_items add check (length(trim(room)) > 0 and length(trim(name)) > 0);

/** Gửi gói nháp để admin duyệt. */
create function submit_package(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.packages set status = 'pending', updated_at = now()
  where id = p_id and contractor_id = public.my_contractor_id() and status in ('draft', 'hidden');
  if not found then raise exception 'package_not_found'; end if;
end $$;

-- Ghép yêu cầu với nhà thầu, báo giá -----------------------------------------

create type match_status as enum ('sent', 'quoted', 'accepted', 'declined');

-- Một nhà thầu báo giá một lần cho mỗi yêu cầu (gửi lại thì ghi đè), nên báo giá nằm luôn trong dòng ghép.
create table quote_matches (
  request_id uuid not null references quote_requests on delete cascade,
  contractor_id uuid not null references contractors on delete cascade,
  status match_status not null default 'sent',
  price bigint check (price >= 0),
  duration_days integer check (duration_days > 0),
  message text check (length(message) <= 2000),
  quoted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (request_id, contractor_id)
);
create index on quote_matches (contractor_id, created_at desc);

-- Hai bảng tra chéo nhau trong policy: tra qua hàm security definer để không đệ quy RLS.
create function my_request_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id from public.quote_requests where owner_id = auth.uid()
$$;

create function my_matched_request_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select request_id from public.quote_matches where contractor_id = public.my_contractor_id()
$$;

alter table quote_matches enable row level security;
create policy "chủ nhà và nhà thầu xem dòng ghép của mình" on quote_matches for select
  using (contractor_id = my_contractor_id() or request_id in (select my_request_ids()));
-- Ghi qua hàm bên dưới, hoặc admin ghép tay trong Studio (yêu cầu tự do theo địa chỉ).

create policy "nhà thầu xem yêu cầu được ghép" on quote_requests for select
  using (id in (select my_matched_request_ids()));

-- Yêu cầu đi từ một gói: tự ghép với nhà thầu của gói đó.
create function match_package_contractor() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.package_id is not null then
    insert into public.quote_matches (request_id, contractor_id)
    select new.id, contractor_id from public.packages where id = new.package_id and status = 'published'
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger on_quote_request_created after insert on quote_requests
  for each row execute function match_package_contractor();

/** Nhà thầu gửi (hoặc sửa) báo giá cho yêu cầu được ghép, khi chủ nhà chưa chọn ai. */
create function submit_quote(p_request uuid, p_price bigint, p_duration_days int, p_message text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_contractor uuid := public.my_contractor_id();
begin
  if v_contractor is null then raise exception 'not_contractor'; end if;
  if p_price is null or p_price < 0 then raise exception 'invalid_price'; end if;
  if p_duration_days is null or p_duration_days <= 0 then raise exception 'invalid_duration_days'; end if;
  update public.quote_matches m set
    status = 'quoted', price = p_price, duration_days = p_duration_days,
    message = nullif(trim(p_message), ''), quoted_at = now()
  from public.quote_requests r
  where m.request_id = p_request and m.contractor_id = v_contractor
    and r.id = m.request_id and r.status = 'open' and m.status in ('sent', 'quoted');
  if not found then
    if exists (select 1 from public.quote_matches where request_id = p_request and contractor_id = v_contractor) then
      raise exception 'request_closed';
    end if;
    raise exception 'request_not_found';
  end if;
end $$;

/** Chủ nhà chọn một báo giá: báo giá đó accepted, các báo giá khác declined, yêu cầu chuyển matched. */
create function accept_quote(p_request uuid, p_contractor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.quote_requests where id = p_request and owner_id = auth.uid() and status = 'open' for update;
  if not found then
    if exists (select 1 from public.quote_requests where id = p_request and owner_id = auth.uid()) then
      raise exception 'request_closed';
    end if;
    raise exception 'request_not_found';
  end if;
  update public.quote_matches set status = 'accepted'
  where request_id = p_request and contractor_id = p_contractor and status = 'quoted';
  if not found then raise exception 'quote_not_found'; end if;
  update public.quote_matches set status = 'declined'
  where request_id = p_request and contractor_id <> p_contractor;
  update public.quote_requests set status = 'matched' where id = p_request;
end $$;

revoke execute on function submit_package, submit_quote, accept_quote, save_package, repend_package,
  my_request_ids, my_matched_request_ids, my_contractor_id from public, anon;
grant execute on function submit_package, submit_quote, accept_quote, save_package, repend_package,
  my_request_ids, my_matched_request_ids, my_contractor_id to authenticated;
-- Policy xem gói (cả với khách chưa đăng nhập) gọi hàm này; với anon nó trả null.
grant execute on function my_contractor_id to anon;

-- Nhà thầu xoá gói chưa đăng: yêu cầu, lead cũ vẫn giữ, chỉ bỏ liên kết tới gói.
alter table quote_requests drop constraint quote_requests_package_id_fkey,
  add foreign key (package_id) references packages on delete set null;
alter table leads drop constraint leads_package_id_fkey,
  add foreign key (package_id) references packages on delete set null;
