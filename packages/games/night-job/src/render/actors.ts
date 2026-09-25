/* Thieves, guards, dogs, civilians and intel silhouettes. Rigs are small groups (yaw → pose → parts) built from
 * kit meshes; NPC rigs are pooled because guards appear and vanish with crew sight. */
import { AdditiveBlending, BufferGeometry, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, SRGBColorSpace, type Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ResourceScope } from '../../../../party-runtime/src/index';
import type { Grid } from '../geometry';
import { ROLES, SIGHT, TIMING, type NpcKind, type NpcView, type PlayerView, type Role, type View } from '../model';
import type { Kit } from './kit';
import { coneMaterial, coneMesh, fillCone } from './cones';
import type { Fog } from './fog';
import type { Pose } from './interp';
import { HIP } from './shapes';

/** Base actor scale at the closest framing; index.ts grows it as the camera pulls back. */
export const ACTOR_SCALE = 1.5;
/** Drawn cones match npc.ts perceive(): dogs see like guards (plus a short all-round smell). */
const CONE: Record<NpcKind, { range: number; half: number }> = { guard: { range: SIGHT.guardRange, half: SIGHT.guardHalfAngle }, dog: { range: SIGHT.guardRange, half: SIGHT.guardHalfAngle }, civilian: { range: SIGHT.civilianRange, half: SIGHT.guardHalfAngle } };
const CONE_COLOUR = { calm: new Color('#ffd98a'), alert: new Color('#ff9a2e'), chase: new Color('#ff2e2a'), charmed: new Color('#ff7ad0'), civilian: new Color('#cfe6ff'), stunned: new Color('#6f7f9f') };
/** Cone [fill, edge] alpha per look: calm cones stay subtle, alert and chase escalate. */
const CONE_ALPHA = { calm: [.2, .34], alert: [.24, .5], chase: [.32, .75], charmed: [.12, .3], civilian: [.08, .22] } as const;
const CIVILIAN_TINTS = ['#e0b44c', '#5fa8d8', '#c65b7c', '#7fbf6a', '#b98ae0', '#e08a4c'];
const ease = (from: number, to: number, dt: number, rate: number, reduced: boolean) => reduced ? to : from + (to - from) * (1 - Math.exp(-dt * rate));
const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };

type Rig = { root: Group; yaw: Group; pose: Group; body: Mesh; legs: Group[]; ground: Mesh; phase: number; x: number; y: number; amp: number; down: number; crouch: number };
type Thief = Rig & { ring: Mesh; gold: Mesh; item: Mesh; bird: Mesh | null; mat: MeshLambertMaterial; role: Role; disguised: boolean | null };
type Npc = Rig & { kind: NpcKind; cone: Mesh; aim: Mesh[]; aimAt: number; mat: MeshLambertMaterial; seen: number; drawn: [x: number, y: number, facing: number, grid: number, smoke: number]; drawnState: string };

function disc(scope: ResourceScope, ring = 0) {
  const canvas = document.createElement('canvas'), s = 128; canvas.width = canvas.height = s;
  const g = canvas.getContext('2d')!, grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * .36);
  grad.addColorStop(0, 'rgba(0,0,0,.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(0, 0, s, s);
  if (ring) { g.strokeStyle = '#ffffff'; g.lineWidth = ring; g.beginPath(); g.arc(s / 2, s / 2, s * .4, 0, 7); g.stroke(); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = ring * 2.2; g.stroke(); }
  const t = scope.own(new CanvasTexture(canvas)); t.colorSpace = SRGBColorSpace; return t;
}

