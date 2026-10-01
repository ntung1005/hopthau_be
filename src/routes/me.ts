import { Router } from 'express';
import { dbError, must, readJson, str } from '../http.ts';
import type { Supabase } from '../supabase.ts';

export function meRoutes(supa: Supabase) {
  const router = Router();

  router.get('/', async (req, res) => {
    res.json(must(await req.db.from('profiles').select('id,phone,full_name,roles').eq('id', req.userId).single()));
  });

  router.patch('/', async (req, res) => {
    const fullName = str(readJson(req), 'full_name', 100);
    res.json(must(await req.db.from('profiles').update({ full_name: fullName }).eq('id', req.userId)
      .select('id,phone,full_name,roles').single()));
  });

  /**
   * Xoá tài khoản (App Store bắt buộc). Nhà thầu: ẩn hồ sơ và gói trước. Yêu cầu, công trình,
   * đánh giá giữ lại nhưng không còn gắn với người này (khoá ngoại set null).
   */
  router.delete('/', async (req, res) => {
    const { data: contractor } = await supa.admin.from('contractors').select('id').eq('owner_id', req.userId).maybeSingle();
    if (contractor) {
      await supa.admin.from('packages').update({ status: 'hidden' }).eq('contractor_id', contractor.id);
      await supa.admin.from('contractors').update({ status: 'rejected' }).eq('id', contractor.id);
    }
    const { error } = await supa.admin.auth.admin.deleteUser(req.userId);
    if (error) throw dbError({ message: error.message });
    res.json({ ok: true });
  });

  return router;
}
