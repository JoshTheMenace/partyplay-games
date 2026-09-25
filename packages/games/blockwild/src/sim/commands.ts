/** Command queue execution: every command with n > ack runs once, in order; rejected ones still advance ack. */
import { B, blockOf, cellId, cellState, chestLoot, DOOR_OPEN, DOOR_UPPER, isAir, isLiquid, makeCell } from '../shared/blocks';
import { EDIT_LIMIT_TOAST, EYE_HEIGHT, MAX_FOOD, REACH, SNEAK_EYE_HEIGHT } from '../shared/constants';
import { cellIndex, FACES, lookVector, type Vec3 } from '../shared/coords';
import { addItem, removeItem, takeOne } from '../shared/inventory';
import { armorOf, attackDamage, durabilityOf, I, isItem, itemOf, maxStack, placesBlock } from '../shared/items';
import { breakTime, drops as miningDrops } from '../shared/mining';
import { bodyBox } from '../shared/physics';
import { BOW_MIN_SECONDS, bowPower, bucketTarget, bucketUse, canSurvive, EAT_SECONDS, isHoe, isPathable, isShovel, isTillable, placementFor } from '../shared/placement';
import { IF, MOB, mobBox, type Cmd, type Input } from '../shared/protocol';
import { craftFromInventory, recipeById } from '../shared/recipes';
import { collisionBoxes } from '../shared/shapes';
import { equip } from './armor';
import { damageMob, exhaust, mobState, spawnArrow } from './combat';
import { celebrate, chestSlots, click, closeScreen, furnaceAt, MAX_CHESTS, MAX_FURNACES, openScreen } from './containers';
import { spawnItem } from './entities';
import { applyBoneMeal } from './growth';
import { foodFor } from './mobs';
import { deflectFireball } from './nether-mobs';
import { respawn, useBed, wake } from './players';
import { tryIgnite } from './portals';
import { primeTnt, useRedstoneBlock } from './redstone';
import { addFx, boxDist2, toast, type Player, type State } from './state';
import { openLootChest } from './structures';
import { openTrade, runTrade } from './villagers';
import { breakBlock, writeCell, writeCells } from './world';

/** Latency allowance added to the reach distance. */
const REACH_SLACK = 0.75, ATTACK_GAP = 0.15;

export const eyeOf = (player: Player): Vec3 => [player.x, player.y + (player.sneaking ? SNEAK_EYE_HEIGHT : EYE_HEIGHT), player.z];
function inReach(state: State, player: Player, box: readonly number[]) {
  const [ex, ey, ez] = eyeOf(player), reach = REACH[state.settings.mode] + REACH_SLACK;
  return boxDist2(ex, ey, ez, box) <= reach * reach;
}
const reachesBlock = (state: State, player: Player, x: number, y: number, z: number) => inReach(state, player, [x, y, z, x + 1, y + 1, z + 1]);
const survival = (state: State) => state.settings.mode === 'survival';

/** Wear the tool in an inventory slot; it breaks at its durability. No wear in creative. */
export function wearTool(state: State, player: Player, slot: number, amount: number) {
  const stack = player.inv[slot], max = stack ? durabilityOf(stack.id) : 0;
  if (!stack || !max || !survival(state)) return;
  const d = (stack.d ?? 0) + amount;
  player.inv[slot] = d >= max ? null : { id: stack.id, n: stack.n, d };
}
/** Consume one of the item in a slot (survival only). */
function consume(state: State, player: Player, slot: number) {
  if (survival(state)) player.inv[slot] = takeOne(player.inv[slot] ?? null);
}

export function runCommands(state: State, player: Player, input: Input) {
  for (const cmd of input.cmds) {
    if (cmd.n <= player.ack) continue;
    player.ack = cmd.n;
    runCommand(state, player, cmd);
  }
}

