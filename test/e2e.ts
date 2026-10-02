// Chạy cả vòng lead trên BE thật: npm run dev (terminal khác) rồi npm run e2e.
// Bước admin (duyệt nhà thầu, đăng gói) làm bằng secret key như vận hành làm trong Studio.

import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/env.ts';

const env = loadEnv();
const BASE = `http://localhost:${env.port}`;
const admin = createClient(env.supabaseUrl, env.secretKey, { auth: { persistSession: false } });
const UNIT_A = '20000000-0000-0000-0000-000000000001';

type Json = any;

async function call(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; data: Json }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function ok(method: string, path: string, token?: string, body?: unknown) {
  const r = await call(method, path, token, body);
  assert.ok(r.status < 300, `${method} ${path} -> ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function fails(expected: [number, string], method: string, path: string, token?: string, body?: unknown) {
  const r = await call(method, path, token, body);
  assert.deepEqual([r.status, r.data.error], expected, `${method} ${path}`);
}

let n = 0;
async function newUser(name: string) {
  const phone = `09${String(Date.now() + n++).slice(-8)}`;
  const s = await ok('POST', '/auth/register', undefined, { phone, password: 'secret1', full_name: name });
  return { token: s.access_token as string, phone: `84${phone.slice(1)}` };
}

const step = (s: string) => console.log(`✓ ${s}`);

const owner = await newUser('Chủ nhà E2E');
const builder = await newUser('Nhà thầu E2E');
const outsider = await newUser('Nhà thầu khác');
const ops = await newUser('Vận hành E2E');
{
  const { data } = await admin.from('profiles').select('id,roles').eq('phone', ops.phone).single();
  await admin.from('profiles').update({ roles: [...data!.roles, 'admin'] }).eq('id', data!.id);
}

// Đăng ký nhà thầu
assert.equal(await ok('GET', '/contractor', builder.token), null);
const profile = await ok('POST', '/contractor', builder.token, { name: 'Xưởng E2E', areas: ['Hà Nội'], styles: ['Hiện đại'] });
assert.equal(profile.status, 'pending');
assert.ok((await ok('GET', '/me', builder.token)).roles.includes('contractor'));
await fails([409, 'contractor_exists'], 'POST', '/contractor', builder.token, { name: 'Lần hai' });
await ok('POST', '/contractor', outsider.token, { name: 'Xưởng khác' });
await fails([403, 'not_contractor'], 'GET', '/contractor/packages', owner.token);
step('đăng ký nhà thầu, có vai trò contractor, không đăng ký hai lần');

// Tạo gói
const pkgBody = {
  unit_type_id: UNIT_A, name: 'Gói E2E', style: 'Hiện đại', duration_days: 20, warranty_months: 12,
  items: [
    { room: 'Bếp', name: 'Tủ bếp', qty: 2.5, unit: 'md', unit_price: 3_000_000 },
    { room: 'Phòng ngủ', name: 'Giường', qty: 1, unit_price: 5_000_000 },
    { room: 'Phòng ngủ', name: 'Bàn trang điểm', qty: 1, unit_price: 2_000_000, is_optional: true },
  ],
};
await fails([400, 'missing_items'], 'POST', '/contractor/packages', builder.token, { ...pkgBody, items: [] });
await fails([400, 'missing_name'], 'POST', '/contractor/packages', builder.token, { ...pkgBody, name: ' ' });
const pkg = await ok('POST', '/contractor/packages', builder.token, pkgBody);
assert.equal(pkg.status, 'draft');
assert.equal(pkg.price, 12_500_000);
assert.equal(pkg.items.length, 3);
const listed = () => ok('GET', `/unit-types/${UNIT_A}/packages`).then((l: Json[]) => l.some((p) => p.id === pkg.id));
assert.equal(await listed(), false);
step('tạo gói nháp, giá cộng từ hạng mục, chưa hiện với chủ nhà');

// Người khác không sửa, không xoá được
await fails([404, 'package_not_found'], 'PUT', `/contractor/packages/${pkg.id}`, outsider.token, pkgBody);
await fails([404, 'package_not_found'], 'DELETE', `/contractor/packages/${pkg.id}`, outsider.token);
await fails([404, 'package_not_found'], 'POST', `/contractor/packages/${pkg.id}/submit`, outsider.token);
step('nhà thầu khác không sửa, xoá, gửi duyệt được gói');

// Gửi duyệt, admin duyệt
assert.equal((await ok('POST', `/contractor/packages/${pkg.id}/submit`, builder.token)).status, 'pending');
assert.equal(await listed(), false);
await fails([403, 'not_admin'], 'PATCH', `/admin/packages/${pkg.id}`, builder.token, { status: 'published' });
await fails([400, 'invalid_status'], 'PATCH', `/admin/packages/${pkg.id}`, ops.token, { status: 'lol' });
assert.ok((await ok('GET', '/admin/packages?status=pending', ops.token)).some((p: Json) => p.id === pkg.id && p.price === 12_500_000));
await ok('PATCH', `/admin/packages/${pkg.id}`, ops.token, { status: 'published' });
assert.equal(await listed(), false, 'nhà thầu chưa xác minh thì gói chưa hiện');
const pendingList = await ok('GET', '/admin/contractors?status=pending', ops.token);
assert.equal(pendingList.find((c: Json) => c.id === profile.id).owner.phone, builder.phone);
await ok('PATCH', `/admin/contractors/${profile.id}`, ops.token, { status: 'verified' });
assert.equal(await listed(), true);
step('admin duyệt qua API (người thường bị chặn); chỉ hiện khi gói đã đăng và nhà thầu đã xác minh');

// Bản đo nhà: chủ nhà tự đo, đính kèm yêu cầu; nhà thầu được ghép mới xem được
const plan = { rooms: [
  { id: 'lr', name: 'Phòng khách', type: 'living', x: 0, y: 0, w: 4, l: 5, h: 2.8,
    openings: [{ wall: 's', kind: 'door', offset: 0.5, width: 0.9, height: 2.1 }] },
  { id: 'br', name: 'Phòng ngủ', type: 'bedroom', x: 4, y: 0, w: 3, l: 3.5, h: 2.8, openings: [] },
] };
await fails([400, 'invalid_room_width'], 'POST', '/measurements', owner.token, { name: 'Sai', data: { rooms: [{ ...plan.rooms[0], w: -1 }] } });
const meas = await ok('POST', '/measurements', owner.token, { name: 'Căn của tôi', unit_type_id: UNIT_A, data: plan });
assert.deepEqual([meas.summary.floor_m2, meas.mine], [30.5, true]);
await fails([404, 'measurement_not_found'], 'GET', `/measurements/${meas.id}`, builder.token);
await fails([404, 'measurement_not_found'], 'PUT', `/measurements/${meas.id}`, builder.token, { name: 'x', data: plan });
await fails([404, 'measurement_not_found'], 'POST', '/quote-requests', builder.token, { address: 'x', measurement_id: meas.id });
const upd = await ok('PUT', `/measurements/${meas.id}`, owner.token, { name: 'Căn của tôi', data: { rooms: [plan.rooms[0]] } });
assert.equal(upd.summary.floor_m2, 20);
step('bản đo nhà: kiểm tra số đo, tính diện tích, chỉ chủ nhà sửa được');

// Yêu cầu theo tỉnh + hạng mục: tự ghép nhà thầu đã xác minh cùng tỉnh; admin ghép thêm, tối đa 5.
// Cà Mau / Lai Châu: tỉnh dữ liệu demo không có nhà thầu, để kết quả ghép chỉ có nhà thầu của e2e.
await fails([400, 'invalid_areas'], 'PATCH', `/contractor`, builder.token, { name: 'Xưởng E2E', areas: ['Bắc Ninh E2E'] });
await ok('PATCH', `/contractor`, builder.token, { name: 'Xưởng E2E', areas: ['Cà Mau'], styles: ['Hiện đại'], services: ['Tủ bếp'] });
await fails([400, 'missing_province'], 'POST', '/quote-requests', owner.token, { note: 'Thiếu nơi' });
await fails([400, 'invalid_services'], 'POST', '/quote-requests', owner.token, { province: 'Cà Mau', services: ['Xây nhà'] });
const free = await ok('POST', '/quote-requests', owner.token,
  { province: 'Cà Mau', address: 'Nhà phố E2E', services: ['Tủ bếp', 'Sơn bả'], note: 'Nhà phố', measurement_id: meas.id });
assert.deepEqual(free.services, ['Tủ bếp', 'Sơn bả']);
assert.equal(free.measurement.id, meas.id);
const seen = await ok('GET', `/measurements/${meas.id}`, builder.token);
assert.deepEqual([seen.mine, seen.summary.floor_m2, seen.data.rooms.length], [false, 20, 1]);
assert.equal((await ok('GET', '/contractor/leads', builder.token)).find((l: Json) => l.request.id === free.id).request.measurement.id, meas.id);
await fails([404, 'measurement_not_found'], 'GET', `/measurements/${meas.id}`, outsider.token);
assert.deepEqual(free.quotes.map((q: Json) => q.contractor.id), [profile.id], 'tự ghép theo khu vực');
const noArea = await ok('POST', '/quote-requests', owner.token, { province: 'Lai Châu' });
assert.equal(noArea.quotes.length, 0);
assert.ok((await ok('GET', '/admin/stats', ops.token)).requests_unmatched >= 1);
const sugg = await ok('GET', `/admin/requests/${noArea.id}/suggestions`, ops.token);
assert.equal(sugg.remaining, 5);
assert.ok(sugg.contractors.some((c: Json) => c.id === profile.id));
await ok('POST', `/admin/requests/${noArea.id}/matches`, ops.token, { contractor_id: profile.id });
await fails([409, 'already_matched'], 'POST', `/admin/requests/${noArea.id}/matches`, ops.token, { contractor_id: profile.id });
const outsiderId = (await ok('GET', '/contractor', outsider.token)).id;
await fails([400, 'contractor_not_verified'], 'POST', `/admin/requests/${noArea.id}/matches`, ops.token, { contractor_id: outsiderId });
// Hồ sơ từ form web: chưa có tài khoản thì không ghép được; đăng ký app bằng cùng số thì nhận hồ sơ
const walkIn = await newUser('Thợ từ web E2E');
await fails([400, 'invalid_areas'], 'POST', '/leads/contractors', undefined, { name: 'x', contact_name: 'y', phone: `0${walkIn.phone.slice(2)}`, areas: ['Sao Hỏa'] });
await ok('POST', '/leads/contractors', undefined,
  { name: 'Xưởng web E2E', contact_name: 'Anh Web', phone: `0${walkIn.phone.slice(2)}`, areas: ['Lai Châu'], services: ['Sơn bả'], tax_code: '0100000001' });
const app = (await ok('GET', '/admin/contractors?status=pending', ops.token)).find((c: Json) => c.contact_phone === walkIn.phone);
assert.deepEqual([app.owner, app.years_experience, app.services], [null, null, ['Sơn bả']]);
await ok('PATCH', `/admin/contractors/${app.id}`, ops.token, { status: 'verified' });
await fails([400, 'contractor_no_account'], 'POST', `/admin/requests/${noArea.id}/matches`, ops.token, { contractor_id: app.id });
const claimed = await ok('POST', '/contractor', walkIn.token, { name: 'Xưởng web E2E', areas: ['Lai Châu'], years_experience: 3 });
assert.deepEqual([claimed.id, claimed.status, claimed.years_experience, claimed.services], [app.id, 'verified', 3, ['Sơn bả']]);
assert.equal((await admin.from('contractors').select('tax_code').eq('id', app.id).single()).data!.tax_code, '0100000001');
await ok('POST', `/admin/requests/${noArea.id}/matches`, ops.token, { contractor_id: app.id });

// Báo giá theo món: giá = tổng món. Làm việc trực tiếp: không giá; chọn thì công trình chỉ theo dõi mốc, không tiền
await fails([400, 'invalid_items_0_qty'], 'POST', `/contractor/leads/${noArea.id}/quote`, builder.token,
  { duration_days: 20, items: [{ name: 'Giường', qty: 0, unit_price: 1 }] });
await ok('POST', `/contractor/leads/${noArea.id}/quote`, builder.token, { duration_days: 20, price: 1, items: [
  { room: 'Phòng ngủ', name: 'Giường', qty: 1, unit_price: 6_000_000 }, { name: 'Nhân công', qty: 2, unit_price: 500_000 },
] });
await fails([400, 'missing_message'], 'POST', `/contractor/leads/${noArea.id}/quote`, walkIn.token, { mode: 'offline' });
await ok('POST', `/contractor/leads/${noArea.id}/quote`, walkIn.token, { mode: 'offline', message: 'Qua khảo sát thứ 7' });
const quotes = (await ok('GET', `/quote-requests/${noArea.id}`, owner.token)).quotes;
const byC = (id: string) => quotes.find((q: Json) => q.contractor.id === id);
assert.deepEqual([byC(profile.id).mode, byC(profile.id).price, byC(profile.id).items[1].room], ['in_app', 7_000_000, 'Chung']);
assert.deepEqual([byC(app.id).mode, byC(app.id).price, byC(app.id).status], ['offline', null, 'quoted']);
await ok('POST', `/quote-requests/${noArea.id}/accept`, owner.token, { contractor_id: app.id });
const offJob = await ok('GET', `/jobs/${(await ok('GET', `/quote-requests/${noArea.id}`, owner.token)).job.id}`, walkIn.token);
assert.deepEqual([offJob.offline, offJob.total, offJob.milestones[0].amount], [true, null, null]);
await fails([400, 'offline_job'], 'POST', `/jobs/${offJob.id}/changes`, walkIn.token, { title: 'Thêm kệ', amount: 1000 });
await ok('POST', `/jobs/milestones/${offJob.milestones[0].id}/submit`, walkIn.token, { note: 'Đã chốt thiết kế' });
await ok('POST', `/jobs/milestones/${offJob.milestones[0].id}/review`, owner.token, { approve: true });
await fails([404, 'milestone_not_found'], 'POST', `/jobs/milestones/${offJob.milestones[0].id}/paid`, walkIn.token);
assert.ok((await ok('GET', '/contractor/leads', builder.token)).some((l: Json) => l.request.id === noArea.id));
const log = await ok('GET', '/admin/audit', ops.token);
assert.deepEqual(log.slice(0, 3).map((a: Json) => a.action), ['request.match', 'contractor.verified', 'request.match']);
await fails([403, 'not_admin'], 'GET', '/admin/audit', owner.token);
step('yêu cầu theo tỉnh + hạng mục tự ghép, hồ sơ nhà thầu từ web được nhận khi đăng ký app, báo giá theo món, làm việc trực tiếp chỉ theo dõi mốc, admin ghép thêm, có audit log');

// Chủ nhà gửi yêu cầu từ gói: tự ghép với nhà thầu
const request = await ok('POST', '/quote-requests', owner.token, { unit_type_id: UNIT_A, package_id: pkg.id, note: 'E2E' });
assert.equal(request.quotes.length, 1);
assert.equal(request.quotes[0].status, 'sent');
assert.equal(request.quotes[0].contractor.phone, null);
assert.equal(request.quotes[0].contractor.owner_id, undefined);
let leads = await ok('GET', '/contractor/leads', builder.token);
let lead = leads.find((l: Json) => l.request.id === request.id);
assert.equal(lead.owner.full_name, 'Chủ nhà E2E');
assert.equal(lead.owner.phone, null, 'chưa chọn thì nhà thầu chưa thấy số');
assert.equal(lead.request.owner_id, undefined);
assert.equal((await ok('GET', '/contractor/leads', outsider.token)).length, 0);
step('yêu cầu từ gói tự ghép nhà thầu, chưa lộ số điện thoại hai bên');

// Báo giá, chọn nhà thầu
await fails([404, 'quote_not_found'], 'POST', `/quote-requests/${request.id}/accept`, owner.token, { contractor_id: profile.id });
await fails([404, 'request_not_found'], 'POST', `/contractor/leads/${request.id}/quote`, outsider.token, { price: 1, duration_days: 1 });
await fails([400, 'invalid_duration_days'], 'POST', `/contractor/leads/${request.id}/quote`, builder.token, { price: 13_000_000, duration_days: 0 });
await ok('POST', `/contractor/leads/${request.id}/quote`, builder.token, { price: 13_000_000, duration_days: 18, message: 'Khảo sát thứ 7' });
let detail = await ok('GET', `/quote-requests/${request.id}`, owner.token);
assert.deepEqual([detail.quotes[0].status, detail.quotes[0].price], ['quoted', 13_000_000]);
await fails([404, 'request_not_found'], 'POST', `/quote-requests/${request.id}/accept`, outsider.token, { contractor_id: profile.id });
detail = await ok('POST', `/quote-requests/${request.id}/accept`, owner.token, { contractor_id: profile.id });
assert.equal(detail.status, 'matched');
assert.equal(detail.quotes[0].status, 'accepted');
assert.equal(detail.quotes[0].contractor.phone, builder.phone);
leads = await ok('GET', '/contractor/leads', builder.token);
lead = leads.find((l: Json) => l.request.id === request.id);
assert.equal(lead.owner.phone, owner.phone, 'đã chọn thì nhà thầu thấy số chủ nhà');
await fails([409, 'request_closed'], 'POST', `/contractor/leads/${request.id}/quote`, builder.token, { price: 1, duration_days: 1 });
await fails([409, 'request_closed'], 'POST', `/quote-requests/${request.id}/accept`, owner.token, { contractor_id: profile.id });
step('báo giá, chủ nhà chọn, hai bên thấy số điện thoại, yêu cầu đóng');

// Công trình: tạo khi chọn báo giá, 4 mốc cộng đúng bằng giá
const jobs = await ok('GET', '/jobs', owner.token);
const jobRow = jobs.find((j: Json) => j.request_id === request.id);
assert.deepEqual([jobRow.role, jobRow.total, jobRow.progress.total, jobRow.status], ['owner', 13_000_000, 4, 'active']);
assert.equal((await ok('GET', '/jobs', builder.token)).find((j: Json) => j.id === jobRow.id).role, 'contractor');
assert.equal((await ok('GET', '/jobs', outsider.token)).length, 0);
await fails([404, 'job_not_found'], 'GET', `/jobs/${jobRow.id}`, outsider.token);
let job = await ok('GET', `/jobs/${jobRow.id}`, owner.token);
assert.equal(job.milestones.reduce((s: number, m: Json) => s + Number(m.amount), 0), 13_000_000);
assert.equal(job.contractor.phone, builder.phone);
assert.equal(job.owner.phone, owner.phone);
assert.equal(job.owner_id, undefined);
const [m1, m2, m3, m4] = job.milestones;
step('chọn báo giá tạo công trình với 4 mốc, chỉ hai bên xem được');

// Upload ảnh: URL ký sẵn, PUT thẳng lên Storage; chỉ nhận URL trong bucket của mình
const up = await ok('POST', '/uploads', builder.token, { content_type: 'image/png' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const put = await fetch(up.upload_url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
assert.ok(put.ok, `upload ${put.status} ${await put.text()}`);
assert.equal((await fetch(up.public_url)).status, 200);
await fails([400, 'invalid_content_type'], 'POST', '/uploads', builder.token, { content_type: 'text/html' });
await fails([400, 'invalid_photos'], 'POST', `/jobs/milestones/${m1.id}/submit`, builder.token, { photos: ['https://evil.example/x.png'] });
step('upload ảnh lên Storage, từ chối URL ảnh ngoài');

// Mốc: làm lần lượt, chủ nhà duyệt / trả lại
await fails([400, 'previous_milestone_open'], 'POST', `/jobs/milestones/${m2.id}/submit`, builder.token, {});
await fails([404, 'milestone_not_found'], 'POST', `/jobs/milestones/${m1.id}/submit`, owner.token, {});
await fails([400, 'milestone_not_submitted'], 'POST', `/jobs/milestones/${m1.id}/review`, owner.token, { approve: true });
await ok('POST', `/jobs/milestones/${m1.id}/submit`, builder.token, { note: 'Đã nhận cọc, chốt bản vẽ', photos: [up.public_url] });
await fails([404, 'milestone_not_found'], 'POST', `/jobs/milestones/${m1.id}/review`, builder.token, { approve: true });
await fails([400, 'missing_feedback'], 'POST', `/jobs/milestones/${m1.id}/review`, owner.token, { approve: false });
await ok('POST', `/jobs/milestones/${m1.id}/review`, owner.token, { approve: false, feedback: 'Thiếu bản vẽ bếp' });
await ok('POST', `/jobs/milestones/${m1.id}/submit`, builder.token, { note: 'Bổ sung bản vẽ bếp', photos: [up.public_url] });
await ok('POST', `/jobs/milestones/${m1.id}/review`, owner.token, { approve: true });
await fails([404, 'milestone_not_found'], 'POST', `/jobs/milestones/${m2.id}/paid`, builder.token);
await ok('POST', `/jobs/milestones/${m1.id}/paid`, builder.token);
job = await ok('GET', `/jobs/${jobRow.id}`, builder.token);
assert.deepEqual([job.milestones[0].status, job.paid_amount, job.approved_amount], ['approved', m1.amount, m1.amount]);
step('mốc làm lần lượt, chủ nhà trả lại cần góp ý, nhà thầu xác nhận nhận tiền');

// Phát sinh: chỉ có hiệu lực khi chủ nhà đồng ý
const c1 = await ok('POST', `/jobs/${jobRow.id}/changes`, builder.token, { title: 'Thêm kệ ban công', amount: 2_000_000, days_delta: 2 });
const c2 = await ok('POST', `/jobs/${jobRow.id}/changes`, builder.token, { title: 'Nâng cấp bản lề', amount: 500_000 });
await fails([404, 'job_not_found'], 'POST', `/jobs/${jobRow.id}/changes`, owner.token, { title: 'x', amount: 1 });
await fails([404, 'change_not_found'], 'POST', `/jobs/changes/${c1.id}/decide`, builder.token, { approve: true });
assert.equal((await ok('GET', `/jobs/${jobRow.id}`, owner.token)).total, 13_000_000, 'chưa duyệt thì chưa cộng');
await ok('POST', `/jobs/changes/${c1.id}/decide`, owner.token, { approve: true });
await ok('POST', `/jobs/changes/${c2.id}/decide`, owner.token, { approve: false });
await fails([404, 'change_not_found'], 'POST', `/jobs/changes/${c1.id}/decide`, owner.token, { approve: false });
job = await ok('GET', `/jobs/${jobRow.id}`, owner.token);
assert.deepEqual([job.total, job.total_days], [15_000_000, 20]);
step('phát sinh chỉ cộng khi chủ nhà đồng ý');

// Hoàn thành, đánh giá, điểm nhà thầu
await fails([400, 'job_not_completed'], 'POST', `/jobs/${jobRow.id}/review`, owner.token,
  { quality: 5, punctuality: 5, price_honesty: 5, attitude: 5 });
for (const m of [m2, m3, m4]) {
  await ok('POST', `/jobs/milestones/${m.id}/submit`, builder.token, { note: m.title, photos: [up.public_url] });
  await ok('POST', `/jobs/milestones/${m.id}/review`, owner.token, { approve: true });
}
job = await ok('GET', `/jobs/${jobRow.id}`, owner.token);
assert.equal(job.status, 'completed');
assert.ok(job.warranty_until > job.completed_at);
await fails([400, 'invalid_quality'], 'POST', `/jobs/${jobRow.id}/review`, owner.token, { quality: 6, punctuality: 5, price_honesty: 5, attitude: 5 });
await fails([404, 'job_not_found'], 'POST', `/jobs/${jobRow.id}/review`, builder.token, { quality: 5, punctuality: 5, price_honesty: 5, attitude: 5 });
await ok('POST', `/jobs/${jobRow.id}/review`, owner.token,
  { quality: 5, punctuality: 4, price_honesty: 5, attitude: 4, content: 'Làm kỹ, đúng giá', photos: [up.public_url] });
await fails([400, 'already_reviewed'], 'POST', `/jobs/${jobRow.id}/review`, owner.token, { quality: 1, punctuality: 1, price_honesty: 1, attitude: 1 });
await fails([404, 'review_not_found'], 'POST', `/jobs/${jobRow.id}/review/reply`, outsider.token, { reply: 'x' });
await ok('POST', `/jobs/${jobRow.id}/review/reply`, builder.token, { reply: 'Cảm ơn chị!' });
const pub = await ok('GET', `/contractors/${profile.id}`);
assert.deepEqual([pub.rating, pub.review_count, pub.completed_jobs], [4.5, 1, 1]);
assert.equal(pub.reviews[0].reply, 'Cảm ơn chị!');
assert.equal(pub.tax_code, undefined);
await fails([404, 'contractor_not_found'], 'GET', `/contractors/${(await ok('GET', '/contractor', outsider.token)).id}`);
const showcase = await ok('GET', `/unit-types/${UNIT_A}/showcase`);
const shown = showcase.find((s: Json) => s.job_id === jobRow.id);
assert.ok(shown.photos.includes(up.public_url));
assert.equal(shown.price, undefined);
step('hoàn thành, đánh giá một lần, điểm và hồ sơ công khai, căn đã làm thực tế');

// Sửa gói đã đăng: quay về chờ duyệt
const edited = await ok('PUT', `/contractor/packages/${pkg.id}`, builder.token, { ...pkgBody, items: pkgBody.items.slice(0, 1) });
assert.deepEqual([edited.status, edited.price, edited.items.length], ['pending', 7_500_000, 1]);
assert.equal(await listed(), false);
await fails([404, 'package_not_found'], 'DELETE', `/contractor/packages/${pkg.id}`, outsider.token);
await ok('DELETE', `/contractor/packages/${pkg.id}`, builder.token);
step('sửa gói đã đăng thì về chờ duyệt, xoá được gói chưa đăng');

// Xoá tài khoản: đăng nhập không được nữa, công trình và đánh giá vẫn còn cho nhà thầu
await ok('DELETE', '/me', owner.token);
await fails([401, 'invalid_credentials'], 'POST', '/auth/login', undefined, { phone: owner.phone, password: 'secret1' });
job = await ok('GET', `/jobs/${jobRow.id}`, builder.token);
assert.deepEqual([job.status, job.owner.full_name], ['completed', 'Chủ nhà']);
assert.equal((await ok('GET', `/contractors/${profile.id}`)).review_count, 1);
await ok('DELETE', '/me', outsider.token);
await ok('DELETE', '/me', ops.token);
await ok('DELETE', '/me', walkIn.token);
// Dọn: nhà thầu test bị ẩn khỏi danh sách công khai và gợi ý ghép (DELETE /me đặt rejected).
await ok('DELETE', '/me', builder.token);
step('xoá tài khoản, lịch sử công trình và đánh giá vẫn giữ');

console.log('E2E OK');
