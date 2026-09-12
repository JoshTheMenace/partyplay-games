// Base/Seafarers acceptance uses the same real UI driver as expansion combinations.
import flow from './browser-expansions';
export default async function (page) {
  page.context().browser().__settlersConfig ??= { expansion: 'seafarers', citiesKnights: false, mode: 'standard', scenarios: [], prefix: 'base' };
  return flow(page);
}
