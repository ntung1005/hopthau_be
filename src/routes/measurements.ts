// Bản đo nhà của chủ nhà. Đọc bằng token người dùng (RLS: chủ nhà, hoặc nhà thầu được ghép với
// yêu cầu đính kèm bản đo). Ghi bằng service_role sau khi parseMeasurement kiểm tra dữ liệu.

import { Router } from 'express';
import { ApiError, dbError, must, optStr, optUuid, readJson, str } from '../http.ts';
import { measurementSummary, parseMeasurement, type MeasurementData } from '../measurement.ts';
import type { Supabase } from '../supabase.ts';

const FIELDS = 'id,owner_id,name,unit_type_id,data,note,created_at,updated_at,unit_type:unit_types(name,project:projects(name))';

type Row = { owner_id: string; data: MeasurementData; [k: string]: unknown };

const withSummary = ({ owner_id: _, ...m }: Row, userId: string) =>
  ({ ...m, mine: _ === userId, summary: measurementSummary(m.data as MeasurementData) });

export function measurementRoutes(supa: Supabase) {
  const router = Router();

  const read = (body: Record<string, unknown>) => ({
    name: str(body, 'name', 100),
    unit_type_id: optUuid(body, 'unit_type_id'),
    note: optStr(body, 'note', 2000),
    data: parseMeasurement(body.data),
  });

  router.get('/', async (req, res) => {
    const rows = must(await req.db.from('measurements').select(FIELDS).eq('owner_id', req.userId)
      .order('updated_at', { ascending: false })) as unknown as Row[];
    res.json(rows.map((r) => withSummary(r, req.userId)));
  });

  router.get('/:id', async (req, res) => {
    const row = must(await req.db.from('measurements').select(FIELDS).eq('id', req.params.id).maybeSingle(),
      'measurement_not_found') as unknown as Row;
    res.json(withSummary(row, req.userId));
  });

  router.post('/', async (req, res) => {
    const { data, error } = await supa.admin.from('measurements')
      .insert({ ...read(readJson(req)), owner_id: req.userId }).select(FIELDS).single();
    if (error) throw dbError(error);
    res.status(201).json(withSummary(data as unknown as Row, req.userId));
  });

  router.put('/:id', async (req, res) => {
    const { data, error } = await supa.admin.from('measurements')
      .update({ ...read(readJson(req)), updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('owner_id', req.userId).select(FIELDS).maybeSingle();
    if (error) throw dbError(error);
    if (!data) throw new ApiError(404, 'measurement_not_found');
    res.json(withSummary(data as unknown as Row, req.userId));
  });

  router.delete('/:id', async (req, res) => {
    const { data, error } = await supa.admin.from('measurements').delete()
      .eq('id', req.params.id).eq('owner_id', req.userId).select('id');
    if (error) throw dbError(error);
    if (!data?.length) throw new ApiError(404, 'measurement_not_found');
    res.json({ ok: true });
  });

  return router;
}
