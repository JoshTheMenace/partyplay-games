import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { battleFixture } from './fixtures';
import { definitions as defs } from '../src/definitions/server';
import { rules } from '../src/server';
import { standingPlaces, tickSimulation } from '../src/simulation';

test('ten-vessel fixture measures authoritative tick cost and forty-crew inspection payload', () => {
  const state = battleFixture(4, 6), carrier = state.simulation.ships[0];
  const templates = [...state.simulation.crew];
  state.simulation.crew = [];
  for (let index = 0; index < 40; index++) {
    const owner = index < 32 ? state.captains[Math.floor(index / 8)].id : null;
    const template = templates.find(crew => crew.ownerCaptainId === owner)!;
    const room = carrier.rooms.find(room => standingPlaces(state, carrier, room.id, defs).length)!;
    state.simulation.crew.push({ ...structuredClone(template), id: `density-${index}`, ownerCaptainId: owner, currentShipId: carrier.id, roomId: room.id, ...standingPlaces(state, carrier, room.id, defs)[0], order: { kind: 'hold', roomId: room.id } });
  }
  for (const captain of state.captains) rules.applyAction(state, captain.playerId!, { type: 'inspectShip', shipId: carrier.id, requestId: 1, epoch: state.epoch }, 0);
  const context = { nowMs: 0, phase: 'playing' as const };
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  const publicBytes = bytes(rules.publicView(state, context));
  const privateViews = state.captains.map(captain => rules.playerView(state, captain.playerId!, context));
  const privateBytes = privateViews.map(bytes);
  const samples: number[] = [];
  for (let tick = 0; tick < 200; tick++) {
    const start = performance.now(); tickSimulation(state, new Map(), 1000 / 30, defs); samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(JSON.stringify({ fixture: '10 vessels, all four captains inspect 32 allied crew and eight boarders on one allied hull; no browser/network', phase: state.phase, privateEntities: privateViews.map(view => ({ hullDefinitions: view.hulls.length, ownInteriorCrew: view.ownShip?.crew.length ?? 0, inspectedCrew: view.inspectedShip?.crew.length ?? 0, ownedRoster: view.crew.length })), samples: samples.length, tickP50Ms: Number(samples[100].toFixed(3)), tickP95Ms: Number(samples[190].toFixed(3)), tickMaxMs: Number(samples[199].toFixed(3)), publicBytes, privateBytes, aggregateSnapshotBytes: publicBytes + privateBytes.reduce((sum, value) => sum + value, 0) }));
  assert.equal(state.simulation.ships.length, 10);
  assert.equal(state.simulation.crew.length, 40);
  assert.ok(samples.every(Number.isFinite));
});
