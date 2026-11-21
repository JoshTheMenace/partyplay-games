/**
 * A browser-free host for big-room measurements on a running server: it creates a room, picks Blockwild as a watching
 * display, waits for the seats you fill with socket bots, starts the round and then reports, every few seconds, what the
 * display receives and how much CPU the server process is using.
 *
 *   node --import tsx packages/games/blockwild/tools/room-host.ts --port 4410 --players 32 [--mode creative] [--seed 11] [--seconds 60] [--pid <server pid>]
 *   node --import tsx scripts/qa/room-bots.ts --port 4410 --code <printed code> --players 32 --stats 10 --hook packages/games/blockwild/tools/room-bot.ts
 *
 * The host stands in for the TV: it answers the loading barrier at once, so no WebGL is involved and the numbers are
 * the server's and the wire's. `--pid` (the server's process id) adds its CPU share from /proc.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

const { values: args } = parseArgs({ options: { port: { type: 'string' }, players: { type: 'string', default: '32' }, mode: { type: 'string', default: 'survival' }, seed: { type: 'string', default: '11' }, seconds: { type: 'string', default: '60' }, pid: { type: 'string' } } });
if (!args.port) throw new Error('Usage: room-host.ts --port <port> [--players 32] [--mode survival|creative] [--seed 11] [--seconds 60] [--pid <server pid>]');
const players = Number(args.players), seconds = Number(args.seconds);
const socket = new WebSocket(`ws://127.0.0.1:${args.port}/ws`, { headers: { Origin: `http://127.0.0.1:${args.port}` } });
const send = (type: string, data: Record<string, unknown> = {}) => socket.send(JSON.stringify({ v: '1.0', type, ...data }));
/** Server CPU time so far (user + system, seconds) from /proc, when its pid was given. */
const cpuSeconds = () => { if (!args.pid) return 0; const fields = readFileSync(`/proc/${args.pid}/stat`, 'utf8').split(') ')[1]!.split(' '); return (Number(fields[11]) + Number(fields[12])) / 100; };
let started = false, roundId = '', bytes = 0, snapshots = 0, largest = 0, playingAt = 0, cpuAt = 0, lastBytes = 0, lastSnapshots = 0, lastCpu = 0, lastAt = 0;

socket.on('open', () => send('room.create'));
socket.on('error', error => { console.error(error); process.exit(1); });
socket.on('close', () => { console.log('host socket closed'); process.exit(0); });
socket.on('message', raw => {
  const text = raw.toString(), message = JSON.parse(text) as { type: string; room?: { code: string; phase: string; gameId: string | null; players: { ready: boolean; connected: boolean }[]; notice?: string | null }; roundId?: string; message?: string };
  if (message.type === 'error') console.log('error:', message.message ?? text.slice(0, 200));
  if (message.type === 'room.welcome' && message.room && !message.room.gameId) {
    console.log(`room ${message.room.code}: fill it with ${players} bots`);
    send('game.select', { gameId: 'blockwild', settings: { mode: args.mode, seed: Number(args.seed), difficulty: 'normal', keepInventory: true } });
  }
  if (message.type === 'round.prepare') { roundId = message.roundId!; send('round.ready', { roundId }); }
  if (message.type === 'game.snapshot') {
    if (!playingAt) { playingAt = lastAt = Date.now(); cpuAt = lastCpu = cpuSeconds(); console.log('playing'); }
    bytes += text.length; snapshots++; largest = Math.max(largest, text.length);
  }
  const room = message.room;
  if (room?.notice) console.log('notice:', room.notice);
  if (room && room.phase === 'lobby' && !started && room.players.length >= players && room.players.every(player => player.ready && player.connected)) { started = true; console.log(`${room.players.length} ready: starting`); send('round.start'); }
});
setInterval(() => {
  if (!playingAt) return;
  const now = Date.now(), span = (now - lastAt) / 1000, cpu = cpuSeconds();
  console.log(`t+${Math.round((now - playingAt) / 1000)}s  display: ${((bytes - lastBytes) / span / 1024).toFixed(1)} KiB/s in ${((snapshots - lastSnapshots) / span).toFixed(1)} snapshots/s (largest ${(largest / 1024).toFixed(1)} KiB)${args.pid ? `  server CPU ${((cpu - lastCpu) / span * 100).toFixed(0)}% of a core` : ''}`);
  lastBytes = bytes; lastSnapshots = snapshots; lastCpu = cpu; lastAt = now;
  if (now - playingAt >= seconds * 1000) {
    console.log(`total: display ${(bytes / ((now - playingAt) / 1000) / 1024).toFixed(1)} KiB/s${args.pid ? `, server CPU ${((cpu - cpuAt) / ((now - playingAt) / 1000) * 100).toFixed(0)}% of a core` : ''}`);
    send('round.abort', { roundId });
    setTimeout(() => { send('room.close'); setTimeout(() => process.exit(0), 300); }, 300);
  }
}, 5000);
