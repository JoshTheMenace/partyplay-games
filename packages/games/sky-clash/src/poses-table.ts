/**
 * Pose family and delivering limb for every fighter × move, chosen from what each move looks like in Melee
 * (browser-safe data). The engine publishes the limb in hits[].limb; the renderer animates the pose.
 * Entries read `move:pose` or `move:pose/limb`; a missing limb comes from the pose (swords → weapon, kicks → right foot...).
 * Each fighter layers its own entries over its style base (unarmed, sword, hammer) and the shared humanoid base.
 * Signature motions and hand-held props beyond these families live in the renderer (scene/fighter SIGNATURES, props HELD).
 */
import { ROSTER, ROSTER_DATA, type FighterKind, type Limb, type MoveId, type Pose } from './model';

export type PoseEntry = { pose: Pose; limb: Limb };
const LIMB: Partial<Record<Pose, Limb>> = {
  jab: 'handL', 'jab-rapid': 'handL', headbutt: 'head',
  'kick-front': 'footR', 'kick-high': 'footR', 'kick-low': 'footR', sweep: 'footR', 'flip-kick': 'footR', 'dive-kick': 'footR', stomp: 'footR', drill: 'footR', slide: 'footR', 'ledge-attack': 'footR', 'getup-attack': 'footR',
  shoulder: 'body', spin: 'body', knee: 'body', 'dash-attack': 'body', 'body-slam': 'body', 'hip-check': 'body', rush: 'body', 'rise-spin': 'body', teleport: 'body', counter: 'body', reflect: 'body',
  'charge-hold': 'body', hover: 'body', 'roll-ball': 'body', inflate: 'body', transform: 'body', taunt: 'body',
  'sword-slash': 'weapon', 'sword-rising': 'weapon', 'sword-low': 'weapon', 'sword-thrust': 'weapon', 'sword-overhead': 'weapon', 'sword-spin': 'weapon', 'sword-down-stab': 'weapon',
  'hammer-swing': 'weapon', 'hammer-overhead': 'weapon', 'item-swing': 'weapon', 'staff-swing': 'weapon', 'gun-shoot': 'weapon', 'blaster-draw': 'weapon',
}; // everything else (crosses, palms, uppercuts, casts, grabs, throws) is the right hand
const parse = (spec: string): Partial<Record<MoveId, PoseEntry>> => Object.fromEntries(spec.trim().split(/\s+/).filter(Boolean).map(token => {
  const [move, rest] = token.split(':') as [MoveId, string], [pose, limb] = rest.split('/') as [Pose, Limb | undefined];
  return [move, { pose, limb: limb ?? LIMB[pose] ?? 'handR' }];
}));

const HUMANOID = `jab1:jab jab2:jab-cross jab3:jab-finisher jabRapid:jab-rapid ftilt:kick-front ftiltHi:kick-high ftiltLw:kick-low utilt:uppercut dtilt:sweep dash:dash-attack
  fsmash:palm-thrust fsmashHi:palm-thrust fsmashLw:palm-thrust usmash:headbutt dsmash:sweep nair:kick-front fair:overhead-slam bair:kick-front/footL uair:flip-kick dair:stomp
  nspecial:cast-forward sspecial:rush uspecial:rise dspecial:cast-down grab:grab dashgrab:grab pummel:pummel fthrow:throw-forward bthrow:throw-back uthrow:throw-up dthrow:throw-down
  ledgeattack:ledge-attack ledgeattackSlow:ledge-attack getupattack:getup-attack getupattackD:getup-attack taunt:taunt`;
const SWORD = `jab1:sword-slash jab2:sword-slash jab3:sword-thrust ftilt:sword-slash ftiltHi:sword-slash ftiltLw:sword-low utilt:sword-rising dtilt:sword-low dash:sword-rising
  fsmash:sword-overhead fsmashHi:sword-overhead fsmashLw:sword-overhead usmash:sword-rising dsmash:sword-low nair:sword-spin fair:sword-slash bair:sword-slash uair:sword-rising dair:sword-down-stab
  ledgeattack:sword-slash ledgeattackSlow:sword-slash getupattack:sword-low getupattackD:sword-low grab:grab/handL dashgrab:grab/handL pummel:pummel/handL`;
const HAMMER = `jab1:hammer-swing jab2:hammer-swing ftilt:hammer-swing ftiltHi:hammer-swing ftiltLw:hammer-swing utilt:hammer-overhead dtilt:hammer-swing dash:hammer-swing
  fsmash:hammer-overhead fsmashHi:hammer-overhead fsmashLw:hammer-overhead usmash:hammer-overhead dsmash:hammer-swing nair:hammer-swing fair:hammer-overhead bair:hammer-swing uair:hammer-overhead dair:hammer-overhead
  ledgeattack:hammer-swing ledgeattackSlow:hammer-swing getupattack:hammer-swing getupattackD:hammer-swing`;
