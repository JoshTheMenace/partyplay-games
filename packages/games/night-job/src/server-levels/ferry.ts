import type { ServerLevel } from './index';

const N = -Math.PI / 2, S = Math.PI / 2, E = 0, W = Math.PI;
export const ferry: ServerLevel = {
  npcs: [
    { kind: 'guard', route: [[21, 24, 1.5, N], [13, 25, 2, S], [12, 24, 2, E]] },
    { kind: 'guard', route: [[26, 24, 2, N], [38, 25, 1], [40, 23, 2, W], [32, 25, 1.5, N]] },
    { kind: 'guard', route: [[12, 13, 1.5, W], [7, 15, 1], [2, 19, 2, E], [10, 19, 1.5, N]] },
    { kind: 'guard', route: [[20, 12, 2, E], [30, 12, 2, S], [30, 19, 1.5, W], [20, 19, 1.5, N]] },
    // Stands with his back to the vault door watching the hall; a decoy or the Face moves him.
    { kind: 'guard', route: [[28, 12, 4, S], [25, 13, 2, S]] },
    { kind: 'guard', route: [[21, 5, 2, S], [22, 9, 1], [20, 15, 2, W], [22, 12, 1]] },
    { kind: 'guard', route: [[37, 7, 2, W], [36, 12, 1.5, E], [36, 18, 2, S]] },
    { kind: 'dog', route: [[29, 1, 1], [38, 1, 1.5], [21, 2], [16, 8], [16, 19, 1.5], [16, 5], [6, 2, 1.5]] },
    { kind: 'dog', route: [[11, 5, 1], [9, 6], [2, 9, 1.5], [12, 11, 1], [12, 9]] },
    { kind: 'civilian', route: [[39, 24, 5], [36, 26, 3], [40, 25, 4]] },
    { kind: 'civilian', route: [[29, 24, 4], [33, 25, 3], [27, 26, 3]] },
    { kind: 'civilian', route: [[24, 17, 4], [21, 12, 3], [29, 16, 3]] },
  ],
  reinforcements: { delay: 20, npcs: [
    { kind: 'guard', route: [[9, 2], [16, 9], [21, 16], [30, 13, 2], [36, 13, 2], [37, 18, 2]] },
    { kind: 'guard', route: [[17, 2], [16, 12], [21, 6, 2], [26, 18, 2], [20, 12, 1]] },
    { kind: 'guard', route: [[2, 25], [10, 19, 1], [4, 12, 2], [12, 13, 1]] },
  ] },
};
