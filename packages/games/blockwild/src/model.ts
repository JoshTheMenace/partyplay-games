export const W = 128, H = 48, CHUNK = 16, REACH = 5, EDIT_LIMIT = 16384, PLAYER_RADIUS = .29, CACHE_ITEM_LIMIT = 1_000_000_000;
export const BLOCKS = [
  { name: 'Air', color: '#ffffff', hard: 0, tier: 0 },
  { name: 'Meadow', color: '#80b95b', hard: .5, tier: 0 },
  { name: 'Earth', color: '#956246', hard: .45, tier: 0 },
  { name: 'Stone', color: '#a6aaa4', hard: 1.2, tier: 1 },
  { name: 'Timber', color: '#9c6538', hard: .8, tier: 0 },
  { name: 'Leaves', color: '#4b955a', hard: .25, tier: 0 },
  { name: 'Water', color: '#368eab', hard: 0, tier: 0 },
  { name: 'Sand', color: '#dfc898', hard: .4, tier: 0 },
  { name: 'Copper', color: '#c98155', hard: 1.8, tier: 2 },
  { name: 'Crystal', color: '#ad8dee', hard: 2.2, tier: 3 },
  { name: 'Planks', color: '#d3a665', hard: .5, tier: 0 },
  { name: 'Glass', color: '#b5e5df', hard: .4, tier: 1 },
  { name: 'Lantern', color: '#ffd876', hard: .4, tier: 0 },
  { name: 'Sunwell', color: '#83eee0', hard: 3, tier: 3 },
  { name: 'Bedrock', color: '#414a58', hard: 99999, tier: 99 },
  { name: 'Brick', color: '#bd7869', hard: .8, tier: 1 },
  { name: 'Limestone', color: '#ece2c9', hard:.8, tier:1 },
  { name: 'Slate', color: '#667589', hard:1, tier:1 },
  { name: 'Terracotta', color: '#c87449', hard:.7, tier:0 },
  { name: 'Snow', color: '#e4f0eb', hard:.3, tier:0 },
  { name: 'Pine', color: '#305f55', hard:.3, tier:0 },
  { name: 'Rose tile', color: '#d58b9b', hard:.5, tier:0 },
  { name: 'Ocean tile', color: '#5caaa7', hard:.5, tier:0 },
  { name: 'Gold tile', color: '#d8ba57', hard:.5, tier:0 },

  // IDs24–27 belong to legacy inventory items and are never world blocks.
  { name:'Twig pick',color:'#aa8153',hard:99999,tier:99 },
  { name:'Stone pick',color:'#aaaaaa',hard:99999,tier:99 },
  { name:'Copper pick',color:'#c98155',hard:99999,tier:99 },
  { name:'Berries',color:'#bb5577',hard:99999,tier:99 },
  { name:'Workbench',color:'#b78852',hard:.8,tier:0 },
  { name:'Furnace',color:'#6e777e',hard:1.5,tier:1 },
  { name:'Chest',color:'#b48142',hard:.8,tier:0 },
  { name:'Bed',color:'#ba645d',hard:.5,tier:0 },
  { name:'Farmland',color:'#6f5036',hard:.4,tier:0 },
  { name:'Coal',color:'#53565a',hard:1.4,tier:1 },
  { name:'Iron ore',color:'#b8a28a',hard:1.8,tier:2 },
  { name:'Campfire',color:'#d28943',hard:.4,tier:0 },
] as const;
export const ITEMS = [...BLOCKS.map(b => b.name), 'Iron pick', 'Iron sword', 'Seeds', 'Grain', 'Bread', 'Iron ingot', 'Roasted berries'] as const;
export const BENCH=28,FURNACE=29,CHEST=30,BED=31,FARMLAND=32,COAL=33,IRON_ORE=34,CAMPFIRE=35,IRON_PICK=36,SWORD=37,SEEDS=38,GRAIN=39,BREAD=40,INGOT=41,ROAST=42;
export type TerrainVersion=1|2|3;
export const dayLength=(version:TerrainVersion)=>version===3?1200:240;
export const isNight=(time:number,version:TerrainVersion)=>time%dayLength(version)>dayLength(version)*.62;
export const isWorldBlock=(id:number)=>Number.isInteger(id)&&id>=0&&id<BLOCKS.length&&!(id>=24&&id<=27);
export const isTool=(id:number)=>[24,25,26,IRON_PICK,SWORD].includes(id);
export const TOOL = 24, BERRIES=27;
export const PALETTE = [2,3,4,10,7,11,12,15,13,16,17,18,19,20,21,22,23,5,BENCH,FURNACE,CHEST,BED,COAL,IRON_ORE,CAMPFIRE];
export type Recipe={id:string;name:string;costs:Record<number,number>;item:number;count:number;hint:string;station?:number;seconds?:number};
export const RECIPES:readonly Recipe[] = [
  { id: 'planks', name: 'Planks ×4', costs: { 4: 1 }, item: 10, count: 4, hint: 'Build a shelter' },
  { id: 'twig', name: 'Twig pick', costs: { 4: 2 }, item: 24, count: 1, hint: 'Mine stone' },
  { id: 'stone', name: 'Stone pick', costs: { 3: 4, 4: 1 }, item: 25, count: 1, hint: 'Mine copper and iron',station:BENCH },
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
  {id:'bench',name:'Workbench',costs:{10:4},item:BENCH,count:1,hint:'Place anywhere to craft advanced tools'},
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
export type Settings = { mode: 'survival' | 'creative'; seed: number; terrainVersion?:TerrainVersion };
export type Command = {seq:number;type:'craft'|'eat'|'grow'|'use'|'plant'|'deposit'|'withdraw';recipe?:string;item?:number};
export type Input = { command:Command|null; x: number; z: number; looking: boolean; fly: boolean; sprint: boolean; down: boolean; yaw: number; pitch: number; jump: boolean; mine: boolean; place: boolean; slot: number };
export type Action = { type: 'craft'; recipe: string } | { type:'eat' } | { type:'finish' } | { type:'grow'|'use'|'plant' } | {type:'deposit'|'withdraw';item:number};
export type Player = { id: string; name: string; color: string; x: number; y: number; z: number; yaw: number; pitch: number; health: number; food: number; connected: boolean; flying:boolean; mined: number; built: number; tier: number; progress: number; target: number | null; message: string };
export type Creature = { id: number; x: number; y: number; z: number; health: number; hitAt: number };
export type Cache = { id: string; owner: string; x: number; y: number; z: number; items: Record<number,number> };
export type Farm={i:number;readyAt:number};
export type FurnaceJob={item:number;count:number;readyAt:number};
export type Homestead={chests:Record<number,Record<number,number>>;furnaces:Record<number,FurnaceJob>;farms:Farm[]};
export type StationView={i:number;kind:number;contents:Record<number,number>;readyAt:number};
export type View = { seed: number; terrainVersion:TerrainVersion; revision: number; edits: [number,number][]; players: Player[]; creatures: Creature[]; caches: { id: string; ownerId:string; x: number; y: number; z: number }[]; time: number; mode: Settings['mode']; beacon: boolean; complete: boolean; mined: number; built: number; farms:Farm[]; furnaces:{i:number;readyAt:number}[];sleeping:number };
export type PrivateView = { inventory: Record<number, number>; message: string; commandAck:number; commandResult:string; recovery:{x:number;y:number;z:number}|null;station:StationView|null;home:{x:number;y:number;z:number}|null;air:number };
export const index = (x: number, y: number, z: number) => x + z * W + y * W * W;
export const coords = (i: number) => ({ x: i % W, y: Math.floor(i / (W * W)), z: Math.floor(i / W) % W });
export const solid = (b: number) => b !== 0 && b !== 6;
export const neutral = (): Input => ({ command:null, x: 0, z: 0, looking:false, fly:false, sprint:false, down:false, yaw: 0, pitch: 0, jump: false, mine: false, place: false, slot: 10 });

export function parseCommand(raw:unknown):Command|null {if(raw===null)return null;const c=raw as Command;if(!c||typeof c!=='object'||!Number.isSafeInteger(c.seq)||c.seq<1||!['craft','eat','grow','use','plant','deposit','withdraw'].includes(c.type)||Object.keys(c).some(k=>!['seq','type','recipe','item'].includes(k)))throw new Error('Invalid command.');if(c.type==='craft'){if(!RECIPES.some(r=>r.id===c.recipe)||c.item!==undefined)throw new Error('Invalid recipe.');return{seq:c.seq,type:c.type,recipe:c.recipe};}if(c.type==='deposit'||c.type==='withdraw'){if(!Number.isInteger(c.item)||c.item===undefined||c.item<0||c.item>=ITEMS.length||c.recipe!==undefined)throw new Error('Invalid item.');return{seq:c.seq,type:c.type,item:c.item};}if(c.recipe!==undefined||c.item!==undefined)throw new Error('Unexpected command data.');return{seq:c.seq,type:c.type};}
