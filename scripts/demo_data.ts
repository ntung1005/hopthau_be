// Dữ liệu demo để xem thử app / web: npm run db:reset && npm run dev (terminal khác) && npm run demo
// Đi qua đúng API như người dùng thật (đăng ký, tạo gói, admin duyệt, yêu cầu, báo giá, mốc, đánh giá),
// nên dữ liệu nhất quán với nghiệp vụ. Mọi tên dự án, nhà thầu, người dùng đều là giả.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { EMAIL_DOMAIN } from '../src/auth.ts';
import { loadEnv } from '../src/env.ts';
import { normalizePhone } from '../src/phone.ts';

const env = loadEnv();
const BASE = `http://localhost:${env.port}`;
const PASSWORD = '123456';
const db = createClient(env.supabaseUrl, env.secretKey, { auth: { persistSession: false } });
const photoDir = new URL('./demo_photos/', import.meta.url);

type Json = any;

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Json> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

/** Tạo tài khoản bằng quyền admin (giống /auth/register nhưng không bị giới hạn 10 lần / 5 phút), rồi đăng nhập qua API. */
async function account(phone: string, name: string): Promise<string> {
  const p = normalizePhone(phone)!;
  const { error } = await db.auth.admin.createUser({
    email: `${p}@${EMAIL_DOMAIN}`, password: PASSWORD, email_confirm: true, user_metadata: { phone: p, full_name: name },
  });
  if (error) throw error;
  return (await call('POST', '/auth/login', undefined, { phone, password: PASSWORD })).access_token;
}

const uploaded = new Map<string, string>();
async function photo(token: string, file: string): Promise<string> {
  const key = `${token.slice(-12)}:${file}`;
  if (uploaded.has(key)) return uploaded.get(key)!;
  const slot = await call('POST', '/uploads', token, { content_type: 'image/png' });
  const put = await fetch(slot.upload_url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: readFileSync(new URL(`${file}.png`, photoDir)) });
  if (!put.ok) throw new Error(`upload ${file}: ${put.status}`);
  uploaded.set(key, slot.public_url);
  return slot.public_url;
}

// Hạng mục ----------------------------------------------------------------------------

type Item = { room: string; name: string; material?: string; size?: string; qty: number; unit?: string; unit_price: number; is_optional?: boolean };

/** Bộ hạng mục căn 2PN; k: hệ số giá theo vật liệu. */
function items2PN(material: string, k: number, extras: Item[] = []): Item[] {
  const p = (n: number) => Math.round((n * k) / 50_000) * 50_000;
  return [
    { room: 'Phòng khách', name: 'Kệ tivi treo', material, size: '2400×400', qty: 1, unit_price: p(5_800_000) },
    { room: 'Phòng khách', name: 'Tủ giày kết hợp vách', material, size: '1200×350×2100', qty: 1, unit_price: p(4_200_000) },
    { room: 'Bếp', name: 'Tủ bếp dưới', material: `${material}, mặt đá`, qty: 2.8, unit: 'md', unit_price: p(3_300_000) },
    { room: 'Bếp', name: 'Tủ bếp trên', material, qty: 2.8, unit: 'md', unit_price: p(2_700_000) },
    { room: 'Phòng ngủ 1', name: 'Giường 1m6 có ngăn kéo', material, size: '1600×2000', qty: 1, unit: 'chiếc', unit_price: p(6_200_000) },
    { room: 'Phòng ngủ 1', name: 'Tủ áo 3 cánh kịch trần', material, size: '1600×600×2700', qty: 1, unit_price: p(9_800_000) },
    { room: 'Phòng ngủ 1', name: 'Bàn trang điểm', material, qty: 1, unit_price: p(2_600_000), is_optional: true },
    { room: 'Phòng ngủ 2', name: 'Giường 1m2', material, size: '1200×2000', qty: 1, unit: 'chiếc', unit_price: p(4_300_000) },
    { room: 'Phòng ngủ 2', name: 'Bàn học + giá sách', material, qty: 1, unit_price: p(3_400_000) },
    { room: 'WC', name: 'Tủ lavabo chống nước', material: 'Nhựa PVC chống nước', qty: 1, unit_price: p(2_900_000) },
    { room: 'WC', name: 'Gương đèn LED', qty: 1, unit: 'chiếc', unit_price: p(1_400_000), is_optional: true },
    ...extras,
  ];
}

