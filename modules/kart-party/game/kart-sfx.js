import { createAudio } from './soundforge/engine.js';

export const KART_VOICES=(k)=>{
  const {osc,noise,gain,filt,adsr,hit,sweep,lfo,vary}=k;
  const ping=(t0,out,f=880,peak=.3,dur=.16,type='square')=>{const s=osc(type,vary(f,18),t0,dur),g=gain(0);hit(g.gain,t0,peak,dur);s.connect(g);g.connect(out);return s;};
  const rush=(t0,out,from,to,peak=.32,dur=.38)=>{const n=noise(t0,dur,1.15),bp=filt('bandpass',from,1.1),g=gain(0);sweep(bp.frequency,t0,from,to,dur);adsr(g.gain,t0,peak,.004,.08,.45,dur*.35,.12);n.connect(bp);bp.connect(g);g.connect(out);return n;};
  const voices={
    roulette_tick:{bus:'sfx',prio:2,poly:2,dur:.06,build(t,o){return [ping(t,o,1100,.11,.055)];}},
    item_reveal:{bus:'sfx',prio:5,poly:1,dur:.72,duck:{amount:.72,hold:.2,release:.25},build(t,o){return [ping(t,o,523,.18,.22),ping(t+.075,o,659,.16,.22),ping(t+.15,o,784,.15,.24),ping(t+.26,o,1047,.13,.3,'sine')];}},
    coin:{bus:'sfx',prio:2,poly:3,dur:.18,build(t,o){return [ping(t,o,1320,.13,.16,'sine'),ping(t+.025,o,2000,.08,.12,'sine')];}},
    boost_launch:{bus:'sfx',prio:5,poly:2,dur:.55,duck:{amount:.76,hold:.15,release:.3},build(t,o){const a=osc('sawtooth',90,t,.5),g=gain(0);sweep(a.frequency,t,90,340,.45);adsr(g.gain,t,.32,.003,.08,.55,.25,.14);a.connect(g);g.connect(o);return [a,rush(t,o,350,2400,.24,.48)];}},
    shell_launch:{bus:'sfx',prio:5,poly:3,dur:.45,build(t,o){const a=osc('sawtooth',180,t,.4),g=gain(0);sweep(a.frequency,t,180,720,.36);adsr(g.gain,t,.24,.004,.07,.5,.18,.12);a.connect(g);g.connect(o);return [a,rush(t,o,500,1900,.22,.38)];}},
    banana_drop:{bus:'sfx',prio:4,poly:3,dur:.3,build(t,o){const a=osc('triangle',vary(190,45),t,.25),g=gain(0);sweep(a.frequency,t,190,72,.2);hit(g.gain,t,.4,.24);a.connect(g);g.connect(o);return [a,ping(t+.04,o,620,.12,.1,'sine')];}},
    shield_on:{bus:'sfx',prio:6,poly:2,dur:.65,duck:{amount:.8,hold:.12,release:.3},build(t,o){return [ping(t,o,440,.2,.38,'sine'),ping(t+.04,o,665,.13,.45,'sine'),rush(t,o,420,2200,.2,.48)];}},
    pulse_blast:{bus:'sfx',prio:8,poly:1,dur:.8,duck:{amount:.48,hold:.35,release:.5},build(t,o){const a=osc('sine',115,t,.7),g=gain(0);sweep(a.frequency,t,115,42,.5);adsr(g.gain,t,.7,.002,.12,.35,.22,.3);a.connect(g);g.connect(o);return [a,rush(t,o,2400,280,.55,.65)];}},
    triple_launch:{bus:'sfx',prio:6,poly:1,dur:.7,build(t,o){return [ping(t,o,392,.2,.22,'sawtooth'),ping(t+.13,o,587,.2,.22,'sawtooth'),ping(t+.26,o,784,.2,.24,'sawtooth'),rush(t,o,700,1900,.18,.55)];}},
    oil_drop:{bus:'sfx',prio:4,poly:3,dur:.5,build(t,o){const a=osc('sawtooth',92,t,.43),g=gain(0),lp=filt('lowpass',420,3);lfo(a.frequency,t,.4,12,20);adsr(g.gain,t,.28,.01,.1,.5,.15,.18);a.connect(lp);lp.connect(g);g.connect(o);return [a,rush(t,o,500,130,.18,.35)];}},
    frost_launch:{bus:'sfx',prio:5,poly:3,dur:.55,build(t,o){return [ping(t,o,920,.18,.35,'sine'),ping(t+.025,o,1230,.1,.28,'sine'),rush(t,o,3000,900,.16,.44)];}},
    magnet_on:{bus:'sfx',prio:5,poly:2,dur:.7,build(t,o){const a=osc('sine',240,t,.65),g=gain(0);lfo(a.frequency,t,.65,9,48);adsr(g.gain,t,.32,.03,.1,.65,.3,.18);a.connect(g);g.connect(o);return [a,ping(t+.18,o,720,.13,.3,'sine')];}},
    star_on:{bus:'sfx',prio:8,poly:1,dur:1,duck:{amount:.5,hold:.5,release:.5},build(t,o){return [523,659,784,1047,1319].map((f,i)=>ping(t+i*.09,o,f,.2-i*.018,.32,i%2?'sine':'square'));}},
    rocket_launch:{bus:'sfx',prio:7,poly:2,dur:.72,duck:{amount:.65,hold:.25,release:.4},build(t,o){const a=osc('sawtooth',72,t,.68),g=gain(0),lp=filt('lowpass',600,2);sweep(a.frequency,t,72,190,.58);sweep(lp.frequency,t,500,2400,.55);adsr(g.gain,t,.38,.004,.1,.65,.32,.18);a.connect(lp);lp.connect(g);g.connect(o);return [a,rush(t,o,600,3200,.42,.65)];}},
    decoy_drop:{bus:'sfx',prio:4,poly:3,dur:.45,build(t,o){return [ping(t,o,740,.22,.16,'triangle'),ping(t+.13,o,370,.28,.28,'square')];}},
    hit_stun:{bus:'sfx',prio:8,poly:3,dur:.55,duck:{amount:.55,hold:.2,release:.35},build(t,o){const a=osc('square',105,t,.45),g=gain(0);sweep(a.frequency,t,105,42,.35);hit(g.gain,t,.62,.42);a.connect(g);g.connect(o);return [a,rush(t,o,2400,380,.48,.4)];}},
    hit_frost:{bus:'sfx',prio:8,poly:3,dur:.65,duck:{amount:.58,hold:.2,release:.35},build(t,o){return [ping(t,o,1100,.28,.4,'sine'),ping(t+.02,o,1460,.18,.3,'sine'),rush(t,o,3600,700,.42,.5)];}},
    hit_oil:{bus:'sfx',prio:7,poly:3,dur:.52,build(t,o){const a=osc('sawtooth',140,t,.48),g=gain(0);lfo(a.frequency,t,.45,15,55);sweep(a.frequency,t,140,58,.42);hit(g.gain,t,.45,.45);a.connect(g);g.connect(o);return [a,rush(t,o,620,180,.28,.42)];}},
    hit_decoy:{bus:'sfx',prio:8,poly:2,dur:.7,duck:{amount:.52,hold:.25,release:.4},build(t,o){return [784,587,392,196].map((f,i)=>ping(t+i*.08,o,f,.22,.25,'square')).concat(rush(t,o,2800,320,.48,.55));}},
    shield_block:{bus:'alert',prio:9,poly:2,dur:.65,duck:{amount:.55,hold:.22,release:.4},build(t,o){return [ping(t,o,620,.55,.5,'sine'),ping(t+.018,o,887,.35,.38,'sine'),ping(t+.035,o,1314,.22,.3,'sine'),rush(t,o,900,4200,.4,.45)];}},
    kart_bump:{bus:'sfx',prio:6,poly:3,dur:.42,build(t,o,v){const strength=Math.max(.25,Math.min(1,v.value??.5)),body=osc('triangle',vary(135,70),t,.3),bg=gain(0);sweep(body.frequency,t,145,58,.24);hit(bg.gain,t,.24+.3*strength,.28);body.connect(bg);bg.connect(o);const scrape=noise(t+.018,.24,1.25),bp=filt('bandpass',1700,1.6),sg=gain(0);sweep(bp.frequency,t+.018,2400,520,.2);hit(sg.gain,t+.018,.18+.25*strength,.2);scrape.connect(bp);bp.connect(sg);sg.connect(o);return [body,scrape];}},
    countdown:{bus:'sfx',prio:5,poly:1,dur:.18,build(t,o){return [ping(t,o,440,.28,.16,'square')];}},
    go:{bus:'sfx',prio:7,poly:1,dur:.55,build(t,o){return [ping(t,o,440,.24,.24),ping(t+.08,o,659,.23,.25),ping(t+.16,o,880,.22,.28)];}},
    finish:{bus:'sfx',prio:9,poly:1,dur:1.25,duck:{amount:.45,hold:.7,release:.55},build(t,o){return [523,659,784,1047,1319].map((f,i)=>ping(t+i*.13,o,f,.26-i*.02,.38,i%2?'sine':'square'));}},
  };return voices;
};

export function createKartSfx(context,options={}){
  const audio=createAudio({level:.24,maxVoices:28,noiseSeconds:1.25,voices:KART_VOICES,rng:options.rng,safety:'softclip',buses:{sfx:{role:'sfx',ducked:false},alert:{role:'alert',ducked:false}}});audio.attach(context);return audio;
}
