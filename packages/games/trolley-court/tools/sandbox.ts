/**
 * Trolley Court render sandbox (Node only, never imported by the client): real rules and bots produce fixtures for every
 * phase, esbuild bundles tools/sandbox-page.tsx, and one small server shows any phase at any roster in a second, with no room.
 *
 *   node --import tsx packages/games/trolley-court/tools/sandbox.ts --port 4421 [--out output/trolley-court-sandbox]
 *     [--shots <dir> --plan <file.json>]   # then exit: [{ "name", "f", "seat"?, "view"?, "t"?, "w", "h", "wait"?, "shout"? }, …]
 *
 * Fixtures: /fixtures/<n>/<phase>-<step>.json for 3, 4, 6, 10, 12, 32 and 64 players (round 2, or `last` for the final
 * case and results), plus <n>max: 16-character names, longest legal card text, Accomplices + Underdog with every twist piled
 * on one card. Open /?f=32/plead-0&seat=tv&t=3000 (seat is a seat index for a phone, t is ms into the phase).
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { botAction } from '../src/bot';
import { rules, type State } from '../src/server';
import { TEXT_MAX, courtIdFor, defaults, type Action, type Card, type Settings } from '../src/types';

const { values: args } = parseArgs({ options: { port: { type: 'string', default: '4421' }, out: { type: 'string', default: 'output/trolley-court-sandbox' }, shots: { type: 'string' }, plan: { type: 'string' } } });
const out = resolve(args.out!), here = import.meta.dirname, root = process.cwd(); // Run from the platform root: fonts and art come from its public/.
const FIRST = ['Mika', 'Jonah', 'Ana', 'Sam', 'Lee', 'Rui', 'Ola', 'Kit', 'Bo', 'Zed', 'Ines', 'Tariq', 'Wren', 'Dov', 'Pia', 'Gus'], LONG = ['Bartholomew Fizz', 'Gertrude Q. Hoot', 'Wilhelmina Wobbb', 'Maximilian Mosss', 'Ottoline Pepperr', 'Barnaby Quibblee', 'Clementine Zestt', 'Percival Plonkkk'];
const PALETTE = ['#ff5748', '#28c6e7', '#78d955', '#b58aff', '#ffd24a', '#ff8ac0', '#5ad1b3', '#ff9a3c', '#8fa5ff', '#d7e04a'];
const pad = (c: Card): Card => ({ ...c, text: `${c.text} ${'and then some more besides, at great length, Your Honour, truly'}`.slice(0, TEXT_MAX[c.kind]).trim() });

/** Plays a game with bots and keeps a fixture for every phase and step of one round (and the results after the last). */
function capture(n: number, max: boolean, settings: Partial<Settings>, last = false) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `seat-${i}`, name: max ? `${LONG[i % 8].slice(0, 14)}${String(i).padStart(2, '0')}` : i < 16 ? FIRST[i] : `${FIRST[i % 16]} ${String.fromCharCode(65 + Math.floor(i / 16))}.`, color: i < 10 ? PALETTE[i] : `hsl(${Math.round(i * 137.5) % 360} 75% 62%)` }));
  const s: State = rules.create({ roomId: 'sandbox', roundId: 'round', seed: 7 * n + (max ? 1 : 0), nowMs: 0, players }, { ...defaults, ...settings });
  const ctx = { nowMs: 0, phase: 'playing' as const }, fixtures: Record<string, unknown> = {}, round = last ? s.rounds : Math.min(2, s.rounds);
  let seed = n, key = '';
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const act = (id: string, a: Action) => { try { rules.applyAction(s, id, a, s.now); } catch { /* A lost race between teammates. */ } };
  const snap = (name: string) => {
    const publicView = rules.publicView(s, ctx), privates = players.map(p => rules.playerView(s, p.id, ctx));
    const data = { publicView, privates, outcome: rules.outcome(s) };
    fixtures[name] = max ? JSON.parse(JSON.stringify(data), (k, v) => k === 'card' && v?.text ? pad(v) : v) : data;
  };
  for (let i = 0; i < 400000 && s.round <= round && s.phase !== 'complete'; i++) {
    const v = rules.publicView(s, ctx), fresh = `${s.phase}-${s.step}` !== key;
    if (fresh) key = `${s.phase}-${s.step}`;
    if (fresh && s.round === round && (s.phase === 'plead' || s.phase === 'lever')) for (const p of players.slice(0, 9)) if (p.id !== s.conductor) { act(p.id, { kind: 'shout', turnId: courtIdFor(s.round), shout: 'objection' }); }
    // Hold each pick open for a moment so its fixture shows a half-built table: a few proposals, the first locks and votes.
    const early = s.round === round && ['innocent', 'guilty', 'modifier'].includes(s.phase) && s.now < s.startedAt + 2500;
    for (const p of players) {
      let a = botAction(v, rules.playerView(s, p.id, ctx), p.id, random, s.now);
      if (!a || (early && a.kind === 'lock' && random() < .7)) continue;
      if (max && 'target' in a && a.target) a = { ...a, target: { side: 'north', slot: 0 } };
      act(p.id, a);
    }
    if (s.round === round && (fresh || (early && s.now >= s.startedAt + 2000 && !fixtures[`${key}-mid`]))) snap(fresh ? key : `${key}-mid`);
    rules.tick(s, new Map(), 0, Math.min(s.deadline, s.now + 250));
  }
  if (s.phase === 'complete') snap('complete');
  return fixtures;
}