function items1PN(material: string, k: number): Item[] {
  const p = (n: number) => Math.round((n * k) / 50_000) * 50_000;
  return [
    { room: 'Phòng khách', name: 'Kệ tivi', material, size: '1800×400', qty: 1, unit_price: p(4_600_000) },
    { room: 'Bếp', name: 'Tủ bếp chữ I', material: `${material}, mặt đá`, qty: 2.4, unit: 'md', unit_price: p(5_400_000) },
    { room: 'Phòng ngủ', name: 'Giường 1m6', material, size: '1600×2000', qty: 1, unit: 'chiếc', unit_price: p(5_600_000) },
    { room: 'Phòng ngủ', name: 'Tủ áo 2 cánh', material, size: '1200×600×2400', qty: 1, unit_price: p(7_200_000) },
    { room: 'WC', name: 'Tủ lavabo', material: 'Nhựa PVC chống nước', qty: 1, unit_price: p(2_600_000) },
    { room: 'Ban công', name: 'Kệ giặt phơi', material: 'Nhôm kính', qty: 1, unit_price: p(2_200_000), is_optional: true },
  ];
}

// Bản đo --------------------------------------------------------------------------------

const door = (wall: string, offset: number) => ({ wall, kind: 'door', offset, width: 0.9, height: 2.1, sill: 0 });
const win = (wall: string, offset: number, width = 1.2) => ({ wall, kind: 'window', offset, width, height: 1.4, sill: 0.9 });

const plan2PN = {
  rooms: [
    { id: 'r1', name: 'Phòng khách + bếp', type: 'living', x: 0, y: 0, w: 4.05, l: 6.1, h: 2.85, openings: [door('s', 0.6), win('w', 1.6, 1.8)],
      cuts: [{ corner: 'sw', kind: 'notch', dx: 0.45, dy: 0.45 }], // cột
      items: [{ name: 'Kệ tivi', qty: 1, note: 'dài 2m4' }, { name: 'Tủ bếp trên + dưới', qty: 1, note: 'chữ I, 2m6' }, { name: 'Tủ giày', qty: 1 }] },
    { id: 'r2', name: 'Phòng ngủ master', type: 'bedroom', x: 4.05, y: 0, w: 3.25, l: 3.45, h: 2.85, openings: [door('w', 2.4), win('n', 1.0, 1.4)],
      cuts: [{ corner: 'ne', kind: 'chamfer', dx: 0.8, dy: 0.8 }], // góc vát
      items: [{ name: 'Giường', qty: 1, note: '1m8 × 2m, có ngăn kéo' }, { name: 'Tủ quần áo', qty: 1, note: 'kịch trần, cánh lùa' }, { name: 'Bàn trang điểm', qty: 1 }] },
    { id: 'r3', name: 'Phòng ngủ con', type: 'bedroom', x: 4.05, y: 3.45, w: 3.25, l: 2.9, h: 2.85, openings: [door('w', 0.2), win('e', 0.9)],
      items: [{ name: 'Giường', qty: 1, note: '1m2' }, { name: 'Bàn làm việc', qty: 1, note: 'kèm kệ sách' }] },
    { id: 'r4', name: 'WC chung', type: 'bathroom', x: 4.05, y: 6.35, w: 1.8, l: 2.0, h: 2.6, openings: [door('n', 0.4)] },
    { id: 'r5', name: 'Ban công', type: 'balcony', x: 0, y: 6.1, w: 4.05, l: 1.3, h: 2.85, openings: [door('n', 0.4)] },
  ],
};

