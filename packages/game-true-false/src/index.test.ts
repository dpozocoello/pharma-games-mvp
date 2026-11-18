import { describe, expect, it } from 'vitest';
import { MAX_GAME_BUNDLE_KB } from '@pharma/game-sdk';
import trueFalseGame from './index';

describe('@pharma/game-true-false', () => {
  it('exposes TRUE_FALSE manifest within MAX_GAME_BUNDLE_KB', () => {
    expect(trueFalseGame.manifest.mechanic).toBe('TRUE_FALSE');
    expect(trueFalseGame.manifest.maxBundleKb).toBeLessThanOrEqual(MAX_GAME_BUNDLE_KB);
    expect(typeof trueFalseGame.mount).toBe('function');
  });
});
