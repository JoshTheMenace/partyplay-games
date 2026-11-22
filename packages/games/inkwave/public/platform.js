import * as THREE from 'three';
import { G, on, emit } from './engine/core/ctx.js';
import { Game } from './engine/main.js';
import { Renderer } from './engine/core/renderer.js';
import { Input } from './engine/core/input.js';
import { TouchControls, isTouchDevice } from './engine/core/touch.js';
import { PlayerController } from './engine/game/player.js';
import { HUD } from './engine/ui/hud.js';
import { DioramaOverlay } from './engine/ui/diorama.js';
import { DEFAULT_SETTINGS, QUALITY, MAPS, mapTheme, TEAM_PALETTES, WEAPON_ORDER, PLAYER, mapNoBots } from './engine/config.js';
import { Character } from './engine/game/character.js';
import { Match } from './engine/game/match.js';
import { CameraRig } from './engine/game/cameraRig.js';
import { Projectiles } from './engine/game/weapons.js';
import { SubSystem } from './engine/game/subs.js';
import { SpecialSystem } from './engine/game/specials.js';
import { NetMatch } from './engine/net/netmatch.js';
import { PropKit } from './engine/world/props.js';
import { Environment } from './engine/world/environment.js';
import { createMuralTexture } from './engine/world/murals.js';
import { createTextureLibrary } from './engine/world/texlib.js';
import { FX } from './engine/fx/fx.js';
import { initFxHooks } from './engine/fx/fxHooks.js';
import { ZoneMarks } from './engine/fx/zoneMarks.js';
import { AudioEngine } from './engine/audio/audio.js';
import { dealArenas, unpackInk } from './arenas.js';

const channel = 'partyplay-inkwave', query = new URLSearchParams(location.search), roundId = query.get('round');
const tell = (type, data = {}) => parent.postMessage({ channel, roundId, type, ...data }, location.origin);
const fail = error => { if (stopped) return; document.getElementById('loading').textContent = `Unable to load Inkwave: ${error.message || error}`; tell('error', { message: String(error.message || error) }); };
// `arena` is the one this screen draws: a phone's own, or whichever the TV broadcast is on. `baseline` is its latest paint
// grid; `dirty` means events were missed since, so the next baseline repaints the stage.
let game, net, local, settings, rosters, arena = 0, feed, latest, baseline, lastEvent = 0, painted = false, dirty = false, cutting = false, quiet = false, stopped = false, frame, held = {}, lastCount = 99, tags, splatted, respawned;
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));

/** The original match objects for one arena's roster. The TV calls this again each time its broadcast cuts to another arena. */
async function mount(index) {
  if (game.match) { net.dispose(); game.zoneMarks.dispose(); game.match.dispose(); G.projectiles.clear(); G.subs.clear(); G.specials.clear(); G.fx.clear(); G.paint.clear(); }
  arena = index; feed = null; baseline = null; lastEvent = 0; painted = dirty = false; lastCount = 99;
  game.match = G.match = new Match({ roster: rosters[index], myId: 'viewer', host: false, CharacterClass: Character, duration: settings.duration, mode: settings.mode });
  game.match.setup(); await game.match.boss?.model.ready;
  net = new NetMatch({ myId: 'viewer', hostId: 'server', isHost: false, _members: new Map([['server', {}]]) }, { map: settings.map }); net.bind(game.match);
  game.zoneMarks = new ZoneMarks(G.scene); game.zoneMarks.build(game.match);
  tags?.replaceChildren(...G.actors.map((actor, nid) => Object.assign(document.createElement('span'), { textContent: actor.name, className: rosters[index][nid].bot ? 'is-cpu' : '', style: `--team:${G.teamHex[actor.team]}` })));
}