const planTownhouse = {
  rooms: [
    { id: 'r1', name: 'Phòng khách tầng trệt', type: 'living', x: 0, y: 0, w: 4.5, l: 6.5, h: 3.3, openings: [door('s', 1.5), win('s', 3.0, 1.2)],
      items: [{ name: 'Kệ tivi', qty: 1 }, { name: 'Tủ trang trí', qty: 1 }] },
    { id: 'r2', name: 'Bếp + ăn', type: 'kitchen', x: 0, y: -4.2, w: 4.5, l: 4.2, h: 3.3, openings: [door('s', 0.4), win('n', 1.6, 1.4)],
      items: [{ name: 'Tủ bếp trên + dưới', qty: 1, note: 'chữ L' }, { name: 'Bàn ăn + ghế', qty: 1, note: '6 ghế' }] },
    { id: 'r3', name: 'WC tầng trệt', type: 'bathroom', x: 4.5, y: -4.2, w: 1.6, l: 2.2, h: 3.0, openings: [door('w', 0.6)] },
    { id: 'r4', name: 'Phòng ngủ tầng 2', type: 'bedroom', x: 7.2, y: -4.2, w: 4.0, l: 4.5, h: 3.1, openings: [door('s', 0.3), win('n', 1.4, 1.4)],
      items: [{ name: 'Giường', qty: 1, note: '1m8' }, { name: 'Tủ quần áo', qty: 1 }] },
    { id: 'r5', name: 'Phòng ngủ tầng 2 (sau)', type: 'bedroom', x: 7.2, y: 0.3, w: 4.0, l: 3.8, h: 3.1, openings: [door('n', 0.3), win('s', 1.3)] },
  ],
};

// Chạy ----------------------------------------------------------------------------------

const step = (s: string) => console.log(`✓ ${s}`);

if ((await db.from('profiles').select('id').eq('phone', '84900000999').maybeSingle()).data) {
  console.error('Đã có dữ liệu demo. Chạy lại từ đầu: npm run db:reset, khởi động lại BE, rồi npm run demo.');
  process.exit(1);
}

// Admin
const admin = await account('0900000999', 'Vận hành Hợp Thầu');
{
  const { data } = await db.from('profiles').select('id,roles').eq('phone', '84900000999').single();
  await db.from('profiles').update({ roles: [...data!.roles, 'admin'] }).eq('id', data!.id);
}
step('admin');

// Dự án (2 dự án có sẵn trong seed.sql + 3 dự án mới)
async function project(body: Json, units: [string, number, number, number][]) {
  const p = await call('POST', '/admin/projects', admin, body);
  const ids: Record<string, string> = {};
  for (const [name, area, bed, bath] of units) {
    ids[name] = (await call('POST', `/admin/projects/${p.id}/unit-types`, admin, { name, area_m2: area, bedrooms: bed, bathrooms: bath })).id;
  }
  return ids;
}
const SONG_HONG = { A: '20000000-0000-0000-0000-000000000001', B: '20000000-0000-0000-0000-000000000002' };
const BINH_AN = { C: '20000000-0000-0000-0000-000000000003' };
const thuongThanh = await project(
  { name: 'NOXH Demo Thượng Thanh', developer: 'Chủ đầu tư Demo C', province: 'Hà Nội', address: 'Long Biên, Hà Nội', handover_date: '2027-01-20', is_social_housing: true },
  [['Mẫu A · 2PN 2WC', 58.4, 2, 2], ['Mẫu B · 1PN', 42.5, 1, 1]],
);
const kimChung = await project(
  { name: 'NOXH Demo Kim Chung', developer: 'Chủ đầu tư Demo D', province: 'Hà Nội', address: 'Đông Anh, Hà Nội', handover_date: '2026-11-30', is_social_housing: true },
  [['Mẫu 2PN', 55.0, 2, 1], ['Mẫu 3PN góc', 69.8, 3, 2]],
);
const hoangMai = await project(
  { name: 'Chung cư Demo Hoàng Mai', developer: 'Chủ đầu tư Demo E', province: 'Hà Nội', address: 'Hoàng Mai, Hà Nội', handover_date: '2026-10-15', is_social_housing: false },
  [['Mẫu 2PN+1', 72.0, 2, 2]],
);
step('5 dự án, 10 mẫu căn');

