import type { GameEvent, Good, PieceKind } from '../../model';
import type { SoundName } from './recipes';

/** One scheduled sound: `delay` is milliseconds after the event arrives. */
export type Shot = { sound: SoundName; delay: number; good?: Good };

const PIECE_SOUND: Partial<Record<PieceKind, SoundName>> = {
  road: 'route', ship: 'route', bridge: 'route',
  settlement: 'settlement', harbor: 'settlement', wall: 'settlement', knight: 'settlement',
  city: 'city', metropolis: 'city',
};

/** Coin blips land with the fly-outs (EXPERIENCE §3.7): one per (seat, good), 40 ms stagger. */
const arrivals = (pairs: { seat: string; good: Good }[], start: number): Shot[] => {
  const seen = new Set<string>();
  return pairs.filter(p => !seen.has(`${p.seat}:${p.good}`) && !!seen.add(`${p.seat}:${p.good}`))
    .map((p, i) => ({ sound: 'resource', delay: start + i * 40, good: p.good }));
};

/** Public event → TV/host sounds. Kinds absent here (discard, move, presence, ...) stay silent. */
export function soundsFor(event: GameEvent): Shot[] {
  switch (event.kind) {
    case 'roll': return [
      { sound: 'dice', delay: 0 },
      ...(event.total === 7 ? [{ sound: 'seven', delay: 480 } as Shot] : []),
      ...arrivals(event.grants, 1080),
    ];
    case 'payout': return arrivals(event.grants, 480);
    case 'take': return arrivals(
      Object.keys(event.cards).map(good => ({ seat: event.seat, good: good as Good })), 480);
    case 'build': {
      const sound = PIECE_SOUND[event.piece];
      return sound ? [{ sound, delay: 0 }] : [];
    }
    case 'robber': return [{ sound: 'robber', delay: 0 }];
    case 'steal': return [{ sound: 'steal', delay: 0 }];
    case 'turn': return event.seat ? [{ sound: 'turn', delay: 0 }] : [];
    case 'offer': return event.change === 'posted' ? [{ sound: 'offer', delay: 0 }] : [];
    case 'trade': case 'bank': return [{ sound: 'trade', delay: 0 }];
    case 'barbarians': return [{ sound: 'barbarians', delay: 0 }];
    case 'win': return [{ sound: 'victory', delay: 0 }];
    default: return [];
  }
}
