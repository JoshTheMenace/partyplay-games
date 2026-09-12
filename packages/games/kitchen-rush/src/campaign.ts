import { KITCHENS } from './model';
export const CAMPAIGN_KEY = 'party.kitchen-rush.campaign.v1';
export type Campaign = { stars: number[]; scores: number[]; saved: boolean };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
const blank = (saved = true): Campaign => ({ stars: KITCHENS.map(() => 0), scores: KITCHENS.map(() => 0), saved });
export function readCampaign(storage?: Store): Campaign {
  try {
    const store = storage ?? localStorage, raw = store.getItem(CAMPAIGN_KEY); if (!raw) return blank();
    const value = JSON.parse(raw); if (value.version !== 1 || !Array.isArray(value.stars) || !Array.isArray(value.scores)) return blank();
    return { stars: KITCHENS.map((_, i) => Number.isInteger(value.stars[i]) ? Math.max(0, Math.min(3, value.stars[i])) : 0), scores: KITCHENS.map((_, i) => Number.isFinite(value.scores[i]) ? Math.max(0, Math.round(value.scores[i])) : 0), saved: true };
  } catch { return blank(false); }
}
export function recordCampaign(kitchen: number, stars: number, score: number, storage?: Store): Campaign {
  const progress = readCampaign(storage); if (!Number.isInteger(kitchen) || kitchen < 0 || kitchen >= KITCHENS.length || !Number.isInteger(stars) || stars < 0 || stars > 3 || !Number.isFinite(score) || score < 0) return progress;
  progress.stars[kitchen] = Math.max(progress.stars[kitchen], stars); progress.scores[kitchen] = Math.max(progress.scores[kitchen], Math.round(score));
  try { (storage ?? localStorage).setItem(CAMPAIGN_KEY, JSON.stringify({ version: 1, stars: progress.stars, scores: progress.scores })); progress.saved = true; } catch { progress.saved = false; }
  return progress;
}
