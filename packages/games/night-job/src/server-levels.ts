import type { MissionId, Point } from './model.js';

type GuardSpawn = Point & { id: string; patrol: Point[] };
const routes: Record<MissionId, [number, number][][]> = {
  velvet: [
    [[3, 2], [7, 2], [7, 5], [3, 5]],
    [[12, 5], [19, 5], [19, 8], [12, 8]],
    [[18, 2], [11, 2], [11, 6], [18, 6]],
    [[24, 4], [29, 4], [29, 7], [24, 7]],
    [[25, 12], [29, 12], [29, 15], [23, 15]],
  ],
  glasshouse: [
    [[3, 3], [6, 3], [6, 5], [3, 5]],
    [[12, 3], [21, 3], [21, 1], [12, 1]],
    [[12, 8], [19, 8], [19, 10], [12, 10]],
    [[25, 8], [29, 8], [29, 10], [25, 10]],
    [[25, 3], [29, 3], [29, 1], [25, 1]],
    [[26, 14], [29, 14], [29, 16], [26, 16]],
    [[12, 14], [21, 14], [21, 16], [12, 16]],
  ],
  ferry: [
    [[5, 3], [8, 3], [8, 5], [5, 5]],
    [[13, 3], [18, 3], [18, 5], [13, 5]],
    [[17, 10], [19, 10], [19, 12], [17, 12]],
    [[23, 4], [29, 4], [29, 2], [23, 2]],
    [[22, 9], [24, 9], [24, 12], [22, 12]],
    [[27, 9], [29, 9], [29, 12], [27, 12]],
    [[16, 15], [27, 15], [22, 15], [12, 15]],
  ],
};

// Each round receives fresh patrol arrays; none of this module enters the client graph.
export function getGuards(mission: MissionId): GuardSpawn[] {
  return routes[mission].map((route, index) => {
    const patrol = route.map(([x, y]) => ({ x: x + .5, y: y + .5 }));
    return { id: `${mission}-guard-${index + 1}`, ...patrol[0], patrol };
  });
}
