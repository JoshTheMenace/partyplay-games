import * as THREE from 'three';
import { G } from './engine/core/ctx.js';
import { Game } from './engine/main.js';
import { Renderer } from './engine/core/renderer.js';
import { Input } from './engine/core/input.js';
import { TouchControls, isTouchDevice } from './engine/core/touch.js';
import { PlayerController } from './engine/game/player.js';
import { HUD } from './engine/ui/hud.js';
import { DioramaOverlay } from './engine/ui/diorama.js';
import { DEFAULT_SETTINGS, QUALITY, MAPS, mapTheme, TEAM_PALETTES, WEAPON_ORDER, mapNoBots } from './engine/config.js';
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

const channel = 'partyplay-inkwave', query = new URLSearchParams(location.search), roundId = query.get('round');
const tell = (type, data = {}) => parent.postMessage({ channel, roundId, type, ...data }, location.origin);
const fail = error => { if (stopped) return; document.getElementById('loading').textContent = `Unable to load Inkwave: ${error.message || error}`; tell('error', { message: String(error.message || error) }); };
let game, net, local, view, lastEvent = -1, lastSnapshot = 0, stopped = false, frame, initialInk = false, held = {};
window.addEventListener('error', event => fail(event.error || event.message));
window.addEventListener('unhandledrejection', event => fail(event.reason));

async function boot({ settings, players, playerId }) {
  game = new Game(); game.touchMode = !!playerId && isTouchDevice(); game.settings = G.settings = { ...DEFAULT_SETTINGS, quality: 'low', mobilePerformance: isTouchDevice(), shadows: false, music: 0, cameraShake: 0, touchControls: game.touchMode ? 'on' : 'off' };
  document.body.classList.toggle('party-touch', game.touchMode);
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
  const roster = Array.from({ length: mapNoBots(settings.map) ? players.length : 8 }, (_, index) => {
    const player = players[index], choice = player?.lobbyChoice || {};
    return { nid: index, owner: 'server', bot: !player, team: settings.mode === 'boss' ? 0 : index % 2, slot: settings.mode === 'boss' ? index : Math.floor(index / 2), name: player?.name || `CPU ${index + 1}`, weapon: choice.weapon || WEAPON_ORDER[index % WEAPON_ORDER.length], sub: choice.sub || null, special: choice.special || null, style: choice.style || {} };
  });
  game.match = G.match = new Match({ roster, myId: 'viewer', host: false, CharacterClass: Character, duration: settings.duration, mode: settings.mode });
  game.match.setup(); await game.match.boss?.model.ready; game.match.setState('intro');
  local = G.actors[players.findIndex(player => player.id === playerId)] || null;
  game.match.local = G.local = local;
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
      const turf = view?.stats[local.nid].turf || 0;
      game.hud._turfAcc += Math.max(0, turf - game.hud._turfTotal); game.hud._turfTotal = turf;
      updateHud(dt, { ...data, prompt: game.touchMode ? data.prompt?.replaceAll('SHIFT', 'SQUID').replace('Press F', 'Tap SP').replace('press C', 'tap YEAH') : data.prompt });
    };
    game.diorama = new DioramaOverlay(game.hud.el);
    if (game.touchMode) { game.touch = G.touch = new TouchControls(game.input); game.touch.mount(document.getElementById('ui-root')); }
    else G.renderer.domElement.addEventListener('pointerdown', () => game.input.requestLock());
    const release = () => { game.input.releaseAll(); game.touch?.releaseAll(); game.touch?.clearMap(); held = {}; tell('release'); };
    addEventListener('blur', release); addEventListener('orientationchange', release); document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    game.input.onUnlock = release; game.input.onPause = release;
  }
  else {
    // Lay the stage's long axis (base to base) across the wide screen, tilted so buildings keep their depth.
    // Looking along +X puts +Z on the right, so team 0 (−Z base) sits on the left like its score.
    game.rig._overview = () => {
      const b = G.level.bounds, x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2, tilt = .55;
      const fit = Math.max(b.maxX - b.minX, (b.maxZ - b.minZ) / G.camera.aspect) * .62 / Math.tan(G.camera.fov * Math.PI / 360);
      G.camera.position.set(x - Math.sin(tilt) * fit, Math.cos(tilt) * fit, z); G.camera.lookAt(x, 0, z);
    };
    game.rig.overview(); game.rig._prevMode = 'overview';   // start framed, not blending up from the origin
  }
  net = new NetMatch({ myId: 'viewer', hostId: 'server', isHost: false, _members: new Map([['server', {}]]) }, { map: settings.map }); net.bind(game.match);
  game.fxHooks = initFxHooks(G); game.zoneMarks = new ZoneMarks(G.scene); game.zoneMarks.build(game.match);
  G.mode = 'match'; game.rig.update(1 / 60);
  game.R.render(); await new Promise(requestAnimationFrame); game.R.render();
  document.getElementById('loading').hidden = true;
  tell('ready');
  let previous = performance.now(), sentAt = 0;
  const animate = now => {
    if (stopped) return;
    if (!view) { previous = now; frame = requestAnimationFrame(animate); return; }
    const elapsed = (now - previous) / 1000, dt = Math.min(.05, elapsed); previous = now; G.time += dt;
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
    if (local) { game.match.controller.computeAim(); game._updateHud(dt); game.diorama.update(dt, game.rig.mapK); game.input.endFrame(); }
    game.R.render();
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);
  if (view) receive(view);
}

