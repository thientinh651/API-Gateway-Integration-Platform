/**
 * Benchmark C — gọi thẳng upstream (httpbin), so sánh với gateway.
 *
 *   k6 run -e BASE_URL=https://httpbin.org -e VUS=50 -e DURATION=30s benchmark-direct.js
 */
import http from 'k6/http';
import { check } from 'k6';

const BASE = (__ENV.BASE_URL || 'https://httpbin.org').replace(/\/$/, '');
const PATH = __ENV.UPSTREAM_PATH || '/get';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '30s';

export const options = {
  scenarios: {
    direct: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export default function () {
  const url = `${BASE}${PATH}?direct=${__VU}-${__ITER}`;
  const res = http.get(url, { tags: { name: 'upstream_direct' } });
  check(res, { 'upstream 200': (r) => r.status === 200 });
}

export function handleSummary(data) {
  const dur = data.metrics.http_req_duration?.values ?? {};
  const rps = data.metrics.http_reqs?.values?.rate ?? 0;
  const p50 = dur.med ?? 0;
  const p95 = dur['p(95)'] ?? 0;
  const p99 = dur['p(99)'] ?? 0;
  return {
    stdout: `\n--- Direct upstream ---\nrps=${rps.toFixed(2)} | p50_ms=${p50.toFixed(2)} | p95_ms=${p95.toFixed(2)} | p99_ms=${p99.toFixed(2)}\n`,
  };
}