/** Specials in slot order, ground and air alike: neutral side up down. */
const sp = (n: string, s: string, hi: string, lw: string) => `nspecial:${n} nspecialAir:${n} sspecial:${s} sspecialAir:${s} uspecial:${hi} uspecialAir:${hi} dspecial:${lw} dspecialAir:${lw}`;

const plumber = `jab3:kick-front dash:slide fsmash:palm-thrust fsmashHi:palm-thrust fsmashLw:palm-thrust usmash:headbutt dsmash:sweep nair:kick-front fair:overhead-slam uair:flip-kick dair:drill/body bthrow:spin/handR ${sp('palm-thrust/handR', 'item-swing', 'rise', 'spin')}`;
const spacer = `jabRapid:kick-front ftilt:kick-front utilt:flip-kick dtilt:sweep/body dash:kick-front fsmash:kick-high usmash:flip-kick dsmash:sweep nair:kick-front fair:kick-front uair:flip-kick ${sp('gun-shoot', 'rush', 'rise-spin', 'reflect')}`;
const falcon = `jab3:knee utilt:kick-high dtilt:kick-low dash:shoulder fsmash:elbow usmash:flip-kick dsmash:sweep nair:kick-front fair:knee bair:elbow/handL uair:flip-kick dair:stomp`;
const koopa = `jab1:jab/handR jab2:jab-cross/handL ftilt:jab-finisher utilt:uppercut dtilt:sweep/handR dash:body-slam fsmash:headbutt usmash:spin dsmash:spin nair:spin fair:jab-cross bair:kick-front/footL uair:headbutt dair:drill/body ${sp('cast-forward/head', 'grab', 'rise-spin', 'body-slam')}`;
const hylian = `ftilt:sword-overhead dash:sword-overhead nair:kick-front bair:kick-front/footL uair:sword-rising grab:grab/handR dashgrab:grab/handR ${sp('charge-hold/handR', 'cast-forward', 'sword-spin', 'cast-forward')}`;
const fireEmblem = (n: string) => `utilt:sword-rising dash:sword-rising usmash:sword-rising fsmash:sword-overhead nair:sword-spin fair:sword-slash bair:sword-spin dair:sword-overhead ${sp(n, 'sword-slash', 'sword-rising', 'counter/weapon')}`;
const rodent = `jab1:headbutt jab2:headbutt ftilt:kick-front utilt:flip-kick/body dtilt:sweep/body dash:headbutt fsmash:cast-forward/head usmash:flip-kick/body dsmash:spin nair:spin fair:drill/body bair:spin uair:flip-kick/body dair:drill/body ${sp('cast-forward/head', 'rush/head', 'rush', 'cast-up/body')}`;
const psychic = `jab1:palm-thrust jab2:palm-thrust ftilt:sweep/body utilt:flip-kick/body dtilt:sweep/body dash:palm-thrust fsmash:cast-forward usmash:cast-up dsmash:cast-down nair:spin fair:overhead-slam bair:hip-check uair:flip-kick/body dair:stomp`;
const sorceress = `jab1:palm-thrust jab2:palm-thrust ftilt:jab-finisher utilt:cast-up dtilt:kick-low dash:palm-thrust fsmash:cast-forward usmash:cast-up dsmash:sweep nair:spin fair:kick-front bair:kick-front/footL uair:cast-up dair:stomp`;
const hand = (lw: string) => `jab1:jab/body jab2:jab/body jabRapid:jab-rapid/body ftilt:sword-slash/body utilt:uppercut/body dtilt:sweep/body dash:rush fsmash:overhead-slam/body usmash:rise/body dsmash:sweep/body
  nair:spin fair:overhead-slam/body bair:hip-check uair:flip-kick/body dair:stomp/body grab:grab/body dashgrab:grab/body pummel:pummel/body ${sp('gun-shoot/body', 'slide/body', 'rise/body', lw)}`;
const climber = `${sp('hammer-swing', 'spin/weapon', 'rise/weapon', 'cast-forward')}`;

