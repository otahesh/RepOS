CREATE TABLE IF NOT EXISTS health_weight_samples (
  id           BIGSERIAL    PRIMARY KEY,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sample_date  DATE         NOT NULL,
  sample_time  TIME         NOT NULL,
  weight_lbs   NUMERIC(5,1) NOT NULL CHECK (weight_lbs BETWEEN 50.0 AND 600.0),
  source       TEXT         NOT NULL CHECK (source IN ('Apple Health','Manual','Withings','Renpho')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),

  UNIQUE (user_id, sample_date, source)
);

CREATE INDEX IF NOT EXISTS idx_hws_user_date ON health_weight_samples (user_id, sample_date DESC);
