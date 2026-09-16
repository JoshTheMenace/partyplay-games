import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE, enemyLabel, formation, overlaps } from '../src/render/formation';
import type { ShipSummary } from '../src/contracts';
const ship = (id: string, faction: ShipSummary['faction'], formationIndex: number, extra: Partial<ShipSummary> = {}): ShipSummary => ({ id, ownerCaptainId: faction === 'allied' ? `cap-${id}` : null, faction, hullId: 'wayfarer', name: id, color: '#4fc6c0', formation: formationIndex, hull: 100, maxHull: 100, status: 'active', shield: 2, weaponIds: ['laser-needle'], alerts: [], rooms: [], crewCount: 4, targetShipId: null, escapeAtMs: null, ...extra });
const fleet = (allies: number, enemies: number) => [...Array.from({ length: allies }, (_, i) => ship(`a${i}`, 'allied', i)), ...Array.from({ length: enemies }, (_, i) => ship(`e${i}`, 'enemy', i, { maxHull: i === 5 ? 400 : 120 }))];
for (const allies of [1, 2, 3, 4]) for (const enemies of [0, 1, 2, 3, 4, 5, 6]) void test(`formation ${allies} allies vs ${enemies} enemies stays inside the stage without overlap`, () => {
  const slots = formation(fleet(allies, enemies));
  assert.equal(slots.length, allies + enemies);
  for (const slot of slots) { assert.ok(slot.x >= 0 && slot.y >= STAGE.top && slot.x + slot.w <= STAGE.w && slot.y + slot.h <= STAGE.h - STAGE.bottom, `${slot.shipId} inside stage`); }
  for (const a of slots) for (const b of slots) if (a !== b) assert.ok(!overlaps(a, b), `${a.shipId} overlaps ${b.shipId}`);
  const allySlots = slots.filter(s => s.faction === 'allied'), enemySlots = slots.filter(s => s.faction === 'enemy');
  assert.ok(allySlots.every(s => s.x + s.w <= 564) && enemySlots.every(s => s.x >= 700), 'allies left, enemies right, firing lane between');
});
void test('enemy labels follow formation order and survive destruction and reordering', () => {
  const ships = fleet(2, 6); ships[2 + 1].status = 'destroyed';
  const shuffled = [...ships].reverse();
  assert.equal(enemyLabel(ships[2 + 3], shuffled), 'E4');
  assert.equal(enemyLabel(ships[2 + 1], shuffled), 'E2', 'destroyed E2 keeps its number');
  assert.equal(enemyLabel(ships[2 + 5], ships), 'E6');
  const slots = formation(shuffled); assert.deepEqual(slots.filter(s => s.faction === 'enemy').map(s => s.label), ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']);
  assert.equal(slots.find(s => s.label === 'E6')?.flagship, true, 'largest hull is drawn as the flagship');
});
void test('maximum fleet uses two columns per side, retaining room-plan space', () => {
  const slots = formation(fleet(4, 6));
  assert.ok(slots.filter(s => s.faction === 'allied').every(s => s.h >= 250 && s.w >= 260));
  assert.ok(slots.filter(s => s.faction === 'enemy').every(s => s.h >= 160 && s.w >= 260));
});
