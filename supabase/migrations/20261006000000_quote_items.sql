-- Nhà thầu trả lời yêu cầu theo một trong hai cách:
--  in_app : báo giá theo món, dựa trên đồ chủ nhà chọn trong bản đo (thêm / bớt / đổi số lượng). Giá = tổng các món,
--           BE cộng (src/pricing.ts) rồi mới gọi submit_quote.
--  offline: làm việc trực tiếp, hai bên tự thoả thuận giá bên ngoài. Chọn nhà thầu này thì công trình không có giá:
--           nền tảng chỉ theo dõi tiến độ các mốc (nghiệm thu, ảnh), không ghi nhận tiền, không có phát sinh.

create type quote_mode as enum ('in_app', 'offline');

alter table quote_matches
  add column mode quote_mode not null default 'in_app',
  -- [{room, name, qty, unit_price, note}]
  add column items jsonb not null default '[]' check (jsonb_typeof(items) = 'array');

-- Công trình làm việc trực tiếp: price null, mốc không có số tiền.
alter table jobs alter column price drop not null, alter column duration_days drop not null;
alter table job_milestones alter column amount drop not null;

drop function submit_quote(uuid, bigint, int, text);

create function submit_quote(p_request uuid, p_mode quote_mode, p_price bigint, p_duration_days int, p_message text,
                             p_items jsonb default '[]') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_contractor uuid := public.my_contractor_id();
  v_offline boolean := p_mode = 'offline';
begin
  if v_contractor is null then raise exception 'not_contractor'; end if;
  if v_offline then
    if coalesce(trim(p_message), '') = '' then raise exception 'missing_message'; end if;
    if p_duration_days is not null and p_duration_days <= 0 then raise exception 'invalid_duration_days'; end if;
  else
    if p_price is null or p_price < 0 then raise exception 'invalid_price'; end if;
    if p_duration_days is null or p_duration_days <= 0 then raise exception 'invalid_duration_days'; end if;
  end if;
  update public.quote_matches m set
    status = 'quoted', mode = p_mode,
    price = case when v_offline then null else p_price end,
    items = case when v_offline then '[]'::jsonb else coalesce(p_items, '[]'::jsonb) end,
    duration_days = p_duration_days,
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

revoke execute on function submit_quote from public, anon;
grant execute on function submit_quote to authenticated;

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

  select p.warranty_months into v_warranty
  from public.quote_requests r join public.packages p on p.id = r.package_id
  where r.id = p_request and p.contractor_id = p_contractor;

  insert into public.jobs (request_id, owner_id, contractor_id, price, duration_days, warranty_months)
  values (p_request, auth.uid(), p_contractor, v_price, v_days, coalesce(v_warranty, 12))
  returning id into v_job;

  -- Cọc 30% · sản xuất 40% · lắp đặt 25% · nghiệm thu phần còn lại. Làm việc trực tiếp: mốc không có tiền.
  insert into public.job_milestones (job_id, seq, title, amount) values
    (v_job, 1, 'Đặt cọc, chốt thiết kế', round(v_price * 0.30)),
    (v_job, 2, 'Sản xuất xong tại xưởng', round(v_price * 0.40)),
    (v_job, 3, 'Lắp đặt xong tại nhà', round(v_price * 0.25)),
    (v_job, 4, 'Nghiệm thu, bàn giao', v_price - round(v_price * 0.30) - round(v_price * 0.40) - round(v_price * 0.25));
end $$;

create or replace function confirm_payment(p_milestone uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.job_milestones ms set paid_at = now()
  from public.jobs j
  where ms.id = p_milestone and j.id = ms.job_id and j.contractor_id = public.my_contractor_id()
    and ms.status = 'approved' and ms.paid_at is null and ms.amount is not null;
  if not found then raise exception 'milestone_not_found'; end if;
end $$;

create or replace function propose_change(p_job uuid, p_title text, p_description text, p_amount bigint, p_days integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_price bigint;
begin
  select price into v_price from public.jobs where id = p_job and contractor_id = public.my_contractor_id() and status = 'active';
  if not found then raise exception 'job_not_found'; end if;
  -- Làm việc trực tiếp: giá thoả thuận bên ngoài, phát sinh cũng vậy.
  if v_price is null then raise exception 'offline_job'; end if;
  if p_amount is null then raise exception 'invalid_amount'; end if;
  insert into public.job_changes (job_id, title, description, amount, days_delta)
  values (p_job, trim(p_title), nullif(trim(p_description), ''), p_amount, coalesce(p_days, 0))
  returning id into v_id;
  return v_id;
end $$;
