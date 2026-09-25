/** PrivateView builder: derives task, legality, rates and offer states from the public fixture. */
import {
  COSTS, RESOURCES,
  type BuildOption, type Cards, type DevCard, type OfferState, type PrivateView, type PublicView, type Purchase,
  type SeatId, type Task, type TaskKind, type Why,
} from '../../src/model';
import { openSpots, total } from './build';

const why = (code: Why['code'], text: string): Why => ({ code, text });

export function missing(hand: Cards, cost: Cards): Cards {
  return Object.fromEntries(Object.entries(cost)
    .map(([good, n]) => [good, Math.max(0, (n ?? 0) - (hand[good as keyof Cards] ?? 0))])
    .filter(([, n]) => (n as number) > 0));
}

const needText = (need: Cards) => `Need ${Object.entries(need).map(([g, n]) => `${n} ${g}`).join(', ')}`;

/** Task the server would pick for this seat: private duties first, then the turn. */
function taskFor(pub: PublicView, seat: SeatId): Task {
  const t = pub.turn, s = pub.seats.find(x => x.id === seat)!, prompt = pub.prompts.find(p => p.seat === seat);
  const task = (kind: TaskKind, title: string, text: string, auto: string | null = null): Task =>
    ({ kind, title, text, prompt: prompt?.id ?? null, deadline: s.deadline, auto: s.deadline ? auto : null });
  if (t.stage === 'finale') return task('finale', 'Final scores', 'Revealing hidden points');
  if (t.stage === 'ended') return task('ended', 'Game over', 'See the results');
  if (prompt) return task('prompt', prompt.label, 'Answer to keep the game moving', 'Picks for you');
  if (t.stage === 'setup' && t.setup?.seat === seat) {
    return task('setup', `Place a ${t.setup.piece}`, 'Tap a glowing spot', 'Places the best spot');
  }
  if (t.stage === 'roll' && t.active === seat) return task('roll', 'Roll the dice', 'Or play a card first', 'Rolls');
  if (t.stage === 'main' && t.active === seat) return task('main', 'Your turn', 'Build, trade, end', 'Ends turn');
  if ((t.stage === 'paired' || t.stage === 'main') && t.partner === seat) {
    return task('paired', 'Your build turn', 'Build and trade with the bank only', 'Passes');
  }
  if (t.stage === 'round') {
    return task('round', `Round ${t.round}`, s.ready ? 'Done: waiting for others' : 'Build and trade', 'Marks done');
  }
  const offer = pub.offers.find(o => o.responses[seat] === 'pending');
  if (offer) return task('respond', 'Trade offer', 'Accept, decline or counter');
  return task('wait', 'Waiting', pub.now.title || 'Watch the table');
}

type Free = Partial<Record<Purchase, number>>;

/** Legal targets for this seat (distance rule, connected to own network), plus supply and cost checks. */
function buildOptions(pub: PublicView, seat: SeatId, hand: Cards, acting: boolean, free: Free) {
  const s = pub.seats.find(x => x.id === seat)!, { buildings, routes } = pub.pieces;
  const mine = Object.values(routes).filter(r => r.seat === seat).map(r => r.edge);
  const edges = new Map(pub.board.edges.map(e => [e.id, e]));
  const reach = new Set([
    ...Object.values(buildings).filter(b => b.seat === seat).map(b => b.vertex),
    ...mine.flatMap(id => [edges.get(id)!.a, edges.get(id)!.b])
      .filter(v => !buildings[v] || buildings[v].seat === seat),
  ]);
  const from = (land: boolean) => [...new Set([...reach].flatMap(v => pub.board.edges
    .filter(e => (e.a === v || e.b === v) && (land ? e.land : e.sea) && !routes[e.id]).map(e => e.id)))];
  const targets: Record<Purchase, string[]> = {
    settlement: openSpots(pub).filter(v => pub.turn.stage === 'setup' || reach.has(v)),
    city: Object.values(buildings).filter(b => b.seat === seat && b.kind === 'settlement').map(b => b.vertex),
    road: from(true), ship: pub.modules.includes('seafarers') ? from(false) : [], development: [],
  };
  const left = { road: s.left.roads, ship: s.left.ships, settlement: s.left.settlements, city: s.left.cities };
  const pieces: Purchase[] = ['road', 'settlement', 'city', 'development'];
  if (pub.modules.includes('seafarers')) pieces.splice(1, 0, 'ship');
  return pieces.map((piece): BuildOption => {
    const cost = COSTS[piece], need = free[piece] ? {} : missing(hand, cost);
    const count = piece === 'development' ? null : left[piece];
    const spots = acting ? targets[piece] : [];
    const reason = !acting ? why('not-your-turn', 'Wait for your turn')
      : count === 0 ? why('no-pieces', `No ${piece}s left`)
      : piece === 'development' && pub.devDeck === 0 ? why('deck-empty', 'The deck is empty')
      : total(need) ? why('cost', needText(need))
      : piece !== 'development' && !spots.length ? why('no-spot', 'No legal spot') : null;
    return { piece, cost, free: free[piece] ?? 0, targets: spots, left: count, missing: need, why: reason };
  });
}

