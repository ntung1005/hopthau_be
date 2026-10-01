export interface PriceItem {
  qty: number;
  unit_price: number;
  is_optional: boolean;
}

/**
 * Giá trọn gói = tổng (số lượng × đơn giá) của các hạng mục bắt buộc.
 * Hạng mục tuỳ chọn chỉ cộng khi chủ nhà chọn (truyền vào `chosenOptional`).
 * Giá không lưu riêng trong DB để luôn khớp với danh sách hạng mục.
 */
export function packagePrice(items: (PriceItem & { id?: string })[], chosenOptional: ReadonlySet<string> = new Set()): number {
  let total = 0;
  for (const it of items) {
    if (it.is_optional && !(it.id && chosenOptional.has(it.id))) continue;
    total += Math.round(Number(it.qty) * Number(it.unit_price));
  }
  return total;
}
