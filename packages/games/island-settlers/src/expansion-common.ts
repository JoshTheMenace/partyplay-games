import { GOODS, building, edge, event, has, need, phase, player, random, total, transfer, vertex } from './core';
import { RESOURCES, emptyHand, type Hand } from './model';
import type { State } from './state';
import type { Prompt } from './expansion-state';
import type { CommandField, ExpansionAction, ExpansionCommand, Good } from './expansion-model';

export const extra = (s: State, id: string) => s.modules!.players[id];
export const cost = (cards: Partial<Hand>): Hand => ({ ...emptyHand(), ...cards });
export const choice = (key: string, label: string, values: string[], map?: CommandField['map']): CommandField => ({ key, label, options: values.map(value => ({ value, label: value })), ...(map ? { map } : {}) });
export const seats = (s: State, key: string, label: string, ids: string[]) => ({ key, label, options: ids.map(id => ({ value: id, label: player(s, id).name })) });
export const command = (id: string, group: ExpansionCommand['group'], label: string, detail: string, fields: CommandField[] = [], pay?: Hand): ExpansionCommand => ({ id, group, label, detail, fields, ...(pay ? { cost: pay } : {}) });
export function validateCommand(s: State, id: string, a: ExpansionAction, commands: ExpansionCommand[]) {
  const c = commands.find(c => c.id === a.command); need(c, 'That expansion action is no longer available.');
  need(Object.keys(a.choices).every(k => c.fields.some(f => f.key === k)), 'Unknown choice.');
  for (const f of c.fields) need(f.optional && !a.choices[f.key] || f.options.some(o => o.value === a.choices[f.key]), `Choose ${f.label.toLowerCase()} again.`);
  if (c.cards) {
    need(a.cards && total(a.cards) >= c.cards.min && total(a.cards) <= c.cards.max && has(c.cards.available, a.cards) && GOODS.every(r => !a.cards![r] || c.cards!.allowed.includes(r)), `Choose ${c.cards.min === c.cards.max ? c.cards.min : `${c.cards.min}–${c.cards.max}`} cards.`);
  } else need(!a.cards || !total(a.cards), 'This action does not use a card selection.');
  if (c.cost) transfer(player(s, id).hand, s.bank, c.cost);
  return c;
}
export function queue(s: State, prompt: Omit<Prompt, 'id'>, now: number) {
  const m = s.modules!;
  if (!m.prompts.length) { m.resumePhase = s.phase; m.choiceStarted = now; phase(s, 'choice'); }
  m.prompts.push({ ...prompt, id: `q${++s.serial}` });
}
export function finishPrompt(s: State, id: string, now: number) {
  const m = s.modules!; m.prompts = m.prompts.filter(p => p.id !== id);
  if (!m.prompts.length) {
    if (s.deadline !== null && m.choiceStarted !== null) s.deadline += now - m.choiceStarted;
    m.choiceStarted = null; phase(s, m.resumePhase);
  } else s.turnId++;
}
export function take(s: State, id: string, good: Good, count: number) { const n = Math.min(count, s.bank[good] ?? 0); if (n) transfer(s.bank, player(s, id).hand, cost({ [good]: n })); }
export function steal(s: State, from: string, to: string) {
  const victim = player(s, from); let pick = Math.floor(random(s) * total(victim.hand));
  for (const r of GOODS) { if (pick < (victim.hand[r] ?? 0)) { transfer(victim.hand, player(s, to).hand, cost({ [r]: 1 })); return; } pick -= victim.hand[r] ?? 0; }
}
export function adjacentTiles(s: State, id: string) { return s.board.tiles.filter(t => s.buildings.some(b => b.playerId === id && vertex(s, b.vertex)!.tiles.includes(t.id))); }
export function connectedVertices(s: State, id: string, start: string) {
  const seen = new Set([start]), todo = [start];
  for (const at of todo) {
    if (at !== start && (building(s, at)?.playerId && building(s, at)!.playerId !== id || s.modules?.public.knights.some(k => k.vertex === at && k.playerId !== id))) continue;
    for (const r of s.routes.filter(r => r.playerId === id)) {
      const e = edge(s, r.edge)!; if (e.a !== at && e.b !== at) continue;
      const next = e.a === at ? e.b : e.a; if (!seen.has(next)) { seen.add(next); todo.push(next); }
    }
  }
  seen.delete(start); return [...seen];
}
export const emptyIntersection = (s: State, id: string) => !building(s, id) && !s.modules?.public.knights.some(k => k.vertex === id);
export function cardPicker(c: ExpansionCommand, available: Hand, min: number, max = min, allowed: readonly Good[] = GOODS) { c.cards = { label: 'Cards', available, min, max, allowed: [...allowed] }; return c; }
export function payCoins(s: State, id: string, n: number) { need(extra(s, id).coins >= n, 'You need more gold coins.'); extra(s, id).coins -= n; }
export function resourceChoice(key = 'resource', label = 'Resource') { return choice(key, label, [...RESOURCES]); }
export function announce(s: State, id: string, text: string, target: string | null = null) { event(s, 'build', `${player(s, id).name} ${text}`, id, target); }