mkdirSync(join(out, 'fixtures'), { recursive: true });
const sets: [string, number, boolean, Partial<Settings>, boolean][] = [...[3, 4, 6, 10, 12, 32, 64].map(n => [String(n), n, false, {}, false] as [string, number, boolean, Partial<Settings>, boolean]),
  ...[10, 12, 64].map(n => [`${n}max`, n, true, { accomplices: true, catchUp: true }, false] as [string, number, boolean, Partial<Settings>, boolean]),
  ...[4, 10, 32, 64].map(n => [`${n}last`, n, false, n > 10 ? {} : { laps: 1 as const }, true] as [string, number, boolean, Partial<Settings>, boolean]), ['64maxlast', 64, true, {}, true]];
const index: Record<string, string[]> = {};
for (const [name, n, max, settings, last] of sets) {
  const fixtures = capture(n, max, settings, last); mkdirSync(join(out, 'fixtures', name), { recursive: true }); index[name] = Object.keys(fixtures);
  for (const [k, v] of Object.entries(fixtures)) writeFileSync(join(out, 'fixtures', name, `${k}.json`), JSON.stringify(v));
}
await build({ entryPoints: [join(here, 'sandbox-page.tsx')], outfile: join(out, 'app.js'), bundle: true, format: 'esm', jsx: 'automatic', target: 'es2022', external: ['/fonts/*', '/games/*'], define: { 'process.env.NODE_ENV': '"development"' }, logLevel: 'warning' });
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Trolley Court sandbox</title><link rel="stylesheet" href="/app.css"><body><div id="root"></div><script type="module" src="/app.js"></script>`);
writeFileSync(join(out, 'fixtures.json'), JSON.stringify(index, null, 1));

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname), file = [join(out, path === '/' ? 'index.html' : path), join(root, 'public', path)].find(f => !path.includes('..') && existsSync(f) && extname(f));
  if (!file) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file));
}).listen(Number(args.port), '127.0.0.1');
console.log(`Sandbox: http://127.0.0.1:${args.port}/?f=32/plead-0&seat=tv  (fixtures: ${join(out, 'fixtures.json')})`);

if (args.shots && args.plan) {
  type Shot = { name: string; f: string; seat?: number | 'tv'; view?: string; t?: number; w: number; h: number; wait?: number; shout?: boolean; reduced?: boolean };
  const { chromium } = createRequire(`${process.env.PLAYWRIGHT_CORE ?? `${process.env.HOME}/.local/opt/pw/node_modules`}/`)('playwright-core');
  const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] }), plan: Shot[] = JSON.parse(readFileSync(args.plan, 'utf8')), report: unknown[] = [];
  mkdirSync(args.shots, { recursive: true });
  for (const shot of plan) {
    const phone = shot.seat !== undefined && shot.seat !== 'tv', page = await (await browser.newContext({ viewport: { width: shot.w, height: shot.h }, isMobile: phone, hasTouch: phone, reducedMotion: shot.reduced ? 'reduce' : 'no-preference' })).newPage();
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message)); page.on('console', (m: { type(): string; text(): string }) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`http://127.0.0.1:${args.port}/?f=${shot.f}&seat=${shot.seat ?? 'tv'}${shot.view ? `&view=${shot.view}` : ''}&t=${shot.t ?? 0}${shot.shout ? '&shout' : ''}${shot.wait === 0 ? '&freeze' : ''}`);
    await page.waitForSelector('.tc'); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(shot.wait ?? 900);
    // Layout checks: page overflow, small phone targets, and TV text boxes that clip or spill out of the stage.
    const issues: string[] = await page.evaluate(() => {
      const found: string[] = [], doc = document.documentElement, stage = document.querySelector('.tc-stage');
      if (doc.scrollWidth > doc.clientWidth + 1) found.push(`page overflows horizontally ${doc.scrollWidth}>${doc.clientWidth}`);
      if (!stage) for (const b of document.querySelectorAll('.tc button, .tc [role=switch]')) { const r = b.getBoundingClientRect(); if (r.width && (r.height < 44 || r.width < 44)) found.push(`small target "${(b.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`); }
      if (stage) { const s = stage.getBoundingClientRect(); for (const el of stage.querySelectorAll('.tc-card-text, .tc-mods, .tc-plate, .tc-board, .tc-banner, .tc-strip>p, .tc-tally li, .tc-top-judge, .tc-band')) {
        const e = el as HTMLElement, r = e.getBoundingClientRect();
        if (e.scrollWidth > e.clientWidth + 2 && !e.querySelector('.tc-floor-flag')) found.push(`wide ${e.className} "${(e.textContent ?? '').slice(0, 24)}" ${e.scrollWidth}>${e.clientWidth}`);
        if (r.bottom > s.bottom + 2 || r.right > s.right + 2) found.push(`outside the stage: ${e.className} "${(e.textContent ?? '').slice(0, 24)}"`);
      } for (const row of stage.querySelectorAll('.tc-row')) { const band = row.querySelector('.tc-band')?.getBoundingClientRect(), b = row.getBoundingClientRect(); for (const m of row.querySelectorAll('.tc-mods')) { const r = m.getBoundingClientRect(); if (r.bottom > (band?.top ?? b.bottom) + 3) found.push(`twists spill ${Math.round(r.bottom - (band?.top ?? b.bottom))}px past their row (${(row as HTMLElement).dataset.side})`); } } }
      return found;
    });
    await page.screenshot({ path: join(args.shots, `${shot.name}.png`), fullPage: phone && shot.view !== 'viewport' });
    if (issues.length || errors.length) report.push({ shot: shot.name, issues, errors });
    await page.context().close();
  }
  writeFileSync(join(args.shots, 'layout.json'), JSON.stringify(report, null, 1));
  console.log(`${plan.length} shots → ${args.shots}; ${report.length} with findings`);
  await browser.close(); server.close();
}
