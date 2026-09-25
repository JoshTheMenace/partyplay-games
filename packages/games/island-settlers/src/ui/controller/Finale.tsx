/** Finale / ended (EXPERIENCE §4.2): the winner, your rank and your score breakdown until results. */
import { listText } from '../shared/format';
import { nameOf } from '../shared/seats';
import { useCtl } from './context';

const ordinal = (n: number) =>
  `${n}${['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th'}`;

export function Finale() {
  const { pub, me } = useCtl();
  const results = pub.results, winners = results?.winners ?? [];
  const mine = results?.standings.find(s => s.seat === me.seat);
  const parts = mine?.parts ?? me.parts, total = mine?.vp ?? me.vp;
  const title = winners.includes(me.seat) ? 'You win!'
    : winners.length ? `${listText(winners.map(w => nameOf(pub, w)))} ${winners.length > 1 ? 'win' : 'wins'}!`
      : 'Game over';
  return <div className="island-settlers-screen island-settlers-finale">
    <h2 className="kp-title">{title}</h2>
    {mine && <p className="island-settlers-rank">You finished {ordinal(mine.rank)}</p>}
    <table className="island-settlers-parts">
      <tbody>{parts.map(p => <tr key={p.key}>
        <th scope="row">{p.label}{p.count > 1 && ` ×${p.count}`}{p.hidden && ' (hidden)'}</th><td>{p.points}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row">Total</th><td>{total} VP</td></tr></tfoot>
    </table>
  </div>;
}
