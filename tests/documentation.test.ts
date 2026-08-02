import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('delivery documentation', () => {
  it('documents every REST route in OpenAPI', async () => {
    const [app, openapi] = await Promise.all([
      readFile(new URL('../src/app.ts', import.meta.url), 'utf8'),
      readFile(new URL('../docs/openapi.yaml', import.meta.url), 'utf8'),
    ]);
    expect(app).toContain("app.use('/api/v1");
    for (const path of [
      '/auth/register', '/auth/login', '/auth/refresh', '/auth/logout',
      '/drivers/me/status', '/drivers/me/location', '/drivers/nearby',
      '/orders', '/orders/{id}', '/orders/{id}/assign-driver',
      '/orders/{id}/transition', '/orders/{id}/events', '/orders/{id}/eta',
      '/customers/me/orders', '/merchants/me/webhooks',
      '/merchants/me/webhooks/{id}', '/merchants/me/webhooks/{id}/deliveries',
    ]) expect(openapi).toContain(`  ${path}:`);
  });

  it('configures the required 200-driver, three-second ping scenario', async () => {
    const script = await readFile(new URL('../load/location-pings.js', import.meta.url), 'utf8');
    expect(script).toContain('vus: 200');
    expect(script).toContain('sleep(3)');
    expect(script).toContain("location_ping_latency: ['p(95)<250']");
  });
});
