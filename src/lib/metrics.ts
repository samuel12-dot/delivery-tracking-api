import { Counter, Histogram, collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics({ prefix: 'delivery_api_' });

export const httpRequestsTotal = new Counter({
  name: 'delivery_api_http_requests_total',
  help: 'Total HTTP requests completed',
  labelNames: ['method', 'route', 'status'] as const,
});

export const httpRequestDuration = new Histogram({
  name: 'delivery_api_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const locationPingDuration = new Histogram({
  name: 'delivery_api_location_ping_duration_seconds',
  help: 'Database and broadcast processing time for driver location pings',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});

export const webhookDeliveriesTotal = new Counter({
  name: 'delivery_api_webhook_deliveries_total',
  help: 'Webhook delivery attempt outcomes',
  labelNames: ['outcome'] as const,
});

export const metricsRegistry = register;

