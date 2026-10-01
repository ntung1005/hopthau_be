// Bản đo nhà: kiểm tra dữ liệu app gửi lên và tính diện tích để nhà thầu báo giá.
// Toạ độ theo mét: x sang phải, y xuống dưới; phòng đặt tại góc trên trái (x, y), rộng w theo x, dài l theo y.
// Tường n / s dài w, tường e / w dài l. Cửa nằm trên một tường, cách góc trái (nhìn từ trong phòng: n, s tính
// từ trái sang theo x; e, w tính từ trên xuống theo y) một khoảng offset.
// Góc phòng có thể bị cắt (cột, hộp kỹ thuật, góc vát): cắt vuông (notch) khoét hình chữ nhật dx × dy,
// cắt chéo (chamfer) vát theo đường chéo. Phòng khi đó là đa giác; diện tích, chu vi tính theo đa giác.

import { ApiError } from './http.ts';

export const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'balcony', 'other'] as const;
const WALLS = ['n', 'e', 's', 'w'] as const;
const CORNERS = ['nw', 'ne', 'se', 'sw'] as const;

export interface CornerCut {
  corner: (typeof CORNERS)[number];
  kind: 'notch' | 'chamfer';
  dx: number;
  dy: number;
}

export interface Opening {
  wall: (typeof WALLS)[number];
  kind: 'door' | 'window';
  offset: number;
  width: number;
  height: number;
  sill: number;
}

export interface Room {
  id: string;
  name: string;
  type: (typeof ROOM_TYPES)[number];
  x: number;
  y: number;
  w: number;
  l: number;
  h: number;
  openings: Opening[];
  cuts: CornerCut[];
}

export interface MeasurementData {
  rooms: Room[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function num(v: unknown, key: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new ApiError(400, `invalid_${key}`);
  return r2(v);
}

/** Kiểm tra và chuẩn hoá (làm tròn 1 cm). Sai: ApiError invalid_<trường>. */
export function parseMeasurement(raw: unknown): MeasurementData {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { rooms?: unknown }).rooms)) {
    throw new ApiError(400, 'invalid_rooms');
  }
  const rooms = (raw as { rooms: unknown[] }).rooms;
  if (rooms.length === 0) throw new ApiError(400, 'missing_rooms');
  if (rooms.length > 30) throw new ApiError(400, 'too_many_rooms');
  const ids = new Set<string>();
  return {
    rooms: rooms.map((r) => {
      if (typeof r !== 'object' || r === null) throw new ApiError(400, 'invalid_rooms');
      const o = r as Record<string, unknown>;
      const id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : '';
      if (!id || ids.has(id)) throw new ApiError(400, 'invalid_room_id');
      ids.add(id);
      const name = typeof o.name === 'string' ? o.name.trim().slice(0, 50) : '';
      if (!name) throw new ApiError(400, 'missing_room_name');
      const type = ROOM_TYPES.includes(o.type as Room['type']) ? (o.type as Room['type']) : 'other';
      const w = num(o.w, 'room_width', 0.3, 30);
      const l = num(o.l, 'room_length', 0.3, 30);
      const h = num(o.h, 'room_height', 1.8, 6);
      const openings = o.openings ?? [];
      if (!Array.isArray(openings) || openings.length > 12) throw new ApiError(400, 'invalid_openings');
      const cutsRaw = o.cuts ?? [];
      if (!Array.isArray(cutsRaw) || cutsRaw.length > 4) throw new ApiError(400, 'invalid_cuts');
      const cuts: CornerCut[] = cutsRaw.map((c) => {
        const q = (c ?? {}) as Record<string, unknown>;
        const corner = CORNERS.includes(q.corner as CornerCut['corner']) ? (q.corner as CornerCut['corner']) : null;
        const kind = q.kind === 'notch' || q.kind === 'chamfer' ? q.kind : null;
        if (!corner || !kind) throw new ApiError(400, 'invalid_cuts');
        return { corner, kind, dx: num(q.dx, 'cut_size', 0.05, w - 0.1), dy: num(q.dy, 'cut_size', 0.05, l - 0.1) };
      });
      if (new Set(cuts.map((c) => c.corner)).size !== cuts.length) throw new ApiError(400, 'invalid_cuts');
      const cut = cornerCuts(cuts);
      // Hai góc cùng một cạnh không được chồng lên nhau (chừa ít nhất 10 cm tường).
      if (cut.nw.dx + cut.ne.dx > w - 0.1 || cut.sw.dx + cut.se.dx > w - 0.1 ||
          cut.nw.dy + cut.sw.dy > l - 0.1 || cut.ne.dy + cut.se.dy > l - 0.1) throw new ApiError(400, 'invalid_cut_size');
      return {
        id, name, type, w, l, h, cuts,
        x: num(o.x, 'room_x', -100, 100),
        y: num(o.y, 'room_y', -100, 100),
        openings: openings.map((p) => {
          if (typeof p !== 'object' || p === null) throw new ApiError(400, 'invalid_openings');
          const q = p as Record<string, unknown>;
          const wall = WALLS.includes(q.wall as Opening['wall']) ? (q.wall as Opening['wall']) : null;
          const kind = q.kind === 'door' || q.kind === 'window' ? q.kind : null;
          if (!wall || !kind) throw new ApiError(400, 'invalid_openings');
          // Cửa chỉ nằm trên đoạn tường còn lại sau khi cắt góc.
          const [from, to] = wallSpan(wall, w, l, cut);
          const width = num(q.width, 'opening_width', 0.2, to - from);
          const offset = num(q.offset, 'opening_offset', from, to - width);
          const height = num(q.height, 'opening_height', 0.2, h);
          const sill = num(q.sill ?? 0, 'opening_sill', 0, h - height);
          return { wall, kind, offset, width, height, sill };
        }),
      };
    }),
  };
}