const FIGHTER: Record<FighterKind, string> = {
  mario: plumber, 'dr-mario': plumber,
  luigi: `${plumber} dash:dash-attack dair:stomp ${sp('palm-thrust/handR', 'rush/head', 'rise', 'spin')}`,
  fox: `${spacer} dair:drill/body`, falco: `${spacer} dair:stomp`,
  'captain-falcon': `${falcon} ${sp('jab-finisher', 'rush/handR', 'rise', 'dive-kick')}`,
  ganondorf: `${falcon} utilt:kick-high fsmash:elbow fair:overhead-slam ${sp('jab-finisher', 'rush/handR', 'rise', 'dive-kick')}`,
  'male-wireframe': `${falcon} ${sp('jab-finisher', 'rush/handR', 'rise', 'slide')}`,
  'donkey-kong': `ftilt:palm-thrust utilt:uppercut dtilt:sweep/handR dash:spin fsmash:clap fsmashHi:clap fsmashLw:clap usmash:clap dsmash:sweep/handR nair:spin fair:overhead-slam uair:headbutt ${sp('charge-hold/handR', 'headbutt', 'rise-spin', 'overhead-slam')}`,
  kirby: `utilt:flip-kick dtilt:kick-low dash:spin fsmash:kick-front usmash:flip-kick dsmash:sweep nair:spin fair:kick-front dair:drill ${sp('inflate', 'hammer-swing', 'rise', 'body-slam')}`,
  bowser: koopa, 'giga-bowser': koopa,
  link: hylian, 'young-link': hylian,
  sheik: `ftilt:kick-high utilt:kick-high dash:palm-thrust fsmash:palm-thrust fsmashHi:palm-thrust fsmashLw:palm-thrust usmash:cast-up dsmash:sweep nair:kick-front fair:overhead-slam dair:dive-kick ${sp('cast-forward', 'cast-forward', 'teleport', 'transform')}`,
  zelda: `${sorceress} ${sp('cast-around/body', 'cast-forward', 'teleport', 'transform')}`,
  'female-wireframe': `${sorceress} ${sp('cast-forward', 'cast-forward', 'teleport', 'reflect')}`,
  ness: `jab3:kick-front dtilt:kick-low dash:cast-forward fsmash:item-swing fsmashHi:item-swing fsmashLw:item-swing usmash:cast-up dsmash:sweep/handR nair:spin fair:cast-forward bair:palm-thrust/handL uair:headbutt ${sp('cast-up', 'cast-forward', 'cast-up', 'charge-hold')}`,
  peach: `jab1:palm-thrust jab2:palm-thrust ftilt:kick-high utilt:cast-up dtilt:sweep/handR dash:palm-thrust fsmash:item-swing fsmashHi:item-swing fsmashLw:item-swing usmash:cast-up dsmash:spin nair:spin fair:overhead-slam bair:hip-check uair:uppercut dair:stomp ${sp('counter', 'hip-check', 'rise/weapon', 'cast-down')}`,
  popo: climber, nana: climber,
  pikachu: rodent, pichu: rodent,
  samus: `jab1:jab/weapon jab2:jab-cross/weapon utilt:kick-high dtilt:gun-shoot dash:shoulder fsmash:palm-thrust/weapon fsmashHi:palm-thrust/weapon fsmashLw:palm-thrust/weapon usmash:cast-up/weapon dsmash:sweep nair:kick-front fair:overhead-slam/weapon uair:rise-spin dair:overhead-slam/weapon grab:gun-shoot dashgrab:gun-shoot ${sp('charge-hold/weapon', 'gun-shoot', 'rise-spin', 'roll-ball')}`,
  yoshi: `jab1:kick-front jab2:kick-front/footL utilt:flip-kick dtilt:sweep/body dash:kick-front fsmash:headbutt fsmashHi:headbutt fsmashLw:headbutt usmash:headbutt dsmash:spin fair:headbutt bair:hip-check uair:flip-kick/body dair:stomp ${sp('cast-forward/head', 'roll-ball', 'cast-up', 'body-slam')}`,
  jigglypuff: `jab1:jab/handR jab2:jab-cross ftilt:kick-front utilt:kick-high dtilt:kick-low dash:dash-attack fsmash:kick-front usmash:headbutt dsmash:spin nair:kick-front fair:kick-front uair:uppercut dair:drill ${sp('roll-ball', 'palm-thrust', 'cast-around/head', 'charge-hold')}`,
  mewtwo: `${psychic} ${sp('charge-hold/handR', 'cast-forward', 'teleport', 'cast-forward/head')}`,
  marth: fireEmblem('sword-thrust'), roy: fireEmblem('sword-slash'),
  'game-watch': `jab1:jab/handR jab2:jab/handR ftilt:item-swing utilt:cast-up dtilt:sweep/body dash:rush fsmash:item-swing fsmashHi:item-swing fsmashLw:item-swing usmash:headbutt dsmash:hammer-swing
    nair:item-swing bair:item-swing fair:item-swing uair:cast-up dair:stomp ${sp('item-swing', 'hammer-overhead', 'rise/body', 'item-swing')}`,
  'master-hand': hand('overhead-slam/body'), 'crazy-hand': hand('grab/body'),
  sandbag: `jab1:shoulder jab2:shoulder jab3:body-slam jabRapid:shoulder ftilt:hip-check utilt:headbutt dtilt:slide dash:body-slam fsmash:shoulder fsmashHi:shoulder fsmashLw:shoulder usmash:headbutt dsmash:spin
    nair:spin fair:body-slam bair:hip-check uair:headbutt dair:body-slam ${sp('cast-forward/body', 'shoulder', 'rise/body', 'body-slam')}`,
};
const STYLE: Record<string, string> = { sword: SWORD, climber: HAMMER };
export const POSE_TABLE = Object.fromEntries(ROSTER.map(kind => [kind, { ...parse(HUMANOID), ...parse(STYLE[ROSTER_DATA[kind].style] ?? ''), ...parse(FIGHTER[kind]) }])) as Record<FighterKind, Record<MoveId, PoseEntry>>;
