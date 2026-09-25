import './phone.css';
import type { ClientProps } from '../contracts';
import { useActions } from './common';
import { CombatController } from './combat';
import { MenuController } from './menus';
export { Personal } from './personal';

/** Landscape phone controller: the combat cockpit, or the menu for every other phase. */
export function Controller(props: ClientProps) {
  const actions = useActions(props);
  return props.publicView.phase === 'combat' && props.publicView.combat ? <CombatController {...props} actions={actions}/> : <MenuController {...props} actions={actions}/>;
}