/** Trade rates from ports touching this seat's buildings (4:1 default). */
function rates(pub: PublicView, seat: SeatId): Cards {
  const owned = pub.board.ports.filter(p => p.vertices.some(v => pub.pieces.buildings[v]?.seat === seat));
  const generic = owned.some(p => p.good === 'any') ? 3 : 4;
  return Object.fromEntries(RESOURCES.map(g => [g, owned.some(p => p.good === g) ? 2 : generic]));
}

/** Hidden victory-card score line (engine key `vp-cards`, ENGINE §11), shown to the owner and in results. */
export const victoryPart = (n: number) =>
  ({ key: 'vp-cards', label: 'Victory point cards', points: n, count: n, hidden: true as const });

type Patch = Partial<PrivateView> & { free?: Free };

export function me(pub: PublicView, seat: SeatId, hand: Cards, o: Patch = {}): PrivateView {
  const s = pub.seats.find(x => x.id === seat)!, { free = {}, ...patch } = o, dev: DevCard[] = o.dev ?? [];
  const hidden = dev.filter(d => d.kind === 'victory').length;
  const task = o.task ?? taskFor(pub, seat), acting = ['setup', 'main', 'paired', 'round'].includes(task.kind);
  const turnish = acting && !s.ready;
  const offers: OfferState[] = pub.offers.filter(x => x.from !== seat && x.responses[seat] !== undefined).map(x => {
    const need = missing(hand, x.want), able = total(need) === 0;
    return { id: x.id, canAccept: able, canCounter: true, why: able ? null : why('cost', needText(need)) };
  });
  const bankWhy = total(hand) ? null : why('cost', 'You have no cards to trade');
  const proposeWhy = task.kind === 'paired' ? why('stage', 'Build turns trade with the bank only')
    : task.kind === 'main' || task.kind === 'round' ? null : why('not-your-turn', 'Trade on your turn');
  return {
    seat, hand, dev,
    vp: s.vp + hidden,
    parts: hidden ? [...s.parts, victoryPart(hidden)] : s.parts,
    target: pub.settings.targetPoints, rates: rates(pub, seat), task,
    can: {
      roll: task.kind === 'roll', end: turnish && task.kind !== 'setup',
      bank: turnish && task.kind !== 'setup' && !bankWhy, propose: turnish && !proposeWhy, skipPaired: false,
    },
    why: { propose: proposeWhy, bank: bankWhy },
    build: buildOptions(pub, seat, hand, turnish, free),
    shipMoves: [], offers,
    partners: task.kind === 'main' || task.kind === 'round'
      ? pub.seats.filter(x => x.id !== seat && x.id !== pub.turn.partner && !(task.kind === 'round' && x.ready))
        .map(x => x.id)
      : [],
    prompts: [], commands: [], inbox: [], ext: {},
    ...patch,
  };
}