export type Actors = ReturnType<typeof createActors>;
export function createActors(kit: Kit, fog: Fog, scope: ResourceScope, coneRoot: Group, objectiveKind: string) {
  const root = new Group(), figures = new Map<string, BufferGeometry>();
  const figure = (...names: string[]) => { const key = names.join('+'); let g = figures.get(key); if (!g) { g = scope.own(mergeGeometries(names.map(n => kit.geometry(n)))!); figures.set(key, g); } return g; };
  const actorMat = (tint?: string) => fog.patch(scope.own(new MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true })), { fog: 0, light: .55, tint });
  const plane = scope.own(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), ringTex = disc(scope, 7), seatTex = disc(scope, 12), blobTex = disc(scope);
  const blobMat = scope.own(new MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
  const aimGeo = scope.own(new PlaneGeometry(1, .14).rotateX(-Math.PI / 2).translate(.5, 0, 0));
  const aimMat = (colour: string, opacity: number, map?: typeof ringTex) => scope.own(new MeshBasicMaterial({ color: colour, opacity, transparent: true, depthWrite: false, depthTest: !map, ...(map && { map }) }));

  function rig(body: BufferGeometry, material: Material, legs: [number, number, number][], legName: string): Rig {
    const r = new Group(), yaw = new Group(), pose = new Group(), mesh = new Mesh(body, material);
    r.scale.setScalar(ACTOR_SCALE); r.add(yaw); yaw.add(pose); pose.add(mesh);
    const legGroups = legs.map(([x, y, z]) => { const g = new Group(); g.position.set(x, y, z); g.add(new Mesh(kit.geometry(legName), material)); pose.add(g); return g; });
    const shadow = new Mesh(plane, blobMat); shadow.position.y = .015; shadow.renderOrder = 1; r.add(shadow);
    root.add(r);
    return { root: r, yaw, pose, body: mesh, legs: legGroups, ground: shadow, phase: 0, x: NaN, y: NaN, amp: 0, down: 0, crouch: 0 };
  }
  const HUMAN_LEGS: [number, number, number][] = [[-HIP.x, HIP.y, 0], [HIP.x, HIP.y, 0]], DOG_LEGS: [number, number, number][] = [[-.075, .22, .16], [.075, .22, .16], [-.075, .22, -.16], [.075, .22, -.16]];

  /** Shared walk/crouch/down animation. Returns distance moved this frame. */
  function animate(r: Rig, pose: Pose, moving: boolean, crouch: number, down: number, dt: number, reduced: boolean, stride = 9) {
    const moved = Number.isNaN(r.x) ? 0 : Math.hypot(pose.x - r.x, pose.y - r.y);
    r.x = pose.x; r.y = pose.y; r.root.position.set(pose.x, 0, pose.y); r.yaw.rotation.y = Math.PI / 2 - pose.facing;
    r.phase += moved * stride; r.amp = ease(r.amp, moving && moved > 1e-4 ? 1 : 0, dt, 12, reduced);
    r.crouch = ease(r.crouch, crouch, dt, 10, reduced); r.down = ease(r.down, down, dt, 8, reduced);
    const swing = reduced ? 0 : Math.sin(r.phase) * .8 * r.amp * (1 - r.down);
    r.legs.forEach((leg, i) => { leg.rotation.x = (i % 2 === (i >> 1) % 2 ? swing : -swing); });
    r.pose.position.y = (reduced ? 0 : Math.abs(Math.cos(r.phase)) * .05 * r.amp) + r.down * .15;
    r.pose.rotation.set(r.crouch * .3 - r.down * Math.PI / 2, 0, 0); r.pose.scale.y = 1 - r.crouch * .16;
    return moved;
  }

  /* thieves */
  const thieves = new Map<string, Thief>();
  const itemGeo = kit.geometry(`obj_${objectiveKind}`), itemMat = fog.patch(scope.own(new MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#6a4a10' })), { fog: 0, light: 0 });
  const birdMat = actorMat(), goldMat = scope.own(new MeshBasicMaterial({ map: seatTex, color: '#ffd24a', transparent: true, depthWrite: false, blending: AdditiveBlending }));
  function thief(p: PlayerView) {
    const mat = actorMat(ROLES[p.role].color), r = rig(figure('thief_torso', 'thief_head', `hat_${p.role}`), mat, HUMAN_LEGS, 'thief_leg');
    const ring = new Mesh(plane, scope.own(new MeshBasicMaterial({ map: seatTex, color: p.color, transparent: true, depthWrite: false })));
    ring.position.y = .02; ring.scale.setScalar(1.1); ring.renderOrder = 1; r.root.add(ring);
    const gold = new Mesh(plane, goldMat); gold.position.y = .025; gold.renderOrder = 1; gold.visible = false; r.root.add(gold);
    r.root.renderOrder = 4; // thieves draw after smoke puffs, so a thief in a cloud stays visible
    const item = new Mesh(itemGeo, itemMat); item.position.set(0, .42, -.05); item.visible = false; r.pose.add(item);
    const bird = p.role === 'magpie' ? new Mesh(kit.geometry('bird'), birdMat) : null; if (bird) r.root.add(bird);
    const t: Thief = { ...r, ring, gold, item, bird, mat, role: p.role, disguised: null }; thieves.set(p.id, t); return t;
  }

  /* NPCs */
  const npcs = new Map<string, Npc>(), free: Record<NpcKind, Npc[]> = { guard: [], dog: [], civilian: [] };
  function npc(n: NpcView): Npc {
    const pooled = free[n.kind].pop();
    if (pooled) { pooled.root.visible = true; pooled.mat.opacity = 0; Object.assign(pooled, { x: NaN, phase: 0, amp: 0, crouch: 0, down: 0, aimAt: NaN, drawnState: '' }); return pooled; }
    // Own material per rig so each NPC fades in and out with the fog edge instead of popping.
    const civ = n.kind === 'civilian', mat = actorMat(civ ? CIVILIAN_TINTS[hash(n.id) % CIVILIAN_TINTS.length] : undefined); mat.opacity = 0;
    const body = n.kind === 'dog' ? figure('dog_body') : civ ? figure('civilian_torso', 'civilian_head') : figure('guard_torso', 'guard_head');
    const r = rig(body, mat, n.kind === 'dog' ? DOG_LEGS : HUMAN_LEGS, n.kind === 'dog' ? 'dog_leg' : 'thief_leg');
    r.ground.material = scope.own(new MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false })); r.ground.scale.setScalar(.9);
    const cone = coneMesh(scope.own(coneMaterial())); scope.own(cone.geometry); coneRoot.add(cone);
    // Aim telegraph: a dim track to the target, a bright bar filling it over TIMING.aim, a reticle closing in.
    const aim = [new Mesh(aimGeo, aimMat('#ff4a3a', .3)), new Mesh(aimGeo, aimMat('#ffe2d8', .95)), new Mesh(plane, aimMat('#ff4a3a', 1, ringTex))];
    aim.forEach((m, i) => { m.renderOrder = 3 + i * 3; m.visible = false; coneRoot.add(m); });
    return { ...r, kind: n.kind, cone, aim, aimAt: NaN, mat, seen: 0, drawn: [0, 0, 0, 0, 0], drawnState: '' };
  }

  /* intel ghosts */
  const ghostMat = scope.own(new MeshBasicMaterial({ color: '#a8ecff', transparent: true, opacity: .55, depthTest: false, depthWrite: false }));
  const ghostRing = scope.own(new MeshBasicMaterial({ map: ringTex, color: '#6fd8ff', transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending }));
  const ghosts: Mesh[] = [];

  let frame = 0;
  return {
    root, thieves,
    sync(view: View | null, poses: ReadonlyMap<string, Pose>, grid: Grid, gridVersion: number, now: number, t: number, dt: number, reduced: boolean, scale: number) {
      frame++;
      for (const p of view?.players ?? []) {
        const v = thieves.get(p.id) ?? thief(p), pose = poses.get(p.id);
        v.root.visible = !p.suspended && !!pose;
        if (!v.root.visible || !pose) continue;
        if (v.disguised !== p.disguised) { v.disguised = p.disguised; v.body.geometry = p.disguised ? figure('guard_torso', 'guard_head', 'hat_impostor') : figure('thief_torso', 'thief_head', `hat_${p.role}`); v.mat.userData.nj.njTint.value.set(p.disguised ? '#ffffff' : ROLES[p.role].color); }
        const working = !!p.work && !p.down; v.root.scale.setScalar(scale);
        animate(v, pose, p.moving, p.moving && !p.running ? 1 : working ? .6 : 0, p.down ? 1 : 0, dt, reduced);
        if (working && !reduced) { v.pose.position.y += Math.abs(Math.sin(t * 14)) * .03; v.pose.rotation.z = Math.sin(t * 9) * .06; } else v.pose.rotation.z = 0;
        v.mat.opacity = p.hidden ? .38 : !p.connected ? .6 : 1; v.mat.depthWrite = !p.hidden;
        (v.ring.material as MeshBasicMaterial).opacity = p.down ? .55 + .45 * Math.sin(t * 8) : p.hidden ? .5 : 1;
        v.item.visible = v.gold.visible = p.carrying; if (p.carrying && !reduced) v.item.rotation.y = t * 1.5;
        if (p.carrying) v.gold.scale.setScalar(1.55 + (reduced ? 0 : .12 * Math.sin(t * 4)));
        if (v.bird) {
          const a = t * 2.1 + p.seat;
          if (reduced) { v.bird.position.set(.2, .78, 0); v.bird.rotation.set(0, 0, 0); v.bird.scale.set(1, 1, 1); }
          else { v.bird.position.set(Math.cos(a) * .75, 1.05 + Math.sin(t * 5) * .07, Math.sin(a) * .75); v.bird.rotation.set(0, -a, Math.sin(t * 18) * .15); v.bird.scale.set(1 + Math.sin(t * 22) * .3, 1, 1); }
        }
      }
      for (const n of view?.npcs ?? []) {
        let v = npcs.get(n.id); if (!v) { v = npc(n); v.down = +(n.state === 'stunned'); npcs.set(n.id, v); }
        const pose = poses.get(n.id); if (!pose) continue;
        v.seen = frame; v.root.scale.setScalar(scale); v.mat.opacity = reduced ? 1 : Math.min(1, v.mat.opacity + dt * 6);
        const stunned = n.state === 'stunned', panic = n.state === 'panic';
        animate(v, pose, n.moving, 0, stunned ? 1 : 0, dt, reduced, n.kind === 'dog' ? 14 : panic ? 13 : 9);
        v.pose.rotation.z = stunned ? Math.PI / 2 * v.down : panic && !reduced ? Math.sin(t * 30) * .08 : 0;
        if (stunned) v.pose.rotation.x = 0;
        // Cone: recomputed only when the NPC, its state, doors or smoke changed.
        const cfg = CONE[n.kind], d = v.drawn, smokeCount = view!.smoke.length;
        const look = n.state === 'chase' ? 'chase' : n.state === 'charmed' || panic ? 'charmed' : n.kind === 'civilian' ? 'civilian' : n.state === 'patrol' ? 'calm' : 'alert', colour = CONE_COLOUR[look];
        v.cone.visible = !stunned;
        if (!stunned && (n.state !== v.drawnState || d[3] !== gridVersion || d[4] !== smokeCount || Math.abs(d[0] - pose.x) + Math.abs(d[1] - pose.y) + Math.abs(d[2] - pose.facing) > .004)) {
          v.drawnState = n.state; d[0] = pose.x; d[1] = pose.y; d[2] = pose.facing; d[3] = gridVersion; d[4] = smokeCount;
          fillCone(v.cone, grid, view!.smoke, now, pose.x, pose.y, pose.facing - cfg.half, pose.facing + cfg.half, cfg.range, colour, .045, CONE_ALPHA[look][0], CONE_ALPHA[look][1]);
        }
        (v.ground.material as MeshBasicMaterial).color.copy(stunned ? CONE_COLOUR.stunned : colour);
        for (const m of v.aim) m.visible = !!n.aiming;
        if (!n.aiming) v.aimAt = NaN;
        else {
          if (Number.isNaN(v.aimAt)) v.aimAt = now;
          const dx = n.aiming.x - pose.x, dz = n.aiming.y - pose.y, len = Math.hypot(dx, dz), k = Math.min(1, (now - v.aimAt) / TIMING.aim), [track, bar, reticle] = v.aim;
          for (const m of [track, bar]) { m.position.set(pose.x, .07, pose.y); m.rotation.y = -Math.atan2(dz, dx); }
          track.scale.set(len, 1, 1); bar.scale.set(Math.max(.01, len * k), 1, 1);
          reticle.position.set(n.aiming.x, .08, n.aiming.y); reticle.scale.setScalar(2.2 - 1.2 * k); reticle.rotation.y = reduced ? 0 : t * 3;
          (reticle.material as MeshBasicMaterial).opacity = reduced ? 1 : .7 + .3 * Math.sin(t * 24);
        }
      }
      for (const [id, v] of npcs) if (v.seen !== frame) {
        v.cone.visible = false; for (const m of v.aim) m.visible = false;
        v.mat.opacity = reduced ? 0 : v.mat.opacity - dt * 6;
        if (v.mat.opacity <= 0) { v.root.visible = false; npcs.delete(id); free[v.kind].push(v); }
      }
      // Intel: ghostly silhouettes seen through walls.
      let g = 0;
      for (const i of view?.intel ?? []) {
        if (i.kind === 'camera' || i.kind === 'laser') continue;
        if (!ghosts[g]) { ghosts[g] = new Mesh(undefined, ghostMat); const ring = new Mesh(plane, ghostRing); ring.position.y = .03; ghosts[g].add(ring); root.add(ghosts[g]); }
        const mesh = ghosts[g];
        if (mesh.userData.kind !== i.kind) { mesh.userData.kind = i.kind; mesh.geometry = i.kind === 'dog' ? figure('dog_body') : i.kind === 'civilian' ? figure('civilian_torso', 'civilian_head') : figure('guard_torso', 'guard_head'); }
        mesh.visible = true; mesh.renderOrder = 4; mesh.position.set(i.x, 0, i.y); mesh.rotation.y = Math.PI / 2 - i.facing; mesh.scale.setScalar(scale); g++;
        mesh.children[0].scale.setScalar(reduced ? 1 : 1 + .15 * Math.sin(t * 4 + g));
      }
      for (; g < ghosts.length; g++) ghosts[g].visible = false;
    },
  };
}
