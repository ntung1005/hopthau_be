// Toàn bộ API. App Flutter và landing page chỉ nói chuyện với server này; server giữ
// secret key và gọi Supabase.

import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import { authRoutes, requireUser } from './auth.ts';
import { adminRoutes, requireAdmin } from './routes/admin.ts';
import { loadEnv, type Env } from './env.ts';
import { ApiError } from './http.ts';
import { catalogRoutes } from './routes/catalog.ts';
import { contractorRoutes } from './routes/contractor.ts';
import { jobRoutes } from './routes/jobs.ts';
import { measurementRoutes } from './routes/measurements.ts';
import { leadRoutes } from './routes/leads.ts';
import { meRoutes } from './routes/me.ts';
import { quoteRoutes } from './routes/quotes.ts';
import { uploadRoutes } from './routes/uploads.ts';
import { createSupabase, type Supabase } from './supabase.ts';

function createApp(env: Env, supa: Supabase) {
  const app = express();
  app.disable('x-powered-by');

  app.use(cors({
    origin: env.corsOrigin,
    allowedHeaders: ['Authorization', 'Content-Type'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }));
  app.use(express.json({ type: () => true, limit: '1mb' }));

  // Công khai
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/auth', authRoutes(supa, env.authMaxAttempts));
  app.use('/leads', leadRoutes(supa, env.authMaxAttempts));
  app.use('/', catalogRoutes(supa));

  // Cần đăng nhập
  app.use(['/me', '/quote-requests', '/contractor', '/jobs', '/uploads', '/admin', '/measurements'], requireUser(supa));
  app.use('/admin', requireAdmin(), adminRoutes(supa));
  app.use('/me', meRoutes(supa));
  app.use('/quote-requests', quoteRoutes(supa));
  app.use('/contractor', contractorRoutes(supa, env.supabaseUrl));
  app.use('/jobs', jobRoutes(supa, env.supabaseUrl));
  app.use('/measurements', measurementRoutes(supa));
  app.use('/uploads', uploadRoutes(supa, env.supabaseUrl));

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use(errorHandler);

  return app;
}

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: err.code });
  // Lỗi của express.json(): body không phải JSON hoặc quá lớn.
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  console.error(err);
  res.status(500).json({ error: 'internal' });
};

export const env = loadEnv();

export default createApp(env, createSupabase(env));