async function boot({ settings: chosen, players, playerId }) {
  settings = chosen;
  game = new Game(); game.touchMode = !!playerId && isTouchDevice(); game.settings = G.settings = { ...DEFAULT_SETTINGS, quality: 'low', mobilePerformance: isTouchDevice(), shadows: false, music: 0, cameraShake: 0, touchControls: game.touchMode ? 'on' : 'off' };
  document.body.classList.toggle('party-touch', game.touchMode); document.body.classList.toggle('party-tv', !playerId);
  G.audio = new AudioEngine({ music: false });
  const volume = () => { let muted = false; try { muted = localStorage.getItem('party.sound.muted') === 'true'; } catch {} G.audio.setVolumes({ master: muted ? 0 : .7, sfx: .8, music: 0 }); };
  volume(); addEventListener('storage', volume);
  for (const event of ['pointerdown', 'keydown']) addEventListener(event, () => G.audio.init(), { once: true });
  game.memK = .5; game.PropKit = PropKit;
  game.R = new Renderer(document.getElementById('app'), game.settings);
  G.renderer = game.R.renderer; G.scene = new THREE.Scene(); G.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, .15, 6500);
  game.R.setScene(G.scene, G.camera); G.renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('Graphics context lost. Return to the lobby and retry.')); });
  const map = MAPS.find(map => map.id === settings.map), quality = QUALITY[game.settings.quality];
  game.theme = mapTheme(map, settings.time); game.time = settings.time;
  game.murals = await createMuralTexture(); game.texlib = await createTextureLibrary(G.renderer, { size: 128 });
  await game._buildWorld(map, settings.mode);
  G.env = new Environment(G.renderer, G.scene, { bounds: G.level.bounds, theme: game.theme, shadowSize: quality.shadowSize, footprint: game._footprint(G.level), forceDeckField: true });
  if (G.env.envMap) G.scene.environment = G.env.envMap;
  G.projectiles = new Projectiles(G.scene); G.subs = new SubSystem(G.scene); G.specials = new SpecialSystem(G.scene); G.fx = new FX(G.scene, { quality });
  game._setPalette(TEAM_PALETTES[0]); game._applyNight();
  game.rig = G.rig = new CameraRig(G.camera); G.post = game.R; G.game = game;
  rosters = dealArenas(players, settings, WEAPON_ORDER, mapNoBots(settings.map));
  const seat = players.findIndex(player => player.id === playerId), mine = rosters.flat().find(entry => entry.seat === seat && seat >= 0);
  if (!mine) { tags = document.createElement('div'); tags.className = 'iw-tv-tags'; document.getElementById('ui-root').append(tags); }
  await mount(mine ? mine.arena : latest?.arena ?? 0);
  local = mine ? G.actors[mine.nid] : null;
  game.match.local = G.local = local;
  game.fxHooks = initFxHooks(G);
  if (local) {
    game.minimap.setViewerTeam(local.team);
    local.isLocal = true; game.rig.yaw = local.team ? Math.PI : 0; game.rig.pitch = -.12; game.rig.follow(local, true);
    game.input = G.input = new Input(G.renderer.domElement); game.input.setTouchMode(game.touchMode);
    game.match.controller = new PlayerController(local, game.rig, game.input);
    local.superJump = target => { tell('action', { action: { turnId: roundId, type: 'superjump', target: target.nid ?? -1 } }); return true; };
    G.subs.jumpToBeacon = (actor, beacon) => { tell('action', { action: { turnId: roundId, type: 'beacon', target: beacon.gid } }); return true; };
    G.specials.aimConfirm = actor => { const special = actor.specialActive; if (special?.aiming) tell('action', { action: { turnId: roundId, type: 'strike', x: special.target.x, z: special.target.z } }); };
    game.hud = G.hud = new HUD(document.getElementById('ui-root')); game.hud.setVisible(true); if (game.match.boss) game.hud.boss?._spawn(game.match.boss); game._hintT = 0; game._hints = {};
    const updateHud = game.hud.update.bind(game.hud);
    game.hud.update = (dt, data) => {
      const turf = feed?.stats[local.nid][0] || 0;
      game.hud._turfAcc += Math.max(0, turf - game.hud._turfTotal); game.hud._turfTotal = turf;
      updateHud(dt, { ...data, prompt: game.touchMode ? data.prompt?.replaceAll('SHIFT', 'SQUID').replace('Press F', 'Tap SP').replace('press C', 'tap YEAH') : data.prompt });
    };
    game.diorama = new DioramaOverlay(game.hud.el);
    if (game.touchMode) { game.touch = G.touch = new TouchControls(game.input); game.touch.mount(document.getElementById('ui-root')); }
    else G.renderer.domElement.addEventListener('pointerdown', () => game.input.requestLock());
    const release = () => { game.input.releaseAll(); game.touch?.releaseAll(); game.touch?.clearMap(); held = {}; tell('release'); };
    addEventListener('blur', release); addEventListener('orientationchange', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    game.input.onUnlock = release; game.input.onPause = release;
    present();
  }
  else {
    game.rig._overview = broadcast;
    game.rig.overview(); game.rig._prevMode = 'overview';   // start framed, not blending up from the origin
  }
  G.mode = 'match'; game.rig.update(1 / 60);
  restoreInk({ ink: '', sequence: 0 }); painted = false; restoredAt = -Infinity;   // compiles the repaint program while the room is still loading
  game.R.render(); await new Promise(requestAnimationFrame); game.R.render();
  document.getElementById('loading').hidden = true;
  tell('ready');
  let previous = performance.now(), sentAt = 0;
  const animate = now => {
    if (stopped) return;
    if (!feed || cutting) { previous = now; frame = requestAnimationFrame(animate); return; }
    const elapsed = (now - previous) / 1000, dt = Math.min(.05, elapsed); previous = now; G.time += dt;
    // A long pause (a hidden tab, a locked phone) leaves a pile of old events: skip them and repaint from the next baseline.
    for (const peer of net.peers.values()) if (peer.events.length > 600) { peer.events.length = 0; dirty = true; }
    G.renderer.info.reset(); if (game.settings.mobilePerformance) game._dynRes(elapsed);
    net.update(dt); game.match.boss?.update(dt); for (const actor of G.actors) net.applyRemote(actor, dt);
    G.projectiles.update(dt); G.subs.update(dt); G.specials.update(dt); G.fx.update(dt, G.camera); game.fxHooks.update?.(dt);
    G.env.update(dt, G.camera); game.decor.update(dt); game.props.update(dt, G.time);
    if (local) {
      game.input.pollPad(); game.input.pollTouch(); game.touch?.update();
      game.match.controller.enabled = game.match.playing() && local.alive;
      game.match.controller.update(dt); game.rig.setMap(game.match.controller.mapHeld);
      for (const key of ['fire', 'squid', 'jump', 'sub', 'special', 'cheer']) held[key] ||= !!local.intent[key];
      if (now - sentAt >= 50) {
        const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
        tell('input', { input: { moveX: local.intent.move.x, moveY: local.intent.move.z, hasAim: true, yaw: wrap(local.aimYaw), pitch: local.aimPitch, aimX: local.aimPoint.x, aimY: local.aimPoint.y, aimZ: local.aimPoint.z, ...held } }); held = {}; sentAt = now;
      }
    }
    game.rig.update(dt); G.paint.flush(dt);
    G.audio.setListener(G.camera.position, G.camera.getWorldDirection(game._lf ||= new THREE.Vector3()), G.camera.up);
    for (const material of [game.levelMat, game.grateMat]) material.userData.uniforms.uTime.value = G.time;
    game.swimWake?.update(dt, game.levelMat.userData.uniforms, G.camera.position);
    if (local) { game.match.controller.computeAim(); game._ageDeathMarks(dt); game._updateHud(dt); game.diorama.update(dt, game.rig.mapK); game.input.endFrame(); }
    else label();
    game.R.render();
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  if (latest) receive(latest);
}

/**
 * The original game's own match presentation for the player on this screen, which the first port left unwired: the
 * fly-in over the stage, READY and GO, the final countdown and time's up, hit markers, the "ink from that side" flash,
 * the splat card with its respawn clock and the camera on whoever got you, and the kill feed. Same HUD pieces and sounds
 * as upstream's main.js; only the triggers come from the server's events instead of a local simulation.
 */
function present() {
  const { hud, rig } = game, color = team => G.teamHex[team], playing = () => game.match.state === 'playing';
  on('match:state', ({ state }) => {
    if (quiet) { if (state === 'playing') hud.el.classList.add('is-live'); return; }
    // Open on the stage's own establishing shot and fly in behind the player, as the original match intro does.
    if (state === 'intro') { if (game.match.boss) game._bossIntro(game.match.boss); else game._intro(); }
    if (state === 'playing') { hud.banner('go'); G.audio.play('go_horn'); if (local.alive) rig.follow(local, true); }
    if (state === 'finish') { hud.hideSplatted(); hud.banner('timesup'); if (!game.match.boss?.dead) G.audio.play('times_up'); game.input.exitLock(); if (game.match.boss) game._bossFinishCam(game.match.boss); else rig.overview(); }
  });
  on('match:oneminute', () => { hud.banner('one_minute'); G.audio.play('one_minute'); });
  on('match:count', ({ n }) => { hud.countdown(n); G.audio.play('final_count'); });
  let hitAt = 0, hurtAt = 0; const point = new THREE.Vector3();
  on('hit', ({ attacker, killed }) => {
    if (attacker !== local) return;
    hud.hitMarker(killed ? 'kill' : 'hit');
    if (G.time - hitAt > .06) { hitAt = G.time; G.audio.play('hit_marker', { volume: .6 }); }
  });
  on('damage', ({ victim, attacker, amount }) => {
    if (victim !== local || !playing()) return;
    let angle = null;
    if (attacker && attacker !== victim) {
      point.copy(attacker.pos); point.y += 1; point.project(G.camera);
      const behind = point.z > 1, dx = behind ? -point.x : point.x, dy = behind ? point.y : -point.y;
      angle = !behind && Math.abs(dx) < 1 && Math.abs(dy) < 1 ? dx >= 0 ? 0 : Math.PI : Math.atan2(dy * innerHeight, dx * innerWidth);
    }
    hud.damage(Math.max(.15, Math.min(1, amount / 80)), color(victim.enemyTeam), angle);
    if (G.time - hurtAt > .25) { hurtAt = G.time; G.audio.play('hurt', { volume: .7 }); }
  });
  splatted = (victim, attacker, cause) => {
    hud._onSplatted({ victim, attacker }); game._addDeathMark(victim);
    if (attacker === local) { hud.hitMarker('kill'); G.audio.play('splat_enemy', { volume: .9 }); hud.feed({ text: `You splatted ${victim.name}!`, color: color(local.team), kind: 'kill' }); }
    else if (victim === local) {
      G.audio.play('splatted_self'); G.audio.duck?.(.45, 2.2);
      hud.showSplatted({ by: attacker ? attacker.name : cause === 'water' ? null : 'enemy ink', byColor: attacker ? color(attacker.team) : '#6fd0ff', respawn: PLAYER.respawnTime, attacker: attacker || null, cause });
      rig.mode = 'spectate'; rig.spectate = { actor: attacker?.alive ? attacker : null, pos: victim.pos.clone(), from: victim.pos.clone() }; rig.lookAt.copy(victim.pos);
    }
    else if (victim.team === local.team) { G.audio.play('ally_splatted', { volume: .5 }); hud.feed({ text: `${victim.name} was splatted${attacker ? ` by ${attacker.name}` : ''}`, color: color(victim.enemyTeam), kind: 'death' }); }
    else if (attacker?.team === local.team) hud.feed({ text: `${attacker.name} splatted ${victim.name}`, color: color(attacker.team), kind: 'ally' });
  };
  respawned = actor => { if (actor !== local) return; hud._clearDamageDirs(); hud._restart(hud.shield, 'is-on'); hud.hideSplatted(); if (playing()) { rig.follow(actor, true); rig.yaw = actor.yaw; rig.pitch = -.12; } game.match.controller.launchQueuedJump?.(); };
  on('special:ready', ({ actor }) => { if (actor === local) G.audio.play('special_ready'); });
  on('lowink', ({ actor }) => { if (actor === local) game._lowInkFlash = 1.2; });
  on('actor:footstep', ({ actor, surface, pos, speed }) => {
    if (!actor?.alive || actor.form === 'squid') return;
    const at = pos || actor.pos; if (actor !== local && G.camera.position.distanceToSquared(at) > 18 * 18) return;
    G.audio.play(surface === 1 ? 'step_ink' : surface === 2 ? 'step_enemy' : 'step_dry', { pos: actor === local ? undefined : at, volume: (actor === local ? .7 : .45) * Math.min(1, .45 + (speed || actor.anim.speed || 0) / 8) });
  });
}

// ---- TV broadcast camera. The stage's long axis (base to base) lies across the wide screen, tilted so buildings keep
// their depth; looking along +X puts team 0's base on the left, like its score. It frames the whole stage for the intro
// and the final count, and in between eases in on wherever the players are, so the audience can see characters and not
// only paint. A cut to another arena starts on the whole stage again.
const shot = { x: 0, z: 0, span: 0, fresh: true, at: 0 }, TILT = .55;
function broadcast() {
  const b = G.level.bounds, width = b.maxZ - b.minZ, depth = b.maxX - b.minX, aspect = G.camera.aspect, state = game.match.state;
  let x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2, span = Math.max(width, depth * aspect);
  const alive = G.actors.filter(actor => actor.alive);
  if (state === 'playing' && alive.length && game.match.time > 10) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const include = (px, pz) => { minX = Math.min(minX, px); maxX = Math.max(maxX, px); minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz); };
    for (const actor of alive) include(actor.pos.x, actor.pos.z);
    const boss = game.match.boss; if (boss) include(boss.pos.x, boss.pos.z);
    // Room around the action, never closer than a third of the stage and never past its edges.
    const need = Math.max(maxZ - minZ + 18, (maxX - minX + 14) * aspect, span * .36);
    if (need < span) { span = need; x = Math.max(b.minX + span / aspect / 2, Math.min(b.maxX - span / aspect / 2, (minX + maxX) / 2)); z = Math.max(b.minZ + span / 2, Math.min(b.maxZ - span / 2, (minZ + maxZ) / 2)); }
  }
  // Eased by the wall clock, not the engine's capped frame step: a TV browser at ten frames a second must still be back
  // on the whole stage in time for the count.
  const now = performance.now(), k = shot.fresh ? 1 : 1 - Math.exp(-Math.min(1, (now - shot.at) / 1000) * 1.1); shot.fresh = false; shot.at = now;
  shot.x += (x - shot.x) * k; shot.z += (z - shot.z) * k; shot.span += (span - shot.span) * k;
  const distance = shot.span * .62 / aspect / Math.tan(G.camera.fov * Math.PI / 360);
  G.camera.position.set(shot.x - Math.sin(TILT) * distance, Math.cos(TILT) * distance, shot.z); G.camera.up.set(0, 1, 0); G.camera.lookAt(shot.x, 0, shot.z);
}
/** Name tags over the characters on the TV. A squid under its own ink stays hidden from the audience too. */
function label() {
  const point = new THREE.Vector3();
  G.actors.forEach((actor, nid) => {
    const tag = tags.children[nid]; if (!tag) return;
    const show = actor.alive && !actor.submerged && actor.character.root.visible;
    if (show) { if (actor.visualPos) actor.visualPos(point); else point.copy(actor.pos); point.y += actor.form === 'squid' ? 1.1 : 2.1; point.project(G.camera); }
    tag.hidden = !show || point.z > 1 || Math.abs(point.x) > 1.05 || Math.abs(point.y) > 1.05;
    if (!tag.hidden) tag.style.transform = `translate(${((point.x * .5 + .5) * innerWidth).toFixed(1)}px,${((-point.y * .5 + .5) * innerHeight).toFixed(1)}px) translate(-50%,-100%)`;
  });
}

