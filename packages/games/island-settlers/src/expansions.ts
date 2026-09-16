import {applyBarbarian, applyBarbarianPrompt, afterScenarioBuild, barbarianCommands, resolveCoastalBattles, startScenarioMovement} from './barbarian-scenarios';
import {applyExpedition, expeditionCommands, moving, resolveLairs, startExpeditionMovement} from './explorers-pirates';
import {applyCaravanPrompt, applyScenario, scenarioCommands, scenarioAwards, riverBonus, startCaravan} from './traders-barbarians';
import {GOODS, building, event, need, phase, player, random, total, transfer} from './core';
import {RESOURCES} from './model';
import {COMMODITIES, TRACKS, type ExpansionAction, type ExpansionCommand, type ExpansionPrivate, type ExpansionPublic, type Knight, type Track} from './expansion-model';
import type {ExpansionState, Prompt} from './expansion-state';
import type {State} from './state';
import {shuffled} from './board';
import {allKnights, PROGRESS_DECKS, applyCity, cityCommands, discardProgress, drawProgress, recruitSites} from './cities-knights';
import {cardPicker, choice, command, cost, extra, finishPrompt, queue, seats, steal, validateCommand} from './expansion-common';

export function initializeExpansions(s: State): ExpansionState | null {
  if (!s.settings.citiesKnights && s.settings.expansion !== 'explorers' && !s.settings.scenarios?.length && !s.settings.variants?.length) return null;
  const publicView: ExpansionPublic = {
    knights: [], walls: [], metropolises: [], barbarian: s.settings.citiesKnights ? { position: 0, attacks: 0, event: null } : null, merchant: null,
    players: [], fishing: null, rivers: null, caravans: null, attack: null, deliveries: null, explorers: null, harborOwner: null, event: null,
  };
  const m: ExpansionState = {
    public: publicView, players: Object.fromEntries(s.players.map(p => [p.id, { wagonJourneys: 0, improvements: { science: 0, trade: 0, politics: 0 }, progress: [], fish: [], coins: 0, defenderPoints: 0, progressPoints: 0, prisoners: 0, missions: { lairs: 0, fish: 0, spices: 0 }, fleet: [], harborUsed: [], goldTrades: 0, built: false, movement: false, activeShip: null, finishedShips: [], shipBoosts: [], pirateAttempts: [], piratePaid: [], fishRolled: false, fastGold: 0, wagonBoost: false, wagonAttempts: [] }])),
    progressDecks: Object.fromEntries(TRACKS.map(t => [t, shuffled(PROGRESS_DECKS[t].flatMap(([kind, n]) => Array(n * (s.players.length > 6 ? 2 : 1)).fill(kind)), () => random(s))])) as ExpansionState['progressDecks'],
    knightTurns: {}, prompts: [], barbarianPaths: {}, attackDeck: [], attackDiscard: [], deliveredCargo: [], lairNumbers: {}, resumeMovement: null, resumePhase: 'action', choiceStarted: null, continuation: null, alchemy: null, freeRouteKind: {}, pillaged: [],
    fishDeck: [], fishDiscard: [], fog: {}, guardMoved: [], caravanPending: [], caravanBids: [], cargoDecks: {},
  };
  if (s.settings.citiesKnights) {
    for (const good of COMMODITIES) s.bank[good] = s.players.length <= 4 ? 12 : s.players.length <= 6 ? 18 : 30;
    for (const p of s.players) for (const good of COMMODITIES) p.hand[good] = 0;
    s.deck = []; s.robber = ''; s.pirate = null;
  }
  return m;
}
export function expansionPublic(s: State): ExpansionPublic | undefined {
  const m = s.modules; if (!m) return undefined;
  return { ...m.public, players: s.players.map(p => { const x = extra(s, p.id); return { id: p.id, improvements: x.improvements, progressCount: x.progress.length, defenderPoints: x.defenderPoints, coins: x.coins, fishCount: x.fish.length, prisoners: x.prisoners, missions: x.missions }; }) };
}
function promptCommand(s: State, prompt: Prompt): ExpansionCommand {
  const p = player(s, prompt.playerId), m = s.modules!, x = extra(s, p.id);
  if (prompt.command) return { ...prompt.command, id: prompt.id };
  let c = command(prompt.id, 'Choice', prompt.title, 'The game continues when this choice is confirmed.');
  if (prompt.kind === 'pillage') c.fields = [choice('method', 'City defense', ['pillage', ...(m.public.rivers && x.coins >= 5 ? ['pay-5-gold'] : [])]), { ...choice('target', 'City to downgrade if not paying gold', s.buildings.filter(b => b.playerId === p.id && b.kind === 'city' && !m.public.metropolises.some(x => x.vertex === b.vertex)).map(b => b.vertex), 'vertex'), optional: true }];
  if (prompt.kind === 'draw') c.fields = [choice('track', 'Progress deck', TRACKS.filter(t => m.progressDecks[t].length > 0))];
  if (prompt.kind === 'progress-discard') c.fields = [{ key: 'card', label: 'Progress card to discard', options: x.progress.map(c => ({ value: c.id, label: c.kind.replaceAll('-', ' ') })) }];
  if (['wedding', 'sabotage', 'harbor', 'guild', 'event-give', 'event-pick'].includes(prompt.kind)) {
    const available = prompt.kind === 'guild' ? player(s, prompt.from!).hand : prompt.kind === 'event-pick' ? s.bank : p.hand;
    const allowed = prompt.kind === 'harbor' ? COMMODITIES : prompt.kind === 'event-pick' ? RESOURCES : GOODS;
    const count = prompt.kind === 'harbor' ? 1 : prompt.kind === 'guild' ? Math.min(2, total(available)) : prompt.count ?? 1;
    c = cardPicker(c, available, count, count, allowed);
  }
  if (prompt.kind === 'spy') c.fields = [{ key: 'card', label: 'Progress card to take', options: extra(s, prompt.from!).progress.map(c => ({ value: c.id, label: c.kind.replaceAll('-', ' ') })) }];
  if (prompt.kind === 'treason') c.fields = [choice('knight', 'Knight to remove', allKnights(s).filter(k => k.playerId === p.id).map(k => k.id))];
  if (prompt.kind === 'replace-knight') c.fields = [choice('target', 'Recruitment position', m.public.attack ? [prompt.knight!.vertex] : recruitSites(s, p.id), m.public.attack ? 'edge' : 'vertex'), choice('strength', 'Strength', ['1', '2', '3'].filter(n => Number(n) <= prompt.knight!.strength && allKnights(s).filter(k => k.playerId === p.id && k.strength === Number(n)).length < 2))];
  if (prompt.kind === 'rob') c.fields = [seats(s, 'opponent', 'Player to steal from', s.players.filter(o => o.id !== p.id && total(o.hand)).map(o => o.id))];
  return c;
}
export function expansionCommands(s: State, id: string): ExpansionCommand[] {
  if (!s.modules || s.players.some(p => !p.connected)) return [];
  const prompt = s.modules.prompts[0];
  if (prompt) return prompt.playerId === id ? [promptCommand(s, prompt)] : [];
  return [...cityCommands(s, id), ...scenarioCommands(s, id), ...expeditionCommands(s, id), ...barbarianCommands(s, id)];
}
export function expansionPrivate(s: State, id: string): ExpansionPrivate | undefined {
  if (!s.modules) return undefined;
  const x = extra(s, id), prompt = s.modules.prompts[0];
  return { movement: x.movement, hasMovement: !!(s.modules.public.explorers || s.modules.public.attack || s.modules.public.deliveries), commands: expansionCommands(s, id), task: prompt ? prompt.playerId === id ? prompt.title : `Waiting for ${player(s, prompt.playerId).name}: ${prompt.title}` : null, progress: x.progress, fish: x.fish, coins: x.coins, improvements: x.improvements };
}
function applyPrompt(s: State, prompt: Prompt, a: ExpansionAction, now: number) {
  const m = s.modules!, id = prompt.playerId, p = player(s, id), at = a.choices.target;
  if (prompt.kind === 'pillage' && a.choices.method === 'pay-5-gold') extra(s, id).coins -= 5;
  else if (prompt.kind === 'pillage') { const b = building(s, at); need(b && b.playerId === id && b.kind === 'city', 'Choose the city to downgrade.'); if (s.buildings.filter(b => b.playerId === id && b.kind === 'settlement').length >= 5) m.pillaged.push(at); b.kind = 'settlement'; m.public.walls = m.public.walls.filter(v => v !== at); event(s, 'build', `${p.name} lost a city to barbarians`, id, at); }
  if (prompt.kind === 'draw') drawProgress(s, id, a.choices.track as Track, now);
  if (prompt.kind === 'progress-discard') discardProgress(s, id, a.choices.card);
  if (prompt.kind === 'guard-retreat') { const k = prompt.knight!; m.public.attack!.guards.push({ id: k.id, playerId: id, strength: k.strength, active: k.active, edge: at }); }
  if (prompt.kind === 'retreat') m.public.knights.push({ ...prompt.knight!, vertex: at });
  if (['wedding', 'harbor', 'event-give'].includes(prompt.kind)) transfer(p.hand, player(s, prompt.from!).hand, a.cards!);
  if (prompt.kind === 'sabotage') transfer(p.hand, s.bank, a.cards!);
  if (prompt.kind === 'guild') transfer(player(s, prompt.from!).hand, p.hand, a.cards!);
  if (prompt.kind === 'event-pick') transfer(s.bank, p.hand, a.cards!);
  if (prompt.kind === 'spy') { const from = extra(s, prompt.from!), card = from.progress.find(c => c.id === a.choices.card)!; from.progress = from.progress.filter(c => c !== card); extra(s, id).progress.push(card); }
  if (prompt.kind === 'treason') {
    const k = allKnights(s).find(k => k.id === a.choices.knight)!;
    const removed: Knight = { id: k.id, playerId: k.playerId, strength: k.strength, active: k.active, vertex: m.public.attack ? m.public.attack.guards.find(g => g.id === k.id)!.edge : k.vertex };
    if (m.public.attack) m.public.attack.guards = m.public.attack.guards.filter(g => g.id !== k.id); else m.public.knights = m.public.knights.filter(x => x.id !== k.id);
    if ((m.public.attack || recruitSites(s, prompt.from!).length) && [1, 2, 3].some(n => n <= k.strength && allKnights(s).filter(x => x.playerId === prompt.from && x.strength === n).length < 2)) queue(s, { playerId: prompt.from!, kind: 'replace-knight', title: 'Place the knight gained through Treason', knight: removed }, now);
  }
  if (prompt.kind === 'replace-knight') {
    const k: Knight = { id: `k${++s.serial}`, playerId: id, vertex: at, strength: Number(a.choices.strength) as Knight['strength'], active: prompt.knight!.active };
    if (m.public.attack) m.public.attack.guards.push({ id: k.id, playerId: id, edge: at, strength: k.strength, active: k.active }); else m.public.knights.push(k);
    m.knightTurns[k.id] = { activated: k.active ? p.turns : -1, promoted: -1 };
  }
  if (prompt.kind === 'rob') steal(s, a.choices.opponent, id);
  if (['guard-card', 'guard-treason', 'barbarian-move'].includes(prompt.kind)) applyBarbarianPrompt(s, a);
  if (prompt.kind.startsWith('caravan-')) applyCaravanPrompt(s, a, now);
  if (prompt.kind === 'gold-trade' && a.choices.answer === 'accept') { const proposer = extra(s, prompt.from!); need(proposer.coins >= prompt.count!, 'The offered gold is no longer available.'); transfer(p.hand, player(s, prompt.from!).hand, cost({ [prompt.target!]: 1 })); proposer.coins -= prompt.count!; extra(s, id).coins += prompt.count!; }
  finishPrompt(s, prompt.id, now);
}
export function applyExpansion(s: State, id: string, a: ExpansionAction, now: number) {
  need(s.modules, 'No expansion is selected.'); validateCommand(s, id, a, expansionCommands(s, id));
  const before = new Map(s.buildings.map(b => [b.vertex, b.kind]));
  const prompt = s.modules.prompts[0];
  if (prompt) applyPrompt(s, prompt, a, now); else if (/^(guard|wagon):/.test(a.command)) applyBarbarian(s, id, a, now); else if (a.command.startsWith('exp:')) applyExpedition(s, id, a, now); else if (/^(fish|river|gold):/.test(a.command)) applyScenario(s, id, a, now); else applyCity(s, id, a, now);
  for (const b of s.buildings) if (before.get(b.vertex) !== b.kind && (!before.has(b.vertex) || b.kind !== 'settlement')) { afterScenarioBuild(s, id, b.vertex, b.kind, false); riverBonus(s, id, b.vertex, b.kind, false); }
  scenarioAwards(s);
}
export function resetExpansionTurn(s: State, id: string) {
  if (!s.modules) return;
  const x = extra(s, id); Object.assign(x, { wagonJourneys: 0, fleet: [], harborUsed: [], goldTrades: 0, built: false, movement: false, activeShip: null, finishedShips: [], shipBoosts: [], pirateAttempts: [], piratePaid: [], fishRolled: false, fastGold: 0, wagonBoost: false, wagonAttempts: [] });
  delete s.modules.freeRouteKind[id];
}
export function endExpansionTurn(s: State, id: string, now: number, forced = false): boolean {
  if (!s.modules) return false;
  if (extra(s, id).progress.length > 4) { queue(s, { playerId: id, kind: 'progress-discard', title: 'Discard down to four progress cards before ending' }, now); return true; }
  if (!forced && (s.modules.public.explorers || s.modules.public.attack || s.modules.public.deliveries) && !extra(s, id).movement) { extra(s, id).movement = true; startExpeditionMovement(s, id); startScenarioMovement(s, id); if (s.settings.mode === 'standard') phase(s, 'movement'); return true; }
  if (moving(s, id) || forced) { resolveLairs(s); resolveCoastalBattles(s); }
  if (startCaravan(s, id, now)) return true;
  return false;
}