// Nhà thầu
async function contractor(phone: string, person: string, profile: Json) {
  const token = await account(phone, person);
  const c = await call('POST', '/contractor', token, profile);
  return { token, id: c.id as string };
}
const tuanPhat = await contractor('0911000111', 'Anh Tuấn', {
  name: 'Xưởng Mộc Tuấn Phát', tax_code: '0109000111', address: 'Gia Lâm, Hà Nội', areas: ['Hà Nội', 'Bắc Ninh'],
  services: ['Thiết kế 3D', 'Đồ gỗ nội thất', 'Tủ bếp'], years_experience: 8, website: 'facebook.com/xuongmoctuanphat.demo',
  styles: ['Japandi', 'Hiện đại'], bio: 'Xưởng gỗ công nghiệp và gỗ sồi 8 năm, 25 thợ. Nhận căn hộ NOXH khu Long Biên, Gia Lâm, Đông Anh.',
});
const anGia = await contractor('0911000222', 'Chị Ngọc', {
  name: 'Nội Thất An Gia', tax_code: '0109000222', address: 'Hoàng Mai, Hà Nội', areas: ['Hà Nội'],
  services: ['Thiết kế 3D', 'Đồ gỗ nội thất', 'Tủ bếp', 'Rèm, giấy dán tường'], years_experience: 5,
  styles: ['Hiện đại', 'Tối giản'], bio: 'Chuyên căn hộ nhỏ, tối ưu lưu trữ. Thiết kế 3D miễn phí khi chốt gói.',
});
const mocViet = await contractor('0911000333', 'Anh Khoa', {
  name: 'Mộc Việt Studio', tax_code: '0319000333', address: 'Thủ Đức, TP. Hồ Chí Minh', areas: ['TP. Hồ Chí Minh', 'Đồng Nai'],
  services: ['Thiết kế 3D', 'Đồ gỗ nội thất', 'Tủ bếp', 'Sơn bả', 'Sàn gỗ / sàn nhựa', 'Cải tạo, sửa chữa'], years_experience: 10,
  styles: ['Indochine', 'Scandinavian'], bio: 'Xưởng tại Thủ Đức, làm Indochine gỗ tự nhiên và Scandinavian sáng màu.',
});
const haiDang = await contractor('0911000444', 'Anh Hải', {
  name: 'Xưởng Hải Đăng', tax_code: '0109000444', address: 'Đông Anh, Hà Nội', areas: ['Hà Nội'],
  services: ['Đồ gỗ nội thất'], years_experience: 2,
  styles: ['Hiện đại'], bio: 'Xưởng mới, đang chờ xác minh.',
});
for (const c of [tuanPhat, anGia, mocViet]) await call('PATCH', `/admin/contractors/${c.id}`, admin, { status: 'verified' });
step('4 nhà thầu (3 đã xác minh, 1 chờ xác minh)');

