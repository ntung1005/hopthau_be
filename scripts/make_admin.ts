// Cấp vai trò admin cho một tài khoản đã đăng ký: npm run make-admin -- 0912345678
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/env.ts';
import { normalizePhone } from '../src/phone.ts';

const phone = normalizePhone(process.argv[2] ?? '');
if (!phone) throw new Error('Cách dùng: npm run make-admin -- <số điện thoại đã đăng ký>');
const env = loadEnv();
const db = createClient(env.supabaseUrl, env.secretKey, { auth: { persistSession: false } });
const { data, error } = await db.from('profiles').select('id,roles').eq('phone', phone).maybeSingle();
if (error) throw error;
if (!data) throw new Error(`Chưa có tài khoản ${phone}. Đăng ký trong app trước.`);
if (!data.roles.includes('admin')) {
  const { error: e } = await db.from('profiles').update({ roles: [...data.roles, 'admin'] }).eq('id', data.id);
  if (e) throw e;
}
console.log(`${phone} là admin`);
