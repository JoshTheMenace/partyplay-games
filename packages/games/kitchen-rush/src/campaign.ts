// Best stars and scores per level, saved in the host's browser. Keyed by level id so reordering levels keeps progress.
import { LEVELS } from './levels';
import { CHARACTERS, type CharacterId } from './model';

export const CAMPAIGN_KEY = 'party.kitchen-rush.campaign.v2';
export type Best = { stars: number; score: number };
export type Campaign = { levels: Record<string, Best>; saved: boolean };
type Store = Pick<Storage, 'getItem' | 'setItem'>;

const ID = /^[a-z0-9-]{1,40}$/;
const sanitize = (value: unknown): Best => {
  const { stars, score } = (value ?? {}) as Partial<Best>;
  return { stars: Number.isInteger(stars) ? Math.max(0, Math.min(3, stars!)) : 0, score: Number.isFinite(score) ? Math.max(0, Math.round(score!)) : 0 };
};
export function readCampaign(storage?: Store): Campaign {
  try {
    const raw = (storage ?? localStorage).getItem(CAMPAIGN_KEY), value = raw ? JSON.parse(raw) : null, levels: Record<string, Best> = {};
    if (value?.version === 2 && value.levels && typeof value.levels === 'object')
      for (const [id, best] of Object.entries(value.levels)) if (ID.test(id)) levels[id] = sanitize(best);
    return { levels, saved: true };
  } catch { return { levels: {}, saved: false }; }
}
export const bestFor = (campaign: Campaign, id: string): Best => campaign.levels[id] ?? { stars: 0, score: 0 };
export const totalStars = (campaign: Campaign) => LEVELS.reduce((sum, level) => sum + bestFor(campaign, level.id).stars, 0);
/** Keeps the best stars and best score independently; never regresses. */
export function recordCampaign(levelId: string, stars: number, score: number, storage?: Store): Campaign {
  const campaign = readCampaign(storage);
  if (!ID.test(levelId) || !Number.isInteger(stars) || stars < 0 || stars > 3 || !Number.isFinite(score) || score < 0) return campaign;
  const before = bestFor(campaign, levelId);
  campaign.levels[levelId] = { stars: Math.max(before.stars, stars), score: Math.max(before.score, Math.round(score)) };
  try { (storage ?? localStorage).setItem(CAMPAIGN_KEY, JSON.stringify({ version: 2, levels: campaign.levels })); campaign.saved = true; }
  catch { campaign.saved = false; }
  return campaign;
}

/** This phone's last chosen chef, so Play again (which clears lobby choices) keeps everyone's look. */
export const COOK_KEY = 'party.kitchen-rush.cook';
export function rememberedCook(storage?: Pick<Storage, 'getItem'>): CharacterId | null {
  try { const id = (storage ?? localStorage).getItem(COOK_KEY); return CHARACTERS.some(character => character.id === id) ? id as CharacterId : null; } catch { return null; }
}
export function rememberCook(id: CharacterId, storage?: Pick<Storage, 'setItem'>) { try { (storage ?? localStorage).setItem(COOK_KEY, id); } catch { /* Storage can be blocked. */ } }