/** Execute one command; false when rejected (the client's optimistic change then reverts on the next snapshot). */
export function runCommand(state: State, player: Player, cmd: Cmd): boolean {
  if (player.dead) {
    if (cmd.t === 'respawn') return respawn(state, player);
    if (cmd.t === 'close') closeScreen(state, player);
    return cmd.t === 'close';
  }
  if (cmd.t === 'wake') return wake(state, player);
  if (player.sleeping && cmd.t !== 'close' && cmd.t !== 'click') return false;
  switch (cmd.t) {
    case 'break': return breakCommand(state, player, cmd.x, cmd.y, cmd.z);
    case 'place': return placeCommand(state, player, cmd);
    case 'use': return useCommand(state, player, cmd.x, cmd.y, cmd.z, cmd.face);
    case 'useItem': return useItemCommand(state, player, cmd.slot);
    case 'attack': return attackCommand(state, player, cmd.id);
    case 'interact': return interactCommand(state, player, cmd.id);
    case 'click': return click(state, player, cmd.w, cmd.i, cmd.b);
    case 'craft': return craftCommand(state, player, cmd.r, cmd.max === true);
    case 'close':
      if (player.sleeping) wake(state, player);
      else closeScreen(state, player);
      return true;
    case 'drop': return dropCommand(state, player, cmd.slot, cmd.all === true);
    case 'respawn': return false;
    case 'creative': return creativeCommand(state, player, cmd.id, cmd.slot);
    case 'trade': return player.screen?.kind === 'trade' && runTrade(state, player, cmd.i, cmd.max === true);
  }
}

/**
 * Survival breaks need `breakTime * 0.6 - 0.15` s of mining the same block (tracked from Input.mine); creative breaks
 * are instant but rate-limited to 5/s by a token bucket.
 */
function breakCommand(state: State, player: Player, x: number, y: number, z: number): boolean {
  const cell = state.get(x, y, z), block = blockOf(cell);
  if (!block.targetable || block.hardness < 0 || !reachesBlock(state, player, x, y, z)) return false;
  const held = player.inv[player.slot]?.id ?? 0;
  if (!survival(state)) {
    if (player.breakTokens < 1) return false;
    player.breakTokens--;
    if (!breakBlock(state, x, y, z, [])) return limitReached(player);
  } else {
    const mine = player.mine, same = mine && mine.x === x && mine.y === y && mine.z === z;
    const elapsed = same ? state.clock - mine.start : 0;
    if (elapsed < breakTime(cell, held, true, false) * 0.6 - 0.15) return false;
    if (!breakBlock(state, x, y, z, miningDrops(cell, held, state.rand))) return limitReached(player);
    if (block.hardness > 0) wearTool(state, player, player.slot, itemOf(held)?.tool?.kind === 'sword' ? 2 : 1);
    exhaust(player, 0.005);
  }
  player.mine = null;
  player.swing++;
  player.stats.mined++;
  state.stats.mined++;
  return true;
}
function limitReached(player: Player) {
  toast(player, EDIT_LIMIT_TOAST);
  return false;
}

/** Placement via the shared rules, refusing cells that would overlap a player or mob. */
function placeCommand(state: State, player: Player, cmd: Extract<Cmd, { t: 'place' }>): boolean {
  const stack = player.inv[cmd.slot];
  if (!stack || !reachesBlock(state, player, cmd.x, cmd.y, cmd.z)) return false;
  const hit = cmd.hy === undefined ? { x: cmd.x, y: cmd.y, z: cmd.z, face: cmd.face } : { x: cmd.x, y: cmd.y, z: cmd.z, face: cmd.face, hy: cmd.hy };
  const writes = placementFor({ getCell: state.get }, stack.id, hit, player.yaw, player.pitch);
  if (!writes) return false;
  const block = placesBlock(stack.id);
  if (block === B.chest && state.chests.size >= MAX_CHESTS) { toast(player, 'This world has too many chests.'); return false; }
  if (block === B.furnace && state.furnaces.size >= MAX_FURNACES) { toast(player, 'This world has too many furnaces.'); return false; }
  const bodies: (readonly number[])[] = [
    ...state.players.filter(p => !p.dead).map(p => bodyBox(p)),
    ...state.mobs.filter(mob => mob.health > 0).map(mob => mobBox({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, s: mobState(mob) })),
  ];
  for (const [x, y, z, value] of writes) for (const b of collisionBoxes(value)) {
    const box = [x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]];
    if (bodies.some(body => box[0]! < body[3]! - 1e-3 && box[3]! > body[0]! + 1e-3 && box[1]! < body[4]! - 1e-3 && box[4]! > body[1]! + 1e-3 && box[2]! < body[5]! - 1e-3 && box[5]! > body[2]! + 1e-3)) return false;
  }
  if (!writeCells(state, writes)) return limitReached(player);
  const [x, y, z, value] = writes[0]!;
  if (block === B.chest) chestSlots(state, cellIndex(x, y, z));
  if (block === B.furnace) furnaceAt(state, cellIndex(x, y, z));
  consume(state, player, cmd.slot);
  addFx(state, 'place', x + 0.5, y + 0.5, z + 0.5, value);
  player.swing++;
  player.stats.placed++;
  state.stats.placed++;
  return true;
}

