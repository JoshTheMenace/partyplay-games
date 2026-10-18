/** Which licensed sample (public/games/blockwild/sounds) plays for each game event. Pure data. */
import type { SoundGroup } from '../../shared/blocks';

/** Sample names that exist on disk (without `.wav`). Families with `-0..2` variants list the base name. */
export const SAMPLE_FAMILIES = ['impact-glass', 'impact-hit', 'impact-metal', 'impact-soft', 'impact-stone', 'impact-wood', 'step-cloth', 'step-grass', 'step-snow', 'step-stone',
  'step-wood', 'skeleton', 'spider', 'zombie'] as const;
export const SAMPLES = ['bow', 'chest-close', 'chest-open', 'chicken', 'close', 'cow', 'craft', 'explode', 'fire', 'fuse', 'open', 'pickup', 'pig', 'select', 'sheep', 'sleep',
  'splash', 'swish', 'water'] as const;
/** Everything the SFX engine may load. */
export const SOUND_FILES: readonly string[] = [...SAMPLES, ...SAMPLE_FAMILIES.flatMap(family => [0, 1, 2].map(i => `${family}-${i}`))];

/** Sounds that are synthesized because no sample exists. */
export type SynthSound = 'eat' | 'burp' | 'levelup' | 'click' | 'hurt' | 'fizz' | 'piston' | 'portal' | 'travel' | 'scrape' | 'villager' | 'ghast' | 'shriek'
  | 'eye' | 'roar' | 'flap' | 'scream' | 'vwoop' | 'blaze' | 'blazeShoot' | 'silverfish' | 'portalOpen' | 'dragonDeath';

const STEP: Record<SoundGroup, string> = { stone: 'step-stone', metal: 'step-stone', glass: 'step-stone', wood: 'step-wood', grass: 'step-grass', gravel: 'step-snow', sand: 'step-snow', snow: 'step-snow', wool: 'step-cloth' };
const IMPACT: Record<SoundGroup, string> = { stone: 'impact-stone', metal: 'impact-metal', glass: 'impact-glass', wood: 'impact-wood', grass: 'impact-soft', gravel: 'impact-soft', sand: 'impact-soft', snow: 'impact-soft', wool: 'impact-soft' };

const variant = (family: string, pick: number) => `${family}-${Math.abs(Math.floor(pick)) % 3}`;
/** Footstep sample for the block under the feet. */
export const stepSound = (group: SoundGroup, pick: number) => variant(STEP[group], pick);
/** Mining hit / break / place sample for a block's sound group. */
export const impactSound = (group: SoundGroup, pick: number) => variant(IMPACT[group], pick);
/** Pitch multiplier per action (MC plays break/place lower than hits). */
export const IMPACT_PITCH = { hit: 1.25, break: 0.85, place: 0.95 } as const;

/** Mob voice: ambient idle call; hurt and death reuse it at other pitches. Creepers only hiss; zombified piglins grunt with the zombie. */
export function mobVoice(key: string, pick: number): string | null {
  if (key === 'zombie' || key === 'skeleton' || key === 'spider' || key === 'zombified_piglin') return variant(key === 'zombified_piglin' ? 'zombie' : key, pick);
  if (key === 'cow' || key === 'pig' || key === 'sheep' || key === 'chicken') return key;
  return null;
}
/** Synthesized voices for mobs without samples (villager hums, ghast wails, blaze breaths, enderman vwoops...), played like mobVoice. */
const MOB_SYNTHS: Partial<Record<string, SynthSound>> = { villager: 'villager', ghast: 'ghast', blaze: 'blaze', enderman: 'vwoop', silverfish: 'silverfish', ender_dragon: 'roar' };
export const mobSynth = (key: string): SynthSound | null => MOB_SYNTHS[key] ?? null;
/** Hearing distance (blocks) of a mob's voice when it carries further than the default 24. */
export const mobRange = (key: string) => key === 'ender_dragon' ? 128 : key === 'ghast' ? 48 : undefined;
/** Pitch per mob voice (zombified piglins sound lower and rougher than zombies). */
export const mobPitch = (key: string) => key === 'zombified_piglin' ? 0.72 : 1;
