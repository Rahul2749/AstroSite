CREATE TABLE appointments (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  request_hash text NOT NULL,
  service_id text NOT NULL,
  service_name text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  duration integer NOT NULL CHECK (duration BETWEEN 1 AND 30),
  starts_at timestamptz NOT NULL,
  language text NOT NULL CHECK (language IN ('en','hi')),
  payment_mode text NOT NULL CHECK (payment_mode IN ('test','live')),
  name text NOT NULL,
  email text NOT NULL,
  details jsonb NOT NULL,
  consent_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','expired','confirmed','completed','no_show','cancelled')),
  hold_until timestamptz NOT NULL,
  order_id text UNIQUE,
  order_state text NOT NULL DEFAULT 'creating' CHECK (order_state IN ('creating','ready','uncertain')),
  payment_id text UNIQUE,
  payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','captured','refund_pending','refunded','refund_failed')),
  refund_id text UNIQUE,
  join_url text,
  admin_note text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0,
  reconcile_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX appointments_active_slot ON appointments(starts_at) WHERE status IN ('pending','confirmed');
CREATE INDEX appointments_schedule ON appointments(starts_at DESC, id);
CREATE INDEX appointments_status_schedule ON appointments(status, starts_at DESC);
CREATE INDEX appointments_reconcile ON appointments(reconcile_at) WHERE order_id IS NOT NULL AND payment_status='unpaid';
CREATE TABLE jobs (
  id uuid PRIMARY KEY, appointment_id uuid NOT NULL REFERENCES appointments(id),
  kind text NOT NULL CHECK (kind IN ('email','refund')), dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','failed')),
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz, lease_id uuid, first_attempt_at timestamptz,
  provider_id text, delivery_status text, error text, checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready ON jobs(available_at) WHERE status IN ('queued','processing');
CREATE INDEX jobs_appointment ON jobs(appointment_id, created_at);
CREATE TABLE webhook_events (id text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE admins (id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE admin_sessions (token_hash text PRIMARY KEY, admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE, csrf text NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX sessions_expiry ON admin_sessions(expires_at);
CREATE TABLE audit_log (id bigserial PRIMARY KEY, appointment_id uuid REFERENCES appointments(id), admin_id uuid REFERENCES admins(id), action text NOT NULL, data jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_appointment ON audit_log(appointment_id, created_at DESC);
CREATE TABLE rate_limits (key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL);
