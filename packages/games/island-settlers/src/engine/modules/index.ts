/**
 * The module list in MODULE_IDS order (one import per module). A function, not a constant, so a
 * module that imports core files (which import the registry) never sees an unfinished import cycle.
 */
import type { Module } from './registry';
import { seafarers } from './seafarers/index';
import { explorers } from './explorers/index';
import { citiesKnights } from './cities-knights/index';
import { fishing } from './fishing';
import { rivers } from './rivers';
import { caravans } from './caravans';
import { barbarianAttack } from './barbarian-attack';
import { deliveries } from './deliveries';
import { friendlyRobber } from './friendly-robber';
import { harbormaster } from './harbormaster';

export const allModules = (): readonly Module[] => [
  seafarers, explorers, citiesKnights,
  fishing, rivers, caravans, barbarianAttack, deliveries,
  friendlyRobber, harbormaster,
];
