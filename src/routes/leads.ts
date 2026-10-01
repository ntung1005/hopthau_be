// Form "để lại số" trên landing page. Không cần đăng nhập, giới hạn theo IP.

import { Router } from 'express';
import { AttemptLimiter, clientIp } from '../auth.ts';
import { ApiError, must, optStr, optUuid, readJson, str } from '../http.ts';
import { normalizePhone } from '../phone.ts';
import type { Supabase } from '../supabase.ts';

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

  return router;
}
