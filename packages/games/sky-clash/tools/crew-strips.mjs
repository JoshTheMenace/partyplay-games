// The standard filmstrip set for a crew fighter: the real simulation drawn by the real renderer at fixed ticks, hitboxes on top.
// From the PartyPlay root, with the lab server running (tools/lab.vite.config.ts on port 4430):
//   node packages/games/sky-clash/tools/crew-strips.mjs <out-dir> <kind> [reach in meters] [strip ...]
// Strips: loco (idle, walk, run, jump, land), hurt (struck, launched, down, up), ground (jab chain, tilts, dash attack), smash, air, special.
// `reach` is how far in front of the fighter the sparring partner stands (default 1.2).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const [out, kind, reachArg, ...only] = process.argv.slice(2), d = Number(reachArg ?? 1.2), partner = kind === 'sola' ? 'toll' : 'sola';
const press = (t, key, x, y) => `${t}:0.press(${key},${x},${y});${t + 1}:0.free()`, at = (base, ...offs) => offs.map(o => base + o);
const stand = (t, gap = d, dmg = 30) => `${t}:0.place(-1,1);${t}:1.place(${(-1 + gap).toFixed(2)},-1);${t}:1.dmg(${dmg})`, up = (t, h = 2.4) => `${t}:0.place(-1,1,${h});${t}:1.place(${(-1 + d).toFixed(2)},-1,${h + .2})`;
const STRIPS = {
  loco: { kinds: kind, script: '20:0.hold(.5,0);56:0.hold(1,0);96:0.free();103:0.press(jump,0,0);104:0.hold(0,0,jump);130:0.free()', ticks: [5, 20, 30, 40, 66, 72, 78, 96, 103, 107, 114, 124, 136, 148, 154, 166], half: 1.5 },
  hurt: { kinds: `${kind},${partner}`, script: `0:0.place(.5,-1);0:1.place(-1,1);1:0.dmg(45);${partner === 'toll' ? '4:1.press(smash,1,0);5:1.free()' : '4:1.press(smash,1,0);5:1.free()'}`, ticks: [14, 22, 26, 29, 32, 36, 42, 50, 60, 74, 90, 106, 122, 138, 154, 170], half: 2.2 },
  ground: { kinds: `${kind},${partner}`, script: [stand(0), press(4, 'attack', 0, 0), press(13, 'attack', 0, 0), press(22, 'attack', 0, 0), stand(69), press(70, 'attack', 1, 0), stand(119, d * .5), press(120, 'attack', 0, 1), stand(169), press(170, 'attack', 0, -1), stand(219, d + 1.6), '220:0.hold(1,0)', '232:0.press(attack,1,0)', '233:0.free()'].join(';'),
    ticks: [...at(4, 3, 6, 12, 15, 22, 26), ...at(70, 5, 9, 13), ...at(120, 5, 9, 13), ...at(170, 5, 9), ...at(232, 6, 12)], half: 1.7 },
  smash: { kinds: `${kind},${partner}`, script: [stand(0, d, 60), press(4, 'smash', 1, 0), stand(89, d * .3, 60), press(90, 'smash', 0, 1), stand(169, d * .7, 60), press(170, 'smash', 0, -1)].join(';'),
    ticks: [...at(4, 6, 12, 16, 20, 24, 28, 40), ...at(90, 8, 13, 17, 21, 26), ...at(170, 8, 12, 16, 22)], half: 1.9 },
  air: { kinds: `${kind},${partner}`, script: [up(0), press(2, 'attack', 1, 0), up(59), press(60, 'attack', 0, 1), up(119), press(120, 'attack', 0, 0), `179:0.place(-1,1,2.4);179:1.place(${(-1 - d).toFixed(2)},1,2.6)`, press(180, 'attack', -1, 0), up(239, 3), press(240, 'attack', 0, -1)].join(';'),
    ticks: [...at(2, 5, 9, 13, 18), ...at(60, 4, 8, 13), ...at(120, 5, 10, 18), ...at(180, 5, 9, 13), ...at(240, 6, 11, 16)], half: 1.8 },
  special: { kinds: `${kind},${partner}`, script: [stand(0, d + 1.6, 20), press(4, 'special', 0, 0), stand(79, d + .8, 20), press(80, 'special', 1, 0), stand(159, d * .4, 20), press(160, 'special', 0, 1), stand(279, d * .8, 20), press(280, 'special', 0, -1)].join(';'),
    ticks: [...at(4, 8, 14, 20, 30, 44), ...at(80, 6, 12, 18, 26), ...at(160, 6, 12, 26, 44), ...at(280, 8, 14, 22)], half: 2.2 },
};
const specs = Object.entries(STRIPS).filter(([name]) => !only.length || only.includes(name)).map(([name, s]) =>
  `${kind}-${name}|/pose-lab/crew.html?kinds=${s.kinds}&do=${s.script}&ticks=${s.ticks.join(',')}&cam=0,1.2,${s.half}&follow=0&cell=300x360&cols=8|2420x780|ready|0`);
const run = spawnSync(process.execPath, [fileURLToPath(new URL('./lab-shoot.mjs', import.meta.url)), out, ...specs], { stdio: 'inherit', env: { ...process.env, WAIT: process.env.WAIT ?? '240000' } });
process.exit(run.status ?? 1);
