CREATE TABLE IF NOT EXISTS exercise_muscle_contributions (
  exercise_id  UUID NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  muscle_id    INT  NOT NULL REFERENCES muscles(id),
  contribution NUMERIC(3,2) NOT NULL CHECK (contribution > 0 AND contribution <= 1.0),
  PRIMARY KEY (exercise_id, muscle_id)
);

CREATE INDEX IF NOT EXISTS idx_emc_muscle_contribution
  ON exercise_muscle_contributions(muscle_id, contribution DESC);