// Gói
async function pkg(c: { token: string }, unit: string, name: string, style: string, days: number, warranty: number, items: Item[], photos: string[], publish = true) {
  const images = [];
  for (const f of photos) images.push(await photo(c.token, f));
  const p = await call('POST', '/contractor/packages', c.token, { unit_type_id: unit, name, style, duration_days: days, warranty_months: warranty, items, images });
  await call('POST', `/contractor/packages/${p.id}/submit`, c.token);
  if (publish) await call('PATCH', `/admin/packages/${p.id}`, admin, { status: 'published' });
  return p.id as string;
}
const pJapandi = await pkg(tuanPhat, SONG_HONG.A, 'Gói Japandi Mộc', 'Japandi', 28, 24, items2PN('MDF chống ẩm An Cường, vân sồi', 1.0), ['living_japandi', 'kitchen_wood', 'bedroom_warm']);
await pkg(tuanPhat, SONG_HONG.B, 'Gói Japandi 2WC', 'Japandi', 32, 24,
  items2PN('MDF chống ẩm An Cường, vân sồi', 1.08, [{ room: 'WC 2', name: 'Tủ lavabo', material: 'Nhựa PVC', qty: 1, unit_price: 2_900_000 }]), ['living_japandi', 'wardrobe']);
await pkg(tuanPhat, thuongThanh['Mẫu A · 2PN 2WC'], 'Gói Gỗ Sồi Ấm', 'Japandi', 30, 36, items2PN('Veneer sồi tự nhiên', 1.35), ['kitchen_wood', 'bedroom_warm', 'wardrobe']);
const pAnGia = await pkg(anGia, SONG_HONG.A, 'Gói Hiện Đại Sáng', 'Hiện đại', 25, 24, items2PN('Melamine An Cường', 0.9), ['living_modern', 'kitchen_white', 'bedroom_blue']);
await pkg(anGia, thuongThanh['Mẫu B · 1PN'], 'Gói Tối Giản 1PN', 'Tối giản', 20, 24, items1PN('Melamine', 0.95), ['bedroom_blue', 'kitchen_white']);
const pTietKiem = await pkg(anGia, kimChung['Mẫu 2PN'], 'Gói Tiết Kiệm', 'Hiện đại', 22, 12, items2PN('MDF phủ Melamine', 0.75), ['kitchen_white', 'bedroom_blue']);
await pkg(anGia, hoangMai['Mẫu 2PN+1'], 'Gói Hiện Đại Plus', 'Hiện đại', 35, 36,
  items2PN('Acrylic bóng gương', 1.25, [{ room: 'Phòng đa năng', name: 'Giường gấp + tủ', material: 'Acrylic', qty: 1, unit_price: 8_500_000 }]), ['living_modern', 'wardrobe', 'bathroom']);
const pIndochine = await pkg(mocViet, BINH_AN.C, 'Gói Indochine 1PN', 'Indochine', 30, 36, items1PN('Gỗ sồi Mỹ + mây đan', 1.4), ['living_indochine', 'bedroom_warm']);
await pkg(mocViet, BINH_AN.C, 'Gói Scandinavian 1PN', 'Scandinavian', 24, 24, items1PN('MDF sơn trắng + gỗ ash', 1.05), ['bedroom_blue', 'kitchen_white']);
await pkg(haiDang, kimChung['Mẫu 3PN góc'], 'Gói Hải Đăng 3PN', 'Hiện đại', 35, 12, items2PN('MDF chống ẩm', 1.1, [
  { room: 'Phòng ngủ 3', name: 'Giường 1m2 + tủ', material: 'MDF chống ẩm', qty: 1, unit_price: 7_500_000 },
]), ['living_modern'], false);
step('10 gói có ảnh (9 đang hiển thị, 1 chờ duyệt)');

