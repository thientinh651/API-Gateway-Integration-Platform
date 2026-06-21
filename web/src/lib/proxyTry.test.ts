import { describe, expect, it } from 'vitest';
import { describeProxyExpectation, tryDataPlaneRequest } from './proxyTry';

describe('describeProxyExpectation', () => {
  it('labels upstream OpenWeather 401 as upstream issue', () => {
    const msg = describeProxyExpectation(
      {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        elapsedMs: 50,
        bodyText: '{"cod":401,"message":"Invalid API key"}',
        bodyJson: { cod: 401, message: 'Invalid API key' },
        sentToken: true,
        requestUrl: '/v1/api/weather?q=Hanoi',
        method: 'GET',
      },
      'with_token',
    );
    expect(msg).toContain('upstream');
    expect(msg.toLowerCase()).not.toContain('hmac');
  });

  it('labels missing gateway token as authentication', () => {
    const msg = describeProxyExpectation(
      {
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        elapsedMs: 10,
        bodyText: '{"error":"missing_token"}',
        bodyJson: { error: 'missing_token', message: 'Missing Authorization: Bearer token' },
        sentToken: false,
        requestUrl: '/v1/api/get',
        method: 'GET',
      },
      'with_token',
    );
    expect(msg.toLowerCase()).toContain('authentication');
  });
});

describe('tryDataPlaneRequest export', () => {
  it('is exported for Proxy Try page', () => {
    expect(typeof tryDataPlaneRequest).toBe('function');
  });
});
