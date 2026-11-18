import { describe, expect, it } from 'vitest';
import { MAX_GAME_BUNDLE_KB } from '@pharma/game-sdk';
import triviaGame from './index';

describe('@pharma/game-trivia', () => {
  it('exposes MULTIPLE_CHOICE manifest within MAX_GAME_BUNDLE_KB', () => {
    expect(triviaGame.manifest.mechanic).toBe('MULTIPLE_CHOICE');
    expect(triviaGame.manifest.maxBundleKb).toBeLessThanOrEqual(MAX_GAME_BUNDLE_KB);
    expect(typeof triviaGame.mount).toBe('function');
  });
});
