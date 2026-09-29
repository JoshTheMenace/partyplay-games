import type { EventDef } from '../types';
import { BEACONS } from './beacons';
import { DISTRESS } from './distress';
import { FRONTIER } from './frontier';
import { HOSTILE } from './hostile';
import { QUESTS } from './quests';
import { SCIENCE } from './science';
import { SPECIAL } from './special';
import { TRADE } from './trade';
import { TRAVEL } from './travel';

export const EVENTS: readonly EventDef[] = [...HOSTILE, ...TRAVEL, ...DISTRESS, ...TRADE, ...SCIENCE, ...QUESTS, ...FRONTIER, ...BEACONS, ...SPECIAL];
