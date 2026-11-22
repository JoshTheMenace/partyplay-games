import { useEffect, type CSSProperties } from 'react';
import { Check, Star } from 'lucide-react';
import { ArcadeButton, StatusNotice, type LobbyViewProps } from '../../../party-ui/src/index';
import { CHARACTERS, KITCHEN_MAX, lineOf, lineSizes, type CharacterId, type Settings } from './model';
import { LEVELS } from './levels';
import { bestFor, readCampaign, rememberCook, rememberedCook } from './campaign';
import { Icon, LineBadge, lineStyle } from './hud';
import './picker.css';

const chosen = (choice: unknown) => (choice as { character?: CharacterId } | undefined)?.character;
const characterOf = (choice: unknown): CharacterId => chosen(choice) ?? 'chef';

function Tonight({ settings, stars }: { settings: Settings; stars?: number }) {
  const level = LEVELS[settings.level] ?? LEVELS[0];
  return <p className={`kr-tonight kr-theme-${level.theme}`}><span>Tonight</span><strong>{level.name}</strong><small>{level.location} · {settings.seconds === 150 ? '2½' : settings.seconds / 60} min{settings.relaxed ? ' · Relaxed' : ''}</small>
    {stars !== undefined && <em aria-label={`${stars} of 3 stars`}>{[0, 1, 2].map(i => <Star key={i} className={i < stars ? 'kr-got' : ''} aria-hidden="true"/>)}</em>}</p>;
}

export function CookLobby({ players, playerId, isHost, settings, connected, error, onChoice, onReady }: LobbyViewProps<Settings>) {
  const me = players.find(player => player.id === playerId), mine = characterOf(me?.lobbyChoice), level = LEVELS[settings.level] ?? LEVELS[0];
  const stars = isHost ? bestFor(readCampaign(), level.id).stars : undefined, choice = chosen(me?.lobbyChoice);
  // Play again clears lobby choices; restore this phone's last pick unless a new one is already made.
  useEffect(() => {
    const cook = me && !me.ready && !choice && connected && rememberedCook();
    if (cook) onChoice({ character: cook });
  }, [me?.id, me?.ready, choice, connected]);
  // More than ten chefs cook in parallel kitchens in seat order, so the board shows who shares a kitchen before the start.
  const sizes = lineSizes(players.length), many = players.length > KITCHEN_MAX;
  const seat = (player: typeof players[number], i: number) => <li key={player.id} className={player.ready ? 'kr-is-ready' : ''} style={{ '--chef': player.color } as CSSProperties}>
    <Icon name={`character_${characterOf(player.lobbyChoice)}`} className="kr-face"/><b>{i + 1}</b><strong>{player.name}</strong><small>{player.ready ? <><Check aria-hidden="true"/>Ready</> : 'Choosing…'}</small>
  </li>;
  if (!me) return <section className="kr-lobby">
    <Tonight settings={settings} stars={stars}/>
    {many ? <>
      <p className="kr-lobby-lines">{players.length} chefs make a restaurant of <b>{sizes.length} kitchens</b>. Same menu, shared stars, and a race for Kitchen of the Night. Every phone shows its own kitchen.</p>
      <ol className="kr-crew-lines">{sizes.map((size, line) => { const first = sizes.slice(0, line).reduce((sum, n) => sum + n, 0); return <li key={line} style={lineStyle(line)}>
        <LineBadge line={line}/><ol className="kr-crew kr-crew-compact">{players.slice(first, first + size).map((player, i) => seat(player, first + i))}</ol>
      </li>; })}</ol>
    </> : <ol className="kr-crew">{players.map(seat)}</ol>}
    {!players.length && <p className="kr-lobby-empty">Scan the code to join the kitchen crew.</p>}
  </section>;
  const number = players.indexOf(me) + 1, line = lineOf(number - 1, players.length).line;
  return <section className="kr-lobby kr-lobby-phone" style={{ '--chef': me.color } as CSSProperties}>
    <header><b className="kr-me">{number}</b><div><h2>Pick your chef</h2>{many
      ? <p className="kr-my-line">You cook in <LineBadge line={line}/> with {sizes[line] - 1} others. This phone will show your kitchen.</p>
      : <p>Looks only. Your number and colour stay with you.</p>}</div></header>
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    <div className="kr-characters" role="radiogroup" aria-label="Chef">{CHARACTERS.map(character => <button type="button" role="radio" key={character.id} aria-label={character.name} aria-checked={mine === character.id} disabled={!connected || me.ready} onClick={() => { rememberCook(character.id); onChoice({ character: character.id }); }}>
      <Icon name={`character_${character.id}`}/><strong>{character.name}</strong>
    </button>)}</div>
    <div className="kr-lobby-go"><Tonight settings={settings}/><ArcadeButton size="lg" disabled={!connected} tone={me.ready ? 'ghost' : 'lime'} onClick={() => onReady(!me.ready)}>{me.ready ? 'Not ready' : 'Ready to cook'}</ArcadeButton></div>
  </section>;
}