// Công trình: yêu cầu từ gói → báo giá → chọn → mốc
async function job(owner: string, contractorC: { token: string; id: string }, unit: string, packageId: string, price: number, days: number,
  { approved = 4, submitNext = false, note = '' } = {}) {
  const r = await call('POST', '/quote-requests', owner, { unit_type_id: unit, package_id: packageId, note });
  await call('POST', `/contractor/leads/${r.id}/quote`, contractorC.token, { price, duration_days: days, message: 'Khảo sát miễn phí, đã gồm vận chuyển và lắp đặt.' });
  const d = await call('POST', `/quote-requests/${r.id}/accept`, owner, { contractor_id: contractorC.id });
  const j = await call('GET', `/jobs/${d.job.id}`, owner);
  const photos = [['raw_room'], ['kitchen_wood', 'wardrobe'], ['living_japandi', 'bedroom_warm'], ['living_japandi', 'kitchen_wood']];
  const notes = ['Đã nhận cọc, chốt bản vẽ 3D và vật liệu', 'Tủ bếp, tủ áo đã xong tại xưởng', 'Lắp đặt xong toàn bộ, đã vệ sinh', 'Bàn giao, hướng dẫn sử dụng và bảo hành'];
  for (let i = 0; i < 4; i++) {
    const m = j.milestones[i];
    if (i >= approved + (submitNext ? 1 : 0)) break;
    const urls = [];
    for (const f of photos[i]) urls.push(await photo(contractorC.token, f));
    await call('POST', `/jobs/milestones/${m.id}/submit`, contractorC.token, { note: notes[i], photos: urls });
    if (i < approved) {
      await call('POST', `/jobs/milestones/${m.id}/review`, owner, { approve: true });
      await call('POST', `/jobs/milestones/${m.id}/paid`, contractorC.token);
    }
  }
  return d.job.id as string;
}

const lan = await account('0922000222', 'Chị Lan');
const hoa = await account('0933000333', 'Chị Hoa');
const minh = await account('0944000444', 'Anh Minh');
const thu = await account('0955000555', 'Chị Thu');
const nam = await account('0966000666', 'Anh Nam');
const mai = await account('0977000777', 'Chị Mai');

// Chị Lan: đang thi công, mốc 2 chờ nghiệm thu, có phát sinh chờ quyết
const lanMeasure = await call('POST', '/measurements', lan, { name: 'Căn 2PN Sông Hồng tầng 12', unit_type_id: SONG_HONG.A, data: plan2PN });
const jobLan = await job(lan, tuanPhat, SONG_HONG.A, pJapandi, 41_500_000, 28, { approved: 1, submitNext: true, note: 'Nhận nhà 15/12, muốn xong trước Tết' });
await call('POST', `/jobs/${jobLan}/changes`, tuanPhat.token, {
  title: 'Thêm kệ gia vị âm tủ', description: 'Chị Lan yêu cầu khi xem xưởng', amount: 1_800_000, days_delta: 1,
});

// Chị Hoa, chị Mai, chị Thu: đã bàn giao, có đánh giá
const jobHoa = await job(hoa, tuanPhat, SONG_HONG.A, pJapandi, 39_800_000, 25, { note: 'Căn tầng 9' });
await call('POST', `/jobs/${jobHoa}/review`, hoa, {
  quality: 5, punctuality: 5, price_honesty: 5, attitude: 4, content: 'Đúng giá như gói, không phát sinh. Tủ bếp chắc chắn, thợ làm gọn gàng.',
  photos: [await photo(hoa, 'living_japandi'), await photo(hoa, 'kitchen_wood')],
});
await call('POST', `/jobs/${jobHoa}/review/reply`, tuanPhat.token, { reply: 'Cảm ơn chị Hoa đã tin tưởng xưởng!' });
const jobMai = await job(mai, anGia, SONG_HONG.A, pAnGia, 36_900_000, 25, { note: 'Muốn tông trắng xanh' });
await call('POST', `/jobs/${jobMai}/review`, mai, {
  quality: 4, punctuality: 4, price_honesty: 5, attitude: 5, content: 'Giá rõ ràng từng món. Trễ 2 ngày do chờ đá nhưng báo trước.',
  photos: [await photo(mai, 'living_modern'), await photo(mai, 'bedroom_blue')],
});
const jobThu = await job(thu, mocViet, BINH_AN.C, pIndochine, 45_000_000, 30, { note: 'Thích gỗ và mây' });
await call('POST', `/jobs/${jobThu}/review`, thu, {
  quality: 5, punctuality: 4, price_honesty: 5, attitude: 5, content: 'Căn 1PN nhỏ mà nhìn rộng hẳn. Gỗ đẹp, anh Khoa tư vấn kỹ.',
  photos: [await photo(thu, 'living_indochine')],
});
await call('POST', `/jobs/${jobThu}/review/reply`, mocViet.token, { reply: 'Cảm ơn chị Thu, hẹn chị bảo dưỡng sau 6 tháng nhé.' });
step('4 công trình (1 đang thi công, 3 đã bàn giao, 3 đánh giá)');