// Repaint the stage from the authoritative grid. Normal play keeps the original spreading splat shapes instead.
// The canvas, texture and material are made once: a repaint must stay cheap, or the slow frame it causes would look like
// a stall that needs another repaint.
let blit, restoredAt = -Infinity;
function restoreInk({ ink, sequence }) {
  const paint = G.paint;
  if (!blit) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = paint.size;
    const texture = new THREE.CanvasTexture(canvas); texture.flipY = false; texture.colorSpace = THREE.NoColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, blending: THREE.NoBlending })));
    blit = { canvas, context: canvas.getContext('2d'), texture, scene, camera: new THREE.Camera() };
  }
  const context = blit.context; context.clearRect(0, 0, paint.size, paint.size); paint.clear();
  if (ink) unpackInk(ink, paint.grid);
  paint.counts = [0, 0];
  for (const face of paint.paintFaces) {
    const atlas = face.atlas, width = face.cu * atlas.ppm, height = face.cv * atlas.ppm;
    for (let y = 0; y < face.nv; y++) for (let x = 0, row = face.grid + y * face.nu; x < face.nu;) {
      const value = paint.grid[row + x]; let run = 1; while (x + run < face.nu && paint.grid[row + x + run] === value) run++;
      if (value) {
        context.fillStyle = value === 1 ? '#008080' : '#ff8080';
        context.fillRect(atlas.x + atlas.pad + x * width, atlas.y + atlas.pad + y * height, run * width + 1, height + 1);
        if (face.turf) for (let k = row + x; k < row + x + run; k++) if (!paint.dead[k]) paint.counts[value - 1]++;
      }
      x += run;
    }
  }
  paint.version++; blit.texture.needsUpdate = true;
  const previous = G.renderer.getRenderTarget(); G.renderer.setRenderTarget(paint.rt); G.renderer.render(blit.scene, blit.camera); G.renderer.setRenderTarget(previous);
  lastEvent = sequence; painted = true; restoredAt = performance.now();
}
/** One snapshot of one arena: `{ arena, feed, ink?, inkSequence? }`. The paint baseline only comes when it was retaken. */
function receive(message) {
  latest = message; if (!net || cutting) return;
  if (message.arena !== arena) {
    // The broadcast moved on. Rebuild the eight characters for that arena, then pick up from its newest snapshot.
    cutting = true; shot.fresh = true;
    mount(message.arena).then(() => { cutting = false; if (!stopped) receive(latest); }, fail);
    return;
  }
  feed = message.feed;
  if (typeof message.ink === 'string') baseline = { ink: message.ink, sequence: message.inkSequence };
  // Events up to `eventBase` have left the wire. If this screen has not played them all, its paint is behind.
  if (painted && lastEvent < feed.eventBase) { dirty = true; lastEvent = feed.eventBase; }
  // (Never twice within four seconds: on a struggling device the repaint is itself what makes it miss the next events.)
  if (baseline && baseline.sequence >= feed.eventBase && (!painted || dirty && performance.now() - restoredAt > 4000)) { restoreInk(baseline); dirty = false; }
  // A screen that has just arrived paints from the baseline it has, a little stale, and is corrected by the next one.
  else if (baseline && !painted) { restoreInk(baseline); lastEvent = feed.eventBase; dirty = true; }
  if (baseline?.sequence < lastEvent && !dirty) baseline = null;
  // Events go on the server's timeline, to be replayed with the same delay as the interpolated characters they belong to.
  const peer = net._peer('server');
  for (const event of feed.events) { if (event[0] <= lastEvent) continue; lastEvent = event[0]; if (event[2] === 'd') peer.events.push([event[1], 'd', event[3], event[4], event[5]]); else peer.events.push([event[1], ...event.slice(2)]); }
  for (const [owner, gid, x, y, z, nx, ny, nz, uses] of feed.beacons) {
    net.mute++; try { G.subs.netGhost(G.actors[owner], [1, gid, 'beacon', x, y, z, nx, ny, nz, 0]); } finally { net.mute--; }
    const beacon = G.subs.items.find(item => item.gid === gid); if (beacon) beacon.uses = uses;
  }
  for (const item of G.subs.items) if (item.state === 'beacon' && !feed.beacons.some(beacon => beacon[1] === item.gid)) G.subs._destroy(item);
  const zones = game.match.zones, state = feed.zones;
  if (zones && state) {
    if (zones.active.id !== state.active) zones.netEvent(['za', zones.objectives.findIndex(objective => objective.id === state.active), Number(state.final)]);
    Object.assign(zones, { count: [...state.count], penalty: [...state.penalty], owner: state.owner, nextSwap: state.nextSwap || Infinity, final: state.final, overtime: state.overtime, overtimeT: state.overtimeT });
    for (const zone of state.zones) { const target = zones.zones[zone.id]; if (target) { target.owner = zone.owner; target.share = [...zone.share]; } }
  }
  for (const move of feed.bossMoves) game.match.boss?.onMove(move);
  // `t` is the server's simulation clock, so the engine's own jitter buffer spaces the samples as they were simulated,
  // however unevenly they arrived.
  net.onMessage('server', { k: 't', ts: feed.t, a: feed.actors, B: feed.boss, c: [feed.state, feed.time] });
  const match = game.match, before = match.time;
  // A screen that arrives mid-match (a reload, a broadcast cut) takes the state without replaying READY and GO.
  if (match.state !== feed.state) { quiet = match.state === 'init' && feed.state !== 'intro'; if (feed.state === 'judge') match.state = 'judge'; else match.setState(feed.state); quiet = false; }
  match.time = feed.time; if (feed.result) match.result = feed.result;
  if (feed.state === 'playing') {
    if (before > 60 && feed.time <= 60 && settings.duration > 60) emit('match:oneminute', {});
    const count = Math.ceil(feed.time); if (feed.time <= 10 && count > 0 && count < lastCount) { lastCount = count; emit('match:count', { n: count }); }
  }
}
// What the engine's netcode leaves to each player's own simulation, and this port has none: a splat or respawn of any
// actor goes to this screen's presentation directly (not onto the event bus, where weapon kits would act on it a second
// time), and the server's damage record becomes the original 'damage' and 'hit' events. All of it on the playback timeline.
function wire() {
  const play = NetMatch.prototype._play;
  NetMatch.prototype._play = function (from, event) {
    const who = ref => ref && this.byNid.get(ref.n) || null;
    if (event[1] === 'ev' && event[2] === 'splatted') { const victim = who(event[3].victim), alive = victim?.alive; play.call(this, from, event); if (alive) splatted?.(victim, who(event[3].attacker), event[3].cause); return; }
    if (event[1] === 'ev' && event[2] === 'respawn') { const actor = who(event[3].actor), away = actor && !actor.alive; play.call(this, from, event); if (away) respawned?.(actor); return; }
    if (event[1] !== 'd') return play.call(this, from, event);
    const victim = this.byNid.get(event[2]), attacker = this.byNid.get(event[3]) || null; if (!victim) return;
    emit('damage', { victim, attacker, amount: event[4], source: 'weapon' });
    if (attacker) emit('hit', { attacker, victim, damage: event[4], killed: false });
  };
}
wire();
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel || event.data.roundId !== roundId) return;
  if (event.data.type === 'init' && !game) { clearInterval(hello); boot(event.data).catch(fail); }
  if (event.data.type === 'unlock') G.audio?.init();
  if (event.data.type === 'snapshot') receive(event.data.view);
  // The shell lost its socket: nothing is held any more. The arena itself stays as it is until the socket returns.
  if (event.data.type === 'release' && local) { game.input.releaseAll(); game.touch?.releaseAll(); game.touch?.clearMap(); held = {}; }
  if (event.data.type === 'stop') stop();
});
function stop() { if (stopped) return; stopped = true; clearInterval(hello); cancelAnimationFrame(frame); G.audio?.stopAll(0); G.audio?.ctx?.close(); G.renderer?.dispose(); G.renderer?.forceContextLoss(); }
// The shell removes this frame with its stage (results, lobby) without a word: give the GPU back at once.
addEventListener('pagehide', stop);
const hello = setInterval(() => tell('loaded'), 500);
tell('loaded');
