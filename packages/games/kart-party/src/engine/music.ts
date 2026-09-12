import type { SpeedClass, TrackId } from './types';

export type MusicTrack = TrackId;
export type MusicSpeedClass = SpeedClass;
export type AudioMode = 'solo' | 'party' | 'controller' | 'display';
export type Music = {id:string;title:string;path:string;bpmEstimated:number;energy:number;durationSeconds:number;rmsDb:number};
export const MUSIC = {
  lap:{id:'lap',title:'Rainbow Lap Rush',path:'/games/kart-party/music/rainbow-lap-rush.mp3',bpmEstimated:130,energy:.31,durationSeconds:127.33,rmsDb:-17.58},
  lapAlt:{id:'lap-alt',title:'Rainbow Lap Rush · Alternate',path:'/games/kart-party/music/rainbow-lap-rush-alt.mp3',bpmEstimated:140,energy:.48,durationSeconds:173.17,rmsDb:-17.48},
  drift:{id:'drift',title:'Rainbow Drift Dash',path:'/games/kart-party/music/rainbow-drift-dash.mp3',bpmEstimated:145,energy:.57,durationSeconds:294.97,rmsDb:-18.81},
  sugar:{id:'sugar',title:'Sugar Rush Circuit',path:'/games/kart-party/music/sugar-rush-circuit.mp3',bpmEstimated:162,energy:.62,durationSeconds:98.57,rmsDb:-20.08},
  sugarAlt:{id:'sugar-alt',title:'Sugar Rush Circuit · Alternate',path:'/games/kart-party/music/sugar-rush-circuit-alt.mp3',bpmEstimated:164,energy:.80,durationSeconds:293.97,rmsDb:-17.49},
} as const satisfies Record<string,Music>;
const {lap,lapAlt,drift,sugar,sugarAlt}=MUSIC;
const PLAYLISTS:Record<MusicTrack,Record<MusicSpeedClass,readonly Music[]>>={
  coast:{50:[lap],100:[lapAlt,drift],150:[sugar,sugarAlt],200:[sugarAlt,sugar]},
  canyon:{50:[lap,lapAlt],100:[drift,lapAlt],150:[sugar,sugarAlt],200:[sugarAlt,sugar]},
  midnight:{50:[lapAlt,lap],100:[drift,lapAlt],150:[sugarAlt,sugar],200:[sugarAlt,sugar]},
  rainbow:{50:[drift,lapAlt],100:[sugar,drift],150:[sugarAlt,sugar],200:[sugarAlt,sugar]},
};
export const selectPlaylist=(track:MusicTrack,speedClass:MusicSpeedClass=100):readonly Music[]=>PLAYLISTS[track][speedClass];
export const selectMusic=(track:MusicTrack,speedClass:MusicSpeedClass=100):Music=>selectPlaylist(track,speedClass)[0];

// One streamed element avoids decoding five multi-minute songs into mobile AudioBuffers.
export class StreamedMusic {
  private audio:HTMLAudioElement|null=null;
  private playlist:readonly Music[]=[];
  private index=0;
  private wanted=false;
  private unlocked=false;
  private blocked=false;
  private pending=false;
  private generation=0;
  private disposed=false;
  private failed=new Set<string>();
  constructor(private readonly createAudio:()=>HTMLAudioElement=()=>new Audio()){}
  get current():Music|null{return this.playlist[this.index]??null;}
  retryFailed(){
    if(this.disposed)return;
    const exhausted=this.current&&this.failed.has(this.current.id);this.failed.clear();
    if(exhausted){this.index=0;this.generation++;this.pending=false;this.releaseSource();}
  }
  unlock(){if(this.disposed)return;this.unlocked=true;this.blocked=false;this.retryFailed();this.play();}
  update(playlist:readonly Music[],enabled:boolean){
    if(this.disposed)return;
    const changed=playlist.map(song=>song.id).join(',')!==this.playlist.map(song=>song.id).join(',');
    this.wanted=enabled;
    if(changed){this.failed.clear();this.playlist=playlist;this.index=0;this.generation++;this.pending=false;this.audio?.pause();if(!playlist.length)this.releaseSource();}
    if(!enabled){if(this.pending){this.generation++;this.pending=false;}if(this.audio&&!this.audio.paused)this.audio.pause();return;}
    this.play();
  }
  private play(){
    const song=this.current;if(!song||!this.wanted||!this.unlocked||this.blocked||this.pending||this.disposed||this.failed.has(song.id))return;
    if(!this.audio){this.audio=this.createAudio();this.audio.preload='metadata';this.audio.onended=()=>{if(this.disposed||!this.playlist.length)return;this.advance();};}
    const audio=this.audio;
    if(audio.getAttribute('src')!==song.path){audio.pause();audio.src=song.path;audio.playbackRate=1;audio.preservesPitch=true;audio.volume=Math.min(.5,.34*10**((-18-song.rmsDb)/20));}
    audio.loop=this.playlist.length===1;
    if(!audio.paused)return;
    const generation=this.generation;
    audio.onerror=()=>{if(audio.error)this.fail(generation,song.id);};
    this.pending=true;
    void audio.play().then(()=>{
      if(generation!==this.generation||this.disposed)return;
      this.pending=false;if(!this.wanted)audio.pause();
    }).catch((error:unknown)=>{
      if(generation!==this.generation||this.disposed)return;
      this.pending=false;
      if(error instanceof Error&&(error.name==='NotAllowedError'||error.name==='AbortError'))this.blocked=true;
      else this.fail(generation,song.id);
    });
  }
  private fail(generation:number,id:string){
    if(generation!==this.generation||this.disposed||this.current?.id!==id)return;
    this.failed.add(id);this.audio?.pause();this.advance();
  }
  private advance(){
    this.generation++;this.pending=false;
    for(let offset=1;offset<=this.playlist.length;offset++){
      const next=(this.index+offset)%this.playlist.length;
      if(!this.failed.has(this.playlist[next].id)){this.index=next;this.play();return;}
    }
  }
  private releaseSource(){if(this.audio){this.audio.onerror=null;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();}}
  dispose(){if(this.disposed)return;this.disposed=true;this.generation++;if(this.audio)this.audio.onended=null;this.releaseSource();this.audio=null;this.playlist=[];}
}
