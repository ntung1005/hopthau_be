// Upload ảnh: BE cấp URL ký sẵn, app PUT ảnh thẳng lên Supabase Storage (không đi qua BE).
// Chỉ nhận lại URL ảnh nằm trong bucket của mình (photoList), để không nhúng ảnh ngoài.

import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { ApiError, dbError, readJson } from '../http.ts';
import type { Supabase } from '../supabase.ts';

const BUCKET = 'photos';
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_PHOTOS = 10;

export const publicPhotoPrefix = (supabaseUrl: string) => `${supabaseUrl}/storage/v1/object/public/${BUCKET}/`;

/** Danh sách URL ảnh trong body; mỗi URL phải là ảnh trong bucket photos. */
export function photoList(body: Record<string, unknown>, key: string, supabaseUrl: string): string[] {
  const v = body[key];
  if (v === undefined || v === null) return [];
  const prefix = publicPhotoPrefix(supabaseUrl);
  if (!Array.isArray(v) || v.length > MAX_PHOTOS ||
      v.some((u) => typeof u !== 'string' || !u.startsWith(prefix) || u.length > 500 || u.includes('..'))) {
    throw new ApiError(400, `invalid_${key}`);
  }
  return v as string[];
}

export function uploadRoutes(supa: Supabase, supabaseUrl: string) {
  const router = Router();

  router.post('/', async (req, res) => {
    const contentType = readJson(req).content_type;
    const ext = typeof contentType === 'string' ? EXT[contentType] : undefined;
    if (!ext) throw new ApiError(400, 'invalid_content_type');
    const path = `${req.userId}/${randomUUID()}.${ext}`;
    const { data, error } = await supa.admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) throw dbError({ message: error?.message ?? 'upload_failed' });
    res.status(201).json({
      upload_url: data.signedUrl,
      content_type: contentType,
      public_url: publicPhotoPrefix(supabaseUrl) + path,
    });
  });

  return router;
}
