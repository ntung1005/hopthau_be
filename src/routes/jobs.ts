// Công trình (sau khi chủ nhà chọn báo giá): mốc nghiệm thu / thanh toán, phát sinh, đánh giá.
// Hai bên cùng xem một công trình; mọi thay đổi đi qua hàm SQL (kiểm tra vai trò và thứ tự).

import { Router, type Request } from 'express';
import { ApiError, bool, int, must, optStr, readJson, rpc, str } from '../http.ts';
import type { Supabase } from '../supabase.ts';
import { photoList } from './uploads.ts';

const JOB = 'id,request_id,owner_id,contractor_id,price,duration_days,warranty_months,status,completed_at,created_at,' +
  'contractor:contractors(id,name,rating,status,owner_id),' +
  'request:quote_requests(address,note,unit_type:unit_types(id,name,project:projects(name)),package:packages(id,name))';

interface Job {
  id: string;
  owner_id: string | null;
  price: number | null;
  status: string;
  warranty_months: number;
  completed_at: string | null;
  contractor: { id: string; owner_id: string | null; [k: string]: unknown };
  [k: string]: unknown;
}

interface Milestone { amount: number | null; status: string; paid_at: string | null }
interface Change { amount: number; days_delta: number; status: string }

/**
 * Tổng tiền hiện tại, đã duyệt, đã trả; hạn bảo hành. Tính ở một chỗ để app và web không tự cộng.
 * Làm việc trực tiếp (price null): không có số tiền nào, offline = true.
 */
export function jobSummary(job: { price: number | null; duration_days: number | null; warranty_months: number; completed_at: string | null },
                           milestones: Milestone[], changes: Change[]) {
  const approvedChanges = changes.filter((c) => c.status === 'approved');
  const warrantyUntil = job.completed_at ? new Date(job.completed_at) : null;
  warrantyUntil?.setMonth(warrantyUntil.getMonth() + job.warranty_months);
  const offline = job.price === null;
  const sum = (ms: Milestone[]) => (offline ? null : ms.reduce((s, m) => s + Number(m.amount), 0));
  return {
    offline,
    total: offline ? null : job.price! + approvedChanges.reduce((s, c) => s + Number(c.amount), 0),
    total_days: job.duration_days === null ? null : job.duration_days + approvedChanges.reduce((s, c) => s + c.days_delta, 0),
    approved_amount: sum(milestones.filter((m) => m.status === 'approved')),
    paid_amount: sum(milestones.filter((m) => m.paid_at)),
    warranty_until: warrantyUntil?.toISOString() ?? null,
  };
}

export function jobRoutes(supa: Supabase, supabaseUrl: string) {
  const router = Router();

  /** Vai trò của người gọi trong công trình, và tên + số điện thoại bên kia (đã chốt nên hiện số). */
  async function withParties(req: Request, job: Job) {
    const role = job.owner_id === req.userId ? 'owner' : 'contractor';
    const ids = [job.owner_id, job.contractor.owner_id].filter((x): x is string => !!x);
    const people = ids.length === 0 ? [] : must(await supa.admin.from('profiles').select('id,full_name,phone').in('id', ids));
    const byId = new Map(people.map((p) => [p.id, p]));
    const { owner_id, contractor: { owner_id: contractorOwner, ...contractor }, ...rest } = job;
    return {
      ...rest,
      role,
      contractor: { ...contractor, phone: byId.get(contractorOwner ?? '')?.phone ?? null },
      owner: { full_name: byId.get(owner_id ?? '')?.full_name ?? 'Chủ nhà', phone: byId.get(owner_id ?? '')?.phone ?? null },
    };
  }

  router.get('/', async (req, res) => {
    const jobs = must(await req.db.from('jobs').select(JOB + ',milestones:job_milestones(amount,status,paid_at),changes:job_changes(amount,days_delta,status)')
      .order('created_at', { ascending: false })) as unknown as (Job & { milestones: Milestone[]; changes: Change[] })[];
    res.json(await Promise.all(jobs.map(async ({ milestones, changes, ...j }) => ({
      ...(await withParties(req, j as Job)),
      ...jobSummary(j as never, milestones, changes),
      progress: { done: milestones.filter((m) => m.status === 'approved').length, total: milestones.length },
    }))));
  });

  router.get('/:id', async (req, res) => {
    const job = must(await req.db.from('jobs')
      .select(JOB + ',milestones:job_milestones(*),changes:job_changes(*),review:reviews(*)')
      .eq('id', req.params.id)
      .order('seq', { referencedTable: 'job_milestones' })
      .order('created_at', { referencedTable: 'job_changes' })
      .maybeSingle(), 'job_not_found') as unknown as Job & { milestones: Milestone[]; changes: Change[] };
    res.json({ ...(await withParties(req, job)), ...jobSummary(job as never, job.milestones, job.changes) });
  });

  // Nhà thầu ------------------------------------------------------------------

  router.post('/milestones/:id/submit', async (req, res) => {
    const body = readJson(req);
    await rpc(req, 'submit_milestone', {
      p_milestone: req.params.id,
      p_note: optStr(body, 'note', 2000),
      p_photos: photoList(body, 'photos', supabaseUrl),
    });
    res.json({ ok: true });
  });

  router.post('/milestones/:id/paid', async (req, res) => {
    await rpc(req, 'confirm_payment', { p_milestone: req.params.id });
    res.json({ ok: true });
  });

  router.post('/:id/changes', async (req, res) => {
    const body = readJson(req);
    const amount = body.amount;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount)) throw new ApiError(400, 'invalid_amount');
    const days = body.days_delta ?? 0;
    if (typeof days !== 'number' || !Number.isInteger(days) || Math.abs(days) > 365) throw new ApiError(400, 'invalid_days_delta');
    const id = await rpc<string>(req, 'propose_change', {
      p_job: req.params.id,
      p_title: str(body, 'title', 200),
      p_description: optStr(body, 'description', 2000),
      p_amount: amount,
      p_days: days,
    });
    res.status(201).json({ id });
  });

  router.post('/:id/review/reply', async (req, res) => {
    await rpc(req, 'reply_review', { p_job: req.params.id, p_reply: str(readJson(req), 'reply', 2000) });
    res.json({ ok: true });
  });

  // Chủ nhà -------------------------------------------------------------------

  router.post('/milestones/:id/review', async (req, res) => {
    const body = readJson(req);
    await rpc(req, 'review_milestone', {
      p_milestone: req.params.id,
      p_approve: bool(body, 'approve'),
      p_feedback: optStr(body, 'feedback', 2000),
    });
    res.json({ ok: true });
  });

  router.post('/changes/:id/decide', async (req, res) => {
    await rpc(req, 'decide_change', { p_change: req.params.id, p_approve: bool(readJson(req), 'approve') });
    res.json({ ok: true });
  });

  router.post('/:id/review', async (req, res) => {
    const body = readJson(req);
    const score = (key: string) => {
      const v = int(body, key);
      if (v < 1 || v > 5) throw new ApiError(400, `invalid_${key}`);
      return v;
    };
    await rpc(req, 'submit_review', {
      p_job: req.params.id,
      p_quality: score('quality'),
      p_punctuality: score('punctuality'),
      p_price_honesty: score('price_honesty'),
      p_attitude: score('attitude'),
      p_content: optStr(body, 'content', 3000),
      p_photos: photoList(body, 'photos', supabaseUrl),
    });
    res.status(201).json({ ok: true });
  });

  return router;
}
