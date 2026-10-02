// Danh sách chọn dùng chung app, web và BE (GET /meta). Ghép yêu cầu với nhà thầu so khớp đúng
// chuỗi trong các danh sách này, nên BE chỉ nhận giá trị có trong danh sách.

import { ApiError, optStr, strList } from './http.ts';

/** 34 tỉnh / thành từ 1/7/2025 (Nghị quyết 202/2025/QH15), thành phố trực thuộc trung ương đứng đầu. */
export const PROVINCES = [
  'Hà Nội', 'TP. Hồ Chí Minh', 'Hải Phòng', 'Đà Nẵng', 'Cần Thơ', 'Huế',
  'An Giang', 'Bắc Ninh', 'Cà Mau', 'Cao Bằng', 'Đắk Lắk', 'Điện Biên', 'Đồng Nai', 'Đồng Tháp',
  'Gia Lai', 'Hà Tĩnh', 'Hưng Yên', 'Khánh Hòa', 'Lai Châu', 'Lâm Đồng', 'Lạng Sơn', 'Lào Cai',
  'Nghệ An', 'Ninh Bình', 'Phú Thọ', 'Quảng Ngãi', 'Quảng Ninh', 'Quảng Trị', 'Sơn La', 'Tây Ninh',
  'Thái Nguyên', 'Thanh Hóa', 'Tuyên Quang', 'Vĩnh Long',
];

/** Hạng mục chủ nhà cần làm / nhà thầu nhận làm. */
export const SERVICES = [
  'Thiết kế 3D', 'Đồ gỗ nội thất', 'Tủ bếp', 'Sơn bả', 'Sàn gỗ / sàn nhựa', 'Ốp lát gạch',
  'Trần thạch cao', 'Điện nước', 'Rèm, giấy dán tường', 'Cải tạo, sửa chữa',
];

export function optProvince(body: Record<string, unknown>, key = 'province'): string | null {
  const v = optStr(body, key, 50);
  if (v !== null && !PROVINCES.includes(v)) throw new ApiError(400, `invalid_${key}`);
  return v;
}

/** Danh sách con của [options], bỏ trùng. */
export function pickList(body: Record<string, unknown>, key: string, options: string[]): string[] {
  const v = strList(body, key, { maxItems: options.length });
  if (v.some((x) => !options.includes(x))) throw new ApiError(400, `invalid_${key}`);
  return [...new Set(v)];
}
