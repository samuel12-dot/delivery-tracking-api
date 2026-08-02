-- Up Migration

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('customer', 'driver', 'merchant', 'admin');
CREATE TYPE vehicle_type AS ENUM ('bike', 'car', 'van');
CREATE TYPE driver_status AS ENUM ('offline', 'available', 'en_route', 'unavailable');
CREATE TYPE order_status AS ENUM (
  'placed', 'confirmed', 'driver_assigned', 'picked_up',
  'in_transit', 'delivered', 'cancelled', 'failed'
);
CREATE TYPE webhook_delivery_status AS ENUM ('pending', 'succeeded', 'failed', 'exhausted');
CREATE TYPE outbox_status AS ENUM ('pending', 'published', 'failed');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  full_name text NOT NULL,
  role user_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_id uuid REFERENCES refresh_tokens(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens(user_id);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens(family_id);

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  vehicle_type vehicle_type NOT NULL,
  status driver_status NOT NULL DEFAULT 'offline',
  current_location geography(Point, 4326),
  location_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drivers_current_location_gist_idx ON drivers USING gist(current_location);
CREATE INDEX drivers_available_idx ON drivers(status) WHERE status = 'available';

CREATE TABLE merchants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  address text NOT NULL
);
CREATE INDEX merchants_location_gist_idx ON merchants USING gist(location);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES users(id),
  merchant_id uuid NOT NULL REFERENCES merchants(id),
  driver_id uuid REFERENCES drivers(id),
  pickup_location geography(Point, 4326) NOT NULL,
  dropoff_location geography(Point, 4326) NOT NULL,
  status order_status NOT NULL DEFAULT 'placed',
  estimated_delivery_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_pickup_location_gist_idx ON orders USING gist(pickup_location);
CREATE INDEX orders_dropoff_location_gist_idx ON orders USING gist(dropoff_location);
CREATE INDEX orders_customer_created_idx ON orders(customer_id, created_at DESC, id DESC);
CREATE INDEX orders_merchant_created_idx ON orders(merchant_id, created_at DESC);
CREATE UNIQUE INDEX orders_one_active_per_driver_idx
  ON orders(driver_id)
  WHERE driver_id IS NOT NULL
    AND status IN ('driver_assigned', 'picked_up', 'in_transit');

CREATE TABLE order_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status order_status NOT NULL,
  changed_by uuid REFERENCES users(id),
  changed_by_system boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((changed_by IS NULL) = changed_by_system)
);
CREATE INDEX order_status_events_order_time_idx
  ON order_status_events(order_id, occurred_at, id);

CREATE TABLE location_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  location geography(Point, 4326) NOT NULL,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX location_pings_location_gist_idx ON location_pings USING gist(location);
CREATE INDEX location_pings_driver_time_idx ON location_pings(driver_id, recorded_at DESC);

CREATE TABLE webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  url text NOT NULL,
  secret text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhooks_active_merchant_idx ON webhooks(merchant_id) WHERE is_active;

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  order_status_event_id uuid NOT NULL REFERENCES order_status_events(id) ON DELETE CASCADE,
  status webhook_delivery_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempted_at timestamptz,
  next_retry_at timestamptz,
  response_status_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (webhook_id, order_status_event_id)
);
CREATE INDEX webhook_deliveries_due_idx
  ON webhook_deliveries(next_retry_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status outbox_status NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_events_pending_idx
  ON outbox_events(available_at, created_at)
  WHERE status IN ('pending', 'failed');

-- Down Migration

DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS webhook_deliveries;
DROP TABLE IF EXISTS webhooks;
DROP TABLE IF EXISTS location_pings;
DROP TABLE IF EXISTS order_status_events;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS merchants;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;
DROP TYPE IF EXISTS outbox_status;
DROP TYPE IF EXISTS webhook_delivery_status;
DROP TYPE IF EXISTS order_status;
DROP TYPE IF EXISTS driver_status;
DROP TYPE IF EXISTS vehicle_type;
DROP TYPE IF EXISTS user_role;