// A reconnect restores the authoritative grid once. Normal play keeps the original spreading splat shapes.
function restoreInk(snapshot) {
  const paint = G.paint, bytes = atob(snapshot.ink), canvas = document.createElement('canvas'); canvas.width = canvas.height = paint.size;
  const context = canvas.getContext('2d'); paint.clear();
  for (let i = 0; i < paint.grid.length; i++) paint.grid[i] = (bytes.charCodeAt(i >> 2) >> ((i % 4) * 2)) & 3;
  for (const face of paint.paintFaces) {
    const atlas = face.atlas;
    for (let y = 0; y < face.nv; y++) for (let x = 0; x < face.nu; x++) {
      const value = paint.grid[face.grid + y * face.nu + x]; if (!value) continue;
      context.fillStyle = value === 1 ? '#008080' : '#ff8080';
      context.fillRect(atlas.x + atlas.pad + x * face.cu * atlas.ppm, atlas.y + atlas.pad + y * face.cv * atlas.ppm, face.cu * atlas.ppm + 1, face.cv * atlas.ppm + 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.flipY = false; texture.colorSpace = THREE.NoColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, blending: THREE.NoBlending }), geometry = new THREE.PlaneGeometry(2, 2), scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material)); const previous = G.renderer.getRenderTarget(); G.renderer.setRenderTarget(paint.rt); G.renderer.render(scene, new THREE.Camera()); G.renderer.setRenderTarget(previous);
  material.dispose(); geometry.dispose(); texture.dispose(); lastEvent = snapshot.inkSequence; initialInk = true;
}
function receive(snapshot) {
  view = { ...view, ...snapshot }; snapshot = view; if (!net || typeof snapshot.ink !== 'string') return;
  if (!initialInk || performance.now() - lastSnapshot > 1500) restoreInk(snapshot);
  const now = performance.now() / 1000, events = snapshot.events.filter(event => event[0] > lastEvent);
  for (const event of events) { net._play('server', [now, ...event.slice(1)]); lastEvent = event[0]; }
  for (const [owner, gid, x, y, z, nx, ny, nz, uses] of snapshot.beacons) {
    net.mute++; try { G.subs.netGhost(G.actors[owner], [1, gid, 'beacon', x, y, z, nx, ny, nz, 0]); } finally { net.mute--; }
    const beacon = G.subs.items.find(item => item.gid === gid); if (beacon) beacon.uses = uses;
  }
  for (const item of G.subs.items) if (item.state === 'beacon' && !snapshot.beacons.some(beacon => beacon[1] === item.gid)) G.subs._destroy(item);
  const zones = game.match.zones, state = snapshot.zones;
  if (zones && state) {
    if (zones.active.id !== state.active) zones.netEvent(['za', zones.objectives.findIndex(objective => objective.id === state.active), Number(state.final)]);
    Object.assign(zones, { count: [...state.count], penalty: [...state.penalty], owner: state.owner, nextSwap: state.nextSwap || Infinity, final: state.final, overtime: state.overtime, overtimeT: state.overtimeT });
    for (const zone of state.zones) { const target = zones.zones[zone.id]; if (target) { target.owner = zone.owner; target.share = [...zone.share]; } }
  }
  for (const move of snapshot.bossMoves) game.match.boss?.onMove(move);
  net.onMessage('server', { k: 't', ts: now, a: snapshot.actors, B: snapshot.boss, c: [snapshot.state, snapshot.time] });
  game.match.state = snapshot.state; game.match.time = snapshot.time; lastSnapshot = performance.now();
}
window.addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel || event.data.roundId !== roundId) return;
  if (event.data.type === 'init' && !game) { clearInterval(hello); boot(event.data).catch(fail); }
  if (event.data.type === 'unlock') G.audio?.init();
  if (event.data.type === 'snapshot') receive(event.data.view);
  if (event.data.type === 'stop') { stopped = true; clearInterval(hello); cancelAnimationFrame(frame); G.audio?.stopAll(0); G.audio?.ctx?.close(); G.renderer?.dispose(); G.renderer?.forceContextLoss(); }
});
const hello = setInterval(() => tell('loaded'), 500);
tell('loaded');
