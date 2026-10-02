import { ApiError } from './http.ts';

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

export interface QuoteItem {
  room: string;
  name: string;
  qty: number;
  unit_price: number;
  note: string | null;
}

/**
 * Món trong báo giá của nhà thầu (đã thêm / bớt so với đồ chủ nhà chọn). Trả về món đã chuẩn hoá
 * và tổng giá = Σ số lượng × đơn giá, để giá báo luôn khớp danh sách món.
 */
export function parseQuoteItems(raw: unknown): { items: QuoteItem[]; total: number } {
  if (raw === undefined || raw === null) return { items: [], total: 0 };
  if (!Array.isArray(raw) || raw.length > 100) throw new ApiError(400, 'invalid_items');
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const items = raw.map((it, i) => {
    const q = (it ?? {}) as Record<string, unknown>;
    const name = text(q.name, 50);
    if (!name) throw new ApiError(400, `missing_items_${i}_name`);
    if (!Number.isInteger(q.qty) || (q.qty as number) < 1 || (q.qty as number) > 99) throw new ApiError(400, `invalid_items_${i}_qty`);
    if (!Number.isSafeInteger(q.unit_price) || (q.unit_price as number) < 0) throw new ApiError(400, `invalid_items_${i}_unit_price`);
    return { room: text(q.room, 50) || 'Chung', name, qty: q.qty as number, unit_price: q.unit_price as number, note: text(q.note, 100) || null };
  });
  return { items, total: items.reduce((s, it) => s + it.qty * it.unit_price, 0) };
}
