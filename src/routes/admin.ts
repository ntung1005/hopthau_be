// API cho web admin (hopthau_web /admin). Chỉ tài khoản có vai trò admin; đọc / ghi bằng
// service_role nên thấy mọi dữ liệu (kể cả MST, số điện thoại). Mọi thao tác ghi vào admin_audit.

import { Router, type RequestHandler } from 'express';
import { ApiError, dbError, must, optStr, optUuid, readJson, str } from '../http.ts';
import { optProvince } from '../options.ts';
import { packagePrice, type PriceItem } from '../pricing.ts';
import type { Supabase } from '../supabase.ts';

const MAX_MATCHES = 5;
const CONTRACTOR_STATUS = ['pending', 'verified', 'rejected'];
const PACKAGE_STATUS = ['draft', 'pending', 'published', 'hidden'];

export function requireAdmin(): RequestHandler {
  return async (req, _res, next) => {
    const { data } = await req.db.from('profiles').select('roles').eq('id', req.userId).maybeSingle();
    if (!data?.roles?.includes('admin')) throw new ApiError(403, 'not_admin');
    next();
  };
}

function oneOf(body: Record<string, unknown>, key: string, allowed: string[]): string {
  const v = body[key];
  if (typeof v !== 'string' || !allowed.includes(v)) throw new ApiError(400, `invalid_${key}`);
  return v;
}