/**
 * Fill or empty the bucket in `slot` at (x, y, z) with the shared rules (water and lava, obsidian where they meet, no
 * water in the Nether). A filled bucket from a stack of empties goes to the inventory (or drops).
 */
function useBucket(state: State, player: Player, slot: number, x: number, y: number, z: number): boolean {
  const stack = player.inv[slot], use = stack && bucketUse({ getCell: state.get }, stack.id, x, y, z);
  if (!stack || !use) return false;
  if (!writeCells(state, use.writes)) return limitReached(player);
  if (survival(state)) {
    if (stack.n <= 1) player.inv[slot] = { id: use.item, n: 1 };
    else {
      player.inv[slot] = { id: stack.id, n: stack.n - 1 };
      if (addItem(player.inv, use.item, 1) > 0) spawnItem(state, player.x, player.y + 1, player.z, { id: use.item, n: 1 }, { owner: player.id, delay: 1.5 });
    }
  }
  addFx(state, use.fx, x + 0.5, y + 0.5, z + 0.5);
  return true;
}

/** Flint and steel: prime tnt, light a portal frame, or set fire to the cell across the clicked face. */
function strike(state: State, player: Player, x: number, y: number, z: number, face: number): boolean {
  const [dx, dy, dz] = FACES[face]!, tx = x + dx, ty = y + dy, tz = z + dz;
  let lit = cellId(state.get(x, y, z)) === B.tnt ? primeTnt(state, x, y, z) : tryIgnite(state, tx, ty, tz);
  if (!lit && isAir(state.get(tx, ty, tz)) && canSurvive({ getCell: state.get }, tx, ty, tz, B.fire)) {
    if (!writeCell(state, tx, ty, tz, B.fire)) return limitReached(player);
    lit = true;
  }
  if (!lit) return false;
  wearTool(state, player, player.slot, 1);
  addFx(state, 'ignite', tx + 0.5, ty + 0.5, tz + 0.5);
  player.swing++;
  return true;
}

/** Right-click on a block: open stations, sleep, toggle doors, redstone controls, till, paths, bone meal, fire, buckets. */
function useCommand(state: State, player: Player, x: number, y: number, z: number, face: number): boolean {
  if (!reachesBlock(state, player, x, y, z)) return false;
  const cell = state.get(x, y, z), id = cellId(cell), held = player.inv[player.slot]?.id ?? 0;
  if (!player.sneaking || !held) {
    switch (id) {
      case B.crafting_table: openScreen(state, player, 'table', x, y, z); return true;
      case B.furnace: case B.furnace_lit: openScreen(state, player, 'furnace', x, y, z); return true;
      case B.chest:
        if (chestLoot(cellState(cell))) openLootChest(state, x, y, z);
        openScreen(state, player, 'chest', x, y, z);
        return true;
      case B.lever: case B.stone_button: case B.oak_button: case B.repeater: return useRedstoneBlock(state, player, x, y, z);
      case B.bed: return useBed(state, player, x, y, z);
      case B.oak_door: {
        const lowerY = cellState(cell) & DOOR_UPPER ? y - 1 : y, lower = state.get(x, lowerY, z), upper = state.get(x, lowerY + 1, z);
        const open = (cellState(lower) & DOOR_OPEN) === 0;
        const flip = (door: number) => makeCell(B.oak_door, open ? cellState(door) | DOOR_OPEN : cellState(door) & ~DOOR_OPEN);
        if (!writeCells(state, [[x, lowerY, z, flip(lower)], [x, lowerY + 1, z, flip(upper)]])) return limitReached(player);
        addFx(state, 'door', x + 0.5, lowerY + 1, z + 0.5, open ? 1 : 0);
        return true;
      }
    }
  }
  if (isHoe(held)) {
    if (!isTillable(id) || !isAir(state.get(x, y + 1, z))) return false;
    if (!writeCell(state, x, y, z, B.farmland)) return limitReached(player);
    wearTool(state, player, player.slot, 1);
    addFx(state, 'place', x + 0.5, y + 1, z + 0.5, B.farmland);
    return true;
  }
  if (isShovel(held) && isPathable(id)) {
    if (!isAir(state.get(x, y + 1, z)) || !writeCell(state, x, y, z, B.dirt_path)) return false;
    wearTool(state, player, player.slot, 1);
    addFx(state, 'place', x + 0.5, y + 1, z + 0.5, B.dirt_path);
    return true;
  }
  if (held === I.bone_meal) {
    if (!applyBoneMeal(state, x, y, z)) return false;
    consume(state, player, player.slot);
    return true;
  }
  if (held === I.flint_and_steel) return strike(state, player, x, y, z, face);
  if (held === I.bucket || held === I.water_bucket || held === I.lava_bucket) return useBucket(state, player, player.slot, ...bucketTarget({ getCell: state.get }, held, { x, y, z, face }));
  return false;
}

