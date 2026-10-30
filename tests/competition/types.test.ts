// The shared PRNG must be deterministic (draws record their seed and must be reproducible).
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../../src/lib/competition/types';

describe('seededRandom', () => {
  it('gives the same sequence for the same seed, a different one for another seed, always in [0, 1)', () => {
    const a = Array.from({ length: 5 }, seededRandom(42));
    const b = Array.from({ length: 5 }, seededRandom(42));
    const c = Array.from({ length: 5 }, seededRandom(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    for (const x of [...a, ...c]) expect(x >= 0 && x < 1).toBe(true);
  });
});
