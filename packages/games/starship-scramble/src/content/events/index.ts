import type { EventDef } from '../types';
import { DISTRESS } from './distress';
import { HOSTILE } from './hostile';
import { QUESTS } from './quests';
import { SCIENCE } from './science';
import { SPECIAL } from './special';
import { TRADE } from './trade';
import { TRAVEL } from './travel';

export const EVENTS: readonly EventDef[] = [...HOSTILE, ...TRAVEL, ...DISTRESS, ...TRADE, ...SCIENCE, ...QUESTS, ...SPECIAL];
