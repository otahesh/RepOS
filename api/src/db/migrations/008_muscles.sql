CREATE TABLE IF NOT EXISTS muscles (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z_]+$'),
  name          TEXT NOT NULL,
  group_name    TEXT NOT NULL CHECK (group_name IN ('chest','back','shoulders','arms','legs','core')),
  display_order SMALLINT NOT NULL
);

INSERT INTO muscles (slug, name, group_name, display_order) VALUES
  ('chest',       'Chest',                                  'chest',     10),
  ('lats',        'Lats',                                   'back',      20),
  ('upper_back',  'Upper Back / Mid-Traps / Rhomboids',     'back',      30),
  ('front_delt',  'Front Deltoid',                          'shoulders', 40),
  ('side_delt',   'Side Deltoid',                           'shoulders', 50),
  ('rear_delt',   'Rear Deltoid',                           'shoulders', 60),
  ('biceps',      'Biceps + Brachialis',                    'arms',      70),
  ('triceps',     'Triceps',                                'arms',      80),
  ('quads',       'Quadriceps',                             'legs',      90),
  ('hamstrings',  'Hamstrings',                             'legs',     100),
  ('glutes',      'Glutes',                                 'legs',     110),
  ('calves',      'Calves',                                 'legs',     120)
ON CONFLICT (slug) DO NOTHING;
