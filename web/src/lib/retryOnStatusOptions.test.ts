import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RETRY_ON_STATUS,
  formatRetryOnStatus,
  parseRetryOnStatus,
  retryStatusHintForCode,
  toggleRetryOnStatus,
  unknownRetryStatusCodes,
} from './retryOnStatusOptions';

describe('retryOnStatusOptions', () => {
  it('parses comma-separated status codes', () => {
    expect(parseRetryOnStatus('502,503,504')).toEqual([502, 503, 504]);
    expect(parseRetryOnStatus(' 504 , 502 ')).toEqual([502, 504]);
  });

  it('formats sorted unique codes', () => {
    expect(formatRetryOnStatus([504, 502, 503])).toBe('502,503,504');
  });

  it('toggles preset codes', () => {
    expect(toggleRetryOnStatus('502,503', 504, true)).toBe('502,503,504');
    expect(toggleRetryOnStatus('502,503,504', 503, false)).toBe('502,504');
  });

  it('detects unknown codes outside presets', () => {
    expect(unknownRetryStatusCodes(parseRetryOnStatus('502,520'))).toEqual([520]);
  });

  it('default matches gateway seed', () => {
    expect(DEFAULT_RETRY_ON_STATUS).toBe('502,503,504');
  });

  it('returns hint for preset code', () => {
    expect(retryStatusHintForCode(502)).toContain('Bad Gateway');
    expect(retryStatusHintForCode(999)).toBeUndefined();
  });
});
