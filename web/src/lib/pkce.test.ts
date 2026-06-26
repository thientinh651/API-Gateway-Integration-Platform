/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  generatePkceVerifier,
  isValidPkceVerifier,
  pkceChallengeS256,
} from './pkce';

describe('pkce', () => {
  it('generates verifier and matching S256 challenge', async () => {
    const verifier = generatePkceVerifier();
    expect(isValidPkceVerifier(verifier)).toBe(true);
    const challenge = await pkceChallengeS256(verifier);
    expect(challenge).toHaveLength(43);
    const again = await pkceChallengeS256(verifier);
    expect(again).toBe(challenge);
  });
});
