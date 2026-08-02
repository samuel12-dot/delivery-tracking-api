import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const pingLatency = new Trend('location_ping_latency', true);
const pingFailures = new Rate('location_ping_failures');

export const options = {
  scenarios: {
    active_drivers: {
      executor: 'constant-vus',
      vus: 200,
      duration: __ENV.DURATION || '5m',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    location_ping_latency: ['p(95)<250'],
    location_ping_failures: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const tokens = JSON.parse(open(__ENV.DRIVER_TOKENS_FILE || './driver-tokens.json'));

export default function () {
  const token = tokens[(__VU - 1) % tokens.length];
  const angle = (__ITER % 360) * Math.PI / 180;
  const body = JSON.stringify({
    lat: 6.5244 + Math.sin(angle) * 0.01,
    lng: 3.3792 + Math.cos(angle) * 0.01,
    recorded_at: new Date().toISOString(),
  });
  const response = http.post(`${__ENV.BASE_URL || 'http://localhost:3000'}/api/v1/drivers/me/location`, body, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  pingLatency.add(response.timings.duration);
  pingFailures.add(response.status !== 202);
  check(response, { 'location accepted': (res) => res.status === 202 });
  sleep(3);
}

