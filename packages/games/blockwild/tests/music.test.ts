import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundMusic, SOUNDTRACKS } from '../src/music';
class Media{
 src='';preload='';loop=true;paused=true;currentTime=0;plays=0;loads=0;blocked=false;
 onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
 play(){this.plays++;this.paused=false;return this.blocked?Promise.reject(new Error('Gesture required')):Promise.resolve();}
 pause(){this.paused=true;}
 removeAttribute(){this.src='';}
 load(){this.loads++;}
}
function setup(){
 const media=new Media(),source={connect(){},disconnect(){this.closed=true;},closed:false},gain={...source,gain:{value:1}};
 const ctx={createMediaElementSource:()=>source,createGain:()=>gain} as unknown as AudioContext;
 return {media,source,gain,music:new BackgroundMusic(ctx,{} as AudioNode,media as unknown as HTMLAudioElement)};
}
test('streams all four tracks in order and wraps to the first without layering',()=>{
 const {media,music,gain}=setup();assert.equal(media.plays,0);assert.equal(media.preload,'none');assert.equal(media.loop,false);assert.equal(gain.gain.value,.18);
 music.setPlaying(true);
 for(let i=0;i<8;i++){assert.equal(media.src,`/games/blockwild/music/${SOUNDTRACKS[i%4]}.mp3`);media.onended!();}
 assert.equal(media.plays,9);music.dispose();
});
test('mute and inactive scenes pause in place; repeated frames do not restart music',()=>{
 const {media,music}=setup();music.setPlaying(true);media.currentTime=27;
 for(let i=0;i<100;i++)music.setPlaying(true);assert.equal(media.plays,1);
 music.setPlaying(false);assert.equal(media.paused,true);assert.equal(media.currentTime,27);
 music.setPlaying(true);assert.equal(media.plays,2);assert.equal(media.currentTime,27);
 music.setPlaying(false);media.onended!();assert.equal(media.plays,2);music.dispose();
});
test('failed tracks are skipped and a missing whole playlist stops after four attempts',()=>{
 const {media,music}=setup();music.setPlaying(true);
 for(let i=0;i<4;i++)media.onerror!();assert.equal(media.plays,4);assert.equal(media.paused,true);
 for(let i=0;i<100;i++)music.setPlaying(true,true);assert.equal(media.plays,4);music.dispose();
});
test('a blocked play retries on a gesture, and disposal cancels playback and releases nodes',async()=>{
 const {media,music,source,gain}=setup();media.blocked=true;music.setPlaying(true);await Promise.resolve();
 music.setPlaying(true);assert.equal(media.plays,1);media.blocked=false;music.setPlaying(true,true);assert.equal(media.plays,2);
 const ended=media.onended!;music.dispose();ended();music.setPlaying(true,true);
 assert.equal(media.plays,2);assert.equal(media.paused,true);assert.equal(media.src,'');assert.equal(media.loads,1);assert.equal(media.onended,null);assert.equal(media.onerror,null);assert.equal(source.closed,true);assert.equal(gain.closed,true);
});
