// Form "để lại số" trên landing page và form hồ sơ nhà thầu (/cho-nha-thau). Không cần đăng nhập, giới hạn theo IP.

import { Router } from 'express';
import { AttemptLimiter, clientIp } from '../auth.ts';
import { ApiError, dbError, must, optStr, optUuid, readJson, str } from '../http.ts';
import { normalizePhone } from '../phone.ts';
import type { Supabase } from '../supabase.ts';
import { readProfile } from './contractor.ts';

export function leadRoutes(supa: Supabase, maxAttempts: number) {
  const limiter = new AttemptLimiter(maxAttempts, 5 * 60_000);
  const router = Router();

  router.post('/', async (req, res) => {
    const body = readJson(req);
    const lead = {
      name: str(body, 'name', 100),
      phone: normalizePhone(typeof body.phone === 'string' ? body.phone : ''),
      project_id: optUuid(body, 'project_id'),
      package_id: optUuid(body, 'package_id'),
      note: optStr(body, 'note', 1000),
      source: optStr(body, 'source', 100),
    };
    if (!lead.phone) throw new ApiError(400, 'invalid_phone');
    limiter.check(`lead:${clientIp(req)}`);
    must(await supa.admin.from('leads').insert(lead).select('id').single());
    res.status(201).json({ ok: true });
  });

  /**
   * Hồ sơ nhà thầu chưa có tài khoản: tạo contractors chờ xác minh, owner_id trống. Nhà thầu đăng ký
   * app bằng cùng số điện thoại thì nhận hồ sơ (POST /contractor). Số đã gửi rồi thì không ghi đè
   * (form công khai, ai cũng gửi được), vận hành gọi lại để cập nhật.
   */
  router.post('/contractors', async (req, res) => {
    const body = readJson(req);
    const phone = normalizePhone(typeof body.phone === 'string' ? body.phone : '');
    if (!phone) throw new ApiError(400, 'invalid_phone');
    const row = {
      ...readProfile(body),
      contact_name: str(body, 'contact_name', 100),
      contact_phone: phone,
      source: optStr(body, 'source', 100),
      owner_id: null,
    };
    limiter.check(`lead:${clientIp(req)}`);
    const { error } = await supa.admin.from('contractors').insert(row);
    if (error && error.code !== '23505') throw dbError(error);
    res.status(201).json({ ok: true });
  });

  return router;
}
