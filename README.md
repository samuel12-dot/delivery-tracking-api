# Delivery Tracking API

A production-oriented logistics backend built with Node.js, strict TypeScript,
Express, PostgreSQL/PostGIS, and Redis. Development follows the milestones in
the project build specification, with each milestone kept as a reviewable Git
commit.

## Quick start

```bash
cp .env.example .env
npm install
docker compose up --build
```

`GET /health` checks both PostgreSQL and Redis and returns `503` if either
dependency is unavailable.

## Delivery milestones

- [x] Service scaffold, Docker Compose, PostGIS, Redis, health endpoint
- [x] Database schema and spatial indexes
- [x] Authentication and role authorization
- [x] Transactional order state machine
- [x] Location ingestion and nearby-driver search
- [x] Orders and driver assignment
- [x] Authenticated WebSocket delivery
- [x] Reliable webhook worker and transactional outbox
- [ ] Rate limiting, metrics, API documentation, and load testing

## WebSocket events

Connect to `WS /ws/orders/:id` with the access JWT in an `Authorization:
Bearer <token>` header. Browser clients that cannot set upgrade headers may use
the `access_token` query parameter over TLS; infrastructure must redact query
strings from access logs. Only the customer, assigned driver, owning merchant,
or an administrator can subscribe.

The server sends:

- `subscribed` immediately after an authorized connection is established.
- `status_changed` after the transactional outbox publishes an order status event.
- `driver_location_updated` after a newer driver location ping is committed.

Redis Pub/Sub is used because these are ephemeral live views: durable order
status and location history remains in PostgreSQL, and reconnecting clients can
rebuild state through REST. Redis Streams would add consumer state and replay
semantics that are unnecessary for this fan-out path.

## Webhook verification and retries

The webhook secret is returned only when an endpoint is registered. For every
request, compute HMAC-SHA256 over the exact raw request body using that secret,
prefix the lowercase hexadecimal digest with `sha256=`, and compare it to
`X-Signature` with a constant-time comparison. Persist `event_id` to deduplicate
late retries.

Delivery runs outside request processing. A failed initial attempt is retried
after 1 second, 5 seconds, 30 seconds, 5 minutes, and 30 minutes. After six
total attempts the delivery becomes `exhausted` and remains visible through the
merchant delivery-history endpoint.
