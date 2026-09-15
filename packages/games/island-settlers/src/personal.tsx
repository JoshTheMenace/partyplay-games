import { useState } from 'react';
import type { GameViewProps } from '../../../party-ui/src/index';
import type { Action, PrivateView, PublicView } from './model';
import { Controller } from './controller';
import { Display } from './display';
/** Keep the hand mounted while the solo host watches CPU turns on the board. */
export function PersonalView(props: GameViewProps<null, Action, PublicView, PrivateView>) {
  const [board, setBoard] = useState(false);
  return <div className="is-personal"><nav className="is-personal-tabs" aria-label="Game view"><button type="button" aria-pressed={!board} onClick={() => setBoard(false)}>Your hand{props.publicView.activeIds.includes(props.playerId ?? '') ? ' · your turn' : ''}</button><button type="button" aria-pressed={board} onClick={() => setBoard(true)}>Board</button></nav><div className="is-personal-hand" hidden={board}><Controller {...props}/></div><div className="is-personal-board" hidden={!board}><Display {...props}/></div></div>;
}