// Anh Minh: tự đo nhà phố, gửi yêu cầu theo tỉnh + hạng mục → tự ghép Mộc Việt (TP. Hồ Chí Minh) → đã báo giá, chờ chọn
const minhMeasure = await call('POST', '/measurements', minh, { name: 'Nhà phố Dĩ An', data: planTownhouse, note: 'Nhà 2 tầng, làm tầng trệt và 2 phòng ngủ' });
const reqMinh = await call('POST', '/quote-requests', minh, {
  province: 'TP. Hồ Chí Minh', address: 'Nhà phố Dĩ An', services: ['Đồ gỗ nội thất', 'Tủ bếp', 'Sơn bả'], budget: 150_000_000, style: 'Scandinavian', measurement_id: minhMeasure.id,
  note: 'Làm tầng trệt và 2 phòng ngủ, đã đo sẵn trong app',
});
// Mộc Việt báo theo món: giữ đồ anh Minh chọn, bỏ tủ trang trí, thêm tab đầu giường và nhân công
await call('POST', `/contractor/leads/${reqMinh.id}/quote`, mocViet.token, {
  duration_days: 40, message: 'Đã xem bản đo của anh: sàn 70 m², tường 190 m². Bỏ tủ trang trí vì phòng khách đã có kệ tivi dài; thêm tab đầu giường cho đồng bộ.',
  items: [
    { room: 'Phòng khách tầng trệt', name: 'Kệ tivi', qty: 1, unit_price: 9_500_000, note: 'gỗ sồi, dài 2m8' },
    { room: 'Bếp + ăn', name: 'Tủ bếp trên + dưới', qty: 1, unit_price: 38_000_000, note: 'chữ L, MDF chống ẩm' },
    { room: 'Bếp + ăn', name: 'Bàn ăn + ghế', qty: 1, unit_price: 14_000_000, note: '6 ghế' },
    { room: 'Phòng ngủ tầng 2', name: 'Giường', qty: 1, unit_price: 12_000_000, note: '1m8' },
    { room: 'Phòng ngủ tầng 2', name: 'Tủ quần áo', qty: 1, unit_price: 22_000_000 },
    { room: 'Phòng ngủ tầng 2', name: 'Tab đầu giường', qty: 2, unit_price: 2_500_000 },
    { room: 'Chung', name: 'Nhân công, vận chuyển, lắp đặt', qty: 1, unit_price: 8_000_000 },
  ],
});
// An Gia muốn gặp trực tiếp: khảo sát rồi tự thoả thuận giá bên ngoài
await call('POST', `/admin/requests/${reqMinh.id}/matches`, admin, { contractor_id: anGia.id });
await call('POST', `/contractor/leads/${reqMinh.id}/quote`, anGia.token, {
  mode: 'offline', message: 'Nhà phố nên khảo sát tận nơi trước khi báo. Bên em qua đo lại sáng thứ 7, báo giá trực tiếp tại nhà.',
});

