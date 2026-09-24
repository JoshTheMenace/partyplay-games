/** Registry: one art module per stage id. */
import { STAGE_IDS, type StageId } from '../../../stages';
import type { StageModule } from '../index';
import { generic } from './common';
import dk from './dk';
import earthbound from './earthbound';
import fzero from './fzero';
import kirby from './kirby';
import mario from './mario';
import metroid from './metroid';
import pokemon from './pokemon';
import retro from './retro';
import smash from './smash';
import starfox from './starfox';
import yoshi from './yoshi';
import zelda from './zelda';

export const BESPOKE: Partial<Record<StageId, StageModule>> = { ...smash, ...mario, ...dk, ...zelda, ...metroid, ...yoshi, ...kirby, ...starfox, ...pokemon, ...fzero, ...earthbound, ...retro };
export const MODULES = Object.fromEntries(STAGE_IDS.map(id => [id, BESPOKE[id] ?? generic()])) as Record<StageId, StageModule>;
