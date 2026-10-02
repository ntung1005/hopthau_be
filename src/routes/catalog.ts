// Danh mục công khai: dự án, mẫu căn, gói nội thất. Đọc bằng quyền anon nên RLS
// chỉ trả gói đã đăng và nhà thầu đã xác minh.

import { Router } from 'express';
import { dbError, must } from '../http.ts';
import { PROVINCES, SERVICES } from '../options.ts';
import { packagePrice, type PriceItem } from '../pricing.ts';
import type { Supabase } from '../supabase.ts';

const CONTRACTOR = 'contractor:contractors(id,name,rating,logo_url,areas,styles,status)';

/**
 * Giá gói rẻ nhất theo mẫu căn và theo dự án ("từ 32 triệu"). RLS chỉ trả gói đã đăng của
 * nhà thầu đã xác minh. ponytail: cộng lại mỗi lần gọi, đủ nhanh vài nghìn gói; lưu sẵn
 * (materialized view) khi chậm.
 */
async function minPrices(db: Supabase['anon'], unitTypeIds?: string[]) {
  let q = db.from('packages').select('unit_type_id,unit_type:unit_types(project_id),package_items(qty,unit_price,is_optional)');
  if (unitTypeIds) q = q.in('unit_type_id', unitTypeIds);
  const { data, error } = await q;
  if (error) throw dbError(error);
  const byUnit = new Map<string, number>();
  const byProject = new Map<string, number>();
  const keepMin = (m: Map<string, number>, k: string, v: number) => m.set(k, Math.min(m.get(k) ?? Infinity, v));
  for (const p of data as unknown as { unit_type_id: string; unit_type: { project_id: string }; package_items: PriceItem[] }[]) {
    const price = packagePrice(p.package_items);
    keepMin(byUnit, p.unit_type_id, price);
    keepMin(byProject, p.unit_type.project_id, price);
  }
  return { byUnit, byProject };
}

