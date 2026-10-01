-- Web admin: nhật ký thao tác của admin, tự ghép yêu cầu theo địa chỉ.
-- Mọi thao tác admin đi qua BE bằng service_role (src/routes/admin.ts), BE kiểm tra vai trò admin.

create table admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles on delete set null,
  action text not null,                  -- ví dụ contractor.verify, package.publish, request.match
  target_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on admin_audit (created_at desc);

-- Không có policy: chỉ service_role đọc / ghi.
alter table admin_audit enable row level security;

/**
 * Yêu cầu tự do theo địa chỉ: ghép tối đa 5 nhà thầu đã xác minh có khu vực phục vụ nằm trong
 * địa chỉ (ví dụ areas ['Hà Nội'] khớp "Long Biên, Hà Nội"), điểm cao trước.
 * ponytail: so khớp chuỗi đơn giản; chuyển sang tỉnh/thành chuẩn hoá khi form có ô chọn tỉnh.
 */
create function auto_match_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.package_id is null and new.address is not null then
    insert into public.quote_matches (request_id, contractor_id)
    select new.id, c.id from public.contractors c
    where c.status = 'verified'
      and exists (select 1 from unnest(c.areas) a where length(a) >= 2 and new.address ilike '%' || a || '%')
    order by c.rating desc nulls last, c.review_count desc
    limit 5
    on conflict do nothing;
  end if;
  return new;
end $$;

create trigger on_quote_request_auto_match after insert on quote_requests
  for each row execute function auto_match_request();
