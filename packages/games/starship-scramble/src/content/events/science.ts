/** Anomalies, archives and the stranger corners of the map. */
import type { EventDef } from '../types';
import { armada, augment, ev, fight, hull, hurt, kin, leave, opt, opt1, out, pay, recruit, reveal, role, scrap, weapon } from './dsl';

const U = ['unknown'] as const, UN = ['unknown', 'nebula'] as const;

export const SCIENCE: readonly EventDef[] = [
  ev('sc-anomaly', 'any', UN, 'Spatial Anomaly', "A shimmering fold in space hangs at the beacon. Light bends around it. Your instruments give three different readings and one apology.", [
    opt('scan', 'Scan it', [
      out("The scan maps the fold and, somehow, the whole sector around it.", [reveal], 3),
      out("The scan reflects back into your helm, which reboots twice.", [{ kind: 'systemDamage', system: 'helm', amount: 1, who: 'random' }], 2),
    ]),
    opt('fly', 'Fly one ship through it', [
      out("It comes out the other side with engines tuned by physics itself.", [{ kind: 'upgrade', system: 'engines', who: 'random' }], 2),
      out("It comes out the other side with a crew that sees colors nobody should.", [hurt(15, 'random')], 3),
    ]),
    leave(),
  ]),
  ev('sc-pulsar', ['meridian', 'rustbelt'], U, 'Pulsar Readings', "A pulsar ticks like a cosmic metronome. Scientists everywhere would pay for clean readings. So would anyone selling them to scientists.", [
    opt('record', 'Record the pulses', [
      out("Clean data. A research outpost buys it on the spot.", [scrap(15)], 7),
      out("The pulse spikes and fries a shield emitter.", [scrap(8), { kind: 'systemDamage', system: 'shields', amount: 1, who: 'random' }], 3),
    ]),
    leave(),
  ]),
  ev('sc-warden-archive', ['meridian'], U, 'Open Archive', "A Warden archive sits with its doors wide open, lights blinking lazily. Nobody has touched it in a thousand years. Probably.", [
    opt('download', 'Download everything', [
      out("Star charts, trade routes and a coupon for a store that no longer exists.", [reveal, scrap(15)], 3),
      out("An alarm wakes the archive's guardians.", [fight('sector')], 2),
    ]),
    leave(),
  ]),
  ev('sc-crystal-garden', ['veil'], UN, 'Crystal Garden', "Crystals the size of houses grow from a drifting rock, humming softly. The humming rises when you get close.", [
    opt('harvest', 'Harvest the crystals', [
      out("The crystals come loose cleanly. They make excellent scrap.", [scrap(25)], 3),
      out("The crystals scream. Everyone's ears ring for hours.", [scrap(10), hurt(20, 'fleet')], 2),
    ]),
    opt1('bastion', 'Let your Bastion crew speak to them', "The crystals recognize a mineral cousin. They offer shards that seal your hulls like new.", [hull(6), scrap(15)], kin('bastion')),
    leave(),
  ]),
  ev('sc-echo', 'any', U, 'Echo of Yourselves', "A fleet appears ahead, battered and scorched. It's your fleet. Future you waves, looks very tired and flies away.", [
    opt1('wave', 'Wave back', "It feels important. It probably isn't. You feel better anyway.", [hull(2)]),
    opt1('hail', 'Hail your future selves', "They send one message before vanishing. 'Left at the next fork.' You check the map.", [reveal, armada(-1)]),
  ]),
  ev('sc-black-hole', 'any', U, 'Lensing Black Hole', "A black hole bends the stars into a halo. Slingshot around it and you'd gain real time. Get it wrong and there's no second try.", [
    opt('sling', 'Slingshot around it', [
      out("The fleet whips around the event horizon and shoots out way ahead of schedule.", [armada(-1)], 1),
      out("Tidal stress groans through every hull, but you make it.", [hull(-4)], 1),
    ]),
    leave("You give it a wide, respectful berth."),
  ]),
  ev('sc-spore-bloom', ['veil'], ['nebula'], 'Spore Bloom', "The nebula flowers with glowing spores. They drift through your hulls, smelling faintly of cinnamon and bad decisions.", [
    opt('breathe', 'Let them drift through', [
      out("The spores settle into your hull seams and harden, sealing cracks.", [hull(4)], 1),
      out("The spores make everyone sneeze for an hour. Hard.", [hurt(10, 'fleet')], 1),
    ]),
    opt1('medic', 'Have a medic culture the spores', "Your medic grows a healing gel from the spores. Crew and hulls both feel better.", [hull(5), augment('nanite-medics')], role('medic')),
  ]),
  ev('sc-observatory', ['rustbelt', 'meridian'], U, 'Cold Observatory', "A lonely observatory orbits a dead sun. Its sole astronomer offers tea and seems thrilled to have company.", [
    opt1('tea', 'Stay for tea', "The tea is terrible. The company is wonderful. Everyone leaves in better spirits.", [hull(3)]),
    opt1('recruit', 'Invite her to join the fleet', "She packs a telescope and three thermoses and comes along.", [recruit('human', 'pilot')]),
    opt1('charts', 'Buy her sector charts', "Her charts are perfect.", [reveal], pay(8)),
  ]),
  ev('sc-ghost-signal', ['veil'], UN, 'Ghost Signal', "A signal pulses from deep in the fog. Not a distress call, not a hail. Just a slow, steady heartbeat.", [
    opt('follow', 'Follow it', [
      out("It leads to a derelict with its salvage untouched.", [scrap(25)], 5),
      out("It leads to a Vesk nest. The heartbeat was the nest.", [fight('sector', { hazard: 'nebula' })], 3),
      out("It leads back to your own beacon. One of your own ships was sending it. Nobody knows why.", [], 2),
    ]),
    leave(),
  ]),
  ev('sc-magnetar', ['meridian'], U, 'Magnetar', "A magnetar floods the beacon with fields strong enough to wipe memory banks from a light-year away.", [
    opt1('wait', 'Wait for a calm window', "It takes a while, but the field quiets enough to jump.", [armada(1)]),
    opt('dash', 'Dash through now', [
      out("You make it. Barely.", [], 1),
      out("Every weapon system in the fleet stutters and needs repairs.", [{ kind: 'systemDamage', system: 'weapons', amount: 1, who: 'fleet' }], 1),
    ]),
    opt1('capacitor', 'Bottle the field in your shield capacitor', "Your capacitor drinks the field and stores it neatly. Physicists pay a fortune for bottled magnetar.", [scrap(30)], { kind: 'augment', augment: 'shield-capacitor' }),
  ]),
  ev('sc-sleeping-giant', ['veil', 'meridian'], UN, 'Sleeping Giant', "A colossal creature drifts asleep, its hide studded with ancient wreckage. Some of it looks valuable. Some of it looks like weapons.", [
    opt('pry', 'Pry loose a weapon', [
      out("The creature doesn't stir. You take the weapon and go.", [weapon(2)], 1),
      out("The creature twitches in its sleep and swats a ship.", [hull(-5, 'random')], 1),
    ]),
    leave("Let sleeping giants lie."),
  ]),
];
