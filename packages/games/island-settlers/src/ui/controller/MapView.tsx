/**
 * The controller's door to WP-map's BoardMap. In short landscape the primary map is portalled into the left
 * column (EXPERIENCE §4.1 other sizes); elsewhere it renders in place. The mini map opens the full map.
 */
import { createContext, useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { BoardMap, MapScreen, type BoardMapProps } from '../map/index';
import { useCtl } from './context';

type Props = Omit<BoardMapProps, 'pub' | 'seat' | 'mode' | 'serverNowMs' | 'onOpen'> & { mini?: boolean };

/** Set by the frame in short landscape: the element the task's map renders into. */
export const MapHost = createContext<HTMLElement | null>(null);

export function MapView({ mini, ...rest }: Props) {
  const { pub, me, now } = useCtl();
  const host = useContext(MapHost), [full, setFull] = useState(false);
  const common = { pub, seat: me.seat, serverNowMs: now };
  const map = <BoardMap {...common} {...rest} mode={mini && !host ? 'mini' : 'full'}
    onOpen={mini && !host ? () => setFull(true) : undefined}
    className={mini && !host ? 'island-settlers-mini' : 'island-settlers-board'}/>;
  return <>
    {host ? createPortal(map, host) : map}
    {full && <MapScreen {...common} onClose={() => setFull(false)}/>}
  </>;
}
