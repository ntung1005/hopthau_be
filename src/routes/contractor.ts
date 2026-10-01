// Khu vực nhà thầu: hồ sơ, gói nội thất, khách hàng được ghép và báo giá.
// Ghi bằng token người dùng: RLS và các hàm SQL tự kiểm tra quyền sở hữu.

import { Router, type Request } from 'express';
import { ApiError, dbError, int, must, optStr, optUuid, readJson, rpc, str, strList } from '../http.ts';
import { packagePrice, type PriceItem } from '../pricing.ts';
import type { Supabase } from '../supabase.ts';
import { photoList } from './uploads.ts';

// tax_code không đọc được bằng quyền người dùng (chỉ admin), nên không có trong danh sách.
const PROFILE = 'id,name,address,areas,styles,bio,logo_url,status,rating,created_at';
const PACKAGE = 'id,name,style,duration_days,warranty_months,images,status,updated_at,' +
  'unit_type:unit_types(id,name,project:projects(id,slug,name)),' +
  'items:package_items(id,room,name,material,size,qty,unit,unit_price,is_optional,sort)';

function readProfile(body: Record<string, unknown>) {
  return {
    name: str(body, 'name', 100),
    tax_code: optStr(body, 'tax_code', 20),
    address: optStr(body, 'address', 300),
    areas: strList(body, 'areas'),
    styles: strList(body, 'styles'),
    bio: optStr(body, 'bio', 2000),
  };
}

function readPackage(body: Record<string, unknown>, supabaseUrl: string) {
  const unitTypeId = optUuid(body, 'unit_type_id');
  if (!unitTypeId) throw new ApiError(400, 'missing_unit_type_id');
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) throw new ApiError(400, 'missing_items');
  return {
    p_fields: {
      unit_type_id: unitTypeId,
      name: str(body, 'name', 100),
      style: str(body, 'style', 50),
      duration_days: int(body, 'duration_days'),
      warranty_months: int(body, 'warranty_months'),
      images: photoList(body, 'images', supabaseUrl),
    },
    p_items: items.map((raw, i) => {
      if (typeof raw !== 'object' || raw === null) throw new ApiError(400, `invalid_items`);
      const it = raw as Record<string, unknown>;
      const qty = it.qty;
      if (typeof qty !== 'number' || !(qty > 0) || qty > 99999) throw new ApiError(400, `invalid_items_${i}_qty`);
      return {
        room: str(it, 'room', 50),
        name: str(it, 'name', 100),
        material: optStr(it, 'material', 100),
        size: optStr(it, 'size', 50),
        qty,
        unit: optStr(it, 'unit', 20),
        unit_price: int(it, 'unit_price'),
        is_optional: it.is_optional === true,
      };
    }),
  };
}

const withPrice = <T extends { items: PriceItem[] }>(p: T) => ({ ...p, price: packagePrice(p.items) });

