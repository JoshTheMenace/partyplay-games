import type { ServerLevel } from './index';

const N = -Math.PI / 2, S = Math.PI / 2, E = 0, W = Math.PI;
export const glasshouse: ServerLevel = {
  npcs: [
    // Two guards walk the same ring around the Orchid House half a lap apart, pausing at its doors.
    { kind: 'guard', route: [[19, 10, 2, S], [11, 11, 1], [11, 16, 1.5, E], [19, 17, 2, N], [25, 16, 1], [25, 11, 1.5, W]] },
    { kind: 'guard', route: [[19, 17, 2, N], [25, 16, 1], [25, 11, 1.5, W], [19, 10, 2, S], [11, 11, 1], [11, 16, 1.5, E]] },
    { kind: 'guard', route: [[14, 23, 2, E], [19, 24, 1.5, N], [24, 23, 2, W], [19, 21, 1.5, N]] },
    { kind: 'guard', route: [[12, 4, 2, E], [16, 4, 1], [17, 6, 2, E], [14, 7, 1.5, S]] },
    { kind: 'guard', route: [[5, 3, 2, W], [7, 6, 1], [4, 10, 1.5, E], [3, 16, 2, E]] },
    { kind: 'guard', route: [[30, 11, 2, S], [35, 15, 1.5, W], [33, 7, 2, N], [33, 10, 1]] },
    { kind: 'guard', route: [[33, 21, 3, S], [29, 23, 2, N], [35, 24, 2, W]] },
    { kind: 'dog', route: [[40, 5, 1], [38, 13], [42, 18, 1], [38, 20, 1.5], [44, 14], [44, 6]] },
    { kind: 'dog', route: [[3, 22, 1], [9, 22], [8, 26, 1], [4, 27]] },
    { kind: 'civilian', route: [[33, 15, 3], [30, 17, 2], [34, 10, 3]] },
    { kind: 'civilian', route: [[29, 14, 4], [35, 14, 2], [32, 10, 3]] },
    { kind: 'civilian', route: [[19, 23, 4], [14, 24, 2], [24, 22, 3]] },
  ],
  reinforcements: { delay: 20, npcs: [
    { kind: 'guard', route: [[19, 27], [19, 21], [19, 10, 2], [12, 4, 2], [19, 17, 2]] },
    { kind: 'guard', route: [[20, 27], [25, 23, 1], [33, 15, 2], [25, 14, 2], [11, 14, 2]] },
    { kind: 'guard', route: [[18, 25], [13, 23, 1], [11, 15, 2], [15, 4, 2], [19, 7, 2], [11, 13]] },
  ] },
};
