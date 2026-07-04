import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ALLOWED_METHODS,
  formatAllowedMethods,
  formatAllowedMethodsLabel,
  isAllMethodsAllowed,
  parseAllowedMethods,
  setAllowAllMethods,
  toggleAllowedMethod,
  unknownMethods,
} from './allowedMethodsOptions';

describe('allowedMethodsOptions', () => {
  it('treats * and empty as all methods', () => {
    expect(isAllMethodsAllowed('*')).toBe(true);
    expect(isAllMethodsAllowed('')).toBe(true);
    expect(isAllMethodsAllowed('  *  ')).toBe(true);
    expect(parseAllowedMethods('*')).toEqual([]);
  });

  it('parses comma-separated methods', () => {
    expect(parseAllowedMethods('GET,POST')).toEqual(['GET', 'POST']);
    expect(parseAllowedMethods(' post , get ')).toEqual(['GET', 'POST']);
  });

  it('formats sorted methods', () => {
    expect(formatAllowedMethods(['POST', 'GET'])).toBe('GET,POST');
    expect(formatAllowedMethods([])).toBe('*');
  });

  it('toggles from all to subset', () => {
    expect(toggleAllowedMethod('*', 'GET', false)).toBe('POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
    expect(toggleAllowedMethod('GET,POST', 'POST', false)).toBe('GET');
  });

  it('collapses full selection back to *', () => {
    expect(toggleAllowedMethod('GET,POST,PUT,PATCH,DELETE,HEAD', 'OPTIONS', true)).toBe('*');
  });

  it('labels for table display', () => {
    expect(formatAllowedMethodsLabel('*')).toBe('Tất cả');
    expect(formatAllowedMethodsLabel('GET,POST')).toBe('GET, POST');
  });

  it('detects unknown methods', () => {
    expect(unknownMethods('GET,TRACE')).toEqual(['TRACE']);
  });

  it('default matches gateway seed', () => {
    expect(DEFAULT_ALLOWED_METHODS).toBe('*');
    expect(setAllowAllMethods()).toBe('*');
  });
});
