import { BoxGeometry, CanvasTexture, CircleGeometry, Color, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshToonMaterial, Scene, SphereGeometry, SRGBColorSpace, TorusGeometry, type BufferGeometry, type Material } from 'three';
import { getStage, stageFrame, type StageId } from './stages';
/** Original procedural scenery. Walkable geometry is generated only from the shared stage surfaces. */
export function createStageScene(scene: Scene, id: StageId) {
  const stage = getStage(id), root = new Group(), owned: { dispose(): void }[] = [], own = <T extends { dispose(): void }>(r: T): T => { owned.push(r); return r; };
  scene.add(root);
  const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 256;
  const g = canvas.getContext('2d')!, gradient = g.createLinearGradient(0,0,0,256), sky = new Color(stage.sky);
  gradient.addColorStop(0, sky.clone().multiplyScalar(.48).getStyle()); gradient.addColorStop(.65,sky.getStyle()); gradient.addColorStop(1,new Color(stage.color).lerp(sky,.35).getStyle());
  g.fillStyle = gradient; g.fillRect(0,0,8,256); const background = own(new CanvasTexture(canvas)); background.colorSpace = SRGBColorSpace; scene.background = background;
  const box = own(new BoxGeometry(1,1,1)), sphere = own(new SphereGeometry(1,12,8)), cone = own(new ConeGeometry(1,1,8)), cylinder = own(new CylinderGeometry(1,1,1,12)), disc = own(new CircleGeometry(1,40)), ring = own(new TorusGeometry(1,.045,5,48));
  const materials = new Map<string, Material>();
  const mat = (color: string, glow = false) => { const key = color+glow; if (!materials.has(key)) materials.set(key,own(glow ? new MeshBasicMaterial({color}) : new MeshToonMaterial({color}))); return materials.get(key)!; };
  const mesh = (parent: Group, geometry: BufferGeometry, color: string, x: number,y: number,z: number,w: number,h: number,d: number,glow = false) => { const m = new Mesh(geometry,mat(color,glow)); m.position.set(x,y,z); m.scale.set(w,h,d); parent.add(m); return m; };
  const block = (parent: Group,color: string,x: number,y: number,z: number,w: number,h: number,d: number,glow = false) => mesh(parent,box,color,x,y,z,w,h,d,glow);
  const orb = (parent: Group,color: string,x: number,y: number,z: number,w: number,h = w,d = w) => mesh(parent,sphere,color,x,y,z,w,h,d);
  const band = (parent: Group,color: string,x: number,y: number,z: number,r: number) => mesh(parent,ring,color,x,y,z,r,r,1,true);
  const back = new Group(); root.add(back);
  const cloud = (x: number,y: number,z: number,size: number,color = '#e9e5e1') => { for (let i=0;i<4;i++) orb(back,color,x+(i-1.5)*size*.85,y+(i%2)*size*.24,z,size,size*.5,size*.5); };
  const tree = (x: number,y: number,z: number,size: number,leaves = '#659962') => { mesh(back,cylinder,'#7c624b',x,y+size*1.6,z,size*.25,size*3.2,size*.25); for (let i=0;i<5;i++) orb(back,leaves,x+Math.sin(i*2.4)*size*1.2,y+size*(3+i%2*.5),z+Math.cos(i*2.4)*size*.6,size*1.3,size,size); };
  const tower = (x: number,y: number,z: number,size: number,roof = stage.color) => { mesh(back,cylinder,stage.ground,x,y+size*1.5,z,size*.7,size*3,size*.7); mesh(back,cone,roof,x,y+size*3.4,z,size,size*1.5,size); block(back,'#554960',x,y+size*1.8,z+size*.7,size*.3,size*.8,.1); };
  const windows = (x: number,y: number,z: number,w: number,h: number,color = '#f7d999') => { for (let row=0;row<4;row++) for(let col=0;col<3;col++) block(back,color,x+(col-1)*w*.24,y+row*h*.19,z,w*.09,h*.055,.05,true); };
  const building = (x: number,y: number,z: number,w: number,h: number,color: string) => { block(back,color,x,y+h/2,z,w,h,2); windows(x,y+h*.14,z+1.02,w,h); };
  const wave = (color: string,y: number,z: number) => { block(back,color,0,y,z,70,.2,22); for(let i=0;i<12;i++) block(back,'#a9e5e7',-28+i*5,y+.03,z+5+(i%3)*2,2.3,.05,.12,true); };
  // Distant forms remain behind the fighting plane; visible props never masquerade as colliders.
  switch (stage.family) {
    case 'sky': case 'storybook':
      for(let i=0;i<7;i++) cloud(-21+i*7,1+(i%3)*3,-18-(i%2)*9,2.3,stage.family==='storybook' ? '#f5e9cb' : '#e6cbe7');
      mesh(back,disc,'#fff0bd',12,10,-40,4,4,1,true); break;
    case 'jungle':
      for(let i=0;i<7;i++) tree(-20+i*6,-6,-14-(i%2)*5,2.1+(i%3)*.4,i%2 ? '#355c50' : '#497358');
      wave('#427b77',-3,-7); break;
    case 'water':
      wave('#367f9f',-3,-8); for(let i=0;i<5;i++) cloud(-25+i*12,7+i%2*3,-35,3);
      mesh(back,disc,'#f6dbb0',14,8,-42,3,3,1,true); break;
    case 'castle':
      for(let i=0;i<5;i++) mesh(back,cone,'#6f7897',-30+i*14,2,-30,10,15+(i%2)*5,4);
      for(let i=0;i<4;i++) tower(-14+i*9,-5,-14,2.5); break;
    case 'dream':
      for(let i=0;i<10;i++) { const star=mesh(back,cone,'#f9e9a4',-20+i*4.6,5+(i%4)*2,-22,.25,.55,.15,true); star.rotation.z=i; }
      for(let i=0;i<4;i++) cloud(-18+i*12,-5,-14,3,'#b9a7d3'); break;
    case 'alien':
      for(let i=0;i<13;i++) { mesh(back,cone,i%2?'#3c384c':'#514052',-22+i*3.6,-5,-9-(i%3)*3,2,5+i%4*2,2); mesh(back,cone,'#322d42',-24+i*4,12,-12,2,7,2).rotation.z=Math.PI; }
      for(let i=0;i<9;i++) orb(back,stage.color,-18+i*4,2+(i%3)*2,-14,.2,.5,.2); break;
    case 'space':
      for(let i=0;i<48;i++) mesh(back,disc,i%4?'#c5cbea':stage.color,Math.sin(i*2.39)*35,Math.cos(i*1.72)*20,-38-(i%7),.04+(i%3)*.025,.04+(i%3)*.025,1,true);
      break;
    case 'city':
      for(let i=0;i<11;i++) building(-27+i*5.4,-6,-18-(i%3)*2,3.5,6+(i*7%11),'#39485e'); break;
    case 'ice':
      for(let i=0;i<8;i++) { mesh(back,cone,'#8ab6cf',-24+i*7,2,-20,7,18+i%3*5,5); mesh(back,cone,'#d5f0f5',-24+i*7,9+i%3*2.5,-19.9,3,7+i%3*2,3); } break;
    case 'retro':
      if(id!=='flat-zone') for(let i=0;i<6;i++) { cloud(-25+i*10,7+(i%2)*3,-24,2,'#f3e1c7'); block(back,'#c99773',-24+i*10,-3,-15,5,5+i%2*3,3); } break;
  }
  const platformGroups = new Map<string,Group>();
  for (const p of stage.platforms) {
    const group = new Group(), w = p.right-p.left, thick = p.solid ? .55 : .25, depth = p.solid ? 3.8 : 1.4, z = p.solid ? 0 : -.95;
    root.add(group); platformGroups.set(p.id,group);
    // Soft ledges sit behind the fighting plane so low platforms cannot hide a fighter’s torso.
    block(group,stage.ground,0,-thick/2,z,w,thick,depth);
    block(group,stage.color,0,-thick-.07,z,w+.08,.14,depth+.1);
    block(group,id==='flat-zone'?'#17281f':'#fff0d4',0,-.035,z+depth/2+.012,w,.07,.045,true);
    if(p.solid) {
      if(['sky','dream','storybook','alien','space'].includes(stage.family)) {
        const underside = mesh(group,cone,stage.family==='space'?'#40385c':'#62536e',0,-1.2,0,w*.38,1.8,1.4); underside.rotation.z=Math.PI;
        if(stage.family==='space') for(let i=0;i<3;i++) block(group,stage.color,(i-1)*w*.2,-.85,1.3,w*.08,.12,.05,true);
      } else if(stage.family==='jungle'||stage.family==='water') {
        for(let x=-w/2+.45;x<w/2;x+=1.2) block(group,'#765339',x,-.31,0,.08,.58,depth);
        for(const x of [-w*.36,w*.36]) mesh(group,cylinder,'#6b5245',x,-1.35,0,.16,2.2,.16);
      } else if(stage.family==='castle'||stage.family==='city') {
        block(group,stage.family==='castle'?'#978984':'#4c5268',0,-2,0,w*.92,3,depth*.88);
        for(let x=-w/2+.6;x<w/2-.2;x+=1.4) block(group,stage.family==='castle'?'#534b61':'#efda98',x,-1.6,depth*.45,.35,.65,.06,stage.family==='city');
      } else if(stage.family==='ice') {
        for(let x=-w/2+.3;x<w/2;x+=.8) mesh(group,cone,'#91cee7',x,-.95,1,.22,.95,.22).rotation.z=Math.PI;
      } else {
        for(let x=-w/2+.3;x<w/2;x+=.65) block(group,id==='flat-zone'?'#a8bc91':'#a66a47',x,-.5,depth/2+.03,.035,.7,.04);
      }
    }
    if (id==='poke-floats') {
      orb(group,['#f3a4ba','#a6d5ee','#ddb7ee','#efcf83'][Number(p.id.slice(1)) % 4],0,-.9,0,w*.52,1.35,1.7);
      for(const x of [-w*.2,w*.2]) { orb(group,'#ffffff',x,-.7,1.55,.3,.4,.12); orb(group,'#3b3551',x,-.68,1.68,.12,.2,.07); }
      for(const x of [-w*.38,w*.38]) mesh(group,cone,stage.color,x,-.15,-.3,.5,1.3,.4);
    }
    if (id==='big-blue'||id==='mute-city') {
      block(group,'#2b3953',0,-.7,0,w*.85,.45,2.8); orb(group,'#6998bd',0,-.2,-1.1,w*.22,.8,.65);
      for(const x of [-w*.35,w*.35]) block(group,'#80e7fc',x,-.75,1.6,.6,.2,.08,true);
    }
    if (p.motion && (id==='kongo-jungle'||id==='kongo-jungle-64') && p.y<0) { mesh(group,cylinder,'#a57042',0,-.6,0,.95,1.1,.95).rotation.x=Math.PI/2; band(group,'#e6c68e',0,-.6,1.12,.7); }
    if(p.motion && id==='great-bay') { orb(group,'#5b9273',0,-.8,0,w*.6,1,1.8); orb(group,'#b2c58b',w*.58,-.3,0,.8,.55,.6); }
    if(p.motion && id==='fourside') { orb(group,'#b2b9d7',0,-.6,0,w*.6,.45,1.5); orb(group,'#72c3d6',0,-.1,-.4,.8,.6,.7); for(let i=0;i<5;i++) block(group,'#ffe797',(i-2)*.65,-.7,1.2,.16,.12,.1,true); }
  }
  // Each source stage gets its own authored landmark, silhouette, and composition.
  switch(id) {
    case 'cloudbreak': for(const x of [-5,5]) cloud(x,-3.5,1,1.2); break;
    case 'peach-castle':
      tower(0,1.1,-4,1.6,'#d85d7e'); for(const x of [-6,6]) tower(x,-1,-4,1.15,'#d85d7e');
      for(const x of [-7,-5,-3,3,5,7]) block(back,'#f3e2c6',x,.4,-3,.7,.7,.8); break;
    case 'rainbow-cruise':
      mesh(back,cone,'#785363',0,-1.7,0,7,2.4,1.7).rotation.z=Math.PI;
      mesh(back,cylinder,'#b7a080',-2,3,-2,.12,7,.12); block(back,'#fff0cb',.2,4.6,-2,4.1,3.2,.08);
      for(let i=0;i<5;i++) band(back,['#ff899f','#ffd491','#e7eeab','#a5e1dd','#bab6f3'][i],0,2,-22,11+i*.55); break;
    case 'kongo-jungle': for(const x of [-7,7]) tree(x,-1,-3,1.5); block(back,'#b6e6da',-11,-1,-9,3,11,1); break;
    case 'jungle-japes':
      for(const x of [-8,0,8]) { block(back,'#916747',x,1,-3,2.8,3,2); mesh(back,cone,'#c8ad65',x,3.2,-3,2.5,1.6,2); block(back,'#403b38',x,1,-1.95,1,1.5,.05); } break;
    case 'great-bay': tower(-6,0,-4,.9,'#9f8165'); mesh(back,disc,'#e9dec1',10,10,-30,2.5,2.5,1,true); for(const x of [-10,10]) tree(x,-2,-8,1.4,'#559f85'); break;
    case 'temple':
      for(const x of [-11,-7,6,10]) { mesh(back,cylinder,'#c2baa0',x,3,-4,.45,6,.45); block(back,'#e1d0a5',x,6,-4,1.4,.3,1.4); }
      block(back,'#b4a98e',-9,6.4,-4,7,.6,1.8); mesh(back,cone,'#cebe93',-9,7.3,-4,4,1.4,1.8); band(back,'#eddaa7',2,4,-8,3.5); break;
    case 'brinstar': for(const x of [-6,6]) { orb(back,'#665376',x,2,-5,2,3,1.5); for(let i=0;i<3;i++) orb(back,'#e89070',x,1+i*1.2,-3.5,.6,.4,.4); } break;
    case 'brinstar-depths':
      orb(back,'#76835a',0,1,-6,5,5,2); for(const x of [-1.7,1.7]) { orb(back,'#ecbe78',x,3,-3.9,.6,.45,.2); orb(back,'#333340',x,3,-3.65,.18,.25,.08); }
      for(let i=0;i<5;i++) mesh(back,cone,'#ccd2ac',(i-2)*1.2,-.5,-3.9,.4,1.1,.4).rotation.z=Math.PI; break;
    case 'yoshi-story': case 'yoshi-island': case 'yoshi-island-64':
      for(let i=0;i<6;i++) { orb(back,['#cfb9dd','#f2bea3','#a5cbb5'][i%3],-16+i*6,-1,-9,3,3+i%3,1); for(let j=0;j<3;j++) block(back,'#fff0cd',-16+i*6,-1+j*.6,-7.9,.15,.3,.03); }
      if(id==='yoshi-story') for(const x of [-7,7]) { block(back,'#e7bc91',x,.5,-3,.16,3,.16); orb(back,'#f3aab8',x,2,-3,.7,.7,.2); }
      if(id==='yoshi-island') band(back,'#ffe7a6',1,3,-10,4); break;
    case 'fountain':
      mesh(back,cylinder,'#8f91c5',0,-1.1,0,6,1.1,2); mesh(back,cylinder,'#d3c7ed',0,1.2,-3,.4,3,.4); mesh(back,cone,'#ddd0ec',0,2.9,-3,2.4,.8,1.2).rotation.z=Math.PI;
      for(let i=0;i<8;i++) block(back,'#96d9ed',Math.sin(i*.85)*1.8,1.4,-3+Math.cos(i*.85)*.7,.06,2.4,.06,true); band(back,'#eec2fa',0,3.6,-7,3.7); break;
    case 'green-greens': case 'dream-land':
      tree(id==='green-greens'?0:3,-1,-5,2,id==='green-greens'?'#a5c768':'#77ab79');
      for(const x of [-.5,.5]) orb(back,'#3c4b47',x+(id==='dream-land'?3:0),3,-4.4,.15,.35,.08);
      if(id==='green-greens') for(const x of [-4.8,4.8]) for(let j=0;j<3;j++) { block(back,j===2?'#ddb57d':'#dfe4aa',x,j*.85,-2.5,.75,.75,.75); band(back,'#ab9a6f',x,j*.85,-2.1,.22); } break;
    case 'corneria':
      block(back,'#64768e',-2,-1.1,0,18,1,3.2); const nose=mesh(back,cone,'#bec8d3',10,-.8,0,2,6,1.5); nose.rotation.z=-Math.PI/2;
      orb(back,'#6ba9c3',-3,1.7,-2,2.4,1.5,1); for(const x of [-7,-5]) mesh(back,cone,'#9faabb',x,1,-3,.7,4,.5); break;
    case 'venom':
      block(back,'#8894a9',0,-1.6,-2,16,.6,3); for(const x of [-5,5]) { mesh(back,cylinder,'#5b6279',x,1,-3,1.3,5,1.3); orb(back,'#fac18f',x,-1.5,-1.5,.7,.5,.2); } break;
    case 'stadium':
      for(let i=0;i<3;i++) block(back,['#395971','#4b6b7d','#76939c'][i],0,1+i*.65,-7-i*1.3,27,.55,1.3);
      block(back,'#283f53',0,6,-10,10,4,.6); block(back,'#64a598',0,6,-9.65,9.3,3.3,.08); band(back,'#d9f2dd',0,6,-9.5,1.2);
      for(const x of [-13,13]) { mesh(back,cylinder,'#9aafbb',x,5,-7,.12,10,.12); block(back,'#e1f8ee',x,10,-7,2.3,.7,.4,true); } break;
    case 'poke-floats': for(let i=0;i<5;i++) orb(back,['#eda6c0','#9fcadd','#dfbe80'][i%3],-18+i*9,-6-i%2,-16,3,3.5,2); break;
    case 'mute-city': block(back,'#354057',0,-2,-6,50,.3,10); for(let i=0;i<12;i++) block(back,'#efb6ee',-25+i*5,-1.8,-2,2,.04,.18,true); band(back,'#e994e1',0,6,-17,6); break;
    case 'big-blue': for(const x of [-12,12]) { mesh(back,cylinder,'#a8c6d8',x,1,-8,.3,12,.3); block(back,'#b7cede',x,6,-8,4,.3,1); } break;
    case 'onett':
      for(const [x,y,color] of [[-6,1,'#dba276'],[0,2.8,'#be878c'],[6,.3,'#afc5a4']] as const) { block(back,color,x,y+1,-4,4,2,2); mesh(back,cone,'#626c8b',x,y+2.6,-4,3,1.4,1.5); block(back,'#eee0bd',x,y+1,-2.95,1,.8,.04); }
      block(back,'#484f60',0,-2,-7,45,.2,6); break;
    case 'fourside': building(0,-6,-6,4,8,'#606486'); mesh(back,cone,'#a4a6ca',0,4,-6,2,4,1.5); mesh(back,disc,'#e5dabe',14,11,-35,3,3,1,true); break;
    case 'icicle-mountain': for(let i=0;i<9;i++) mesh(back,cone,'#a0deed',-10+i*2.5,-2,-4,.6,3+i%3,1).rotation.z=Math.PI; band(back,'#b1ecec',0,11,-20,7); break;
    case 'mushroom-kingdom':
      for(const x of [-8,8]) { mesh(back,cylinder,'#61a374',x,1,-3,.8,2,.8); mesh(back,cylinder,'#9aca8d',x,2,-3,1,.35,1); }
      for(let i=0;i<5;i++) block(back,i%2?'#dfae61':'#bc8050',-2+i,5.8,-4,.85,.85,.85); break;
    case 'mushroom-kingdom-ii':
      block(back,'#d2a576',-5,1,-4,3.5,3,2); block(back,'#72525a',-5,1,-2.95,1.4,2,.1); orb(back,'#b77680',7,1,-4,1.8,1.7,1); for(const x of [6.5,7.5]) orb(back,'#eee1c3',x,1.5,-3.1,.2,.4,.1); break;
    case 'flat-zone':
      block(back,'#819276',0,3,-7,23,14,1); block(back,'#c5d1af',0,3,-6.4,19,10,.15); for(let i=0;i<3;i++) block(back,'#344437',-7+i*7,6.5,-6.2,2,.13,.1);
      for(const x of [-10.5,10.5]) orb(back,'#354537',x,0,-5.5,.65,.65,.2); break;
    case 'kongo-jungle-64':
      mesh(back,disc,'#f0c391',-9,6,-25,4,4,1,true); for(const x of [-8,8]) tree(x,-2,-4,1.5,'#5b7960'); break;
    case 'battlefield': for(let i=0;i<3;i++) { const r=band(back,['#6f689a','#b8a3d5','#ded0e9'][i],0,3,-9-i*4,6+i*2); r.rotation.x=.25+i*.2; r.rotation.y=.35; } break;
    case 'final-destination':
      for(let i=0;i<6;i++) { const r=band(back,i%2?'#8c63bc':'#d798df',0,3,-10-i*4,3+i*1.8); r.rotation.x=.5; r.rotation.y=.4+i*.12; }
      for(let i=0;i<7;i++) block(back,'#c39ce6',-6+i*2,-.5,1.8,.08,.12,.05,true); break;
  }
  // Wider arenas have readable outer landmarks and layered horizons, all behind the collision plane.
  const extent = stage.blastX - 6;
  switch (stage.family) {
    case 'castle':
      for (const x of [-extent*.85, extent*.85]) { tower(x,-2,-9,2.8,id==='temple'?'#bca989':'#d85d7e'); block(back,stage.ground,x,4,-9,7,.5,2); }
      for (const x of [-extent*.48, extent*.48]) { const arch=mesh(back,ring,stage.ground,x,4,-12,5,6,1); arch.scale.z=8; } break;
    case 'sky': case 'storybook':
      for (const x of [-extent*.85, extent*.85]) { cloud(x,-4,-4,3); if(id==='cloudbreak') { tower(x,-1,-5,1.8,'#cb8767'); band(back,'#f3dba5',x,5,-8,3.5); } }
      if(id==='rainbow-cruise') for(const x of [-18,19]) { mesh(back,cone,'#795364',x,-2,-3,5,3,2).rotation.z=Math.PI; block(back,'#f5e2be',x,4,-5,4,5,.12); mesh(back,cylinder,'#ae8b70',x-2,2,-5,.12,10,.12); } break;
    case 'jungle':
      for(const x of [-extent*.9,extent*.9]) { tree(x,-2,-7,3.5,'#436e55'); block(back,'#b0e4d5',x*.73,-4,-12,2.7,18,.5); }
      for(let i=0;i<7;i++) block(back,'#75533e',-extent+i*extent/3,5.7-Math.sin(i/6*Math.PI)*1.4,-6,extent/3+.1,.12,.2); break;
    case 'water':
      wave('#205577',-6,-16); for(const x of [-extent,extent]) { mesh(back,cone,'#557990',x,-2,-12,6,14,5); tower(x*.9,1,-10,1.6,'#ded1a5'); }
      if(id==='big-blue') for(const x of [-23,23]) { block(back,'#354662',x,-.8,-2,8,1.3,3); orb(back,'#83cde2',x,0,-3,2.5,1.2,1); } break;
    case 'alien':
      for(let i=0;i<9;i++) { const x=-extent+i*extent/4; mesh(back,cone,'#584464',x,-5,-10,2,10+i%3*3,2); band(back,stage.color,x,4+i%3,-15,2.2); } break;
    case 'dream':
      for(const x of [-extent*.85,extent*.85]) { tree(x,-1,-8,2.5,id==='fountain'?'#9685bd':'#7fab79'); band(back,'#e2c4ed',x,5,-13,4.5); }
      if(id==='fountain') for(const x of [-15,15]) { mesh(back,cylinder,'#b3a6d3',x,1,-4,.45,5,.45); mesh(back,cone,'#d9d1ed',x,4,-4,3,.8,1.5).rotation.z=Math.PI; } break;
    case 'space':
      for(const x of [-extent*.9,extent*.9]) { const orbit=band(back,stage.color,x,3,-20,7); orbit.rotation.y=.65; mesh(back,disc,'#677799',x*1.6,5,-48,8,8,1,true); }
      if(id==='corneria'||id==='venom') for(const x of [-23,23]) { block(back,'#6c7b94',x,-1,-4,9,1.2,3); mesh(back,cone,'#aebdce',x,2,-5,1,6,1); } break;
    case 'city':
      for(let i=0;i<9;i++) building(-extent+i*extent/4,-8,-14-i%3*3,3.6,12+i%4*2,'#43516c');
      for(const x of [-extent*.8,extent*.8]) { block(back,'#29354e',x,6,-8,6,3,.4); block(back,stage.color,x,6,-7.75,5.3,2.3,.05,true); } break;
    case 'ice':
      for(const x of [-extent*.8,extent*.8]) { mesh(back,cone,'#76adca',x,5,-14,8,30,7); mesh(back,cone,'#d0f0f4',x,15,-13.9,3,10,3); }
      band(back,'#8cdbe5',0,16,-26,12); break;
    case 'retro':
      for(const x of [-extent*.85,extent*.85]) { block(back,stage.ground,x,2,-6,6,7,2); for(let i=0;i<3;i++) block(back,stage.color,x+(i-1)*2,6,-6,1.5,1.5,2); }
      break;
  }
  const hazardGroup = new Group(); root.add(hazardGroup);
  const hazardMaterial = own(new MeshBasicMaterial({color:'#ffb45c',transparent:true,opacity:.18,depthWrite:false}));
  const hazardVolume = new Mesh(box,hazardMaterial); hazardGroup.add(hazardVolume);
  const hazardRim = block(hazardGroup,'#ffd890',0,0,2.2,1,.08,.08,true);
  const car = new Group(); root.add(car); block(car,'#fa957d',0,.45,0,2.7,.7,1.6); block(car,'#97d7ee',.1,1,0,1.3,.5,1.4);
  for(const x of [-.85,.85]) orb(car,'#30354b',x,.05,1,.3,.3,.14);
  const warningMarks = new Group(); root.add(warningMarks);
  for(let i=0;i<5;i++) { const m=mesh(warningMarks,cone,'#ffd392',(i-2)*1.2,0,2.3,.2,.4,.06,true); m.rotation.z=Math.PI; }
  const elementColors = ['#87ed9c','#ecab78','#8cdbe8','#d8c796'];
  function update(frame: number, hazards: boolean, reduced: boolean) {
    const current = stageFrame(id,frame,hazards);
    for(const p of current.platforms) platformGroups.get(p.id)!.position.set((p.left+p.right)/2,p.y,0);
    const h=current.hazard, visible=!!h&&(h.active||h.warning); hazardGroup.visible=visible; warningMarks.visible=!!h?.warning; car.visible=!!h?.active&&h.kind==='traffic';
    if(h&&visible) {
      const left=h.kind==='traffic'&&h.warning ? -stage.blastX : h.x;
      hazardVolume.position.set(left,h.y+h.height/2,0); hazardVolume.scale.set(h.width,Math.max(.05,h.height),3.8);
      hazardMaterial.color.set(h.warning?'#ffc16d':h.kind==='lava'?'#fa7950':h.kind==='wind'?'#bceef2':'#ffe7b0'); hazardMaterial.opacity=h.warning?.12:h.kind==='wind'?.08:.4;
      hazardRim.position.set(left,h.y+h.height,2.2); hazardRim.scale.x=h.width;
      warningMarks.position.set(h.kind==='traffic'?0:h.x,h.y+Math.min(h.height,4)+.7,0);
      if(car.visible) { car.position.set(h.x,h.y,0); car.scale.x=h.direction; hazardVolume.visible=false; } else hazardVolume.visible=true;
    }
    // Decorative element cycle; gameplay surfaces always follow the authoritative clock even with reduced motion.
    if(id==='stadium') { const color=elementColors[Math.floor(frame/1200)%4]; const material=materials.get('#64a598false'); if(material instanceof MeshToonMaterial) material.color.set(color); }
    if(!reduced && (id==='final-destination'||id==='battlefield')) for(const child of back.children) if(child instanceof Mesh&&child.geometry===ring) child.rotation.z=frame*.0005;
  }
  update(0,true,true);
  return { update, dispose() { scene.remove(root); if(scene.background===background) scene.background=null; owned.forEach(r=>r.dispose()); root.clear(); } };
}
