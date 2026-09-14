/** Authored arenas guided by the 29 versus GrKind entries; no original stage archives or coordinates. */
export type Platform = { id: string; left: number; right: number; y: number; solid: boolean };
type Motion = { x?: number; y?: number; period: number; phase?: number };
type Surface = Platform & { motion?: Motion };
export type HazardKind = 'lava' | 'wind' | 'traffic' | 'pulse' | 'geyser';
export type Hazard = { kind: HazardKind; label: string; x: number; y: number; width: number; height: number; warning: boolean; active: boolean; direction: number };
type HazardSpec = { kind: HazardKind; label: string; x?: number; y?: number; width?: number; height?: number; period?: number; duration?: number; direction?: number };
export type Stage = { name: string; source: string | null; grKind: number | null; description: string; color: string; sky: string; ground: string; family: 'sky' | 'castle' | 'jungle' | 'water' | 'alien' | 'storybook' | 'dream' | 'space' | 'city' | 'ice' | 'retro'; platforms: Surface[]; hazard?: HazardSpec; blastX: number; blastBottom: number; blastTop: number };
const p = (left: number, right: number, y = 0, solid = false, motion?: Motion): Surface => ({ id: '', left, right, y, solid, motion });
const arena = (name: string, source: string | null, grKind: number | null, family: Stage['family'], color: string, sky: string, ground: string, description: string, platforms: Surface[], hazard?: HazardSpec): Stage => {
  const horizontal = Math.max(...platforms.map(p => Math.max(Math.abs(p.left), Math.abs(p.right)) + (p.motion?.x ?? 0)));
  const top = Math.max(...platforms.map(p => p.y + (p.motion?.y ?? 0)));
  const bottom = Math.min(...platforms.map(p => p.y - (p.motion?.y ?? 0)));
  return { name, source, grKind, family, color, sky, ground, description, platforms: platforms.map((p, i) => ({ ...p, id: `p${i}` })), hazard, blastX: Math.max(14, horizontal + 6), blastBottom: Math.min(-7, bottom - 7), blastTop: Math.max(13, top + 8) };
};
export const STAGES = {
  cloudbreak: arena('Cloudbreak', null, null, 'sky', '#ffb347', '#674384', '#f4e6cc', 'A sky citadel with two outlying islands, stepped lookout towers and a drifting upper bridge. Hold Jump for full height.', [p(-8,8,0,true),p(-5.8,-2.4,1.5),p(2.4,5.8,1.5),p(-1.7,1.7,3)]),
  'peach-castle': arena('Crownkeep', "Princess Peach’s Castle", 2, 'castle', '#ff829f','#a2c9e2','#f6dfc0', 'Fight across castle rooftops. A flashing tower warns of a central blast.', [p(-9,-3,0,true),p(-3,3,1.5,true),p(3,9,0,true),p(-7,-4,3.1),p(4,7,3.1)],{kind:'pulse',label:'Tower blast',x:0,y:1.5,width:3,height:3,period:900}),
  'rainbow-cruise': arena('Prism Voyage', 'Rainbow Cruise', 3, 'sky','#f8c6ff','#7c69ad','#f7dfb2','A skyship deck and a traveling staircase of rainbow platforms.',[p(-7,7,0,true),p(-8,-5,2.5,false,{x:2,y:1,period:600}),p(-2,1,4,false,{x:3,y:1.2,period:780}),p(4,7,3,false,{x:1,y:1.5,period:660})]),
  'kongo-jungle': arena('Barrel Falls','Kongo Jungle',4,'jungle','#edb45b','#153a40','#957047','A timber bridge above rapids. Ride the rescue barrel platform below the ledge.',[p(-8,8,0,true),p(-6,-2,2.8),p(2,6,2.8),p(-1.3,1.3,-2,false,{x:7,period:720})],{kind:'wind',label:'River gust',y:-2,width:28,height:8,direction:1}),
  'jungle-japes': arena('Canopy Crossing','Jungle Japes',5,'jungle','#c4e176','#24382e','#99704b','Three separated huts over a river. Low bridges reward careful recoveries.',[p(-3,3,1,true),p(-10,-6,-.8,true),p(6,10,-.8,true),p(-2,2,4)],{kind:'geyser',label:'River surge',x:4.5,y:-2,width:2,height:4,period:660}),
  'great-bay': arena('Turtle Lagoon','Great Bay',6,'water','#63e2c0','#318fa5','#dcd2a4','A coastal jetty, a lookout, and a broad turtle that ferries fighters across the bay.',[p(-8,1,0,true),p(-6,-3,3),p(4,8,.4,true,{x:1.8,y:.4,period:900}),p(0,3,2.3)],{kind:'geyser',label:'Tidal spout',x:2.7,y:-2,width:1.8,height:4,period:780}),
  temple: arena('Sunken Temple','Hyrule Temple',7,'castle','#efd07d','#7476a7','#c8ba99','A sixty-unit temple complex with a lower sanctuary, two outer courtyards, a high ridge and a central elevator.',[p(-13,-3,2,true),p(-3,4,4,true),p(4,13,1,true),p(-5,5,-2,true),p(-11,-7,5.5),p(7,11,4.5),p(-1,2,7)]),
  brinstar: arena('Ember Core','Brinstar',8,'alien','#ff8455','#2d142d','#736088','A split research cavern. Rising lava periodically swallows the lowest ledges.',[p(-7,7,0,true),p(-7,-3,2.6),p(3,7,2.6),p(-2,2,5)],{kind:'lava',label:'Lava rising',y:-3,width:28,height:4.2,period:840,duration:240}),
  'brinstar-depths': arena('Titan’s Orbit','Brinstar Depths',9,'alien','#b2e357','#1e2733','#596b56','Four orbiting stone ledges circle a central fossil. The ledges remain horizontal.',[p(-3,3,0,true),p(-2,2,3,false,{x:6,y:2,period:960}),p(-2,2,3,false,{x:6,y:2,period:960,phase:Math.PI}),p(-8,-5,-1),p(5,8,-1)]),
  'yoshi-story': arena('Patchwork Parade','Yoshi’s Story',10,'storybook','#f48faf','#97c6c5','#b2d88c','A stitched archipelago with raised side gardens, central platforms and a roaming rescue cloud.',[p(-5.8,5.8,0,true),p(-4.8,-2,2.2),p(2,4.8,2.2),p(-1.6,1.6,4),p(-1,1,-1.7,false,{x:7,period:960})]),
  'yoshi-island': arena('Tilted Garden','Yoshi’s Island',11,'storybook','#ffc571','#6ba7d0','#b8cf78','Two grassy shelves and a bobbing central bridge create a changing low route.',[p(-9,-3,0,true),p(3,9,0,true),p(-3,3,-.6,false,{y:.8,period:600}),p(-6,-2,3),p(2,6,3.8)]),
  fountain: arena('Moonlit Fountain','Fountain of Dreams',12,'dream','#d7a3ff','#282353','#c4c5ed','Two independently rising platforms shimmer above a mirrored fountain.',[p(-7,7,0,true),p(-5.5,-2,2.5,false,{y:1.6,period:720}),p(2,5.5,2.5,false,{y:1.6,period:960,phase:Math.PI}),p(-1.7,1.7,5)]),
  'green-greens': arena('Orchard Blocks','Green Greens',13,'dream','#c5e879','#679786','#c9dc90','A great orchard tree divides three islands. A fruit blast threatens its right flank.',[p(-3.7,3.7,0,true),p(-10,-6,0,true),p(6,10,0,true),p(-3,-.5,3.1),p(.5,3,3.1)],{kind:'pulse',label:'Falling fruit',x:4.8,y:0,width:2,height:3.5,period:780}),
  corneria: arena('Starwing Deck','Corneria',14,'space','#83cefa','#7394ba','#b8c8d6','An asymmetric carrier wing with a raised cockpit and a low forward gun deck.',[p(-10,7,0,true),p(-5,0,2.8,true),p(7,11,-1.5,true)],{kind:'pulse',label:'Cannon charge',x:8.6,y:-1.5,width:2.4,height:3,period:840}),
  venom: arena('Twin Thrusters','Venom',15,'space','#ff897b','#512f49','#9babb3','Four engine fins surround a narrow center. Airborne routes connect both sides.',[p(-2,2,-.8,true),p(-8,-3,0,true),p(3,8,0,true),p(-7,-3,3.5),p(3,7,3.5)],{kind:'wind',label:'Engine wash',y:0,width:26,height:8,direction:-1}),
  stadium: arena('Element Stadium','Pokémon Stadium',16,'city','#87ed9c','#182b46','#c9dfd7','A wide arena with rising side terraces. The stadium cycles through four elements.',[p(-10,10,0,true),p(-7,-3,2.5,false,{y:1.4,period:1200}),p(3,7,2.5,false,{y:1.4,period:1200,phase:Math.PI})],{kind:'geyser',label:'Element vent',x:0,y:0,width:2.2,height:4,period:900}),
  'poke-floats': arena('Balloon Beasts','Poké Floats',17,'sky','#ffaace','#5c7da8','#efd4ed','A procession of floating creatures. Their backs bob at different heights.',[p(-4,4,0,true,{y:.7,period:780}),p(-10,-6,2,false,{x:1,y:1.4,period:660}),p(6,10,2.8,false,{x:1,y:1.6,period:900}),p(-2,2,5,false,{x:3,period:1080})]),
  'mute-city': arena('Neon Circuit','Mute City',18,'city','#ed86ff','#20243b','#7783a6','A racing lift over a neon highway. A warning stripe precedes each passing racer.',[p(-7,7,1,true),p(-5,-2,3.5,false,{x:1.5,period:660}),p(2,5,3.5,false,{x:1.5,period:660,phase:Math.PI})],{kind:'traffic',label:'Racer incoming',y:1,width:2.8,height:1.2,period:660,duration:180}),
  'big-blue': arena('Velocity Fleet','Big Blue',19,'water','#64ddfa','#3d81a8','#b3cadc','Battle on a convoy of hovering racers. Outer vehicles weave alongside the flagship.',[p(-3.5,3.5,1,true),p(-11,-6,.2,true,{x:1,y:.6,period:660}),p(6,11,1.8,true,{x:1,y:.6,period:780}),p(-1.5,1.5,4)],{kind:'wind',label:'Slipstream',y:0,width:34,height:8,direction:-1}),
  onett: arena('Maple Avenue','Onett',20,'city','#ffd178','#748bb7','#d7a78c','Three neighborhood rooftops above a busy street. Watch for the traffic warning.',[p(-9,-3,1,true),p(-3,3,2.8,true),p(3,9,.3,true),p(-7,-4,4)],{kind:'traffic',label:'Car approaching',y:.3,width:3,height:1.6,period:780,duration:180}),
  fourside: arena('Midnight Skyline','Fourside',21,'city','#a4a2ff','#141c3c','#8990b6','Leap between tall rooftops. A saucer circles above the central tower.',[p(-10,-5,0,true),p(-3,3,2,true),p(5,10,.6,true),p(-2,2,5.4,false,{x:5,period:1020})]),
  'icicle-mountain': arena('Glacier Ascent','Icicle Mountain',22,'ice','#a9eeff','#53778e','#c3edfa','A fifteen-unit summit above a wide glacial valley. Three lifts and staggered ledges create climbing and escape routes.',[p(-7,7,0,true),p(-7,-3,3),p(3,7,6),p(-4,0,8),p(-2,2,3,false,{y:2,period:600}),p(-6,-3,5,false,{y:2,period:840})]),
  'mushroom-kingdom': arena('Pixel Pipes','Mushroom Kingdom',24,'retro','#ffc271','#689cc4','#db9460','Brick islands, twin pipes, and a moving elevator over a central gap.',[p(-10,-2,0,true),p(2,10,0,true),p(-2,2,1,false,{y:1,period:600}),p(-7,-4,3),p(4,7,3)]),
  'mushroom-kingdom-ii': arena('Desert Doors','Mushroom Kingdom II',25,'retro','#f7d38a','#b87e92','#e4bb84','A desert gateway with a river gap. A flying carpet bridges its two banks.',[p(-10,-2,0,true),p(2,10,0,true),p(-1.5,1.5,1.5,false,{x:3,period:780}),p(-7,-4,3.5),p(4,7,2.5)],{kind:'geyser',label:'River bubble',x:0,y:-2,width:1.6,height:3,period:720}),
  'flat-zone': arena('Pocket LCD','Flat Zone',27,'retro','#353f36','#b5c4a0','#404d40','A wide monochrome machine with two raised work areas and a central electric hazard.',[p(-6.5,6.5,0,true),p(-5,-2,2.1),p(0,3,3.4),p(3.5,6,1.5)],{kind:'pulse',label:'Machine spark',x:-3.5,y:2.1,width:2,height:2.2,period:720}),
  'dream-land': arena('Breezy Meadow','Dream Land',28,'dream','#a6dd88','#73b5bf','#c5d995','Three classic platforms beneath a watchful tree. Periodic gusts alter aerial drift.',[p(-8.5,8.5,0,true),p(-6,-2.5,2.8),p(2.5,6,2.8),p(-2,2,5.5)],{kind:'wind',label:'Tree breath',y:0,width:29,height:10,direction:1}),
  'yoshi-island-64': arena('Cloud Garden','Yoshi’s Island (64)',29,'storybook','#f8d390','#8abbd4','#c4df9b','A broad island and three platforms, with cloud stepping stones beyond both edges.',[p(-7.5,7.5,0,true),p(-5,-2,2.7),p(2,5,2.7),p(-1.5,1.5,5),p(-12,-9,.3,false,{y:.5,period:780}),p(9,12,.8,false,{y:.5,period:780,phase:Math.PI})]),
  'kongo-jungle-64': arena('Sunset Canopy','Kongo Jungle (64)',30,'jungle','#f4b469','#82515c','#b28350','A timber clearing with orbiting upper ledges and a low rescue barrel.',[p(-7,7,0,true),p(-6,-3,2),p(3,6,2),p(-1.5,1.5,4,false,{x:3,y:.7,period:840}),p(-1,1,-2,false,{x:7.5,period:960})]),
  battlefield: arena('Astral Battlefield','Battlefield',36,'space','#b7a5ff','#211d3d','#aab3ca','Three orbital islands with stepped outer bastions and a rising central perch among ancient star rings.',[p(-7,7,0,true),p(-5.3,-2,2.7),p(2,5.3,2.7),p(-1.7,1.7,5)]),
  'final-destination': arena('Event Horizon','Final Destination',37,'space','#df94ff','#150f29','#a59abb','A forty-unit cosmic causeway above a vast rift. An open dueling arena without overhead platforms or hazards.',[p(-8.5,8.5,0,true)]),
} satisfies Record<string, Stage>;
export type StageId = keyof typeof STAGES;
/** Expanded routes are authored per arena, not scaled vertically: original jump tuning still applies. */
const routes: Record<StageId, Surface[]> = {
  cloudbreak: [p(-19,-12,-1,true),p(12,19,-1,true),p(-13,-8,.5),p(8,13,.5),p(-18,-14,2),p(14,18,2),p(-16,-12,3.5),p(12,16,3.5),p(-13,-9,5),p(9,13,5),p(-4,4,6.5,false,{x:5,y:1.5,period:960})],
  'peach-castle': [p(-20,-12,0,true),p(12,20,0,true),p(-13,-8,1.5),p(8,13,1.5),p(-19,-15,3),p(15,19,3),p(-16,-12,4.5),p(12,16,4.5),p(-10,-6,6,false,{x:2,y:1.5,period:840}),p(6,10,6,false,{x:2,y:1.5,period:840,phase:Math.PI})],
  'rainbow-cruise': [p(-22,-14,-1,true),p(15,23,2,true),p(-15,-10,.5,false,{x:2,period:720}),p(9,15,1,false,{y:1,period:840}),p(-20,-16,3),p(-14,-10,4.5),p(-7,-3,6),p(1,5,7.5),p(8,12,6,false,{x:2,y:1,period:960}),p(17,21,5)],
  'kongo-jungle': [p(-22,-14,-1,true),p(14,22,0,true),p(-15,-9,.5),p(9,15,1.5),p(-21,-17,2),p(17,21,3),p(-17,-13,3.5),p(12,16,4.5),p(-13,-9,5),p(-5,3,6.5,false,{x:4,period:1200})],
  'jungle-japes': [p(-23,-16,1,true),p(16,23,2,true),p(-16,-10,.5,false,{y:.6,period:600}),p(10,16,1,false,{y:.6,period:720}),p(-22,-18,4),p(-17,-13,5.5),p(17,21,5),p(12,16,6.5),p(-7,-3,5.5),p(3,7,5.5)],
  'great-bay': [p(-22,-14,0,true),p(14,23,-.5,true),p(-15,-9,1),p(8,14,.5,false,{x:1,y:.5,period:1200}),p(-21,-17,3),p(-17,-13,4.5),p(-13,-9,6),p(16,20,2.5),p(12,16,4),p(7,11,5.5)],
  temple: [p(-30,-20,0,true),p(20,30,3,true),p(-21,-12,1.5),p(12,21,2),p(-27,-23,3),p(-23,-19,4.5),p(-19,-15,6),p(-14,-9,7.5),p(-7,-2,9),p(2,7,10.5),p(9,14,9),p(16,21,7.5),p(23,28,6),p(-18,-12,-3,true),p(11,17,-2,true),p(-3,3,4,false,{y:6,period:1320})],
  brinstar: [p(-21,-13,1,true),p(13,21,1,true),p(-14,-8,1.5),p(8,14,1.5),p(-20,-16,4),p(16,20,4),p(-16,-12,5.5),p(12,16,5.5),p(-11,-6,7),p(6,11,7),p(-3,3,5,false,{y:3.5,period:1080})],
  'brinstar-depths': [p(-20,-13,-1,true),p(13,20,1,true),p(-15,-9,1,false,{y:2,period:1200}),p(9,15,2,false,{y:2,period:1200,phase:Math.PI}),p(-19,-15,4),p(15,19,6),p(-13,-8,6),p(8,13,8),p(-4,4,9,false,{x:5,y:1,period:1560})],
  'yoshi-story': [p(-17,-11,-1,true),p(11,17,-1,true),p(-12,-6,.5),p(6,12,.5),p(-16,-12,2),p(12,16,2),p(-12,-8,3.5),p(8,12,3.5),p(-7,-3,5),p(3,7,5)],
  'yoshi-island': [p(-21,-14,-1,true),p(14,21,1,true),p(-15,-9,.5),p(9,15,1.5),p(-20,-16,2),p(16,20,4),p(-16,-12,3.5),p(12,16,5.5),p(-10,-6,5),p(-2,3,6.5,false,{x:3,y:1.5,period:900})],
  fountain: [p(-19,-12,0,true),p(12,19,0,true),p(-13,-7,1.5),p(7,13,1.5),p(-18,-14,3),p(14,18,3),p(-14,-10,4.5),p(10,14,4.5),p(-9,-5,6),p(5,9,6),p(-3,3,8,false,{y:1,period:1440})],
  'green-greens': [p(-22,-16,0,true),p(16,22,0,true),p(-17,-10,1.5),p(10,17,1.5),p(-21,-17,3),p(17,21,3),p(-17,-13,4.5),p(13,17,4.5),p(-11,-6,6),p(6,11,6),p(-3,3,5,false,{y:2,period:1080})],
  corneria: [p(-26,-17,-1,true),p(17,27,-2,true),p(-18,-10,0),p(10,18,-.5),p(-24,-20,2),p(-20,-16,3.5),p(-15,-10,5),p(12,16,2.5),p(18,23,1),p(5,10,4),p(-4,2,6,false,{x:4,period:1200})],
  venom: [p(-23,-15,-2,true),p(15,23,2,true),p(-16,-9,-.5),p(9,16,1),p(-22,-18,1),p(-18,-14,2.5),p(18,22,5),p(13,17,6.5),p(-12,-7,5),p(-4,3,7,false,{x:4,y:1,period:1200})],
  stadium: [p(-23,-15,1,true),p(15,23,1,true),p(-16,-10,1.5),p(10,16,1.5),p(-21,-17,4),p(17,21,4),p(-16,-12,5.5),p(12,16,5.5),p(-9,-4,7,false,{y:1.5,period:1200}),p(4,9,7,false,{y:1.5,period:1200,phase:Math.PI})],
  'poke-floats': [p(-24,-17,-1,true,{y:.5,period:900}),p(17,24,1,true,{y:.5,period:1200}),p(-18,-11,.5,false,{x:1,y:1,period:1020}),p(11,18,2,false,{x:1,y:1,period:840}),p(-22,-18,3),p(18,22,5),p(-15,-10,5),p(10,15,7),p(-5,1,8,false,{x:4,y:1,period:1440})],
  'mute-city': [p(-25,-17,0,true),p(17,25,2,true),p(-18,-9,1,false,{x:1,period:600}),p(9,18,2,false,{x:1,period:720}),p(-23,-19,3),p(-17,-12,4.5),p(19,23,5),p(12,17,6.5),p(-7,-2,6),p(1,6,7.5)],
  'big-blue': [p(-27,-19,0,true,{x:1,y:.5,period:1080}),p(19,27,2,true,{x:1,y:.5,period:1320}),p(-20,-12,1),p(12,20,2.5),p(-25,-21,3),p(-18,-14,4.5),p(21,25,5),p(14,18,6.5),p(-9,-4,6),p(3,8,7.5)],
  onett: [p(-24,-16,0,true),p(16,24,1,true),p(-17,-10,1.5),p(9,17,1.5),p(-22,-18,3),p(-17,-12,4.5),p(18,22,4),p(12,17,5.5),p(-10,-5,6),p(5,10,7),p(-3,3,8.5)],
  fourside: [p(-27,-19,-1,true),p(19,27,3,true),p(-20,-11,.5),p(10,20,2),p(-25,-21,2),p(-20,-16,3.5),p(-15,-11,5),p(21,25,6),p(16,20,7.5),p(11,15,9),p(-8,-3,7),p(2,7,8.5)],
  'icicle-mountain': [p(-18,-11,0,true),p(11,18,0,true),p(-12,-7,1.5),p(7,12,1.5),p(-16,-12,3),p(12,16,3),p(-13,-9,4.5),p(9,13,4.5),p(-11,-6,6),p(6,11,7.5),p(-8,-3,9),p(3,8,10.5),p(-6,-1,12),p(1,6,13.5),p(-3,3,15),p(-17,-13,7,false,{y:6,period:1440})],
  'mushroom-kingdom': [p(-22,-15,0,true),p(15,22,0,true),p(-16,-10,1.5),p(10,16,1.5),p(-21,-17,3),p(17,21,3),p(-16,-12,4.5),p(12,16,4.5),p(-10,-6,6),p(6,10,6),p(-3,3,7.5)],
  'mushroom-kingdom-ii': [p(-24,-16,-1,true),p(16,24,1,true),p(-17,-10,.5),p(10,17,1.5),p(-22,-18,2),p(-17,-13,3.5),p(18,22,4),p(13,17,5.5),p(-11,-6,5),p(6,11,7),p(-4,2,6.5,false,{x:3,period:1080})],
  'flat-zone': [p(-19,-12,0,true),p(12,19,0,true),p(-13,-7,1.5),p(6,13,1.5),p(-18,-14,3),p(14,18,3),p(-14,-10,4.5),p(10,14,4.5),p(-7,-2,6),p(2,7,6)],
  'dream-land': [p(-21,-14,0,true),p(14,21,0,true),p(-15,-9,1.5),p(9,15,1.5),p(-20,-16,3),p(16,20,3),p(-16,-12,4.5),p(12,16,4.5),p(-11,-6,6),p(6,11,6),p(-3,3,8,false,{y:1,period:1080})],
  'yoshi-island-64': [p(-23,-16,-1,true),p(16,23,0,true),p(-17,-11,.5),p(11,17,1),p(-22,-18,2),p(18,22,3),p(-17,-13,3.5),p(13,17,4.5),p(-11,-7,5),p(7,11,6)],
  'kongo-jungle-64': [p(-22,-15,-1,true),p(15,22,1,true),p(-16,-8,.5),p(8,16,1.5),p(-21,-17,2),p(17,21,4),p(-16,-12,3.5),p(12,16,5.5),p(-11,-7,5),p(-4,3,7,false,{x:3,y:1,period:1440})],
  battlefield: [p(-20,-13,-1,true),p(13,20,-1,true),p(-14,-8,.5),p(8,14,.5),p(-18,-14,2),p(14,18,2),p(-14,-10,3.5),p(10,14,3.5),p(-9,-5,5),p(5,9,5),p(-3,3,8,false,{y:1,period:1080})],
  'final-destination': [],
};
for (const id of Object.keys(STAGES) as StageId[]) {
  const s = STAGES[id], platforms = id === 'final-destination' ? [p(-20,20,0,true)] : [...s.platforms, ...routes[id]];
  Object.assign(s, arena(s.name,s.source,s.grKind,s.family,s.color,s.sky,s.ground,s.description,platforms,s.hazard));
}
export type StageChoice = StageId | 'random';
export const STAGE_IDS = Object.keys(STAGES) as StageId[];
export const getStage = (id: StageId): Stage => STAGES[id];
export const resolveStage = (choice: StageChoice | undefined, seed: number): StageId => choice === 'random' ? STAGE_IDS[(seed >>> 0) % STAGE_IDS.length] : choice ?? 'cloudbreak';
/** Pure simulation clock: the renderer and server use the very same moving surfaces and hazard bounds. */
export function stageFrame(id: StageId, frame: number, hazards = true): { platforms: Platform[]; hazard: Hazard | null } {
  const stage = getStage(id), platforms = stage.platforms.map(p => {
    const m = p.motion, angle = m ? frame / m.period * Math.PI * 2 + (m.phase ?? 0) : 0;
    const dx = (m?.x ?? 0) * Math.sin(angle), dy = (m?.y ?? 0) * Math.cos(angle);
    return { id: p.id, left: p.left + dx, right: p.right + dx, y: p.y + dy, solid: p.solid };
  });
  const h = stage.hazard;
  if (!h || !hazards) return { platforms, hazard: null };
  const period = h.period ?? 840, duration = h.duration ?? 180, cycle = ((frame % period) + period) % period, start = period - duration;
  const active = cycle >= start, warning = cycle >= start - 120 && !active, progress = Math.max(0, (cycle - start) / duration);
  const width = h.width ?? stage.blastX * 2, height = h.height ?? 7, direction = h.direction ?? 1;
  return { platforms, hazard: { kind: h.kind, label: h.label, x: h.kind === 'traffic' ? (-stage.blastX + progress * stage.blastX * 2) * direction : h.x ?? 0,
    y: h.y ?? 0, width, height: h.kind === 'lava' ? height * Math.sin(progress * Math.PI) : height, warning, active, direction } };
}
/** Spread seats over solid surfaces, including split floors; never spawn over an empty gap. */
export function spawnPoint(id: StageId, index: number, count: number, frame = 0) {
  const surfaces = stageFrame(id, frame, false).platforms.filter(p => p.solid).sort((a,b) => a.left-b.left);
  if (id === 'cloudbreak') return { x: (index - (count - 1) / 2) * 3.2, y: 0, platformId: 'p0' };
  const total = surfaces.reduce((sum,p) => sum + Math.max(.1,p.right-p.left-1.2),0);
  let distance = total * (index + .5) / count;
  for (const p of surfaces) { const width = Math.max(.1,p.right-p.left-1.2); if (distance <= width) return { x: p.left+.6+distance, y:p.y, platformId:p.id }; distance -= width; }
  const p = surfaces[0]; return { x:(p.left+p.right)/2,y:p.y,platformId:p.id };
}
