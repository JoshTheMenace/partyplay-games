import * as THREE from 'three';
import { G } from './engine/core/ctx.js';
import { Menus } from './engine/ui/menus.js';
import { Showcase } from './engine/game/showcase.js';
import { Character } from './engine/game/character.js';
import { AudioEngine } from './engine/audio/audio.js';
import { MAPS, DEFAULT_SETTINGS, SUBS, SUB_ORDER, SPECIAL_ORDER, TEAM_PALETTES, PROGRESSION } from './engine/config.js';
const query = new URLSearchParams(location.search), roundId = query.get('round'), screen = query.get('screen'), channel = 'partyplay-inkwave';
const tell = (type, data = {}) => parent.postMessage({ channel, roundId, type, ...data }, location.origin);
let data, menus, renderer, showcase, frame, stopped = false, signature = '';
const audio = new AudioEngine({ music: false });
const volume = () => { let muted = false; try { muted = localStorage.getItem('party.sound.muted') === 'true'; } catch {} audio.setVolumes({ master: muted ? 0 : .7, music: 0, sfx: .8 }); };
volume(); addEventListener('storage', volume);
for (const event of ['pointerdown', 'keydown']) addEventListener(event, () => audio.init());
const choice = () => data.choice || { weapon: 'shooter', sub: null, special: null, style: {} };
function setChoice(patch) {
  data.choice = { ...choice(), ...patch }; tell('choice', { choice: data.choice });
  if (patch.weapon) showcase?.showLoadout(patch.weapon, G.teamColors[0], choice().style);
}
function publishSettings() {
  const st = menus?._setup; if (!st || screen !== 'settings') return;
  const settings = { ...data.settings, mode: st.mode || data.settings.mode, map: st.mapId || data.settings.map, difficulty: st.difficulty || data.settings.difficulty, time: st.times?.[st.mapId] || data.settings.time, duration: st.mode === 'zones' ? 300 : st.duration || data.settings.duration };
  const key = JSON.stringify(settings); if (key === signature) return; signature = key; data.settings = settings; tell('settings', { settings });
}
function resultData(view) {
  const boss = view.settings.mode === 'boss', team = view.roster.find(p => p.id === data.playerId)?.team ?? (boss ? 0 : view.result.winner), tied = view.settings.mode === 'turf' && view.coverage[0] === view.coverage[1], won = tied || view.result.winner === team;
  const players = view.roster.map((p, i) => ({ ...p, ...view.stats[i], turf: Math.round(view.stats[i].turf), damage: Math.round(view.stats[i].bossDmg || 0), isSelf: p.id === data.playerId }));
  const bo = view.result.boss;
  const result = { win: won, team, party: true, tie: tied, ...(!data.playerId && !boss && !tied ? { title: `${TEAM_PALETTES[0].names[team].toUpperCase()} WINS!` } : {}), mode: view.settings.mode, mapName: MAPS.find(m => m.id === view.settings.map).name, colors: view.colors, teamNames: TEAM_PALETTES[0].names, percents: view.coverage.map(v => v * 100), players,
    ...(bo ? { boss: { name: bo.name, defeated: won, time: bo.time, hpLeft: bo.hp / bo.maxHp, maxHp: bo.maxHp, phase: bo.phase } } : {}),
    ...(view.zones ? { zones: { ...view.result, counts: view.zones.count, penalty: view.zones.penalty, overtimeT: view.zones.overtimeT } } : {}) };
  const self = players.find(p => p.isSelf);
  if (self) {
    const key = `inkwave.party.profile.${data.playerId}`;
    let profile = { level: 1, xp: 0 };
    try { profile = JSON.parse(localStorage.getItem(key)) || profile; } catch {}
    if (profile.round !== view.roundId) {
      const before = { ...profile }, zx = PROGRESSION.zones;
      const gained = Math.round((won ? PROGRESSION.xpWin : PROGRESSION.xpLose) + self.turf * PROGRESSION.xpPerTurfPoint * (view.zones ? zx.turfScale : 1) + self.splats * PROGRESSION.xpPerSplat + (boss ? self.damage * .04 : 0) + (view.zones ? (self.zoneTurf || 0) * zx.xpPerZoneTurfPoint + (won && view.result.reason === 'knockout' ? zx.xpKnockout : 0) : 0));
      profile.xp += gained; while (profile.xp >= PROGRESSION.xpForLevel(profile.level)) { profile.xp -= PROGRESSION.xpForLevel(profile.level); profile.level++; }
      profile.round = view.roundId; profile.result = { gained, levelBefore: before.level, levelAfter: profile.level, xpBefore: before.xp, xpAfter: profile.xp, xpToNextBefore: PROGRESSION.xpForLevel(before.level), xpToNextAfter: PROGRESSION.xpForLevel(profile.level) };
      try { localStorage.setItem(key, JSON.stringify(profile)); } catch {}
    }
    result.xp = profile.result;
  }
  return result;
}
function boot() {
  document.body.classList.add('party-menu', `party-${screen}`);
  G.settings = { ...DEFAULT_SETTINGS, quality: 'low' }; G.teamColors = [new THREE.Color(TEAM_PALETTES[0].a), new THREE.Color(TEAM_PALETTES[0].b)]; G.audio = audio;
  if (screen !== 'settings') {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' }); renderer.setPixelRatio(1); renderer.setClearColor(0x15121c, 0); renderer.toneMapping = THREE.NeutralToneMapping;
    document.getElementById('app').append(renderer.domElement); G.renderer = renderer;
    showcase = new Showcase(renderer, Character); G.game = { showcase, profile: choice() };
  }
  menus = G.menus = new Menus(document.getElementById('ui-root'), {
    party: true, maps: MAPS.map(m => ({ ...m, onlineOnly: false })), subs: SUBS, subOrder: SUB_ORDER, specialOrder: SPECIAL_ORDER,
    getSettings: () => ({ ...DEFAULT_SETTINGS, lastMode: data.settings.mode, lastStage: data.settings.map, difficulty: data.settings.difficulty, matchLength: data.settings.duration, bossLength: data.settings.duration, stageTimes: { [data.settings.map]: data.settings.time } }),
    setSettings: patch => { if (patch.lastMode) { data.settings = { ...data.settings, mode: patch.lastMode, duration: patch.lastMode === 'boss' ? 240 : patch.lastMode === 'zones' ? 300 : 180 }; if (patch.lastMode === 'boss' && data.settings.map === 'cargo') { data.settings.map = 'tidewater'; menus._setup.mapId = 'tidewater'; } } queueMicrotask(publishSettings); },
    getProfile: () => ({ name: data.name || 'Your squidkid', style: choice().style }), getLoadout: choice, setLoadout: setChoice,
    setProfileStyle: style => setChoice({ style }), playSound: name => audio.play(name),
    onScreenChange: name => { if (name === 'loadout') showcase?.showLoadout(choice().weapon, G.teamColors[0], choice().style); if (screen === 'settings') publishSettings(); },
  });
  addEventListener('keydown', event => { if (event.key !== 'Tab') menus.handleKey(event); });
  document.addEventListener('click', () => queueMicrotask(publishSettings)); document.addEventListener('keyup', () => queueMicrotask(publishSettings));
  if (screen === 'settings') menus.show('mode');
  else if (screen === 'results') {
    const result = resultData(data.view), team = result.players.find(p => p.isSelf)?.team ?? (result.mode === 'boss' ? 0 : data.view.result.winner);
    menus.showResults(result); menus.show('results');
    const podium = result.mode === 'boss' ? [...result.players].sort((a, b) => b.damage - a.damage).slice(0, 4) : result.players.filter(p => p.team === team);
    showcase.showResults(team, result.win, new THREE.Color(result.colors[team]), podium);
    if (!data.playerId) menus.el.classList.add('party-watching');
  } else menus.show('loadout');
  if (screen === 'loadout') showcase._warmup();
  document.getElementById('loading').hidden = true;
  let previous = performance.now(), rendered = false;
  const animate = now => {
    if (stopped) return;
    if (document.hidden || (rendered && data.disabled) || now - previous < 1000 / 30) { frame = requestAnimationFrame(animate); return; }
    const dt = Math.min(.05, (now - previous) / 1000); previous = now;
    if (renderer) { if (renderer.domElement.width !== innerWidth || renderer.domElement.height !== innerHeight) renderer.setSize(innerWidth, innerHeight, false); showcase.update(dt); renderer.clear(); showcase.render(); }
    rendered = true;
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate); tell('ready');
}
function update(next) {
  data = { ...next, choice: next.choice || data?.choice };
  if (!menus) boot();
  const locked = !!data.disabled; document.getElementById('ui-root').inert = locked;
}
const hello = setInterval(() => tell('loaded'), 500);
addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel || event.data.roundId !== roundId) return;
  if (event.data.type === 'init' || event.data.type === 'update') { clearInterval(hello); try { update(event.data.data); } catch (error) { tell('error', { message: error.message }); } }
  if (event.data.type === 'unlock') audio.init();
  if (event.data.type === 'stop') { stopped = true; clearInterval(hello); cancelAnimationFrame(frame); menus?.dispose(); showcase?.dispose(); audio.stopAll(0); audio.ctx?.close(); renderer?.dispose(); renderer?.forceContextLoss(); }
});
tell('loaded');
