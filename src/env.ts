// Cấu hình đọc từ biến môi trường (file .env, xem .env.example).

export interface Env {
  supabaseUrl: string;
  /** Publishable key (sb_publishable_...): đăng nhập, đọc dữ liệu công khai, gọi thay mặt người dùng. */
  publishableKey: string;
  /** Secret key (sb_secret_...): chỉ BE giữ, dùng để tạo tài khoản và ghi lead. */
  secretKey: string;
  port: number;
  /** Origin được phép gọi API từ trình duyệt. */
  corsOrigin: string;
  /** Số lần đăng nhập / đăng ký / gửi form tối đa mỗi 5 phút cho một IP. */
  authMaxAttempts: number;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const required = (name: string) => {
    const value = source[name];
    if (!value) throw new Error(`Thiếu biến môi trường ${name} (xem .env.example)`);
    return value;
  };
  return {
    supabaseUrl: required('SUPABASE_URL'),
    publishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
    secretKey: required('SUPABASE_SECRET_KEY'),
    port: Number(source.PORT ?? 8788),
    corsOrigin: source.CORS_ORIGIN ?? '*',
    authMaxAttempts: Number(source.AUTH_MAX_ATTEMPTS ?? 10),
  };
}
