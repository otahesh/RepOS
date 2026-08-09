// p95 budgets in milliseconds, sourced verbatim from
// docs/superpowers/specs/beta/08-qa.md §"Latency budget".
// burst threshold = p99 < 2x budget AND zero 5xx (per §"Test approach" item 2).
export const BUDGETS = {
  'GET /api/mesocycles/today':              { p95: 200,  tier: 'hot'  },
  'GET /api/health/weight?range=30d':       { p95: 250,  tier: 'hot'  },
  'GET /api/health/sync/status':            { p95: 100,  tier: 'hot'  },
  'GET /api/user-programs?include=past':    { p95: 400,  tier: 'warm' },
  'GET /api/mesocycles/:id/volume-rollup':  { p95: 500,  tier: 'warm' },
  'GET /api/mesocycles/:id/recap-stats':    { p95: 800,  tier: 'cold' },
  'POST /api/user-programs/:id/start':      { p95: 2000, tier: 'cold' },
  'PATCH /api/planned-sets/:id':            { p95: 150,  tier: 'hot'  },
  'POST /api/planned-sets/:id/substitute':  { p95: 300,  tier: 'warm' },
  'POST /api/health/weight':                { p95: 200,  tier: 'hot'  },
};