export function contractorRoutes(supa: Supabase, supabaseUrl: string) {
  const router = Router();

  // Hồ sơ -------------------------------------------------------------------

  router.get('/', async (req, res) => {
    const { data, error } = await req.db.from('contractors').select(PROFILE).eq('owner_id', req.userId).maybeSingle();
    if (error) throw dbError(error);
    res.json(data); // null: chưa đăng ký làm nhà thầu
  });

  router.post('/', async (req, res) => {
    const { error } = await req.db.from('contractors').insert(readProfile(readJson(req)));
    if (error?.code === '23505') throw new ApiError(409, 'contractor_exists');
    if (error) throw dbError(error);
    // Đọc lại sau khi ghi: trigger vừa thêm vai trò contractor, RLS đọc thấy hồ sơ pending của mình.
    res.status(201).json(must(await req.db.from('contractors').select(PROFILE).eq('owner_id', req.userId).single()));
  });

  router.patch('/', async (req, res) => {
    res.json(must(await req.db.from('contractors').update(readProfile(readJson(req)))
      .eq('owner_id', req.userId).select(PROFILE).single(), 'contractor_not_found'));
  });

  // Gói ---------------------------------------------------------------------

  router.get('/packages', async (req, res) => {
    const rows = must(await req.db.from('packages').select(PACKAGE)
      .eq('contractor_id', await myContractorId(req))
      .order('updated_at', { ascending: false })
      .order('sort', { referencedTable: 'package_items' })) as unknown as { items: PriceItem[] }[];
    res.json(rows.map(withPrice));
  });

  router.post('/packages', async (req, res) => {
    const id = await rpc<string>(req, 'save_package', { p_id: null, ...readPackage(readJson(req), supabaseUrl) });
    res.status(201).json(await getPackage(req, id));
  });

  router.put('/packages/:id', async (req, res) => {
    const id = await rpc<string>(req, 'save_package', { p_id: req.params.id, ...readPackage(readJson(req), supabaseUrl) });
    res.json(await getPackage(req, id));
  });

  router.post('/packages/:id/submit', async (req, res) => {
    await rpc(req, 'submit_package', { p_id: req.params.id });
    res.json(await getPackage(req, req.params.id));
  });

  router.delete('/packages/:id', async (req, res) => {
    const rows = must(await req.db.from('packages').delete().eq('id', req.params.id).select('id'));
    if (rows.length === 0) throw new ApiError(404, 'package_not_found'); // không có, hoặc đã đăng (không xoá được)
    res.json({ ok: true });
  });

  // Khách hàng được ghép ----------------------------------------------------

  router.get('/leads', async (req, res) => {
    const rows = must(await req.db.from('quote_matches')
      .select('status,price,duration_days,message,quoted_at,created_at,' +
        'request:quote_requests(id,owner_id,address,budget,style,note,status,created_at,job:jobs(id,status),measurement:measurements(id,name),' +
        'unit_type:unit_types(name,area_m2,project:projects(name)),package:packages(id,name))')
      .eq('contractor_id', await myContractorId(req))
      .order('created_at', { ascending: false })) as unknown as Lead[];
    res.json(await attachOwners(supa, rows));
  });

  router.post('/leads/:requestId/quote', async (req, res) => {
    const body = readJson(req);
    await rpc(req, 'submit_quote', {
      p_request: req.params.requestId,
      p_price: int(body, 'price'),
      p_duration_days: int(body, 'duration_days'),
      p_message: optStr(body, 'message', 2000),
    });
    res.json({ ok: true });
  });

  return router;
}

interface Lead {
  status: string;
  request: { owner_id: string; [k: string]: unknown };
  [k: string]: unknown;
}

/**
 * Tên chủ nhà luôn hiện; số điện thoại chỉ hiện khi chủ nhà đã chọn nhà thầu này
 * (chống kéo khách ra ngoài trước khi chủ nhà quyết định). profiles chỉ chủ tài khoản
 * đọc được, nên đọc bằng quyền admin, và không trả owner_id ra ngoài.
 */
async function attachOwners(supa: Supabase, rows: Lead[]) {
  const ids = [...new Set(rows.map((r) => r.request.owner_id))];
  const profiles = ids.length === 0 ? [] : must(await supa.admin.from('profiles').select('id,full_name,phone').in('id', ids));
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return rows.map(({ request: { owner_id, ...request }, ...m }) => {
    const p = byId.get(owner_id);
    return { ...m, request, owner: { full_name: p?.full_name ?? '', phone: m.status === 'accepted' ? p?.phone ?? null : null } };
  });
}

async function myContractorId(req: Request): Promise<string> {
  const { data, error } = await req.db.rpc('my_contractor_id');
  if (error) throw dbError(error);
  if (!data) throw new ApiError(403, 'not_contractor');
  return data as string;
}

async function getPackage(req: Request, id: string) {
  return withPrice(must(await req.db.from('packages').select(PACKAGE).eq('id', id)
    .order('sort', { referencedTable: 'package_items' }).single(), 'package_not_found') as unknown as { items: PriceItem[] });
}
