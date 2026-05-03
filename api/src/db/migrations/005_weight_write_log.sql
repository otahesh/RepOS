CREATE TABLE IF NOT EXISTS weight_write_log (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  log_date    DATE NOT NULL,
  write_count INT  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, log_date)
);