/** First water or lava cell along the look ray within reach, stopping at solid blocks. */
function liquidInSight(state: State, player: Player): Vec3 | null {
  const eye = eyeOf(player), dir = lookVector(player.yaw, player.pitch), reach = REACH[state.settings.mode];
  for (let t = 0; t <= reach; t += 0.1) {
    const x = Math.floor(eye[0] + dir[0] * t), y = Math.floor(eye[1] + dir[1] * t), z = Math.floor(eye[2] + dir[2] * t), cell = state.get(x, y, z);
    if (isLiquid(cell)) return [x, y, z];
    if (blockOf(cell).targetable) return null;
  }
  return null;
}

/** Finish a held use: eat (after EAT_SECONDS of holding), release a bow, or fill a bucket from water in sight. */
function useItemCommand(state: State, player: Player, slot: number): boolean {
  const stack = player.inv[slot];
  if (!stack) return false;
  const item = itemOf(stack.id), held = player.useStart < 0 ? 0 : state.clock - player.useStart;
  if (item?.food) {
    if (player.food >= MAX_FOOD && stack.id !== I.golden_apple && survival(state)) return false;
    if (held < EAT_SECONDS - 0.4) return false;
    player.food = Math.min(MAX_FOOD, player.food + item.food.hunger);
    player.saturation = Math.min(player.food, player.saturation + item.food.saturation);
    if (stack.id === I.golden_apple) player.health = Math.min(20, player.health + 4);
    consume(state, player, slot);
    player.useStart = state.clock;
    addFx(state, 'eat', player.x, player.y + 1.4, player.z, stack.id);
    return true;
  }
  if (stack.id === I.bow) {
    if (held < BOW_MIN_SECONDS) return false;
    if (survival(state) && !removeItem(player.inv, I.arrow, 1)) return false;
    const power = bowPower(held), dir = lookVector(player.yaw, player.pitch), eye = eyeOf(player), speed = 50 * power;
    const damage = Math.max(1, Math.ceil(power * 6)) + (power >= 1 ? 1 + Math.floor(state.rand() * 3) : 0);
    spawnArrow(state, eye[0] + dir[0] * 0.5, eye[1] + dir[1] * 0.5 - 0.1, eye[2] + dir[2] * 0.5, dir[0] * speed, dir[1] * speed, dir[2] * speed, damage, player.id, survival(state));
    wearTool(state, player, slot, 1);
    player.useStart = -1;
    player.swing++;
    return true;
  }
  if (stack.id === I.bucket) {
    const liquid = liquidInSight(state, player);
    return !!liquid && useBucket(state, player, slot, ...liquid);
  }
  if (armorOf(stack.id)) return equip(state, player, slot);
  return false;
}

function attackCommand(state: State, player: Player, id: number): boolean {
  const mob = state.mobs.find(m => m.id === id && m.health > 0);
  if (!mob) return deflectFireball(state, player, id);
  if (state.clock - player.attackAt < ATTACK_GAP) return false;
  if (!inReach(state, player, mobBox({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, s: mobState(mob) }))) return false;
  const held = player.inv[player.slot]?.id ?? 0, crit = !player.onGround && player.fallPeak > player.y + 0.1;
  const damage = attackDamage(held) * (crit ? 1.5 : 1);
  player.attackAt = state.clock;
  damageMob(state, mob, damage, player, { x: player.x, z: player.z, strength: 6, up: 4.5 });
  if (itemOf(held)?.tool) wearTool(state, player, player.slot, itemOf(held)!.tool!.kind === 'sword' ? 1 : 2);
  exhaust(player, 0.1);
  player.swing++;
  addFx(state, 'hit', mob.x, mob.y + 0.6, mob.z, crit ? 1 : 0);
  return true;
}

