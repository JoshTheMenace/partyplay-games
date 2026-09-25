/** Three quest chains. Each start sets a flag; later events gated by requiresFlag pay it off. */
import type { EventDef } from '../types';
import { armada, augment, ev, fight, flag, hull, kin, leave, opt, opt1, out, pay, recruit, reveal, role, scrap, sys, weapon } from './dsl';

const q = { unique: true } as const;

export const QUESTS: readonly EventDef[] = [
  // ---------- The Pilgrims: a tow now, an Armada delay later ----------
  ev('q-pilgrims', 'any', ['distress'], 'Stranded Pilgrims', "A Skitter pilgrim barge drifts with dead engines, humming a hymn on every channel. They're bound for the Hollow Shrine and ask for a tow.", [
    opt1('tow', 'Give them a tow', "They squeeze aboard with incense, hymn books and an alarming number of legs. The tow slows you down.", [flag('pilgrims'), armada(1)]),
    opt1('hymn', 'Skitter crew join the hymn', "Your Skitter crew sing along. The pilgrims fix their own engines out of joy and follow your fleet.", [flag('pilgrims')], kin('skitter')),
    leave("They wave every arm they have as you leave."),
  ], q),
  ev('q-hollow-shrine', 'any', ['unknown', 'nebula', 'distress'], 'The Hollow Shrine', "Inside a hollowed moon burn a thousand Skitter candles. The pilgrims' elder clicks something ceremonial and presses a gift into your hands.", [
    opt1('bless', 'Accept the blessing', "The pilgrims open a hidden lane only they know. The Armada will be searching the wrong system for days.", [armada(-3), reveal, augment('thruster-kit')]),
    opt1('pilot', 'Ask for a pilgrim guide', "Their best pilot joins you and shows the fleet the secret lanes.", [armada(-2), recruit('skitter', 'pilot')]),
  ], { ...q, requiresFlag: 'pilgrims', weight: 3 }),

  // ---------- The Shipwright: three stops to a spare ship (starts in the Veil so standard runs have room to finish it) ----------
  ev('q-shipwright', ['veil'], ['distress'], "The Shipwright's Plea", "Old Mags, a legendary shipwright, is holed up in her yard with scavengers at the gate. 'Get me out and I'll build you a ship. A whole one!'", [
    opt1('fight', 'Clear the gate', "Mags cheers from the rafters as the fight starts.", [flag('shipwright'), fight('sector')]),
    opt1('beam', 'Beam her out quietly', "Mags materializes with a toolbox under each arm. 'Right. Let's find me a keel.'", [flag('shipwright')], sys('teleporter')),
    leave("Mags shouts a lot of words at you. None of them are 'goodbye'."),
  ], q),
  ev('q-shipwright-keel', 'any', ['unknown', 'distress'], 'Mags Needs a Keel', "Mags spots a wrecked cruiser at the beacon. 'That keel's perfect. Hold the fleet steady while I cut it loose.'", [
    opt('cut', 'Help her cut it free', [
      out("The keel comes free with a satisfying clunk. Mags kisses it.", [flag('keel')], 7),
      out("The wreck shifts mid-cut and slams into a ship. Mags gets the keel anyway.", [flag('keel'), hull(-3, 'random')], 3),
    ]),
    opt1('buy', 'Buy her a keel instead', "A salvage broker delivers a keel. Mags says it's inferior. She'll make it work.", [flag('keel')], pay(20)),
  ], { ...q, requiresFlag: 'shipwright', weight: 3 }),
  ev('q-shipwright-yard', 'any', ['unknown', 'distress', 'nebula'], 'The Keel Takes Shape', "Mags welds for three shifts straight, humming badly. The result is ugly, sturdy and entirely yours. 'She'll fly. Don't ask me how.'", [
    opt1('accept', 'Accept the new hull', "The fleet gains a reserve hull. Mags also patches everyone's dents while she's at it.", [{ kind: 'reserves', amount: 1 }, hull(5)]),
    opt1('crew', 'Ask Mags to stay aboard', "She finishes the reserve hull, then moves into your engine room.", [{ kind: 'reserves', amount: 1 }, recruit('human', 'engineer')]),
  ], { ...q, requiresFlag: 'keel', weight: 3 }),

  // ---------- The Keycore: a Warden secret and its best weapon ----------
  ev('q-keycore', 'any', ['unknown'], 'A Warden Keycore', "A dead Warden drone drifts past, a glowing keycore humming in its chest. It is warm, and it is counting down in binary.", [
    opt('pry', 'Pry it loose', [
      out("It comes loose and stops counting. Good sign.", [flag('keycore')], 7),
      out("It zaps whoever touched it, then stops counting.", [flag('keycore'), { kind: 'systemDamage', system: 'weapons', amount: 1, who: 'random' }], 3),
    ]),
    opt1('engineer', 'Have an engineer extract it', "Clean work. Your engineer also finds scrap in the drone's chassis.", [flag('keycore'), scrap(10)], role('engineer')),
    leave("It counts to zero behind you. Nothing happens. Probably."),
  ], q),
  ev('q-sealed-vault', 'any', ['unknown', 'nebula'], 'The Sealed Vault', "The keycore pulls your fleet to a vault buried in a dead moon. The door scans the key, then you, then sighs like an old man.", [
    opt('open', 'Open the vault', [
      out("Inside, a Warden halberd beam, still on its mount.", [weapon(3, 'halberd-beam')], 3),
      out("The halberd beam is inside. So is its guardian, and it just woke up.", [weapon(3, 'halberd-beam'), fight(['warden-sentinel'])], 2),
    ]),
    opt1('bastion', 'Bastion crew recite the Warden oath', "The vault recognizes the old words and opens every drawer. The guardian bows.", [weapon(3, 'halberd-beam'), augment('shield-capacitor')], kin('bastion')),
  ], { ...q, requiresFlag: 'keycore', weight: 3 }),
];
