import type { SoundEvent } from './sound-events';
export const W = 128, H = 48, CHUNK = 16, REACH = 5, EDIT_LIMIT = 16384, PLAYER_RADIUS = .29, CACHE_ITEM_LIMIT = 1_000_000_000;
export const BLOCKS = [
  { name: 'Air', color: '#ffffff', hard: 0, tier: 0 },
  { name: 'Grass Block', color: '#80b95b', hard: .5, tier: 0 },
  { name: 'Dirt', color: '#956246', hard: .45, tier: 0 },
  { name: 'Stone', color: '#a6aaa4', hard: 1.2, tier: 1 },
  { name: 'Oak Log', color: '#9c6538', hard: .8, tier: 0 },
  { name: 'Oak Leaves', color: '#4b955a', hard: .25, tier: 0 },
  { name: 'Water', color: '#368eab', hard: 0, tier: 0 },
  { name: 'Sand', color: '#dfc898', hard: .4, tier: 0 },
  { name: 'Copper Ore', color: '#c98155', hard: 1.8, tier: 2 },
  { name: 'Diamond Ore', color: '#8d9596', hard: 2.2, tier: 3 },
  { name: 'Oak Planks', color: '#d3a665', hard: .5, tier: 0 },
  { name: 'Glass', color: '#b5e5df', hard: .4, tier: 1 },
  { name: 'Lantern', color: '#ffd876', hard: .4, tier: 0 },
  { name: 'Sunwell', color: '#83eee0', hard: 3, tier: 3 },
  { name: 'Bedrock', color: '#414a58', hard: 99999, tier: 99 },
  { name: 'Bricks', color: '#bd7869', hard: .8, tier: 1 },
  { name: 'Sandstone', color: '#ece2c9', hard:.8, tier:1 },
  { name: 'Deepslate', color: '#667589', hard:1, tier:1 },
  { name: 'Terracotta', color: '#c87449', hard:.7, tier:0 },
  { name: 'Snow', color: '#e4f0eb', hard:.3, tier:0 },
  { name: 'Spruce Leaves', color: '#305f55', hard:.3, tier:0 },
  { name: 'Pink Wool', color: '#d58b9b', hard:.5, tier:0 },
  { name: 'Cyan Wool', color: '#5caaa7', hard:.5, tier:0 },
  { name: 'Gold Block', color: '#d8ba57', hard:.5, tier:0 },

  // IDs24–27 belong to legacy inventory items and are never world blocks.
  { name:'Wooden Pickaxe',color:'#aa8153',hard:99999,tier:99 },
  { name:'Stone Pickaxe',color:'#aaaaaa',hard:99999,tier:99 },
  { name:'Copper pick',color:'#c98155',hard:99999,tier:99 },
  { name:'Sweet Berries',color:'#bb5577',hard:99999,tier:99 },
  { name:'Crafting Table',color:'#b78852',hard:.8,tier:0 },
  { name:'Furnace',color:'#6e777e',hard:1.5,tier:1 },
  { name:'Chest',color:'#b48142',hard:.8,tier:0 },
  { name:'Bed',color:'#ba645d',hard:.5,tier:0 },
  { name:'Farmland',color:'#6f5036',hard:.4,tier:0 },
  { name:'Coal Ore',color:'#53565a',hard:1.4,tier:1 },
  { name:'Iron Ore',color:'#b8a28a',hard:1.8,tier:2 },
  { name:'Campfire',color:'#d28943',hard:.4,tier:0 },
  ...['Iron Pickaxe','Iron Sword','Wheat Seeds','Wheat','Bread','Iron Ingot','Roasted berries'].map(name=>({name,color:'#bfa681',hard:99999,tier:99})),
  {name:'Torch',color:'#ffc768',hard:.1,tier:0},
  {name:'Cobblestone',color:'#858986',hard:1.2,tier:1},
  {name:'Oak Sapling',color:'#5d9949',hard:.1,tier:0},
  {name:'White Wool',color:'#eee9df',hard:.4,tier:0},
  {name:'Clay',color:'#9faab7',hard:.5,tier:0},
  ...['Raw Iron','Coal','Stick','Diamond','Diamond Pickaxe','Apple','Bone','Arrow','String','Gunpowder','Rotten Flesh','Brick','Wooden Sword','Stone Sword','Charcoal','Clay Ball'].map(name=>({name,color:'#bfa681',hard:99999,tier:99})),
  {name:'Short Grass',color:'#77a94b',hard:.05,tier:0},
  {name:'Wild Carrots',color:'#8caf49',hard:.1,tier:0},
  {name:'Wild Potatoes',color:'#7c9e4c',hard:.1,tier:0},
] as const;
export const ITEMS = [...BLOCKS.map(b => b.name), 'Wooden Hoe','Stone Hoe','Iron Hoe','Carrot','Potato','Raw Beef','Raw Porkchop','Raw Chicken','Raw Mutton','Leather','Feather','Cooked Beef','Cooked Porkchop','Cooked Chicken','Cooked Mutton','Baked Potato','Bucket','Water Bucket','Shears','Bone Meal'] as const;
export const BENCH=28,FURNACE=29,CHEST=30,BED=31,FARMLAND=32,COAL=33,IRON_ORE=34,CAMPFIRE=35,IRON_PICK=36,SWORD=37,SEEDS=38,GRAIN=39,BREAD=40,INGOT=41,ROAST=42;
export const TORCH=43,COBBLE=44,SAPLING=45,WOOL=46,CLAY=47,RAW_IRON=48,FUEL=49,STICK=50,DIAMOND=51,DIAMOND_PICK=52,APPLE=53,BONE=54,ARROW=55,STRING=56,GUNPOWDER=57,FLESH=58,BRICK_ITEM=59,WOOD_SWORD=60,STONE_SWORD=61,CHARCOAL=62,CLAY_BALL=63;
export const SHORT_GRASS=64,WILD_CARROT=65,WILD_POTATO=66,WOOD_HOE=67,STONE_HOE=68,IRON_HOE=69,CARROT=70,POTATO=71,BEEF=72,PORK=73,CHICKEN=74,MUTTON=75,LEATHER=76,FEATHER=77,COOKED_BEEF=78,COOKED_PORK=79,COOKED_CHICKEN=80,COOKED_MUTTON=81,BAKED_POTATO=82;
export const BUCKET=83,WATER_BUCKET=84,SHEARS=85,BONE_MEAL=86;
export const FOOD_POINTS:Record<number,number>={[BREAD]:2.5,[APPLE]:2,[CARROT]:1.5,[POTATO]:.5,[BEEF]:1.5,[PORK]:1.5,[CHICKEN]:1,[MUTTON]:1,[COOKED_BEEF]:4,[COOKED_PORK]:4,[COOKED_CHICKEN]:3,[COOKED_MUTTON]:3,[BAKED_POTATO]:2.5,[27]:1,[FLESH]:2};
export const isHoe=(id:number)=>[WOOD_HOE,STONE_HOE,IRON_HOE].includes(id);
export const isPlant=(id:number)=>[SHORT_GRASS,WILD_CARROT,WILD_POTATO].includes(id);
export const cropItems=[SEEDS,CARROT,POTATO];
export type AnimalKind='cow'|'sheep'|'pig'|'chicken';
export type Animal={sheared?:boolean;grazeAt?:number;id:number;kind:AnimalKind;x:number;y:number;z:number;yaw:number;health:number;hitAt:number;adultAt:number;loveUntil:number;breedAt:number};
export type TerrainVersion=1|2|3|4|5|6|7;
export const dayLength=(version:TerrainVersion)=>version>=3?1200:240;
export const isNight=(time:number,version:TerrainVersion)=>time%dayLength(version)>dayLength(version)*.62;
export const isWorldBlock=(id:number)=>Number.isInteger(id)&&id>=0&&id<BLOCKS.length&&!(id>=24&&id<=27)&&!(id>=36&&id<=42)&&!(id>=48&&id<=63);
export const isTool=(id:number)=>[24,25,26,IRON_PICK,SWORD,DIAMOND_PICK,WOOD_SWORD,STONE_SWORD,WOOD_HOE,STONE_HOE,IRON_HOE,SHEARS].includes(id);
export const TOOL = 24, BERRIES=27;
export const PALETTE = [2,3,4,10,7,11,12,15,13,16,17,18,19,20,21,22,23,5,BENCH,FURNACE,CHEST,BED,COAL,IRON_ORE,CAMPFIRE];
export const paletteFor=(version:TerrainVersion):number[]=>version<4?PALETTE:[1,2,3,COBBLE,4,10,5,20,7,11,TORCH,15,16,17,18,19,21,22,23,WOOL,CLAY,SAPLING,BENCH,FURNACE,CHEST,BED,COAL,IRON_ORE,8,9,CAMPFIRE];
export const stackLimit=(version:TerrainVersion,item:number)=>version<4?999:item===BUCKET?16:item===WATER_BUCKET||isTool(item)?1:64;
export const selectable=(id:number)=>Number.isInteger(id)&&id>=0&&id<ITEMS.length&&id!==6&&id!==14;
export const itemColor=(id:number)=>(isWorldBlock(id)||id<48?BLOCKS[id]?.color:undefined)??({49:"#42464a",50:"#a87947",51:"#68e0d3",52:"#68e0d3",53:"#d84e44"} as Record<number,string>)[id]??"#c7bb9c";
export type Recipe={category?:'Construction'|'Equipment'|'Items'|'Nature';pattern?:number[][];id:string;name:string;costs:Record<number,number>;item:number;count:number;hint:string;station?:number;seconds?:number};
export const LEGACY_RECIPES:readonly Recipe[] = [
  { id: 'planks', name: 'Planks ×4', costs: { 4: 1 }, item: 10, count: 4, hint: 'Build a shelter' },
  { id: 'twig', name: 'Wooden Pickaxe', costs: { 4: 2 }, item: 24, count: 1, hint: 'Mine stone' },
  { id: 'stone', name: 'Stone Pickaxe', costs: { 3: 4, 4: 1 }, item: 25, count: 1, hint: 'Mine copper and iron',station:BENCH },
  { id: 'copper', name: 'Copper pick', costs: { 8: 4, 4: 1 }, item: 26, count: 1, hint: 'Mine crystal',station:BENCH },
  { id: 'glass', name: 'Glass ×4', costs: { 7: 2 }, item: 11, count: 4, hint: 'Smelt sand into clear windows',station:FURNACE,seconds:12 },
  { id: 'lantern', name: 'Lantern ×2', costs: { 4: 1, 8: 1 }, item: 12, count: 2, hint: 'Keeps creatures away' },
  { id: 'brick', name: 'Brick ×4', costs: { 3: 2, 2: 1 }, item: 15, count: 4, hint: 'Warm stonework' },
  { id:'hedge',name:'Leaves ×4',costs:{4:1,27:1},item:5,count:4,hint:'Grow a garden hedge' },
  { id:'limestone',name:'Limestone ×4',costs:{3:2,7:1},item:16,count:4,hint:'Bright walls and columns' },
  { id:'slate',name:'Slate ×4',costs:{3:3},item:17,count:4,hint:'Roofs and paths' },
  { id:'clay',name:'Terracotta ×4',costs:{2:2,7:1},item:18,count:4,hint:'Warm desert masonry' },
  { id:'rose',name:'Rose tile ×4',costs:{3:1,27:1},item:21,count:4,hint:'Add color to your home' },
  { id:'ocean',name:'Ocean tile ×4',costs:{3:1,8:1},item:22,count:4,hint:'Cool colored stonework' },
  { id:'gold',name:'Gold tile ×4',costs:{7:2,8:1},item:23,count:4,hint:'A golden finishing touch' },
  { id: 'sunwell', name: 'Sunwell beacon', costs: { 3: 8, 8: 4, 9: 3 }, item: 13, count: 1, hint: 'An optional landmark. Keep exploring after placing it' },
  {id:'bench',name:'Crafting Table',costs:{10:4},item:BENCH,count:1,hint:'Place anywhere to craft advanced tools'},
  {id:'furnace',name:'Furnace',costs:{3:8},item:FURNACE,count:1,hint:'Smelt ore, glass and food with coal or timber',station:BENCH},
  {id:'chest',name:'Chest',costs:{10:8},item:CHEST,count:1,hint:'Shared storage for your home'},
  {id:'bed',name:'Bed',costs:{10:3,5:3},item:BED,count:1,hint:'Set your home; rest together to skip the night'},
  {id:'campfire',name:'Campfire',costs:{4:2,3:2},item:CAMPFIRE,count:1,hint:'A warm light that repels brambles'},
  {id:'seeds',name:'Seeds ×2',costs:{27:1},item:SEEDS,count:2,hint:'Plant in grass or earth to grow grain'},
  {id:'iron',name:'Iron ingot',costs:{34:1},item:INGOT,count:1,hint:'Collect the ingot when smelting finishes',station:FURNACE,seconds:15},
  {id:'iron-pick',name:'Iron pick',costs:{41:3,4:1},item:IRON_PICK,count:1,hint:'Fast mining of every natural ore',station:BENCH},
  {id:'sword',name:'Iron sword',costs:{41:2,4:1},item:SWORD,count:1,hint:'More damage against brambles',station:BENCH},
  {id:'bread',name:'Bread',costs:{39:3},item:BREAD,count:1,hint:'A filling meal from your own farm'},
  {id:'roast',name:'Roasted berries ×3',costs:{27:3},item:ROAST,count:3,hint:'Cook a more nourishing meal',station:FURNACE,seconds:10},
];
// Ingredient layouts drive both costs and the recipe-book preview.
const recipe=(id:string,item:number,count:number,pattern:number[][],category:NonNullable<Recipe['category']>,hint:string,station?:number):Recipe=>({id,name:ITEMS[item]+(count>1?` ×${count}`:''),item,count,pattern,category,hint,station,costs:pattern.flat().reduce<Record<number,number>>((costs,id)=>{if(id)costs[id]=(costs[id]??0)+1;return costs;},{})});
export const RECIPES:readonly Recipe[]=[
  recipe('planks',10,4,[[4]],'Construction','Turn logs into planks.'),
  recipe('sticks',STICK,4,[[10],[10]],'Items','Handles for tools and torches.'),
  recipe('bucket',BUCKET,1,[[INGOT,0,INGOT],[0,INGOT,0]],'Equipment','Collect water, then pour it into an irrigation hole.',BENCH),
  recipe('shears',SHEARS,1,[[0,INGOT],[INGOT,0]],'Equipment','Shear adult sheep; wool regrows when they graze.'),
  recipe('bone-meal',BONE_MEAL,3,[[BONE]],'Nature','Fertilize crops or grow short grass for seeds.'),
  recipe('bench',BENCH,1,[[10,10],[10,10]],'Construction','Place a crafting table to unlock 3×3 recipes.'),
  ...[[24,10,'twig'],[25,COBBLE,'stone'],[IRON_PICK,INGOT,'iron-pick'],[DIAMOND_PICK,DIAMOND,'diamond-pick']].map(([item,material,id])=>recipe(String(id),Number(item),1,[[Number(material),Number(material),Number(material)],[0,STICK,0],[0,STICK,0]],'Equipment','Select this pickaxe in the hotbar to mine.',BENCH)),
  ...[[WOOD_SWORD,10,'wood-sword'],[STONE_SWORD,COBBLE,'stone-sword'],[SWORD,INGOT,'sword']].map(([item,material,id])=>recipe(String(id),Number(item),1,[[Number(material)],[Number(material)],[STICK]],'Equipment','Select this sword to deal more damage.',BENCH)),
  ...[[WOOD_HOE,10,'wood-hoe'],[STONE_HOE,COBBLE,'stone-hoe'],[IRON_HOE,INGOT,'iron-hoe']].map(([item,material,id])=>recipe(String(id),Number(item),1,[[Number(material),Number(material)],[0,STICK],[0,STICK]],'Equipment','Use on grass or dirt, then plant seeds in the farmland.',BENCH)),
  recipe('furnace',FURNACE,1,[[COBBLE,COBBLE,COBBLE],[COBBLE,0,COBBLE],[COBBLE,COBBLE,COBBLE]],'Construction','Smelt ore and sand using fuel.',BENCH),
  recipe('chest',CHEST,1,[[10,10,10],[10,0,10],[10,10,10]],'Construction','Shared storage for supplies.',BENCH),
  recipe('torch',TORCH,4,[[FUEL],[STICK]],'Items','Light an area to prevent nearby spawning.'),
  recipe('torch-charcoal',TORCH,4,[[CHARCOAL],[STICK]],'Items','Make torches using charcoal.'),
  recipe('clay-block',CLAY,1,[[CLAY_BALL,CLAY_BALL],[CLAY_BALL,CLAY_BALL]],'Construction','Pack four clay balls into a block.'),
  recipe('bed',BED,1,[[WOOL,WOOL,WOOL],[10,10,10]],'Construction','Set your respawn point and sleep through the night.',BENCH),
  recipe('wool',WOOL,1,[[STRING,STRING],[STRING,STRING]],'Construction','Make wool from spider string.'),
  recipe('bread',BREAD,1,[[GRAIN,GRAIN,GRAIN]],'Nature','A filling meal from your wheat.',BENCH),
  recipe('sandstone',16,1,[[7,7],[7,7]],'Construction','Build with sandstone.'),
  recipe('bricks',15,1,[[BRICK_ITEM,BRICK_ITEM],[BRICK_ITEM,BRICK_ITEM]],'Construction','Combine four fired bricks.'),
  recipe('campfire',CAMPFIRE,1,[[0,STICK,0],[STICK,FUEL,STICK],[4,4,4]],'Construction','A steady light for camp.',BENCH),
  ...[[COOKED_BEEF,BEEF,'beef'],[COOKED_PORK,PORK,'pork'],[COOKED_CHICKEN,CHICKEN,'chicken'],[COOKED_MUTTON,MUTTON,'mutton'],[BAKED_POTATO,POTATO,'potato'],[11,7,'glass'],[INGOT,RAW_IRON,'iron'],[BRICK_ITEM,CLAY_BALL,'brick'],[18,CLAY,'terracotta'],[3,COBBLE,'smooth-stone'],[CHARCOAL,4,'charcoal']].map(([item,input,id])=>({...recipe(String(id),Number(item),1,[[Number(input)]],'Items','Smelt in a nearby furnace with fuel.',FURNACE),seconds:10})),
];
export const recipesFor=(version:TerrainVersion)=>version<4?LEGACY_RECIPES:RECIPES;
export type Settings = { mode: 'survival' | 'creative'; seed: number; terrainVersion?:TerrainVersion };
export type Command = {seq:number;type:'craft'|'eat'|'grow'|'use'|'plant'|'deposit'|'withdraw';recipe?:string;item?:number};
export type Input = { command:Command|null; x: number; z: number; looking: boolean; fly: boolean; sprint: boolean; sneak: boolean; down: boolean; yaw: number; pitch: number; jump: boolean; mine: boolean; place: boolean; slot: number };
export type Action = { type: 'craft'; recipe: string } | { type:'eat' } | { type:'finish' } | { type:'grow'|'use'|'plant' } | {type:'deposit'|'withdraw';item:number};
export type Player = { selected:number; sneaking:boolean; id: string; name: string; color: string; x: number; y: number; z: number; yaw: number; pitch: number; health: number; food: number; connected: boolean; flying:boolean; mined: number; built: number; tier: number; progress: number; target: number | null; message: string };
export type MobKind='zombie'|'skeleton'|'spider'|'creeper';
export type Creature = { kind?:MobKind; yaw?:number; attackAt?:number; fuse?:number; id: number; x: number; y: number; z: number; health: number; hitAt: number };
export type Projectile={id:number;x:number;y:number;z:number;vx:number;vy:number;vz:number;expires:number};
export type Blast={id:number;x:number;y:number;z:number;at:number};
export type Cache = { id: string; owner: string; x: number; y: number; z: number; items: Record<number,number> };
export type Farm={i:number;readyAt:number;crop?:number;plantedAt?:number};
export type FurnaceJob={item:number;count:number;readyAt:number};
export type Homestead={fuelUntil?:Record<number,number>;chests:Record<number,Record<number,number>>;furnaces:Record<number,FurnaceJob>;farms:Farm[]};
export type StationView={i:number;kind:number;contents:Record<number,number>;readyAt:number};
export type View = { animals?:Animal[]; sounds?:SoundEvent[]; burningFurnaces?:number[]; seed: number; terrainVersion:TerrainVersion; revision: number; edits: [number,number][]; players: Player[]; creatures: Creature[]; projectiles?:Projectile[]; blasts?:Blast[]; caches: { id: string; ownerId:string; x: number; y: number; z: number }[]; time: number; mode: Settings['mode']; beacon: boolean; complete: boolean; mined: number; built: number; farms:Farm[]; furnaces:{i:number;readyAt:number}[];sleeping:number };
export type PrivateView = { cropStatus?:string; interaction?:string; craftingSize:2|3; nearFurnace:boolean; inventory: Record<number, number>; message: string; commandAck:number; commandResult:string; recovery:{x:number;y:number;z:number}|null;station:StationView|null;home:{x:number;y:number;z:number}|null;air:number };
export const WORLD_RADIUS=2048, WORLD_WIDTH=WORLD_RADIUS*2;
const LEGACY_CELLS=W*W*H;
export const index=(x:number,y:number,z:number)=>x<-WORLD_RADIUS||x>=WORLD_RADIUS||z<-WORLD_RADIUS||z>=WORLD_RADIUS||y<0||y>=H?-1:x>=0&&x<W&&z>=0&&z<W?x+z*W+y*W*W:LEGACY_CELLS+x+WORLD_RADIUS+(z+WORLD_RADIUS)*WORLD_WIDTH+y*WORLD_WIDTH*WORLD_WIDTH;
export const worldMin=(v:TerrainVersion)=>v===7?-WORLD_RADIUS:0;
export const worldMax=(v:TerrainVersion)=>v===7?WORLD_RADIUS:W;
export const inWorld=(v:TerrainVersion,x:number,z:number,margin=0)=>x>=worldMin(v)+margin&&z>=worldMin(v)+margin&&x<worldMax(v)-margin&&z<worldMax(v)-margin;
export function validVoxel(i:number,v:TerrainVersion){if(!Number.isSafeInteger(i)||i<0)return false;const c=coords(i);return c.y>=1&&c.y<H&&inWorld(v,c.x,c.z)&&index(c.x,c.y,c.z)===i;}
export const coords=(i:number)=>i<LEGACY_CELLS?{x:i%W,y:Math.floor(i/(W*W)),z:Math.floor(i/W)%W}:{x:(i-LEGACY_CELLS)%WORLD_WIDTH-WORLD_RADIUS,y:Math.floor((i-LEGACY_CELLS)/(WORLD_WIDTH*WORLD_WIDTH)),z:Math.floor((i-LEGACY_CELLS)/WORLD_WIDTH)%WORLD_WIDTH-WORLD_RADIUS};
export const solid = (b: number) => b !== 0 && b !== 6 && b !== TORCH && b !== SAPLING && !isPlant(b);
export const neutral = (): Input => ({ command:null, x: 0, z: 0, looking:false, fly:false, sprint:false, sneak:false, down:false, yaw: 0, pitch: 0, jump: false, mine: false, place: false, slot: 10 });

export function parseCommand(raw:unknown):Command|null {if(raw===null)return null;const c=raw as Command;if(!c||typeof c!=='object'||!Number.isSafeInteger(c.seq)||c.seq<1||!['craft','eat','grow','use','plant','deposit','withdraw'].includes(c.type)||Object.keys(c).some(k=>!['seq','type','recipe','item'].includes(k)))throw new Error('Invalid command.');if(c.type==='craft'){if(![...RECIPES,...LEGACY_RECIPES].some(r=>r.id===c.recipe)||c.item!==undefined)throw new Error('Invalid recipe.');return{seq:c.seq,type:c.type,recipe:c.recipe};}if(c.type==='deposit'||c.type==='withdraw'){if(!Number.isInteger(c.item)||c.item===undefined||c.item<0||c.item>=ITEMS.length||c.recipe!==undefined)throw new Error('Invalid item.');return{seq:c.seq,type:c.type,item:c.item};}if(c.recipe!==undefined||c.item!==undefined)throw new Error('Unexpected command data.');return{seq:c.seq,type:c.type};}

// Keep the existing download envelope bounded even with longer global voxel identifiers.
export const editLimit=(version:TerrainVersion)=>version===7?8192:EDIT_LIMIT;
