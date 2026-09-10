import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { MUSIC, selectMusic, selectPlaylist, StreamedMusic, type MusicTrack } from '../game/music';

class FakeAudio {
  src='';paused=true;currentTime=0;playbackRate=1;preservesPitch=true;volume=1;loop=false;preload='';plays=0;pauses=0;loads=0;rejectPlay=false;error:{code:number}|null=null;onerror:(()=>void)|null=null;onended:(()=>void)|null=null;
  getAttribute(){return this.src;}
  removeAttribute(){this.src='';}
  load(){this.loads++;}
  pause(){this.paused=true;this.pauses++;}
  play(){this.plays++;if(this.rejectPlay)return Promise.reject(Object.assign(new Error('Autoplay blocked'),{name:'NotAllowedError'}));this.paused=false;return Promise.resolve();}
}
function setup(){const audio=new FakeAudio(),player=new StreamedMusic(()=>audio as unknown as HTMLAudioElement);return {audio,player};}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
void test('all four courses select deterministic playlists for all three speed classes, with faster primary tracks at higher cc',()=>{
  const used=new Set<string>();
  for(const track of ['coast','canyon','midnight','rainbow'] as MusicTrack[]){
    let previous=0;
    for(const cc of [50,100,150] as const){const music=selectMusic(track,cc);assert.ok(music.bpmEstimated>previous);previous=music.bpmEstimated;assert.equal(selectPlaylist(track,cc)[0],music);assert.deepEqual(selectPlaylist(track,cc),selectPlaylist(track,cc));used.add(music.id);}
    assert.equal(selectMusic(track),selectMusic(track,100));
  }
  assert.equal(used.size,5);assert.ok(selectMusic('rainbow',100).bpmEstimated>selectMusic('coast',100).bpmEstimated);
  for(const song of Object.values(MUSIC)){assert.ok(existsSync(new URL(`../../../public${song.path}`, import.meta.url)));assert.ok(song.energy>0&&song.energy<=1);}
});
void test('music waits for user activation, streams one element, and repeated render updates do not restart playback',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('coast',50);player.update(playlist,true);assert.equal(audio.plays,0);player.unlock();await flush();
  audio.currentTime=12;for(let i=0;i<90;i++)player.update(playlist,true);
  assert.equal(audio.plays,1);assert.equal(audio.currentTime,12);assert.equal(audio.playbackRate,1);assert.equal(audio.preservesPitch,true);assert.equal(audio.loop,true);assert.equal(audio.src,MUSIC.lap.path);player.dispose();
});
void test('pause/mute keep playback position and resume once; menu unloads the resource',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('coast',100);player.update(playlist,true);player.unlock();await flush();audio.currentTime=25;
  player.update(playlist,false);assert.equal(audio.paused,true);assert.equal(audio.currentTime,25);
  player.update(playlist,true);await flush();assert.equal(audio.plays,2);assert.equal(audio.currentTime,25);
  player.update([],false);assert.equal(audio.src,'');assert.equal(audio.loads,1);player.dispose();
});
void test('playlist advances on ended, loops through its deterministic order, and retains original pitch',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('coast',100);player.update(playlist,true);player.unlock();await flush();assert.equal(audio.loop,false);
  audio.paused=true;audio.onended?.();await flush();assert.equal(player.current,MUSIC.drift);assert.equal(audio.src,MUSIC.drift.path);
  audio.paused=true;audio.onended?.();await flush();assert.equal(player.current,MUSIC.lapAlt);assert.equal(audio.playbackRate,1);player.dispose();
});
void test('blocked autoplay does not retry every frame, and an explicit gesture retries successfully',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('rainbow',150);audio.rejectPlay=true;player.update(playlist,true);player.unlock();await flush();
  for(let i=0;i<90;i++)player.update(playlist,true);assert.equal(audio.plays,1);
  audio.rejectPlay=false;player.unlock();await flush();assert.equal(audio.plays,2);assert.equal(audio.paused,false);player.dispose();
});
void test('disposing while play is pending cannot revive music and subsequent updates are inert',async()=>{
  const {audio,player}=setup();player.update(selectPlaylist('rainbow',150),true);player.unlock();player.dispose();await flush();
  assert.equal(audio.paused,true);assert.equal(audio.src,'');assert.equal(audio.onended,null);player.unlock();player.update(selectPlaylist('coast',50),true);assert.equal(audio.plays,1);
});
void test('changing playlists updates native looping even when the first song stays the same',async()=>{
  const {audio,player}=setup();player.update(selectPlaylist('coast',50),true);player.unlock();await flush();assert.equal(audio.loop,true);
  player.update(selectPlaylist('canyon',50),true);await flush();assert.equal(audio.src,MUSIC.lap.path);assert.equal(audio.loop,false);
  player.update(selectPlaylist('coast',50),true);await flush();assert.equal(audio.loop,true);
  player.update(selectPlaylist('canyon',50),true);await flush();audio.paused=true;audio.onended?.();await flush();assert.equal(player.current,MUSIC.lapAlt);player.dispose();
});
void test('pausing a pending play ignores its expected AbortError and resumes without another unlock gesture',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('coast',50);let rejectStartup:(reason:Error)=>void=()=>{};
  audio.play=()=>{audio.plays++;audio.paused=false;return audio.plays===1?new Promise<void>((_,reject)=>{rejectStartup=reject;}):Promise.resolve();};
  player.update(playlist,true);player.unlock();player.update(playlist,false);rejectStartup(Object.assign(new Error('Play interrupted by pause'),{name:'AbortError'}));await flush();
  assert.equal(audio.paused,true);player.update(playlist,true);await flush();assert.equal(audio.plays,2);assert.equal(audio.paused,false);player.dispose();
});
void test('a missing music file advances once, and a stale failure cannot skip the healthy replacement',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('coast',100);player.update(playlist,true);player.unlock();await flush();
  const staleError=audio.onerror;audio.error={code:4};audio.onerror?.();await flush();assert.equal(player.current,MUSIC.drift);assert.equal(audio.plays,2);
  staleError?.();await flush();assert.equal(player.current,MUSIC.drift);assert.equal(audio.plays,2);player.dispose();assert.equal(audio.onerror,null);
});
void test('failed playlists stop after one attempt per song and explicit gestures retry them',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('coast',100);player.update(playlist,true);player.unlock();await flush();
  for(let i=0;i<2;i++){audio.error={code:2};audio.onerror?.();await flush();}
  for(let i=0;i<100;i++)player.update(playlist,true);assert.equal(audio.plays,2);assert.equal(audio.paused,true);
  player.unlock();await flush();assert.equal(audio.plays,3);assert.equal(player.current,MUSIC.lapAlt);
  audio.error={code:3};audio.onerror?.();await flush();assert.equal(player.current,MUSIC.drift);audio.error=null;
  audio.paused=true;audio.onended?.();await flush();assert.equal(player.current,MUSIC.drift,'normal looping skips the broken song');assert.equal(audio.plays,5);player.dispose();
});
void test('a one-song failed playlist remains bounded until the next retry cycle',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('coast',50);player.update(playlist,true);player.unlock();await flush();audio.error={code:4};audio.onerror?.();await flush();
  for(let i=0;i<100;i++)player.update(playlist,true);assert.equal(audio.plays,1);
  player.retryFailed();player.update(playlist,true);await flush();assert.equal(audio.plays,2);player.dispose();
});
void test('unsupported play promises advance the playlist without treating autoplay policy as a bad song',async()=>{
  const {audio,player}=setup();audio.play=()=>{audio.plays++;if(audio.plays===1)return Promise.reject(Object.assign(new Error('Unsupported source'),{name:'NotSupportedError'}));audio.paused=false;return Promise.resolve();};
  player.update(selectPlaylist('coast',100),true);player.unlock();await flush();assert.equal(audio.plays,2);assert.equal(player.current,MUSIC.drift);player.dispose();
});
void test('an interrupted media load advances, while an obsolete error after pausing does not skip a song',async()=>{
  const {audio,player}=setup(),playlist=selectPlaylist('coast',100);player.update(playlist,true);player.unlock();await flush();
  audio.error={code:1};audio.onerror?.();await flush();assert.equal(player.current,MUSIC.drift);
  player.update(playlist,false);audio.error=null;audio.onerror?.();assert.equal(player.current,MUSIC.drift);player.dispose();
});