export function adminRoutes(supa: Supabase) {
  const db = supa.admin;
  const router = Router();

  const audit = async (actor: string, action: string, targetId: string | null, data: Record<string, unknown> = {}) => {
    const { error } = await db.from('admin_audit').insert({ actor_id: actor, action, target_id: targetId, data });
    if (error) console.error('Ghi audit lỗi', error);
  };

  const count = async (table: string, filter: (q: any) => any = (q) => q) => {
    const { count: n, error } = await filter(db.from(table).select('*', { count: 'exact', head: true }));
    if (error) throw dbError(error);
    return n ?? 0;
  };

  // Tổng quan ----------------------------------------------------------------

  router.get('/stats', async (_req, res) => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [contractorsPending, packagesPending, requestsOpen, requestsWeek, leadsWeek, jobsActive, jobsDone, jobs] = await Promise.all([
      count('contractors', (q) => q.eq('status', 'pending')),
      count('packages', (q) => q.eq('status', 'pending')),
      count('quote_requests', (q) => q.eq('status', 'open')),
      count('quote_requests', (q) => q.gte('created_at', since)),
      count('leads', (q) => q.gte('created_at', since)),
      count('jobs', (q) => q.eq('status', 'active')),
      count('jobs', (q) => q.eq('status', 'completed')),
      db.from('jobs').select('price').then(must),
    ]);
    // Yêu cầu chưa có nhà thầu nào: cần ghép tay.
    const open = must(await db.from('quote_requests').select('id,quote_matches(count)').eq('status', 'open'));
    const unmatched = (open as unknown as { quote_matches: { count: number }[] }[])
      .filter((r) => (r.quote_matches[0]?.count ?? 0) === 0).length;
    res.json({
      contractors_pending: contractorsPending,
      packages_pending: packagesPending,
      requests_open: requestsOpen,
      requests_unmatched: unmatched,
      requests_7d: requestsWeek,
      leads_7d: leadsWeek,
      jobs_active: jobsActive,
      jobs_completed: jobsDone,
      gmv: (jobs as { price: number }[]).reduce((s, j) => s + Number(j.price), 0),
    });
  });

  // Nhà thầu -----------------------------------------------------------------

  router.get('/contractors', async (req, res) => {
    let q = db.from('contractors')
      .select('id,name,tax_code,address,areas,styles,services,years_experience,website,bio,status,rating,review_count,created_at,' +
        'contact_name,contact_phone,source,owner:profiles(full_name,phone),packages(count)')
      .order('created_at', { ascending: false });
    if (typeof req.query.status === 'string') q = q.eq('status', req.query.status);
    res.json(must(await q));
  });

  router.patch('/contractors/:id', async (req, res) => {
    const status = oneOf(readJson(req), 'status', CONTRACTOR_STATUS);
    const row = must(await db.from('contractors').update({ status }).eq('id', req.params.id).select('id,name,status').maybeSingle(),
      'contractor_not_found');
    await audit(req.userId, `contractor.${status}`, req.params.id, { name: (row as unknown as { name: string }).name });
    res.json(row);
  });

  // Gói ----------------------------------------------------------------------

  router.get('/packages', async (req, res) => {
    let q = db.from('packages')
      .select('id,name,style,duration_days,warranty_months,images,status,updated_at,' +
        'contractor:contractors(id,name,status),unit_type:unit_types(name,area_m2,project:projects(name)),' +
        'items:package_items(room,name,material,size,qty,unit,unit_price,is_optional,sort)')
      .order('updated_at', { ascending: false });
    if (typeof req.query.status === 'string') q = q.eq('status', req.query.status);
    const rows = must(await q) as unknown as { items: PriceItem[] }[];
    res.json(rows.map((p) => ({ ...p, price: packagePrice(p.items) })));
  });

  router.patch('/packages/:id', async (req, res) => {
    const status = oneOf(readJson(req), 'status', PACKAGE_STATUS);
    const row = must(await db.from('packages').update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).select('id,name,status').maybeSingle(), 'package_not_found');
    await audit(req.userId, `package.${status}`, req.params.id, { name: (row as unknown as { name: string }).name });
    res.json(row);
  });

  // Yêu cầu báo giá: xem, ghép thêm nhà thầu -------------------------------------

  const REQUEST = 'id,province,services,address,budget,style,note,status,created_at,owner:profiles(full_name,phone),' +
    'unit_type:unit_types(name,project:projects(name,province)),package:packages(name),' +
    'matches:quote_matches(status,price,created_at,contractor:contractors(id,name))';

  router.get('/requests', async (req, res) => {
    let q = db.from('quote_requests').select(REQUEST).order('created_at', { ascending: false }).limit(200);
    if (typeof req.query.status === 'string') q = q.eq('status', req.query.status);
    res.json(must(await q));
  });

  /** Nhà thầu đã xác minh, có tài khoản, chưa được ghép; khớp tỉnh (hoặc địa chỉ) và hạng mục lên đầu. */
  router.get('/requests/:id/suggestions', async (req, res) => {
    const r = must(await db.from('quote_requests').select(REQUEST).eq('id', req.params.id).maybeSingle(), 'request_not_found') as unknown as {
      province: string | null; services: string[]; address: string | null; unit_type: { project: { province: string } } | null;
      matches: { contractor: { id: string } }[];
    };
    const place = `${r.province ?? ''} ${r.address ?? ''} ${r.unit_type?.project.province ?? ''}`.toLowerCase();
    const taken = new Set(r.matches.map((m) => m.contractor.id));
    const all = must(await db.from('contractors').select('id,name,areas,styles,services,rating,review_count')
      .eq('status', 'verified').not('owner_id', 'is', null)) as
      { id: string; areas: string[]; services: string[]; rating: number | null; review_count: number }[];
    const ranked = all.filter((c) => !taken.has(c.id))
      .map((c) => ({
        ...c,
        area_match: c.areas.some((a) => a.length >= 2 && place.includes(a.toLowerCase())),
        service_match: c.services.some((x) => r.services.includes(x)),
      }))
      .sort((a, b) => Number(b.area_match) - Number(a.area_match) || Number(b.service_match) - Number(a.service_match) ||
        (b.rating ?? 0) - (a.rating ?? 0));
    res.json({ remaining: MAX_MATCHES - taken.size, contractors: ranked.slice(0, 20) });
  });

  router.post('/requests/:id/matches', async (req, res) => {
    const contractorId = optUuid(readJson(req), 'contractor_id');
    if (!contractorId) throw new ApiError(400, 'missing_contractor_id');
    const r = must(await db.from('quote_requests').select('status,quote_matches(count)').eq('id', req.params.id).maybeSingle(),
      'request_not_found') as unknown as { status: string; quote_matches: { count: number }[] };
    if (r.status !== 'open') throw new ApiError(409, 'request_closed');
    if ((r.quote_matches[0]?.count ?? 0) >= MAX_MATCHES) throw new ApiError(409, 'too_many_matches');
    const c = must(await db.from('contractors').select('status,owner_id').eq('id', contractorId).maybeSingle(), 'contractor_not_found') as
      { status: string; owner_id: string | null };
    if (c.status !== 'verified') throw new ApiError(400, 'contractor_not_verified');
    // Hồ sơ thu từ form web, nhà thầu chưa cài app: ghép vào thì không ai báo giá.
    if (!c.owner_id) throw new ApiError(400, 'contractor_no_account');
    const { error } = await db.from('quote_matches').insert({ request_id: req.params.id, contractor_id: contractorId });
    if (error?.code === '23505') throw new ApiError(409, 'already_matched');
    if (error) throw dbError(error);
    await audit(req.userId, 'request.match', req.params.id, { contractor_id: contractorId });
    res.status(201).json({ ok: true });
  });

  // Lead landing ---------------------------------------------------------------

  router.get('/leads', async (_req, res) => {
    res.json(must(await db.from('leads').select('id,name,phone,note,source,created_at,project:projects(name)')
      .order('created_at', { ascending: false }).limit(500)));
  });

  // Dự án & mẫu căn --------------------------------------------------------------

  router.get('/projects', async (_req, res) => {
    res.json(must(await db.from('projects').select('*,unit_types(id,name,area_m2,bedrooms,bathrooms)')
      .order('created_at', { ascending: false })));
  });

  router.post('/projects', async (req, res) => {
    const body = readJson(req);
    const name = str(body, 'name', 200);
    const slug = optStr(body, 'slug', 100) ?? slugify(name);
    if (!/^[a-z0-9-]+$/.test(slug)) throw new ApiError(400, 'invalid_slug');
    const handover = optStr(body, 'handover_date', 10);
    if (handover && !/^\d{4}-\d{2}-\d{2}$/.test(handover)) throw new ApiError(400, 'invalid_handover_date');
    const { data, error } = await db.from('projects').insert({
      slug, name,
      developer: optStr(body, 'developer', 200),
      province: optProvince(body) ?? str(body, 'province'),
      address: optStr(body, 'address', 300),
      handover_date: handover,
      is_social_housing: body.is_social_housing !== false,
    }).select('*').single();
    if (error?.code === '23505') throw new ApiError(409, 'slug_taken');
    if (error) throw dbError(error);
    await audit(req.userId, 'project.create', data.id, { name });
    res.status(201).json(data);
  });

  router.post('/projects/:id/unit-types', async (req, res) => {
    const body = readJson(req);
    const num = (key: string, min: number, max: number) => {
      const v = body[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ApiError(400, `invalid_${key}`);
      return v;
    };
    const { data, error } = await db.from('unit_types').insert({
      project_id: req.params.id,
      name: str(body, 'name', 100),
      area_m2: num('area_m2', 10, 1000),
      bedrooms: num('bedrooms', 0, 10),
      bathrooms: num('bathrooms', 0, 10),
    }).select('*').single();
    if (error?.code === '23505') throw new ApiError(409, 'unit_type_exists');
    if (error) throw dbError(error);
    await audit(req.userId, 'unit_type.create', data.id, { project_id: req.params.id, name: data.name });
    res.status(201).json(data);
  });

  // Nhật ký --------------------------------------------------------------------------

  router.get('/audit', async (_req, res) => {
    res.json(must(await db.from('admin_audit').select('id,action,target_id,data,created_at,actor:profiles(full_name,phone)')
      .order('created_at', { ascending: false }).limit(200)));
  });

  return router;
}

const VN = 'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
const ASCII = 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd';

/** "NOXH Sông Hồng" -> "noxh-song-hong" */
export function slugify(s: string): string {
  return [...s.toLowerCase()].map((ch) => { const i = VN.indexOf(ch); return i < 0 ? ch : ASCII[i]; }).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}
