import app, { env } from './app.ts';

app.listen(env.port, '0.0.0.0', () => {
  console.log(`Hợp Thầu BE chạy tại http://localhost:${env.port} (Supabase: ${env.supabaseUrl})`);
});
