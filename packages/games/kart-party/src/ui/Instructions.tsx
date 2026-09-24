/* How to play, per role. Short and scannable: the first race teaches the rest. */
import type { InstructionsViewProps } from '../../../../party-ui/src/index';
import { ItemIcon } from './icons';

export function Instructions({ role }: InstructionsViewProps) {
  const touch = role !== 'display';
  return <div className="kp2-howto">
    <ul className="kp2-howto-list">
      <li><b>{touch ? 'Steer' : 'Watch'}</b>{touch ? 'Put your left thumb anywhere on the left half and slide left or right. Your kart speeds up on its own.' : 'Up to four racers share this screen. With more, everyone races on their own phone and this screen follows the action.'}</li>
      <li><b>Drift</b>Hold DRIFT while turning to slide. Keep holding until the sparks turn <span className="kp2-t1">blue</span>, <span className="kp2-t2">orange</span>, then <span className="kp2-t3">purple</span>, then let go for a turbo.</li>
      <li><b>Items</b><span className="kp2-howto-icons"><ItemIcon item="peel"/><ItemIcon item="bouncer"/><ItemIcon item="nitro"/></span>Drive through item boxes, then tap ITEM to use. Hold ITEM to trail a peel or shell behind you as a shield.</li>
      <li><b>Pro tips</b>Press DRIFT just before GO for a rocket start. Hop off ramps for a trick boost. Tuck in behind a rival to slipstream.</li>
    </ul>
    <p className="kp2-howto-keys">Keyboard: <kbd>←</kbd><kbd>→</kbd> steer · <kbd>Shift</kbd>/<kbd>Space</kbd> drift · <kbd>E</kbd> item · <kbd>S</kbd> brake · <kbd>H</kbd> honk. Gamepad: stick, <kbd>A</kbd> drift, <kbd>X</kbd> item, <kbd>B</kbd> brake.</p>
  </div>;
}