type Cuts = Record<CornerCut['corner'], { dx: number; dy: number; kind: CornerCut['kind'] | null }>;

function cornerCuts(cuts: CornerCut[]): Cuts {
  const none = { dx: 0, dy: 0, kind: null };
  const by = Object.fromEntries(cuts.map((c) => [c.corner, c]));
  return { nw: by.nw ?? none, ne: by.ne ?? none, se: by.se ?? none, sw: by.sw ?? none };
}

/** Đoạn tường còn lại [từ, đến] (theo offset của cửa) sau khi cắt hai góc ở hai đầu tường. */
export function wallSpan(wall: Opening['wall'], w: number, l: number, c: Cuts): [number, number] {
  switch (wall) {
    case 'n': return [c.nw.dx, w - c.ne.dx];
    case 's': return [c.sw.dx, w - c.se.dx];
    case 'w': return [c.nw.dy, l - c.sw.dy];
    default: return [c.ne.dy, l - c.se.dy];
  }
}

/** Đa giác phòng (m), theo chiều kim đồng hồ từ góc trên trái; cùng thuật toán với app (lib/measure/model.dart). */
export function outline(r: Pick<Room, 'x' | 'y' | 'w' | 'l' | 'cuts'>): [number, number][] {
  const c = cornerCuts(r.cuts ?? []);
  const { x, y, w, l } = r;
  const pts: [number, number][] = [];
  const corner = (k: keyof Cuts, cx: number, cy: number, pin: [number, number], mid: [number, number], pout: [number, number]) => {
    if (!c[k].kind) return pts.push([cx, cy]);
    pts.push(pin);
    if (c[k].kind === 'notch') pts.push(mid);
    pts.push(pout);
  };
  corner('nw', x, y, [x, y + c.nw.dy], [x + c.nw.dx, y + c.nw.dy], [x + c.nw.dx, y]);
  corner('ne', x + w, y, [x + w - c.ne.dx, y], [x + w - c.ne.dx, y + c.ne.dy], [x + w, y + c.ne.dy]);
  corner('se', x + w, y + l, [x + w, y + l - c.se.dy], [x + w - c.se.dx, y + l - c.se.dy], [x + w - c.se.dx, y + l]);
  corner('sw', x, y + l, [x + c.sw.dx, y + l], [x + c.sw.dx, y + l - c.sw.dy], [x, y + l - c.sw.dy]);
  return pts;
}

function polygonArea(p: [number, number][]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function polygonPerimeter(p: [number, number][]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}

/** Diện tích từng phòng và tổng: sàn, chu vi, tường (đã trừ cửa). Số liệu để nhà thầu bóc khối lượng. */
export function measurementSummary(data: MeasurementData) {
  const rooms = data.rooms.map((r) => {
    const shape = outline(r);
    const floor = polygonArea(shape);
    const perimeter = polygonPerimeter(shape);
    const openings = r.openings.reduce((s, o) => s + o.width * o.height, 0);
    return {
      id: r.id,
      name: r.name,
      floor_m2: r2(floor),
      perimeter_m: r2(perimeter),
      wall_m2: r2(perimeter * r.h - openings),
      doors: r.openings.filter((o) => o.kind === 'door').length,
      windows: r.openings.filter((o) => o.kind === 'window').length,
    };
  });
  const sum = (k: 'floor_m2' | 'wall_m2' | 'perimeter_m') => r2(rooms.reduce((s, r) => s + r[k], 0));
  return { rooms, floor_m2: sum('floor_m2'), wall_m2: sum('wall_m2'), perimeter_m: sum('perimeter_m') };
}
