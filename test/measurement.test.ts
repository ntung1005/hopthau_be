import assert from 'node:assert/strict';
import { test } from 'node:test';
import { measurementSummary, parseMeasurement } from '../src/measurement.ts';

const room = {
  id: 'r1', name: 'Phòng khách', type: 'living', x: 0, y: 0, w: 4, l: 5, h: 2.8,
  openings: [
    { wall: 's', kind: 'door', offset: 0.5, width: 0.9, height: 2.1 },
    { wall: 'e', kind: 'window', offset: 1, width: 1.2, height: 1.4, sill: 0.9 },
  ],
};

test('tính diện tích sàn, tường trừ cửa, chu vi', () => {
  const s = measurementSummary(parseMeasurement({ rooms: [room, { ...room, id: 'r2', openings: [] }] }));
  assert.deepEqual(s.rooms[0], { id: 'r1', name: 'Phòng khách', floor_m2: 20, perimeter_m: 18, wall_m2: 46.83, doors: 1, windows: 1 });
  assert.equal(s.floor_m2, 40);
  assert.equal(s.wall_m2, 97.23);
  assert.equal(s.perimeter_m, 36);
});

test('làm tròn 1 cm, loại phòng lạ thành other', () => {
  const d = parseMeasurement({ rooms: [{ ...room, w: 3.14159, type: 'garage', openings: [] }] });
  assert.equal(d.rooms[0].w, 3.14);
  assert.equal(d.rooms[0].type, 'other');
});

test('từ chối số đo vô lý', () => {
  const bad: [unknown, string][] = [
    [{ rooms: [] }, 'missing_rooms'],
    [{ rooms: [{ ...room, w: 0 }] }, 'invalid_room_width'],
    [{ rooms: [{ ...room, h: 10 }] }, 'invalid_room_height'],
    [{ rooms: [room, room] }, 'invalid_room_id'],
    [{ rooms: [{ ...room, openings: [{ wall: 's', kind: 'door', offset: 3.5, width: 0.9, height: 2.1 }] }] }, 'invalid_opening_offset'],
    [{ rooms: [{ ...room, openings: [{ wall: 'e', kind: 'window', offset: 0, width: 1, height: 1.5, sill: 2 }] }] }, 'invalid_opening_sill'],
    [{ rooms: [{ ...room, openings: [{ wall: 'x', kind: 'door', offset: 0, width: 1, height: 2 }] }] }, 'invalid_openings'],
  ];
  for (const [input, code] of bad) assert.throws(() => parseMeasurement(input), { code }, code);
});

test('cắt góc: cắt vuông không đổi chu vi, cắt chéo vát cạnh, diện tích theo đa giác', () => {
  const notch = { corner: 'nw', kind: 'notch', dx: 0.5, dy: 0.6 };
  const chamfer = { corner: 'se', kind: 'chamfer', dx: 1, dy: 1 };
  const s = measurementSummary(parseMeasurement({ rooms: [{ ...room, openings: [], cuts: [notch, chamfer] }] }));
  assert.equal(s.floor_m2, 20 - 0.3 - 0.5);
  assert.equal(s.perimeter_m, Math.round((18 - 2 + Math.SQRT2) * 100) / 100);
  assert.equal(s.rooms[0].wall_m2, Math.round((18 - 2 + Math.SQRT2) * 2.8 * 100) / 100);
});

test('cắt góc: cửa không nằm trong đoạn tường đã cắt, góc không chồng nhau', () => {
  const notch = { corner: 'nw', kind: 'notch', dx: 0.5, dy: 0.6 };
  const bad: [unknown, string][] = [
    [{ rooms: [{ ...room, cuts: [notch], openings: [{ wall: 'n', kind: 'door', offset: 0.2, width: 0.9, height: 2.1 }] }] }, 'invalid_opening_offset'],
    [{ rooms: [{ ...room, cuts: [notch], openings: [{ wall: 'w', kind: 'door', offset: 0.3, width: 0.9, height: 2.1 }] }] }, 'invalid_opening_offset'],
    [{ rooms: [{ ...room, openings: [], cuts: [notch, { ...notch, corner: 'ne', dx: 3.5 }] }] }, 'invalid_cut_size'],
    [{ rooms: [{ ...room, openings: [], cuts: [notch, notch] }] }, 'invalid_cuts'],
    [{ rooms: [{ ...room, openings: [], cuts: [{ ...notch, dx: 4 }] }] }, 'invalid_cut_size'],
  ];
  for (const [input, code] of bad) assert.throws(() => parseMeasurement(input), { code }, code);
  // Cửa ngay sau đoạn cắt thì hợp lệ.
  assert.doesNotThrow(() => parseMeasurement({ rooms: [{ ...room, cuts: [notch], openings: [{ wall: 'n', kind: 'door', offset: 0.5, width: 0.9, height: 2.1 }] }] }));
});

