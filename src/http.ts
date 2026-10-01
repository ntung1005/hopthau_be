import type { SupabaseClient } from '@supabase/supabase-js';
import type { Request } from 'express';

/** Lỗi trả về cho app dạng {"error": code}. code là chuỗi a-z_ để app dịch ra câu thông báo. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// requireUser (auth.ts) gắn các trường này vào request đã xác thực.
declare global {
  namespace Express {
    interface Request {
      userId: string;
      /** Client Supabase mang token của người dùng đang gọi: RLS và auth.uid() áp dụng. */
      db: SupabaseClient;
    }
  }
}

/** Body JSON đã được express.json() đọc (app.ts). Không có body: invalid_json. */
export function readJson(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  if (body === undefined) throw new ApiError(400, 'invalid_json');
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(400, 'invalid_body');
  }
  return body as Record<string, unknown>;
}

const CODE_RE = /^[a-z_]+$/;

/**
 * Đổi lỗi của Postgres thành [ApiError]. Hàm SQL báo lỗi nghiệp vụ bằng
 * `raise exception 'request_not_found'`..., giữ nguyên mã đó cho app.
 */
export function dbError(error: { message: string; code?: string }): ApiError {
  const message = error.message ?? '';
  if (error.code === 'P0001' && CODE_RE.test(message)) {
    if (message.endsWith('_not_found')) return new ApiError(404, message);
    if (message.startsWith('not_')) return new ApiError(403, message);
    if (message.endsWith('_closed')) return new ApiError(409, message);
    return new ApiError(400, message);
  }
  if (error.code === '23505') return new ApiError(409, 'already_exists');
  // 22P02: sai định dạng (uuid, số...), 23514: vi phạm check, 23503: khoá ngoại không tồn tại,
  // 23502: thiếu trường bắt buộc, 22003: số quá lớn.
  if (['22P02', '23514', '23503', '23502', '22003'].includes(error.code ?? '')) {
    return new ApiError(400, 'invalid_input');
  }
  // 42501: RLS chặn ghi (ví dụ sửa gói của người khác).
  if (error.code === '42501') return new ApiError(403, 'forbidden');
  console.error('Lỗi cơ sở dữ liệu', error);
  return new ApiError(500, 'internal');
}

/** Kết quả truy vấn Supabase: lỗi thì ném [ApiError], không có dòng nào thì 404 `notFound`. */
export function must<T>({ data, error }: { data: T | null; error: { message: string; code?: string } | null }, notFound = 'not_found'): T {
  if (error) {
    // PGRST116: .single() không tìm thấy dòng nào.
    if (error.code === 'PGRST116') throw new ApiError(404, notFound);
    throw dbError(error);
  }
  if (data === null) throw new ApiError(404, notFound);
  return data;
}

/** Gọi hàm SQL bằng quyền của người dùng đang gọi. */
export async function rpc<T = unknown>(req: Request, fn: string, params?: Record<string, unknown>): Promise<T> {
  const { data, error } = await req.db.rpc(fn, params);
  if (error) throw dbError(error);
  return data as T;
}

// Đọc tham số ------------------------------------------------------------------

export function str(body: Record<string, unknown>, key: string, max = 500): string {
  const v = body[key];
  if (typeof v !== 'string' || !v.trim()) throw new ApiError(400, `missing_${key}`);
  if (v.length > max) throw new ApiError(400, `invalid_${key}`);
  return v.trim();
}

export function optStr(body: Record<string, unknown>, key: string, max = 500): string | null {
  const v = body[key];
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > max) throw new ApiError(400, `invalid_${key}`);
  return v.trim();
}

export function optInt(body: Record<string, unknown>, key: string): number | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  if (!Number.isSafeInteger(v) || (v as number) < 0) throw new ApiError(400, `invalid_${key}`);
  return v as number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function optUuid(body: Record<string, unknown>, key: string): string | null {
  const v = body[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new ApiError(400, `invalid_${key}`);
  return v;
}

export function int(body: Record<string, unknown>, key: string): number {
  const v = optInt(body, key);
  if (v === null) throw new ApiError(400, `missing_${key}`);
  return v;
}

export function strList(body: Record<string, unknown>, key: string, { maxItems = 20, max = 50 } = {}): string[] {
  const v = body[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > maxItems || v.some((x) => typeof x !== 'string' || x.length > max)) {
    throw new ApiError(400, `invalid_${key}`);
  }
  return (v as string[]).map((x) => x.trim()).filter(Boolean);
}

export function bool(body: Record<string, unknown>, key: string): boolean {
  const v = body[key];
  if (typeof v !== 'boolean') throw new ApiError(400, `invalid_${key}`);
  return v;
}
