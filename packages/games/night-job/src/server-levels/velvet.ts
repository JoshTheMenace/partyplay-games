import type { ServerLevel } from './index';

const N = -Math.PI / 2, S = Math.PI / 2, E = 0, W = Math.PI;
export const velvet: ServerLevel = {
  npcs: [
    { kind: 'guard', route: [[18, 21, 2, S], [25, 21], [29, 17, 1.5, W], [22, 16, 1], [13, 21, 2, E]] },
    { kind: 'guard', route: [[12, 12, 1, E], [22, 8, 1.5, S], [30, 12, 1, W], [22, 12, 2, N]] },
    { kind: 'guard', route: [[3, 10, 2, E], [8, 12], [5, 16], [2, 20, 2, E], [8, 18], [5, 12]] },
    { kind: 'guard', route: [[23, 2, 2, S], [29, 3, 2, W], [26, 5, 1, N]] },
    { kind: 'guard', route: [[35, 3, 2, E], [36, 7, 1.5, N], [34, 4]] },
    { kind: 'dog', route: [[34, 11], [41, 11, 1], [41, 21], [38, 19, 1], [34, 21]] },
    { kind: 'civilian', route: [[13, 11, 3], [20, 12, 2], [22, 9, 3], [16, 8, 2]] },
    { kind: 'civilian', route: [[25, 12, 4], [29, 11, 3], [24, 9, 2]] },
    { kind: 'civilian', route: [[3, 8, 3], [5, 11, 4], [8, 9, 2]] },
    { kind: 'civilian', route: [[22, 19, 3], [28, 20, 3], [19, 17, 2]] },
  ],
  reinforcements: { delay: 20, npcs: [
    { kind: 'guard', route: [[20, 22], [20, 15], [12, 20, 2], [27, 20, 2]] },
    { kind: 'guard', route: [[21, 22], [33, 20], [39, 14, 2], [36, 11, 2]] },
  ] },
};