// Anh Nam: yêu cầu từ gói, kèm bản đo, nhà thầu chưa báo giá
const namMeasure = await call('POST', '/measurements', nam, { name: 'Căn Kim Chung 2PN', unit_type_id: kimChung['Mẫu 2PN'], data: plan2PN });
await call('POST', '/quote-requests', nam, {
  unit_type_id: kimChung['Mẫu 2PN'], package_id: pTietKiem, measurement_id: namMeasure.id, budget: 45_000_000,
  note: 'Phòng khách rộng hơn mẫu 20 cm do bỏ vách, đã đo lại trong app',
});
// Chị Lan còn gửi bản đo cho yêu cầu mới theo địa chỉ chưa có nhà thầu khu vực → admin ghép tay
await call('POST', '/quote-requests', lan, {
  province: 'Hải Phòng', address: 'Căn hộ cho bố mẹ, phường Hải Dương', services: ['Đồ gỗ nội thất', 'Tủ bếp'], budget: 60_000_000, measurement_id: lanMeasure.id });
step('3 bản đo nhà, 3 yêu cầu mở (1 đã có 2 báo giá, 1 chờ nhà thầu báo, 1 chờ admin ghép)');

// Lead landing
for (const [name, phone, note, source] of [
  ['Anh Quân', '0981 222 333', 'Căn 2PN Thượng Thanh, nhận nhà tháng 1', 'home'],
  ['Chị Hằng', '0982 444 555', 'Muốn gói dưới 40 triệu', 'project:noxh-demo-kim-chung'],
]) await call('POST', '/leads', undefined, { name, phone, note, source });
step('2 lead landing');

// Hồ sơ nhà thầu thu từ form web /cho-nha-thau (chưa có tài khoản app)
await call('POST', '/leads/contractors', undefined, {
  name: 'Xưởng Gỗ Minh Long', contact_name: 'Anh Long', phone: '0983 666 777', address: 'Từ Sơn, Bắc Ninh',
  areas: ['Bắc Ninh', 'Hà Nội'], services: ['Đồ gỗ nội thất', 'Tủ bếp'], years_experience: 12,
  website: 'facebook.com/gominhlong.demo', bio: 'Xưởng 15 thợ, máy CNC, nhận đơn căn hộ.', source: 'contractor',
});
await call('POST', '/leads/contractors', undefined, {
  name: 'Đội thợ Sơn Hùng', contact_name: 'Anh Hùng', phone: '0984 888 999', areas: ['Hà Nội'],
  services: ['Sơn bả', 'Ốp lát gạch', 'Trần thạch cao'], years_experience: 6, source: 'contractor',
});
step('2 hồ sơ nhà thầu từ form web (chờ xác minh, chưa có tài khoản)');

console.log(`
Tài khoản demo (mật khẩu: ${PASSWORD})
  Admin (web /admin)        0900000999  Vận hành Hợp Thầu
  Nhà thầu                  0911000111  Xưởng Mộc Tuấn Phát (Hà Nội): 1 công trình đang làm, 2 đã bàn giao
                            0911000222  Nội Thất An Gia (Hà Nội): 1 yêu cầu chờ báo giá (có bản đo)
                            0911000333  Mộc Việt Studio (TP. Hồ Chí Minh, Đồng Nai)
                            0911000444  Xưởng Hải Đăng: chưa xác minh, 1 gói chờ duyệt
  Nhà thầu từ form web      0983666777  Xưởng Gỗ Minh Long: chưa có tài khoản; đăng ký app bằng số này rồi "Trở thành nhà thầu" để nhận hồ sơ
  Chủ nhà                   0922000222  Chị Lan: công trình đang thi công (mốc 2 chờ nghiệm thu, phát sinh chờ quyết)
                            0933000333  Chị Hoa: đã bàn giao, đã đánh giá
                            0944000444  Anh Minh: bản đo nhà phố, 1 báo giá theo món + 1 đề nghị làm việc trực tiếp
                            0955000555  Chị Thu: đã bàn giao (TP. Hồ Chí Minh)
                            0966000666  Anh Nam: yêu cầu kèm bản đo, chờ nhà thầu
                            0977000777  Chị Mai: đã bàn giao
`);
