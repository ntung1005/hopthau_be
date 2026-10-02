-- Dữ liệu mẫu để phát triển. Tên dự án, nhà thầu đều là giả, không phải dự án thật.

insert into projects (id, slug, name, developer, province, address, handover_date, is_social_housing) values
  ('10000000-0000-0000-0000-000000000001', 'noxh-demo-song-hong', 'NOXH Demo Sông Hồng', 'Chủ đầu tư Demo A', 'Hà Nội', 'Long Biên, Hà Nội', '2026-12-15', true),
  ('10000000-0000-0000-0000-000000000002', 'noxh-demo-binh-an', 'NOXH Demo Bình An', 'Chủ đầu tư Demo B', 'TP. Hồ Chí Minh', 'Thủ Đức, TP. Hồ Chí Minh', '2027-03-01', true);

insert into unit_types (id, project_id, name, area_m2, bedrooms, bathrooms) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Mẫu A · 2PN', 56.2, 2, 1),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Mẫu B · 2PN 2WC', 68.5, 2, 2),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Mẫu C · 1PN', 42.0, 1, 1);

insert into contractors (id, name, address, areas, styles, bio, status, rating) values
  ('30000000-0000-0000-0000-000000000001', 'Xưởng Mộc Demo Gia Lâm', 'Gia Lâm, Hà Nội', '{Hà Nội}', '{Hiện đại,Japandi}', 'Xưởng gỗ công nghiệp 8 năm kinh nghiệm (dữ liệu mẫu).', 'verified', 4.7),
  ('30000000-0000-0000-0000-000000000002', 'Nội Thất Demo Tối Giản', 'Hoàng Mai, Hà Nội', '{Hà Nội}', '{Tối giản,Scandinavian}', 'Chuyên căn hộ nhỏ, tối ưu lưu trữ (dữ liệu mẫu).', 'verified', 4.5),
  ('30000000-0000-0000-0000-000000000003', 'Nhà thầu chưa duyệt', 'Hà Nội', '{Hà Nội}', '{}', null, 'pending', null);

insert into packages (id, contractor_id, unit_type_id, name, style, duration_days, warranty_months, status) values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Gói Cơ Bản', 'Hiện đại', 25, 24, 'published'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Gói Tối Giản', 'Tối giản', 30, 36, 'published'),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Gói Japandi', 'Japandi', 35, 24, 'published'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Gói nháp', 'Hiện đại', 20, 12, 'draft');

insert into package_items (package_id, room, name, material, size, qty, unit, unit_price, is_optional, sort) values
  ('40000000-0000-0000-0000-000000000001', 'Phòng khách', 'Kệ tivi', 'MDF chống ẩm An Cường', '2400×400', 1, 'bộ', 6500000, false, 1),
  ('40000000-0000-0000-0000-000000000001', 'Phòng khách', 'Tủ giày', 'MDF chống ẩm', '1200×350×1000', 1, 'bộ', 3800000, false, 2),
  ('40000000-0000-0000-0000-000000000001', 'Bếp', 'Tủ bếp dưới', 'MDF chống ẩm, mặt đá', null, 2.8, 'md', 3200000, false, 3),
  ('40000000-0000-0000-0000-000000000001', 'Bếp', 'Tủ bếp trên', 'MDF chống ẩm', null, 2.8, 'md', 2800000, true, 4),
  ('40000000-0000-0000-0000-000000000001', 'Phòng ngủ 1', 'Giường 1m6', 'MDF', '1600×2000', 1, 'chiếc', 5500000, false, 5),
  ('40000000-0000-0000-0000-000000000001', 'Phòng ngủ 1', 'Tủ áo 2 cánh', 'MDF chống ẩm', '1200×550×2400', 1, 'bộ', 7200000, false, 6),
  ('40000000-0000-0000-0000-000000000001', 'Phòng ngủ 2', 'Giường tầng', 'MDF', '1200×2000', 1, 'chiếc', 6800000, true, 7),
  ('40000000-0000-0000-0000-000000000002', 'Phòng khách', 'Kệ tivi treo', 'Melamine', '1800×350', 1, 'bộ', 4200000, false, 1),
  ('40000000-0000-0000-0000-000000000002', 'Bếp', 'Tủ bếp chữ I', 'Melamine, mặt đá', null, 2.8, 'md', 3900000, false, 2),
  ('40000000-0000-0000-0000-000000000002', 'Phòng ngủ 1', 'Giường hộp có ngăn kéo', 'Melamine', '1600×2000', 1, 'chiếc', 6200000, false, 3),
  ('40000000-0000-0000-0000-000000000002', 'Phòng ngủ 1', 'Tủ áo kịch trần', 'Melamine', '1400×600×2700', 1, 'bộ', 9500000, false, 4),
  ('40000000-0000-0000-0000-000000000002', 'Phòng ngủ 2', 'Bàn học + giá sách', 'Melamine', '1200×600', 1, 'bộ', 3500000, false, 5),
  ('40000000-0000-0000-0000-000000000003', 'Phòng khách', 'Kệ tivi gỗ sồi', 'Veneer sồi', '2600×400', 1, 'bộ', 9800000, false, 1),
  ('40000000-0000-0000-0000-000000000003', 'Bếp', 'Tủ bếp chữ L', 'Acrylic, mặt đá', null, 4.2, 'md', 4500000, false, 2),
  ('40000000-0000-0000-0000-000000000003', 'Phòng ngủ 1', 'Giường bệt Nhật', 'Veneer sồi', '1800×2000', 1, 'chiếc', 8900000, false, 3),
  ('40000000-0000-0000-0000-000000000004', 'Phòng khách', 'Kệ tivi', 'MDF', null, 1, 'bộ', 5000000, false, 1);
