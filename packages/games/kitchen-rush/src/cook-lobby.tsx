import { ArcadeButton, Panel, StatusNotice, type LobbyViewProps } from '../../../party-ui/src/index';
import { CHARACTERS, type CharacterId, type Settings } from './model';
import { assetUrl } from './asset-url';
import './picker.css';
export function CookLobby({ players, playerId, connected, error, onChoice, onReady }: LobbyViewProps<Settings>) {
  const me = players.find(player => player.id === playerId), choice = (me?.lobbyChoice as { character?: CharacterId } | undefined)?.character ?? 'chef';
  return <Panel className="kr-picker">
    <h2>{me ? 'Choose your cook' : 'Meet the kitchen crew'}</h2>
    {error && <StatusNotice tone="error">{error}</StatusNotice>}
    {me ? <><p>Appearance only. Your number and team colour stay the same.</p>
      <div className="kr-characters">{CHARACTERS.map(character => <button type="button" key={character.id} aria-pressed={choice === character.id} disabled={!connected || me.ready} onClick={() => onChoice({ character: character.id })}><img src={assetUrl(`icons/character_${character.id}.png`)} alt=""/><strong>{character.name}</strong></button>)}</div>
      <ArcadeButton disabled={!connected} tone={me.ready ? 'ghost' : 'lime'} onClick={() => onReady(!me.ready)}>{me.ready ? 'Not ready' : 'Ready to cook'}</ArcadeButton>
    </> : <div className="kr-cook-roster">{players.map((player, i) => { const id = (player.lobbyChoice as { character?: CharacterId } | undefined)?.character ?? 'chef'; return <div key={player.id}><img src={assetUrl(`icons/character_${id}.png`)} alt=""/><strong>#{i+1} {player.name}</strong><span>{player.ready ? 'Ready' : 'Choosing'}</span></div>; })}</div>}
  </Panel>;
}
