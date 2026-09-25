/**
 * Module 3D layers without a GPU: no piece of any module ever covers a number token, roads clear
 * city plinths and walls, coast ships sit out at sea, pieces pick their toggles by state, and a
 * moved unit glides through its event path (EXPERIENCE §1.4, §1.5, §6).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Group, InstancedMesh, Matrix4, Vector3 } from 'three';
import { distance } from '../../src/geometry';
import { TRACKS, type PublicView, type Unit } from '../../src/model';
import { FIXTURE_NAMES, loadFixture } from '../fixtures/index';
import { ResourceScope } from '../../../../party-runtime/src/index';
import { boardIndex, edgeLine } from '../../src/ui/shared/board';
import type { Textures } from '../../src/ui/scene/canvas';
import { context } from '../../src/ui/scene/context';
import { coveredTokens } from './coverage';
import type { Kit } from '../../src/ui/scene/kit';
import { materials } from '../../src/ui/scene/materials';
import { modulePlaces } from '../../src/ui/scene/module-places';
import { createPieces } from '../../src/ui/scene/pieces';
import { corePlaces, landTouch } from '../../src/ui/scene/places';
import { procedural } from '../../src/ui/scene/procedural';

const STAGES = [{ width: 1560, height: 980 }, { width: 1240, height: 620 }];
const unit = (id: string, kind: Unit['kind'], at: string, level = 1, seat: string | null = 'p0', active = true,
  cargo: Unit['cargo'] = []): Unit => ({ id, kind, seat, at, level, active, cargo });

/** The 10-seat stress board with every module piece on every spot it could take. */
function crowded(): PublicView {
  const pub = loadFixture('max-10').pub, built = Object.values(pub.pieces.buildings);
  built.filter(b => b.kind === 'city')
    .forEach((b, i) => Object.assign(b, { wall: true, metropolis: TRACKS[i % 3] }));
  const free = pub.board.vertices.filter(v => !pub.pieces.buildings[v.id] && landTouch(pub, v.tiles));
  const edges = pub.board.edges.filter(e => e.land), open = edges.filter(e => !pub.pieces.routes[e.id]);
  const land = pub.board.tiles.filter(t => landTouch(pub, [t.id]));
  const units = [
    ...free.map((v, i) => unit(`k${i}`, 'knight', v.id, 1 + (i % 3), 'p1', i % 2 === 0)),
    ...built.map((b, i) => unit(`w${i}`, 'wagon', b.vertex, 3, 'p2', true, ['glass'])),
    ...open.map((e, i) => unit(`g${i}`, 'guard', e.id, 3, 'p3')),
    ...edges.map((e, i) => unit(`c${i}`, i % 2 ? 'raider' : 'camel', e.id, 0, null)),
    ...land.map((t, i) => unit(`b${i}`, 'barbarian', t.id, 3, null)),
  ];
  pub.pieces.units = Object.fromEntries(units.map(u => [u.id, u]));
  return pub;
}

test('no module piece covers a token on the crowded 10-seat board or any fixture', () => {
  for (const stage of STAGES) {
    const { covered, shapes, scale } = coveredTokens(crowded(), stage);
    assert.ok(shapes > 500, `${shapes} shapes`);
    assert.deepEqual(covered, [], `crowded at ${stage.width} (scale ${scale})`);
    for (const name of FIXTURE_NAMES) {
      assert.deepEqual(coveredTokens(loadFixture(name).pub, stage).covered, [], `${name} ${stage.width}`);
    }
  }
});

test('the merchant and robber share any hex without covering its token', () => {
  const pub = loadFixture('ck-4').pub;
  for (const t of pub.board.tiles.filter(x => x.number > 0)) {
    Object.assign(pub.pieces, { robber: t.id, merchant: { tile: t.id, seat: 'p1' } });
    for (const stage of STAGES) assert.deepEqual(coveredTokens(pub, stage).covered, [], t.id);
  }
});

test('roads stop short of city plinths and walls at both piece scales', () => {
  const pub = crowded(), index = boardIndex(pub.board);
  for (const scale of [1, 1.2]) {
    for (const road of corePlaces(pub, scale).filter(p => p.node === 'road')) {
      const e = index.edges.get(road.id)!;
      const half = (0.54 * scale * (road.stretch ?? 1)) / 2;
      for (const v of [e.a, e.b]) {
        const b = pub.pieces.buildings[v], at = index.vertices.get(v)!, other = v === e.a ? e.b : e.a;
        // The stress board ignores the distance rule; real roads never join two buildings.
        if (!b || b.kind !== 'city' || pub.pieces.buildings[other]) continue;
        const end = distance(at, road) - half, wall = Math.sqrt(0.39 ** 2 - 0.074 ** 2) * scale;
        assert.ok(end >= wall - 0.006 * scale, `${road.id} ends ${end} from the walled city at ${v}`);
      }
    }
  }
});

