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
- [ ] Authenticated WebSocket delivery
- [ ] Reliable webhook worker and transactional outbox
- [ ] Rate limiting, metrics, API documentation, and load testing
