import type { Definitions, EventEffect } from '../contracts';

export function validateDefinitions(defs: Definitions): string[] {
  const errors: string[] = [];
  for (const [table, entries] of Object.entries(defs)) {
    const ids = new Set<string>();
    for (const entry of entries) {
      if (!entry.id || ids.has(entry.id)) errors.push(`${table}: duplicate or empty ID ${entry.id}`);
      ids.add(entry.id);
    }
  }
  const systems = new Set(defs.systems.map(system => system.id));
  const events = new Set(defs.events.map(event => event.id));
  const weapons = new Set(defs.weapons.map(weapon => weapon.id));
  const hulls = new Set(defs.hulls.map(hull => hull.id));
  const enemies = new Set(defs.enemies.map(enemy => enemy.id));
  const allEffects = defs.events.flatMap(event => [...event.effects, ...event.choices.flatMap(choice => [...choice.effects, ...(choice.outcomes ?? []).flatMap(outcome => outcome.effects)])]);
  const flags = new Set(allEffects.flatMap(effect => effect.kind === 'flag' && effect.value ? [effect.id] : []));
  const effectKinds = new Set(['scrap', 'items', 'damage', 'repair', 'combat', 'store', 'recruit', 'replacement', 'threat', 'flag', 'followup', 'crew-health', 'ammo', 'hazard', 'reputation', 'timed-status']);
  const checkEffect = (id: string, effect: EventEffect) => {
    if (!effectKinds.has(effect.kind)) errors.push(`${id}: unsupported effect ${effect.kind}`);
    if (effect.kind === 'followup' && !events.has(effect.eventId)) errors.push(`${id}: missing followup ${effect.eventId}`);
    if (effect.kind === 'replacement' && !hulls.has(effect.hullId)) errors.push(`${id}: unknown replacement hull`);
    if ('amount' in effect && !Number.isFinite(effect.amount)) errors.push(`${id}: invalid amount`);
    if (effect.kind === 'items' && (!Number.isInteger(effect.count) || effect.count < 0 || effect.count > 32)) errors.push(`${id}: invalid item count`);
    if (effect.kind === 'timed-status' && (!systems.has(effect.system) || effect.durationMs <= 0)) errors.push(`${id}: invalid timed disruption`);
  };
  for (const hull of defs.hulls) {
    if (hull.rooms.reduce((sum, room) => sum + room.capacity, 0) < 40) errors.push(`${hull.id}: insufficient room capacity`);
    const ids = new Set(hull.rooms.map(room => room.id));
    if (ids.size !== hull.rooms.length) errors.push(`${hull.id}: duplicate room IDs`);
    for (const room of hull.rooms) {
      if (room.w < 2 || room.h < 2 || room.x < 0 || room.y < 0 || room.x + room.w > 16 || room.y + room.h > 9) errors.push(`${hull.id}/${room.id}: invalid phone geometry`);
      if (room.adjacent.some(id => !ids.has(id) || !hull.rooms.find(other => other.id === id)?.adjacent.includes(room.id))) errors.push(`${hull.id}/${room.id}: broken room connection`);
      if (hull.rooms.some(other => other !== room && Math.min(room.x + room.w, other.x + other.w) > Math.max(room.x, other.x) && Math.min(room.y + room.h, other.y + other.h) > Math.max(room.y, other.y))) errors.push(`${hull.id}/${room.id}: overlapping room interiors`);
    }
    const reachable = new Set<string>();
    const queue = [hull.rooms[0]?.id];
    for (const id of queue) if (id && !reachable.has(id)) { reachable.add(id); queue.push(...(hull.rooms.find(room => room.id === id)?.adjacent ?? [])); }
    if (reachable.size !== hull.rooms.length) errors.push(`${hull.id}: disconnected room graph`);
    if (hull.startingWeapons.some(id => !weapons.has(id)) || hull.startingSystems.some(id => !systems.has(id))) errors.push(`${hull.id}: missing starter equipment`);
  }
  for (const enemy of defs.enemies) if (!hulls.has(enemy.hullId) || enemy.weapons.some(id => !weapons.has(id)) || enemy.systems.some(id => !systems.has(id))) errors.push(`${enemy.id}: invalid enemy loadout`);
  for (const sector of defs.sectors) if (!enemies.has(sector.boss) || sector.enemies.some(id => !enemies.has(id))) errors.push(`${sector.id}: invalid encounter pool`);
  for (const event of defs.events) {
    if (!(event.weight > 0) || !Number.isFinite(event.weight)) errors.push(`${event.id}: invalid selection weight`);
    if (event.minReputation && (!event.minReputation.faction || !Number.isFinite(event.minReputation.amount))) errors.push(`${event.id}: invalid reputation requirement`);
    if (event.requiresFlag && !flags.has(event.requiresFlag)) errors.push(`${event.id}: impossible entry flag`);
    if (event.minReputation && !allEffects.some(effect => effect.kind === 'reputation' && effect.faction === event.minReputation!.faction && effect.amount > 0)) errors.push(`${event.id}: impossible reputation requirement`);
    if (new Set(event.choices.map(choice => choice.id)).size !== event.choices.length) errors.push(`${event.id}: duplicate choice ID`);
    if (event.choices.filter(choice => choice.requirement).length > 2) errors.push(`${event.id}: too many special options`);
    for (const effect of event.effects) checkEffect(event.id, effect);
    for (const choice of event.choices) {
      if (!Number.isInteger(choice.cost) || choice.cost < 0) errors.push(`${event.id}/${choice.id}: invalid cost`);
      const requirement = choice.requirement;
      if (requirement?.kind === 'system' && !systems.has(requirement.id as never)) errors.push(`${event.id}: impossible system requirement`);
      if (requirement?.kind === 'weapon-family' && !defs.weapons.some(weapon => weapon.family === requirement.id)) errors.push(`${event.id}: impossible weapon requirement`);
      if (requirement?.kind === 'item-tag' && ![...defs.weapons, ...defs.systems, ...defs.drones, ...defs.augments].some(item => item.tags.includes(requirement.id))) errors.push(`${event.id}: impossible item requirement`);
      for (const effect of choice.effects) checkEffect(event.id, effect);
      for (const outcome of choice.outcomes ?? []) {
        if (!(outcome.weight > 0) || !Number.isFinite(outcome.weight)) errors.push(`${event.id}: invalid outcome weight`);
        for (const effect of outcome.effects) checkEffect(event.id, effect);
      }
    }
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  function walk(id: string) {
    if (visiting.has(id)) { errors.push(`${id}: cyclic followup`); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    const event = defs.events.find(event => event.id === id);
    const effects = event ? [...event.effects, ...event.choices.flatMap(choice => [...choice.effects, ...(choice.outcomes ?? []).flatMap(outcome => outcome.effects)])] : [];
    for (const effect of effects) if (effect.kind === 'followup') walk(effect.eventId);
    visiting.delete(id); visited.add(id);
  }
  for (const event of defs.events) walk(event.id);
  return errors;
}

export function contentInventory(defs: Definitions) {
  return defs.events.map(event => {
    const effects = [...event.effects, ...event.choices.flatMap(choice => [...choice.effects, ...(choice.outcomes ?? []).flatMap(outcome => outcome.effects)])];
    return { id: event.id, category: event.category, followup: !!event.requiresFlag, tags: event.tags, sectors: event.sectors, ordinaryChoices: event.choices.filter(choice => !choice.requirement).length, specialChoices: event.choices.filter(choice => choice.requirement).length, capabilities: event.choices.flatMap(choice => choice.requirement ? [`${choice.requirement.kind}:${choice.requirement.id}`] : []), effects: [...new Set(effects.map(effect => effect.kind))], followups: effects.flatMap(effect => effect.kind === 'followup' ? [effect.eventId] : []), words: [event.title, event.text, ...event.choices.flatMap(choice => [choice.label, choice.text, ...(choice.outcomes ?? []).map(outcome => outcome.text)])].join(' ').trim().split(/\s+/).length };
  });
}
