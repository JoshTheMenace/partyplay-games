/** UI import boundary (BUILD-PLAN §0) plus checks on the shared UI contract WP-ui-shared owns. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_SETTINGS, SEAT_COLORS, type GameEvent, type Settings } from '../../src/model';
import { restrictions, suggestedTarget } from '../../src/settings';
import { InstructionsView } from '../../src/ui/instructions';
import { SettingsView } from '../../src/ui/settings';
import { readDraft, saveDraft } from '../../src/ui/shared/drafts';
import { EMBLEM_PATHS, EMBLEMS } from '../../src/ui/shared/emblems';
import { cardsText, clockText, plural, secondsLeft } from '../../src/ui/shared/format';
import { regions, type Rect } from '../../src/ui/shared/layout';
import { SEATS } from '../../src/ui/shared/seats';
import { freshEvents } from '../../src/ui/shared/timeline';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const FORBIDDEN = [join(src, 'engine'), join(src, 'cpu'), join(src, 'server')];

/** Runtime module specifiers of a source file. Type-only imports and exports are skipped. */
function runtimeImports(code: string): string[] {
  const found: string[] = [];
  const from = /^\s*(import|export)\s+(type\s+)?([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const [, , typeOnly, what, spec] of code.matchAll(from)) {
    const inline = /^\{([^}]*)\}$/.exec(what.trim())?.[1].split(',').map(s => s.trim()).filter(Boolean);
    if (!typeOnly && !(inline?.length && inline.every(s => s.startsWith('type ')))) found.push(spec);
  }
  for (const [, spec] of code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.push(spec);
  const dynamic = /\bimport(?:\.meta\.glob)?\s*(?:<[^(]*>)?\(\s*['"]([^'"]+)['"]/g;
  for (const [, spec] of code.matchAll(dynamic)) found.push(spec);
  return found;
}

const breaches = (file: string, code: string) => runtimeImports(code)
  .filter(spec => spec.startsWith('.'))
  .map(spec => resolve(dirname(file), spec))
  .filter(target => FORBIDDEN.some(bad => target.startsWith(bad) && /^([/.]|$)/.test(target.slice(bad.length))))
  .map(target => `${relative(src, file)} → ${relative(src, target)}`);

const uiFiles = () => [join(src, 'client.tsx'),
  ...readdirSync(join(src, 'ui'), { recursive: true, encoding: 'utf8' })
    .filter(f => /\.tsx?$/.test(f)).map(f => join(src, 'ui', f))];

test('client and ui never import engine, cpu or server at runtime', () => {
  const found = uiFiles().flatMap(file => breaches(file, readFileSync(file, 'utf8')));
  assert.deepEqual(found, []);
});

test('the boundary check catches runtime imports and allows type imports', () => {
  const file = join(src, 'ui', 'x', 'index.tsx');
  assert.equal(breaches(file, "import { a } from '../../engine/state';").length, 1);
  assert.equal(breaches(file, "import '../../server';").length, 1);
  assert.equal(breaches(file, "const m = import('../../cpu/index');").length, 1);
  assert.equal(breaches(file, "import.meta.glob<Record<string, X>>(\n  '../../engine/*.ts');").length, 1);
  assert.equal(breaches(file, "import {\n  a,\n  type B,\n} from '../../engine/state';").length, 1);
  assert.equal(breaches(file, "import type { State } from '../../engine/state';").length, 0);
  assert.equal(breaches(file, "import { type State } from '../../engine/state';").length, 0);
  assert.equal(breaches(file, "export type { State } from '../../engine/state';").length, 0);
  assert.equal(breaches(file, "import { rules } from '../../settings';").length, 0);
});

test('ten seats with unique colours and emblems', () => {
  assert.equal(SEATS.length, SEAT_COLORS.length);
  assert.equal(new Set(SEATS.map(s => s.body)).size, 10);
  assert.deepEqual(SEATS.map(s => s.emblem), EMBLEMS);
  assert.equal(new Set(Object.values(EMBLEM_PATHS)).size, 10);
});

const overlaps = (a: Rect, b: Rect) => a.left < b.left + b.width && b.left < a.left + a.width
  && a.top < b.top + b.height && b.top < a.top + a.height;

test('regions match EXPERIENCE §3.1 and §4.9 and never overlap', () => {
  const tv = regions({ width: 1560, height: 980 }, false);
  assert.deepEqual(tv.board, { left: 332, top: 120, width: 1560 - 332 - 392, height: 764 });
  assert.deepEqual(tv.strip, { left: 16, top: 900, width: 1560 - 16 - 392, height: 64 });
  assert.equal(tv.dock, null);
  const host = regions({ width: 1560, height: 980 }, true);
  assert.equal(980 - host.board!.top - host.board!.height, 230);
  assert.deepEqual(host.dock, { left: 16, top: 814, width: 1560 - 16 - 392, height: 150 });
  const stages = [{ width: 1240, height: 620 }, { width: 1560, height: 980 }];
  for (const stage of stages) for (const h of [false, true]) {
    const rects = Object.values(regions(stage, h)).filter((r): r is Rect => !!r);
    for (const a of rects) for (const b of rects) assert(a === b || !overlaps(a, b), JSON.stringify([stage, a, b]));
    const rail = regions(stage, h).rail!;
    assert(rail.width * stage.height / 980 >= 250 - 1e-9, 'seat rail keeps its 250px floor');
  }
});

test('fresh events skip seen and stale ones, oldest first', () => {
  const ev = (id: number, at: number): GameEvent => ({ id, at, text: '', kind: 'emote', seat: 'p0', emote: 'gg' });
  const events = [ev(4, 9000), ev(2, 1000), ev(3, 8000), ev(1, 9500)];
  assert.deepEqual(freshEvents(events, 1, 10000).map(e => e.id), [3, 4]);
});

test('format helpers', () => {
  assert.equal(plural(1, 'resource'), '1 resource');
  assert.equal(plural(7, 'resource'), '7 resources');
  assert.equal(cardsText({ ore: 1, wool: 2 }), '2 wool, 1 ore');
  assert.equal(cardsText({}), 'nothing');
  assert.equal(clockText(secondsLeft(42_100, 0)), '0:43');
  assert.equal(clockText(120), '2:00');
});

test('drafts are scoped to the turn id', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  saveDraft(storage, 'k', 5, { give: { wool: 2 } });
  assert.deepEqual(readDraft(storage, 'k', 5), { give: { wool: 2 } });
  assert.equal(readDraft(storage, 'k', 6), null);
  saveDraft(storage, 'k', 5, null);
  assert.equal(readDraft(storage, 'k', 5), null);
});

const words = (html: string) => html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

test('instructions stay under 60 words before the details', () => {
  for (const role of ['display', 'controller', 'personal'] as const) {
    const html = renderToStaticMarkup(createElement(InstructionsView, { role }));
    assert(words(html.slice(0, html.indexOf('<details'))) < 60, role);
    assert.match(html, /<details><summary>More rules<\/summary>/);
  }
});

test('settings show every restriction reason and the live suggested target', () => {
  const cases: Partial<Settings>[] = [
    { map: 'explorers', missions: ['lairs'] },
    { map: 'seafarers', seafarers: 'four-islands' },
    { scenarios: ['deliveries'], citiesKnights: true },
  ];
  for (const part of cases) {
    const s = { ...DEFAULT_SETTINGS, ...part };
    const html = renderToStaticMarkup(createElement(SettingsView, { settings: s, onChange() {}, disabled: false }));
    const reasons = Object.values(restrictions(s)) as string[];
    for (const reason of reasons) assert(html.includes(reason.replace(/&/g, '&amp;')), reason);
    assert(html.includes(`Suggested for this setup: <b>${suggestedTarget(s)}</b>`));
    assert(html.includes('You + 3 CPUs = 4 seats'));
    assert(html.includes('Relaxed') && html.includes('Brisk') && html.includes('Balanced dice'));
  }
});