/** Shear sheep, feed babies (grow 10% faster) and put adults in love (30 s) to breed. */
function interactCommand(state: State, player: Player, id: number): boolean {
  const mob = state.mobs.find(m => m.id === id && m.health > 0);
  if (!mob || !inReach(state, player, mobBox({ t: mob.t, x: mob.x, y: mob.y, z: mob.z, s: mobState(mob) }))) return false;
  const held = player.inv[player.slot]?.id ?? 0;
  if (mob.t === MOB.villager) return openTrade(state, player, mob);
  if (held === I.shears && mob.t === MOB.sheep && !mob.sheared && mob.baby <= 0) {
    mob.sheared = true;
    spawnItem(state, mob.x, mob.y + 1, mob.z, { id: B.white_wool, n: 1 + Math.floor(state.rand() * 3) }, { scatter: true });
    wearTool(state, player, player.slot, 1);
    player.swing++;
    return true;
  }
  if (!foodFor(mob.t).includes(held)) return false;
  if (mob.baby > 0) mob.baby *= 0.9;
  else if (state.clock >= mob.breedAt && state.clock >= mob.loveUntil) mob.loveUntil = state.clock + 30;
  else return false;
  consume(state, player, player.slot);
  addFx(state, 'eat', mob.x, mob.y + 0.8, mob.z, held);
  player.swing++;
  return true;
}

/** Crafting table within 4 blocks of the player. */
function nearTable(state: State, player: Player): boolean {
  if (player.screen?.kind === 'table') return true;
  const px = Math.floor(player.x), py = Math.floor(player.y + 1), pz = Math.floor(player.z);
  for (let dy = -4; dy <= 4; dy++) for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
    if (cellId(state.get(px + dx, py + dy, pz + dz)) === B.crafting_table) return true;
  }
  return false;
}
function craftCommand(state: State, player: Player, recipeId: string, max: boolean): boolean {
  const recipe = recipeById(recipeId);
  if (!recipe) return false;
  const times = craftFromInventory(player.inv, recipeId, !recipe.table || nearTable(state, player), max);
  if (!times) return false;
  player.stats.crafted += times;
  state.stats.crafted += times;
  addFx(state, 'craft', player.x, player.y + 1, player.z, recipe.out.id);
  celebrate(state, player, recipe.out.id);
  return true;
}

function dropCommand(state: State, player: Player, slot: number, all: boolean): boolean {
  const stack = player.inv[slot];
  if (!stack) return false;
  const n = all ? stack.n : 1, dir = lookVector(player.yaw, player.pitch), eye = eyeOf(player);
  player.inv[slot] = stack.n > n ? { ...stack, n: stack.n - n } : null;
  spawnItem(state, eye[0], eye[1] - 0.3, eye[2], { ...stack, n }, { vx: dir[0] * 5, vy: dir[1] * 5 + 1.5, vz: dir[2] * 5, owner: player.id });
  return true;
}

function creativeCommand(state: State, player: Player, id: number, slot: number): boolean {
  if (survival(state) || !isItem(id)) return false;
  player.inv[slot] = { id, n: maxStack(id) };
  return true;
}

/** Track the mining target, the use hold and continuous swinging from the held input (after commands ran). */
export function updateHolds(state: State, player: Player, input: Input) {
  const mine = player.dead || player.sleeping ? null : input.mine;
  if (!mine) player.mine = null;
  else if (!player.mine || player.mine.x !== mine[0] || player.mine.y !== mine[1] || player.mine.z !== mine[2]) player.mine = { x: mine[0], y: mine[1], z: mine[2], start: state.clock };
  if (input.f & IF.USING && !player.dead) {
    if (player.useStart < 0) player.useStart = state.clock;
  } else player.useStart = -1;
  if (input.f & IF.SWINGING && state.clock - player.swingAt >= 0.25) {
    player.swing++;
    player.swingAt = state.clock;
  }
}
