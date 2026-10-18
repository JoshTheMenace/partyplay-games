import { AudioEngine } from './engine/audio/audio.js';
import { MusicEngine } from './engine/audio/music.js';
const query = new URLSearchParams(location.search), roundId = query.get('round'), channel = 'partyplay-inkwave';
const audio = new AudioEngine(), music = audio.music = new MusicEngine();
let state, track;
function sync() {
  if (!state) return;
  let muted = false; try { muted = localStorage.getItem('party.sound.muted') === 'true'; } catch {}
  audio.setVolumes({ master: muted || !state.connected ? 0 : .7, music: .6, sfx: .8 });
  const view = state.publicView, boss = view?.boss, phase = state.phase;
  const wanted = !state.connected ? null : phase === 'lobby' || phase === 'preparing' ? 'menu' : phase === 'results' ? (view?.result?.winner === 0 ? 'results_win' : 'results_lose') : phase === 'playing' ? boss ? `boss${boss > 1 ? `_${boss}` : ''}` : view?.time <= 60 ? 'battle_final' : 'battle' : null;
  if (track !== wanted) { track = wanted; music.play(wanted, { fade: .6 }); }
}
const hello = setInterval(() => parent.postMessage({ channel, roundId, type: 'loaded' }, location.origin), 500);
addEventListener('message', event => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== channel || event.data.roundId !== roundId) return;
  if (event.data.type === 'init' || event.data.type === 'update') { clearInterval(hello); state = event.data.data; sync(); }
  if (event.data.type === 'unlock') { audio.init(); sync(); }
  if (event.data.type === 'stop') { clearInterval(hello); music.dispose(); audio.stopAll(0); audio.ctx?.close(); }
});
addEventListener('storage', sync);
parent.postMessage({ channel, roundId, type: 'loaded' }, location.origin);