test('ships on coast edges sit 0.15 wu out to sea', () => {
  const pub = loadFixture('seafarers-4').pub, index = boardIndex(pub.board);
  const coast = corePlaces(pub, 1).filter(p => p.node === 'ship' && index.edges.get(p.id)!.land);
  assert.ok(coast.length > 0);
  for (const ship of coast) {
    const mid = edgeLine(pub.board, ship.id)!.mid;
    assert.ok(Math.abs(distance(mid, ship) - 0.15) < 1e-9, `${ship.id}`);
  }
});

test('pieces pick toggles, colours and riders from their state', () => {
  const pub = loadFixture('ck-4').pub, [v1, v2] = Object.values(pub.pieces.units).map(u => u.at);
  pub.pieces.units = {
    a: unit('a', 'knight', v1, 2, 'p0', false), b: unit('b', 'wagon', v2, 1, 'p1', true, ['marble']),
  };
  const [a, b] = modulePlaces(pub).filter(p => p.id.startsWith('unit:'));
  assert.deepEqual([a.node, a.hide, a.dark], ['knight_2', ['knight_2_active'], true]);
  assert.deepEqual([b.node, b.hide, b.tint], ['wagon', ['level_2', 'level_3'], '#f3f0ea']);
  const x = modulePlaces(loadFixture('explorers-4').pub).find(p => p.id === 'unit:x1')!;
  assert.deepEqual(x.riders!.map(r => r.node), ['settler', 'crew']);
  const ship = modulePlaces(loadFixture('ck-4').pub).find(p => p.node === 'barbarian_ship')!;
  assert.equal(ship.step, 5);
});

function layer() {
  const scope = new ResourceScope(), made = new Map<string, ReturnType<typeof procedural>>();
  const kit: Kit = { modelled: () => false, parts: n => made.get(n) ?? made.set(n, procedural(n)).get(n)! };
  const parent = new Group();
  const pieces = createPieces(context(scope, materials(scope), {} as Textures, kit), parent);
  const at = (node: string) => {
    const geometry = kit.parts(node)[0].geometry, m = new Matrix4();
    let mesh: InstancedMesh | undefined;
    // The first match is the body; its outline hull shares the geometry.
    parent.traverse(o => {
      if (!mesh && o instanceof InstancedMesh && o.geometry === geometry && o.count) mesh = o;
    });
    mesh!.getMatrixAt(0, m);
    return new Vector3().setFromMatrixPosition(m);
  };
  return { pieces, at };
}

test('a moved knight hops through every step of its move events', () => {
  const pub = loadFixture('ck-4').pub, index = boardIndex(pub.board), { pieces, at } = layer();
  const start = pub.pieces.units.u1.at, [mid, end] = (() => {
    const hop = (v: string, not: string[]) => index.vertices.get(v)!.edges.map(e => index.edges.get(e)!)
      .map(e => (e.a === v ? e.b : e.a)).find(n => !not.includes(n) && !pub.pieces.buildings[n])!;
    const m = hop(start, []);
    return [m, hop(m, [start])];
  })();
  const none = { drops: new Set<string>(), moves: new Map(), paths: new Map() };
  pieces.sync(pub, 0, none);
  pieces.frame(0, false);
  const p0 = at('knight_2');
  const units = { ...pub.pieces.units, u1: { ...pub.pieces.units.u1, at: end } };
  const next = { ...pub, pieces: { ...pub.pieces, units } };
  pieces.sync(next, 1000, { ...none, paths: new Map([['unit:u1', [mid, end]]]) });
  const v = (id: string) => index.vertices.get(id)!;
  pieces.frame(1000 + 450, false);
  assert.ok(at('knight_2').distanceTo(new Vector3(v(mid).x, p0.y, v(mid).y)) < 1e-6, 'first step ends mid-path');
  pieces.frame(1000 + 225, false);
  assert.ok(at('knight_2').y > p0.y + 0.1, 'hops mid-step');
  pieces.frame(1000 + 2000, false);
  assert.ok(at('knight_2').distanceTo(new Vector3(v(end).x, p0.y, v(end).y)) < 1e-6, 'arrives');
});

test('a fresh build event drops the new piece in; reduced motion places it at once', () => {
  const pub = loadFixture('ck-4').pub, { pieces, at } = layer(), spot = pub.pieces.units.u2.at;
  const without = { ...pub, pieces: { ...pub.pieces, units: { u1: pub.pieces.units.u1 } } };
  const none = { drops: new Set<string>(), moves: new Map(), paths: new Map() };
  pieces.sync(without, 0, none);
  pieces.sync(pub, 100, { ...none, drops: new Set([spot]) });
  pieces.frame(150, false);
  assert.ok(at('knight_1').y > 0.5, 'still falling');
  pieces.frame(160, true);
  assert.ok(Math.abs(at('knight_1').y - 0.3) < 1e-6, 'landed');
});
