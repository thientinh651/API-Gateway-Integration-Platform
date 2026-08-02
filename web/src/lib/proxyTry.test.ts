import { describe, expect, it } from 'vitest';
import {
  describeProxyExpectation,
  looksLikeNginxGatewayError,
  looksLikeSpaShell,
  tryDataPlaneRequest,
} from './proxyTry';

const nginx502Html = `<!DOCTYPE html>
<html>
<head><title>502 Bad Gateway</title></head>
<body>
<center><h1>502 Bad Gateway</h1></center>
<hr><center>nginx/1.24.0 (Ubuntu)</center>
</body>
</html>`;

const spaShellHtml = `<!doctype html>
<html lang="vi">
<head><title>AVASO Gateway</title></head>
<body><div id="root"></div></body>
</html>`;

function baseResult(over: Partial<Parameters<typeof describeProxyExpectation>[0]>) {
  return {
    ok: false,
    status: 502,
    statusText: 'Bad Gateway',
    elapsedMs: 100,
    bodyText: '',
    bodyJson: null,
    sentToken: true,
    requestUrl: '/v1/api/fact',
    method: 'GET',
    ...over,
  };
}

describe('looksLikeNginxGatewayError / looksLikeSpaShell', () => {
  it('detects nginx 502 HTML as nginx error, not SPA', () => {
    const r = baseResult({ bodyText: nginx502Html, status: 502 });
    expect(looksLikeNginxGatewayError(r)).toBe(true);
    expect(looksLikeSpaShell(r)).toBe(false);
  });

  it('detects SPA index HTML as SPA, not nginx', () => {
    const r = baseResult({ bodyText: spaShellHtml, status: 200, ok: true });
    expect(looksLikeNginxGatewayError(r)).toBe(false);
    expect(looksLikeSpaShell(r)).toBe(true);
  });
});

describe('describeProxyExpectation', () => {
  it('labels nginx 502 HTML as proxy response failure, not path typo', () => {
    const msg = describeProxyExpectation(baseResult({ bodyText: nginx502Html }), 'with_token');
    expect(msg.toLowerCase()).toContain('nginx');
    expect(msg.toLowerCase()).toContain('header');
    expect(msg.toLowerCase()).not.toContain('dấu / sau api');
    expect(msg.toLowerCase()).not.toContain('html giao diện');
  });

  it('labels SPA shell HTML as path / API mismatch', () => {
    const msg = describeProxyExpectation(
      baseResult({ bodyText: spaShellHtml, status: 200, ok: true }),
      'with_token',
    );
    expect(msg).toContain('/v1/api/');
    expect(msg.toLowerCase()).toContain('html giao diện');
  });

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
