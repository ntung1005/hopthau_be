-- Bản đầu tập trung vào: chủ nhà tự đo nhà → gửi yêu cầu theo tỉnh / thành + hạng mục → tự ghép nhà thầu;
-- và thu thập hồ sơ nhà thầu (cả từ form web khi nhà thầu chưa có tài khoản).
-- Tỉnh / thành và hạng mục là chuỗi trong danh sách cố định của BE (src/options.ts), BE kiểm tra trước khi ghi.

-- Yêu cầu: tỉnh / thành chuẩn + hạng mục cần làm -----------------------------------

alter table quote_requests
  add column province text check (length(province) <= 50),
  add column services text[] not null default '{}';
alter table quote_requests drop constraint quote_requests_check;
alter table quote_requests add constraint quote_requests_place_check
  check (unit_type_id is not null or address is not null or province is not null);
grant insert (province, services) on quote_requests to authenticated;

-- Nhà thầu: hạng mục nhận làm, kinh nghiệm, liên hệ khi chưa có tài khoản -----------

alter table contractors
  add column services text[] not null default '{}',
  add column years_experience smallint check (years_experience between 0 and 80),
  add column website text check (length(website) <= 300),
  -- Hồ sơ từ form web (owner_id trống): người liên hệ. Nhà thầu đăng ký app bằng số này thì nhận hồ sơ.
  add column contact_name text check (length(contact_name) <= 100),
  add column contact_phone text unique check (contact_phone ~ '^84[35789][0-9]{8}$'),
  add column source text check (length(source) <= 100);
-- contact_*, source: chỉ admin xem.
grant select (services, years_experience, website) on contractors to anon, authenticated;
grant insert (services, years_experience, website) on contractors to authenticated;
grant update (services, years_experience, website) on contractors to authenticated;

/**
 * Yêu cầu không đi từ gói: ghép tối đa 5 nhà thầu đã xác minh, có tài khoản (để trả lời được),
 * phục vụ tỉnh của yêu cầu (hoặc tỉnh của dự án khi chọn mẫu căn). Nhà thầu nhận đúng hạng mục
 * lên trước; nhà thầu chưa khai hạng mục coi như nhận trọn gói. Yêu cầu cũ chỉ có địa chỉ thì
 * vẫn so khớp chuỗi như trước.
 */
create or replace function auto_match_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_province text := coalesce(new.province,
    (select p.province from public.unit_types u join public.projects p on p.id = u.project_id where u.id = new.unit_type_id));
begin
  if new.package_id is not null or (v_province is null and new.address is null) then
    return new;
  end if;
  insert into public.quote_matches (request_id, contractor_id)
  select new.id, c.id from public.contractors c
  where c.status = 'verified' and c.owner_id is not null
    and case when v_province is not null then v_province = any(c.areas)
      else exists (select 1 from unnest(c.areas) a where length(a) >= 2 and new.address ilike '%' || a || '%') end
    and (cardinality(new.services) = 0 or cardinality(c.services) = 0 or c.services && new.services)
  order by (c.services && new.services) desc, c.rating desc nulls last, c.review_count desc
  limit 5
  on conflict do nothing;
  return new;
end $$;
