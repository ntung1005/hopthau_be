// Yêu cầu báo giá của chủ nhà. Ghi bằng token người dùng: RLS đặt owner_id = auth.uid().
// Yêu cầu đi từ một gói tự ghép với nhà thầu của gói; yêu cầu còn lại tự ghép tối đa 5 nhà thầu
// theo tỉnh / thành + hạng mục (trigger auto_match_request). Không ai khớp thì admin ghép tay.

import { Router } from 'express';
import { ApiError, must, optInt, optStr, optUuid, readJson, rpc } from '../http.ts';
import { optProvince, pickList, SERVICES } from '../options.ts';
import type { Supabase } from '../supabase.ts';

const FIELDS = 'id,unit_type_id,package_id,measurement_id,province,services,address,budget,style,note,status,created_at,' +
  'measurement:measurements(id,name),' +
  'unit_type:unit_types(name,project:projects(name)),package:packages(name),' +
  'job:jobs(id,status),' +
  'quotes:quote_matches(status,mode,price,items,duration_days,message,quoted_at,contractor:contractors(id,name,rating,status,owner_id))';

interface Quote {
  status: string;
  contractor: { id: string; owner_id: string | null; [k: string]: unknown } | null;
  [k: string]: unknown;
}

/**
 * Số điện thoại nhà thầu chỉ hiện với báo giá chủ nhà đã chọn. owner_id của nhà thầu
 * không trả ra ngoài.
 */
async function withContractorPhones(supa: Supabase, row: { quotes: Quote[] }) {
  const accepted = row.quotes.find((q) => q.status === 'accepted')?.contractor?.owner_id;
  const phone = accepted
    ? (await supa.admin.from('profiles').select('phone').eq('id', accepted).maybeSingle()).data?.phone ?? null
    : null;
  return {
    ...row,
    quotes: row.quotes.map(({ contractor, ...q }) => {
      const { owner_id: _, ...c } = contractor ?? { owner_id: null };
      return { ...q, contractor: { ...c, phone: q.status === 'accepted' ? phone : null } };
    }),
  };
}

export function quoteRoutes(supa: Supabase) {
  const router = Router();

  router.get('/', async (req, res) => {
    const rows = must(await req.db.from('quote_requests').select(FIELDS)
      .eq('owner_id', req.userId)
      .order('created_at', { ascending: false })) as unknown as { quotes: Quote[] }[];
    res.json(await Promise.all(rows.map((r) => withContractorPhones(supa, r))));
  });

  router.get('/:id', async (req, res) => {
    const row = must(await req.db.from('quote_requests').select(FIELDS)
      .eq('id', req.params.id).eq('owner_id', req.userId)
      .maybeSingle(), 'request_not_found') as unknown as { quotes: Quote[] };
    res.json(await withContractorPhones(supa, row));
  });

  router.post('/', async (req, res) => {
    const body = readJson(req);
    const request = {
      unit_type_id: optUuid(body, 'unit_type_id'),
      package_id: optUuid(body, 'package_id'),
      province: optProvince(body),
      services: pickList(body, 'services', SERVICES),
      address: optStr(body, 'address', 300),
      budget: optInt(body, 'budget'),
      style: optStr(body, 'style', 50),
      note: optStr(body, 'note', 2000),
      measurement_id: optUuid(body, 'measurement_id'),
    };
    if (!request.unit_type_id && !request.address && !request.province) throw new ApiError(400, 'missing_province');
    // Khoá ngoại không kiểm tra chủ sở hữu: chỉ đính kèm được bản đo của chính mình.
    if (request.measurement_id) {
      const { data } = await req.db.from('measurements').select('id').eq('id', request.measurement_id).eq('owner_id', req.userId).maybeSingle();
      if (!data) throw new ApiError(404, 'measurement_not_found');
    }
    // Không đọc lại trong cùng câu lệnh insert: dòng quote_matches do trigger tạo chưa thấy được ở đó.
    const { id } = must(await req.db.from('quote_requests').insert(request).select('id').single()) as { id: string };
    const row = must(await req.db.from('quote_requests').select(FIELDS).eq('id', id).single()) as unknown as { quotes: Quote[] };
    res.status(201).json(await withContractorPhones(supa, row));
  });

  router.post('/:id/accept', async (req, res) => {
    const contractorId = optUuid(readJson(req), 'contractor_id');
    if (!contractorId) throw new ApiError(400, 'missing_contractor_id');
    await rpc(req, 'accept_quote', { p_request: req.params.id, p_contractor: contractorId });
    const row = must(await req.db.from('quote_requests').select(FIELDS).eq('id', req.params.id).single()) as unknown as { quotes: Quote[] };
    res.json(await withContractorPhones(supa, row));
  });

  return router;
}
