/**
 * AVASO Gateway — k6 benchmark (chạy từ Windows / laptop, KHÔNG trên server gateway).
 *
 * Health (không auth):
 *   k6 run -e BASE_URL=https://thientinh.io.vn -e SCENARIO=health -e VUS=50 -e DURATION=30s benchmark.js
 *
 * JWT + routing (full pipeline):
 *   k6 run -e BASE_URL=https://thientinh.io.vn -e SCENARIO=jwt ^
 *     -e CLIENT_ID=avaso_pk_... -e CLIENT_SECRET=avaso_sk_... ^
 *     -e DATA_PLANE_PATH=/v1/api/get -e VUS=100 -e DURATION=30s benchmark.js
 *
 * Ghi JSON cho báo cáo:
 *   k6 run ... --out json=result-50vu.json
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const RAW_SCENARIO = (__ENV.SCENARIO || 'health').toLowerCase();
const SCENARIO = RAW_SCENARIO === 'jwt_full_pipeline' ? 'jwt' : RAW_SCENARIO;
const DATA_PLANE_PATH = __ENV.DATA_PLANE_PATH || '/v1/api/get';
const CLIENT_ID = __ENV.CLIENT_ID || '';
const CLIENT_SECRET = __ENV.CLIENT_SECRET || '';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '30s';
const SLEEP = Number(__ENV.SLEEP || 0);

export const options = {
  scenarios: {
    bench: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

function fetchToken() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('SCENARIO=jwt cần CLIENT_ID và CLIENT_SECRET (OAuth client từ dashboard).');
  }
  const body = [
    'grant_type=client_credentials',
    `client_id=${encodeURIComponent(CLIENT_ID)}`,
    `client_secret=${encodeURIComponent(CLIENT_SECRET)}`,
  ].join('&');

  const res = http.post(`${BASE}/api/oauth/token`, body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    tags: { name: 'oauth_token' },
  });

  check(res, { 'oauth token 200': (r) => r.status === 200 });
  const token = res.json('access_token');
  if (!token) {
    throw new Error(`Không lấy được access_token: HTTP ${res.status} ${res.body}`);
  }
  return token;
}

export function setup() {
  if (SCENARIO === 'jwt') {
    return { token: fetchToken() };
  }
  return {};
}

export default function (data) {
  if (SCENARIO === 'health') {
    const res = http.get(`${BASE}/health`, { tags: { name: 'health' } });
    check(res, {
      'health 200': (r) => r.status === 200,
    });
  } else if (SCENARIO === 'jwt') {
    const path = DATA_PLANE_PATH.startsWith('/') ? DATA_PLANE_PATH : `/${DATA_PLANE_PATH}`;
    const url = `${BASE}${path}?k6=${__VU}-${__ITER}`;
    const res = http.get(url, {
      headers: { Authorization: `Bearer ${data.token}` },
      tags: { name: 'data_plane' },
    });
    check(res, {
      'data plane OK': (r) =>
        (r.status >= 200 && r.status < 300) || r.status === 404 || r.status === 429,
    });
  } else {
    throw new Error(`SCENARIO không hợp lệ: ${SCENARIO}. Dùng health hoặc jwt.`);
  }

  if (SLEEP > 0) {
    sleep(SLEEP);
  }
}

export function handleSummary(data) {
  const dur = data.metrics.http_req_duration?.values ?? {};
  const rps = data.metrics.http_reqs?.values?.rate ?? 0;
  const p50 = dur.med ?? 0;
  const p95 = dur['p(95)'] ?? 0;
  const p99 = dur['p(99)'] ?? 0;
  const fail = data.metrics.http_req_failed?.values?.rate ?? 0;

  const line = [
    `scenario=${RAW_SCENARIO}`,
    `vus=${VUS}`,
    `duration=${DURATION}`,
    `rps=${rps.toFixed(2)}`,
    `p50_ms=${p50.toFixed(2)}`,
    `p95_ms=${p95.toFixed(2)}`,
    `p99_ms=${p99.toFixed(2)}`,
    `error_rate=${(fail * 100).toFixed(2)}%`,
  ].join(' | ');

  return {
    stdout: `\n--- AVASO benchmark summary ---\n${line}\n`,
  };
}