export function catalogRoutes(supa: Supabase) {
  const db = supa.anon;
  const router = Router();

  router.get('/meta', (_req, res) => res.json({ provinces: PROVINCES, services: SERVICES }));

  router.get('/projects', async (req, res) => {
    let q = db.from('projects')
      .select('id,slug,name,developer,province,address,handover_date,cover_url,is_social_housing,unit_types(count)')
      .order('handover_date');
    if (typeof req.query.province === 'string') q = q.eq('province', req.query.province);
    const [rows, { byProject }] = await Promise.all([q.then(must), minPrices(db)]);
    res.json(rows.map(({ unit_types, ...p }) => ({
      ...p,
      unit_type_count: unit_types[0]?.count ?? 0,
      min_price: byProject.get(p.id) ?? null,
    })));
  });

  router.get('/projects/:slug', async (req, res) => {
    const project = must(await db.from('projects')
      .select('*,unit_types(id,name,area_m2,bedrooms,bathrooms,floorplan_url)')
      .eq('slug', req.params.slug)
      .order('name', { referencedTable: 'unit_types' })
      .maybeSingle(), 'project_not_found') as { unit_types: { id: string }[] };
    const { byUnit } = await minPrices(db, project.unit_types.map((u) => u.id));
    res.json({ ...project, unit_types: project.unit_types.map((u) => ({ ...u, min_price: byUnit.get(u.id) ?? null })) });
  });

  router.get('/unit-types/:id/packages', async (req, res) => {
    const { data, error } = await db.from('packages')
      .select(`id,name,style,duration_days,warranty_months,images,${CONTRACTOR},package_items(qty,unit_price,is_optional)`)
      .eq('unit_type_id', req.params.id);
    if (error) throw dbError(error);
    const list = data.map(({ package_items, ...p }) => ({ ...p, price: packagePrice(package_items as PriceItem[]) }));
    res.json(list.sort((a, b) => a.price - b.price));
  });

  // Trước /packages/:id để "featured" không bị hiểu là id. Gói mới cập nhật, ưu tiên gói có ảnh.
  router.get('/packages/featured', async (_req, res) => {
    const { data, error } = await db.from('packages')
      .select(`id,name,style,duration_days,warranty_months,images,updated_at,${CONTRACTOR},unit_type:unit_types(id,name,project:projects(slug,name)),package_items(qty,unit_price,is_optional)`)
      .order('updated_at', { ascending: false }).limit(12);
    if (error) throw dbError(error);
    const list = (data as unknown as { images: string[]; package_items: PriceItem[] }[])
      .map(({ package_items, ...p }) => ({ ...p, price: packagePrice(package_items) }))
      .sort((a, b) => Number(b.images.length > 0) - Number(a.images.length > 0));
    res.json(list.slice(0, 8));
  });

  router.get('/packages/:id', async (req, res) => {
    const pkg = must(await db.from('packages')
      .select(`id,name,style,duration_days,warranty_months,images,updated_at,${CONTRACTOR},\
unit_type:unit_types(id,name,area_m2,bedrooms,bathrooms,project:projects(id,slug,name)),\
items:package_items(id,room,name,material,size,qty,unit,unit_price,is_optional,sort)`)
      .eq('id', req.params.id)
      .order('sort', { referencedTable: 'package_items' })
      .maybeSingle(), 'package_not_found') as { items: PriceItem[] };
    res.json({ ...pkg, price: packagePrice(pkg.items) });
  });

  // Hồ sơ nhà thầu công khai: chỉ nhà thầu đã xác minh. Gói đang hiển thị, đánh giá, số công trình đã xong.
  router.get('/contractors/:id', async (req, res) => {
    const c = must(await db.from('contractors')
      .select('id,name,address,areas,styles,services,years_experience,website,bio,logo_url,status,rating,review_count,created_at')
      .eq('id', req.params.id).eq('status', 'verified').maybeSingle(), 'contractor_not_found') as { id: string; [k: string]: unknown };
    const [packages, reviews, completed] = await Promise.all([
      db.from('packages')
        .select('id,name,style,duration_days,warranty_months,images,unit_type:unit_types(id,name,project:projects(slug,name)),package_items(qty,unit_price,is_optional)')
        .eq('contractor_id', c.id).then(must),
      db.from('reviews').select('job_id,owner_name,quality,punctuality,price_honesty,attitude,content,photos,reply,replied_at,created_at')
        .eq('contractor_id', c.id).order('created_at', { ascending: false }).limit(50).then(must),
      // jobs chỉ hai bên đọc được; đếm bằng quyền admin, chỉ trả con số.
      supa.admin.from('jobs').select('id', { count: 'exact', head: true }).eq('contractor_id', c.id).eq('status', 'completed'),
    ]);
    res.json({
      ...c,
      completed_jobs: completed.count ?? 0,
      packages: (packages as unknown as { package_items: PriceItem[] }[])
        .map(({ package_items, ...p }) => ({ ...p, price: packagePrice(package_items) })),
      reviews,
    });
  });

  /**
   * "Căn đã làm thực tế": công trình đã hoàn thành, ảnh lắp đặt / bàn giao và ảnh trong đánh giá.
   * Đọc bằng quyền admin, chỉ trả thông tin công khai (không giá, không chủ nhà).
   */
  async function showcase(unitTypeId: string | null, limit: number) {
    let q = supa.admin.from('jobs')
      .select('id,completed_at,contractor:contractors!inner(id,name,rating,status),' +
        'request:quote_requests!inner(unit_type_id,unit_type:unit_types(name,project:projects(slug,name)),package:packages(id,name)),' +
        'milestones:job_milestones(seq,photos),review:reviews(quality,punctuality,price_honesty,attitude,content,photos)')
      .eq('status', 'completed').eq('contractor.status', 'verified')
      .order('completed_at', { ascending: false }).limit(limit);
    if (unitTypeId) q = q.eq('request.unit_type_id', unitTypeId);
    const { data, error } = await q;
    if (error) throw dbError(error);
    type Row = { id: string; completed_at: string; contractor: unknown; request: { package: unknown; unit_type: unknown };
      milestones: { seq: number; photos: string[] }[]; review: { photos: string[]; [k: string]: unknown } | null };
    return (data as unknown as Row[]).map((j) => ({
      job_id: j.id,
      completed_at: j.completed_at,
      contractor: j.contractor,
      unit_type: j.request.unit_type,
      package: j.request.package,
      photos: [...(j.review?.photos ?? []), ...j.milestones.filter((m) => m.seq >= 3).flatMap((m) => m.photos)].slice(0, 12),
      review: j.review,
    })).filter((j) => j.photos.length > 0 || j.review);
  }

  router.get('/unit-types/:id/showcase', async (req, res) => res.json(await showcase(req.params.id, 20)));
  router.get('/showcase', async (_req, res) => res.json(await showcase(null, 8)));

  /** Đánh giá mới nhất của nhà thầu đã xác minh, cho landing page. */
  router.get('/reviews/latest', async (_req, res) => {
    res.json(must(await db.from('reviews')
      .select('job_id,owner_name,quality,punctuality,price_honesty,attitude,content,created_at,contractor:contractors!inner(id,name,status)')
      .eq('contractor.status', 'verified').not('content', 'is', null)
      .order('created_at', { ascending: false }).limit(6)));
  });

  return router;
}
