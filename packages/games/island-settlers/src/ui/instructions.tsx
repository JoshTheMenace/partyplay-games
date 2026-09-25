import type { InstructionsViewProps } from '../../../../party-ui/src/index';
import { ALL_TOPICS, type Topic } from './shared/help';

const ROLE_LINE: Record<InstructionsViewProps['role'], string> = {
  display: 'The TV shows the island and everyone’s totals. Cards stay on phones.',
  controller: 'Your phone holds your cards and lights up what you can do.',
  personal: 'Your hand sits in the dock under the board. Hide it if the screen is shared.',
};

/** Rule sections as headings with bullet lines. */
function TopicList({ topics }: { topics: Topic[] }) {
  return <div className="island-settlers-topics">{topics.map(t => <section key={t.id}>
    <h3>{t.title}</h3><ul>{t.lines.map(line => <li key={line}>{line}</li>)}</ul>
  </section>)}</div>;
}

/** Lobby rules (EXPERIENCE §4.2): three lines under 60 words, the rest behind "More rules". */
export function InstructionsView({ role }: InstructionsViewProps) {
  return <div className="island-settlers-instructions">
    <h2>Settle the island</h2>
    <ol>
      <li><b>Roll:</b> every hex with that number pays the buildings on its corners.</li>
      <li><b>Build and trade</b> with the cards you have.</li>
      <li><b>Win:</b> the first to the target score (usually 10 points) wins.</li>
    </ol>
    <p>{ROLE_LINE[role]}</p>
    <details><summary>More rules</summary><TopicList topics={ALL_TOPICS}/></details>
  </div>;
}
