/**
 * Chuẩn hoá số di động Việt Nam về dạng 84xxxxxxxxx.
 * Nhận 0912345678, +84912345678, 84912345678, có thể có dấu cách, chấm, gạch.
 * Sai định dạng: null.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[\s.\-()]/g, '');
  const m = /^(?:\+?84|0)([35789]\d{8})$/.exec(digits);
  return m ? `84${m[1]}` : null;
}
