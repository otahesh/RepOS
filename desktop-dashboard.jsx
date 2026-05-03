// Desktop: Program dashboard — weekly plan, volume heat-map, trend charts.
// Signature pieces: muscle × week heat-map, mesocycle progression, PR feed.

const DESKTOP_DATA = {
  user: 'K. HARRIS',
  program: 'HYPERTROPHY · UPPER/LOWER · 4-DAY',
  week: 3,
  totalWeeks: 5,
  weekLabel: 'WEEK 03 / 05 · MEV → MAV',
  // Muscle × week volume landmarks (sets per week).
  // MV/MEV/MAV/MRV levels from RP literature.
  volumeMatrix: [
    { muscle: 'Chest',      mev: 8,  mav: 18, mrv: 22, weeks: [10, 12, 14, 16, 10] },
    { muscle: 'Back',       mev: 10, mav: 20, mrv: 25, weeks: [14, 16, 18, 20, 12] },
    { muscle: 'Shoulders',  mev: 8,  mav: 18, mrv: 22, weeks: [10, 12, 14, 16, 10] },
    { muscle: 'Biceps',     mev: 8,  mav: 14, mrv: 20, weeks: [8, 10, 12, 14, 8] },
    { muscle: 'Triceps',    mev: 6,  mav: 14, mrv: 18, weeks: [8, 10, 12, 14, 8] },
    { muscle: 'Quads',      mev: 8,  mav: 16, mrv: 20, weeks: [10, 12, 14, 16, 10] },
    { muscle: 'Hamstrings', mev: 6,  mav: 12, mrv: 16, weeks: [8, 10, 11, 13, 8] },
    { muscle: 'Glutes',     mev: 4,  mav: 12, mrv: 16, weeks: [6, 8, 10, 12, 6] },
    { muscle: 'Calves',     mev: 8,  mav: 14, mrv: 20, weeks: [8, 10, 12, 14, 8] },
  ],
  // 12-week PR trend on bench (lbs x RPE-adj estimated 1RM)
  benchTrend: [
    215, 218, 220, 222, 220, 225, 228, 230, 232, 235, 238, 242,
  ],
  volumeTrend: [
    68, 72, 75, 78, 82, 86, 88, 84, 90, 94, 98, 102,
  ],
  schedule: [
    { day: 'MON', type: 'UPPER · HEAVY', ex: 5, done: true, date: 'Apr 06' },
    { day: 'TUE', type: 'LOWER · HEAVY', ex: 5, done: true, date: 'Apr 07' },
    { day: 'WED', type: 'WALK · Z2 · 45m', ex: 1, done: true, date: 'Apr 08', cardio: true },
    { day: 'THU', type: 'UPPER · VOLUME', ex: 6, done: true, date: 'Apr 09' },
    { day: 'FRI', type: 'LOWER · VOLUME', ex: 6, done: false, active: true, date: 'Apr 10' },
    { day: 'SAT', type: 'ROW · INTERVALS', ex: 1, done: false, date: 'Apr 11', cardio: true },
    { day: 'SUN', type: 'REST', ex: 0, done: false, rest: true, date: 'Apr 12' },
  ],
  prs: [
    { lift: 'Bench Press', old: '190 × 5', now: '195 × 5', delta: '+5 lb', date: 'Today' },
    { lift: 'Deadlift',    old: '315 × 3', now: '325 × 3', delta: '+10 lb', date: '2d ago' },
    { lift: 'OHP',         old: '115 × 6', now: '120 × 5', delta: '+5 lb', date: '5d ago' },
  ],
};

function DesktopDashboard({ theme, persona, science }) {
  const t = REPOS_TOKENS[theme];
  const dark = theme === 'dark';
  return (
    <div style={{
      width: 1440, height: 1300, background: t.bg, color: t.text,
      fontFamily: REPOS_FONTS.ui,
      display: 'grid', gridTemplateColumns: '232px 1fr',
      overflow: 'hidden',
    }}>
      <DesktopSidebar t={t} />
      <div style={{
        display: 'grid', gridTemplateRows: '72px 1fr',
        minHeight: 0,
      }}>
        <DesktopTopbar t={t} />
        <div style={{
          padding: '24px 32px 28px', overflow: 'hidden',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 340px',
          gridTemplateRows: 'auto auto auto',
          gap: 20,
        }}>
          {/* Program header strip */}
          <div style={{ gridColumn: '1 / -1' }}>
            <ProgramHeader t={t} science={science} persona={persona} />
          </div>

          {/* Heat-map (full main width) */}
          <VolumeHeatmap t={t} />

          {/* Right column starts: schedule sits next to heat-map */}
          <div style={{ gridColumn: 2, gridRow: '2 / span 2', display: 'grid', gap: 20, gridTemplateRows: 'auto auto', minHeight: 0 }}>
            <WeekSchedule t={t} />
            <PRFeed t={t} />
          </div>

          {/* Bottom: charts side-by-side under heat-map */}
          <div style={{
            gridColumn: 1,
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20,
            minHeight: 0,
          }}>
            <TrendChart t={t} />
            <WeeklyVolumeChart t={t} />
          </div>

          {/* Bodyweight chart — full main column */}
          <div style={{ gridColumn: 1, minHeight: 0 }}>
            <BodyweightChart t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────
function DesktopSidebar({ t }) {
  const items = [
    { name: 'Today', icon: 'flame', active: true, badge: '1' },
    { name: 'Program', icon: 'calendar' },
    { name: 'Library', icon: 'dumbbell' },
    { name: 'Progress', icon: 'trend' },
    { name: 'Cardio', icon: 'heart' },
  ];
  return (
    <aside style={{
      background: t.surface,
      borderRight: `1px solid ${t.line}`,
      padding: '20px 14px',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* logo */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 10px 24px',
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: `linear-gradient(135deg, ${t.accent} 0%, ${t.heat3} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 12px ${t.accentGlow}`,
        }}>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 13, fontWeight: 700,
            color: '#fff', letterSpacing: -0.5,
          }}>R</div>
        </div>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 14, fontWeight: 600,
          letterSpacing: 1, color: t.text,
        }}>REPOS</div>
      </div>

      {/* mesocycle meta */}
      <div style={{
        padding: '10px 12px', marginBottom: 20,
        background: t.surface2, borderRadius: 8,
        border: `1px solid ${t.line}`,
      }}>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 9,
          color: t.textMute, letterSpacing: 1.2, marginBottom: 4,
        }}>MESOCYCLE</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 6 }}>
          Hypertrophy · Block 2
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <div style={{
            flex: 1, height: 4, background: t.surface3, borderRadius: 100,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: '60%',
              background: t.accent,
            }} />
          </div>
          <span style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textDim,
          }}>W3/5</span>
        </div>
      </div>

      {/* nav */}
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => (
          <div key={it.name} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '9px 12px', borderRadius: 7,
            fontSize: 13, fontWeight: it.active ? 600 : 500,
            color: it.active ? t.text : t.textDim,
            background: it.active ? t.surface2 : 'transparent',
            border: it.active ? `1px solid ${t.line}` : '1px solid transparent',
            cursor: 'pointer', position: 'relative',
          }}>
            {it.active && (
              <div style={{
                position: 'absolute', left: 0, top: 8, bottom: 8,
                width: 2, background: t.accent, borderRadius: 100,
              }} />
            )}
            <Icon name={it.icon} size={16} color={it.active ? t.accent : t.textDim} />
            <span style={{ flex: 1 }}>{it.name}</span>
            {it.badge && (
              <span style={{
                fontFamily: REPOS_FONTS.mono, fontSize: 10,
                padding: '1px 6px', borderRadius: 4,
                background: t.accent, color: '#fff',
              }}>{it.badge}</span>
            )}
          </div>
        ))}
      </nav>

      <div style={{ marginTop: 'auto' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 10px', borderRadius: 8,
          border: `1px solid ${t.line}`,
        }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: `linear-gradient(135deg, ${t.heat3} 0%, ${t.accent} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: REPOS_FONTS.mono, fontSize: 12, fontWeight: 700, color: '#fff',
          }}>KH</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{DESKTOP_DATA.user}</div>
            <div style={{ fontSize: 10, color: t.textMute, fontFamily: REPOS_FONTS.mono }}>6mo · INT</div>
          </div>
          <Icon name="settings" size={14} color={t.textMute} />
        </div>
      </div>
    </aside>
  );
}

function DesktopTopbar({ t }) {
  return (
    <header style={{
      borderBottom: `1px solid ${t.line}`,
      padding: '0 32px', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 10,
          color: t.textMute, letterSpacing: 1.4, marginBottom: 2,
        }}>FRI · APR 10 · TODAY</div>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, whiteSpace: 'nowrap' }}>
          Let's move, Kira.
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <SyncStatusPill t={t} />
        <button style={{
          height: 36, padding: '0 14px', borderRadius: 8,
          border: `1px solid ${t.lineStrong}`,
          background: t.surface2, color: t.textDim,
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: REPOS_FONTS.ui, fontSize: 13, fontWeight: 500,
          whiteSpace: 'nowrap',
        }}>
          <Icon name="calendar" size={14} /> WEEK 3 · APR 06 – 12
        </button>
        <button style={{
          height: 36, padding: '0 16px', borderRadius: 8,
          border: 'none',
          background: t.accent, color: '#fff',
          display: 'flex', alignItems: 'center', gap: 8,
          fontFamily: REPOS_FONTS.ui, fontSize: 13, fontWeight: 700,
          letterSpacing: 0.3, textTransform: 'uppercase',
          boxShadow: `0 4px 14px -4px ${t.accentDim}`,
        }}>
          <Icon name="flame" size={14} color="#fff" /> START SESSION
        </button>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────
// Program header strip
// ─────────────────────────────────────────────────────────────
function ProgramHeader({ t, science, persona }) {
  const metrics = [
    { label: 'ADHERENCE', value: '94', unit: '%', delta: '+6' },
    { label: 'HARD SETS · WEEK', value: '86', unit: 'sets', delta: '+12' },
    { label: 'EST. 1RM · BENCH', value: '242', unit: 'lb', delta: '+7' },
    { label: 'ZONE 2 TIME', value: '2:14', unit: 'h/wk', delta: '+0:18' },
  ];
  return (
    <div style={{
      background: t.surface, borderRadius: 12,
      border: `1px solid ${t.line}`,
      padding: '20px 26px',
      display: 'grid', gridTemplateColumns: '380px repeat(4, 1fr)',
      gap: 28, alignItems: 'center',
    }}>
      <div>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 10,
          color: t.accent, letterSpacing: 1.2, marginBottom: 6,
        }}>{DESKTOP_DATA.weekLabel}</div>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.4, marginBottom: 8, whiteSpace: 'nowrap' }}>
          {DESKTOP_DATA.program}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
          <Chip color={t.accent} bg={t.accentGlow} style={{ whiteSpace: 'nowrap' }}>APPROACHING MAV</Chip>
          {persona === 'beginner' && (
            <Chip color={t.textDim} bg={t.surface2}>GUIDED</Chip>
          )}
        </div>
      </div>
      {metrics.map(m => (
        <div key={m.label} style={{ borderLeft: `1px solid ${t.line}`, paddingLeft: 24 }}>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, letterSpacing: 1.2, marginBottom: 6,
          }}>{m.label}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
            <span style={{
              fontSize: 32, fontWeight: 700, letterSpacing: -1,
              fontFamily: REPOS_FONTS.mono,
              fontVariantNumeric: 'tabular-nums',
            }}>{m.value}</span>
            <span style={{
              fontSize: 12, color: t.textMute, fontFamily: REPOS_FONTS.mono,
              whiteSpace: 'nowrap',
            }}>{m.unit}</span>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3, marginTop: 2,
            fontFamily: REPOS_FONTS.mono, fontSize: 11, color: t.good,
          }}>
            <Icon name="arrowUp" size={10} color={t.good} />
            {m.delta}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Volume heat-map — signature feature
// ─────────────────────────────────────────────────────────────
function VolumeHeatmap({ t }) {
  const weeks = ['W1', 'W2', 'W3', 'W4', 'W5'];
  const matrix = DESKTOP_DATA.volumeMatrix;

  // Map sets to 0-5 tone based on MV/MEV/MAV/MRV
  const toneFor = (sets, { mev, mav, mrv }) => {
    if (sets < mev * 0.6) return 0;          // undertrain
    if (sets < mev) return 1;                 // MV
    if (sets < (mev + mav) / 2) return 2;     // MEV
    if (sets < mav) return 3;                 // approaching MAV
    if (sets < mrv) return 4;                 // MAV
    return 5;                                 // MRV
  };

  const heatColors = [t.heat0, t.heat1, t.heat2, t.heat3, t.heat4, t.heat5];

  return (
    <div style={{
      background: t.surface, borderRadius: 12,
      border: `1px solid ${t.line}`,
      padding: '18px 20px 16px',
      display: 'flex', flexDirection: 'column', gap: 14,
      minHeight: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, letterSpacing: 1.2, marginBottom: 4,
          }}>VOLUME · HARD SETS PER WEEK × MUSCLE</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: t.text }}>
            You're pushing MAV on back and chest. Room on glutes.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <HeatLegendItem label="MV" color={t.heat1} t={t} />
          <HeatLegendItem label="MEV" color={t.heat2} t={t} />
          <HeatLegendItem label="MAV" color={t.heat4} t={t} />
          <HeatLegendItem label="MRV" color={t.heat5} t={t} />
        </div>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr 50px', gap: 12, flex: 1, minHeight: 0 }}>
        {/* row labels col + grid */}
        <div />
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 6, alignItems: 'center',
          paddingBottom: 4,
        }}>
          {weeks.map((w, i) => (
            <div key={w} style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 10,
              color: i === 2 ? t.accent : t.textMute,
              letterSpacing: 1, textAlign: 'center', fontWeight: i === 2 ? 600 : 400,
            }}>{w}{i === 2 && ' ·'}</div>
          ))}
        </div>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 10,
          color: t.textMute, letterSpacing: 1, textAlign: 'right',
        }}>MAV</div>

        {matrix.map(row => {
          const maxSets = Math.max(...row.weeks);
          return (
            <React.Fragment key={row.muscle}>
              <div style={{
                fontSize: 12, color: t.textDim, fontWeight: 500,
                alignSelf: 'center', paddingRight: 6,
              }}>{row.muscle}</div>
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6,
                height: 30,
              }}>
                {row.weeks.map((sets, i) => {
                  const tone = toneFor(sets, row);
                  const isCurrent = i === 2;
                  return (
                    <div key={i} style={{
                      background: heatColors[tone],
                      borderRadius: 5,
                      position: 'relative',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: isCurrent ? `1px solid ${t.accent}` : `1px solid ${t.line}`,
                      boxShadow: isCurrent ? `0 0 0 3px ${t.accentGlow}` : 'none',
                    }}>
                      <span style={{
                        fontFamily: REPOS_FONTS.mono, fontSize: 11,
                        fontWeight: tone >= 3 ? 600 : 500,
                        color: tone >= 4 ? '#fff' : tone >= 2 ? t.text : t.textDim,
                        fontVariantNumeric: 'tabular-nums',
                      }}>{sets}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{
                fontFamily: REPOS_FONTS.mono, fontSize: 11,
                color: t.textMute, textAlign: 'right', alignSelf: 'center',
                fontVariantNumeric: 'tabular-nums',
              }}>{row.mav}</div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function HeatLegendItem({ label, color, t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 12, height: 12, background: color, borderRadius: 3, border: `1px solid ${t.line}` }} />
      <span style={{ fontFamily: REPOS_FONTS.mono, fontSize: 10, color: t.textDim, letterSpacing: 0.6 }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Trend charts
// ─────────────────────────────────────────────────────────────
function TrendChart({ t }) {
  const data = DESKTOP_DATA.benchTrend;
  const W = 400, H = 180, padL = 36, padR = 16, padT = 28, padB = 20;
  const minV = Math.min(...data) - 4;
  const maxV = Math.max(...data) + 4;
  const xStep = (W - padL - padR) / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = padL + i * xStep;
    const y = padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
    return [x, y];
  });
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  const areaPath = `${path} L ${pts[pts.length - 1][0]} ${H - padB} L ${pts[0][0]} ${H - padB} Z`;

  return (
    <div style={{
      background: t.surface, borderRadius: 12,
      border: `1px solid ${t.line}`, padding: '16px 18px 14px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, letterSpacing: 1.2, marginBottom: 4,
          }}>ESTIMATED 1RM · BENCH · 12W</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontSize: 26, fontWeight: 700, fontFamily: REPOS_FONTS.mono,
              letterSpacing: -0.8,
            }}>242</span>
            <span style={{ fontSize: 11, color: t.textMute, fontFamily: REPOS_FONTS.mono }}>lb</span>
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 11, color: t.good,
              marginLeft: 6, display: 'flex', alignItems: 'center', gap: 2,
            }}>
              <Icon name="arrowUp" size={10} color={t.good} />+27 lb · 12.5%
            </span>
          </div>
        </div>
        <Chip color={t.good} bg="rgba(107,226,139,0.12)">PR TODAY</Chip>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="trendArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={t.accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={t.accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* y grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(p => {
          const y = padT + p * (H - padT - padB);
          const v = Math.round(maxV - p * (maxV - minV));
          return (
            <g key={p}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={t.line} strokeWidth="1" strokeDasharray={p === 0 || p === 1 ? '0' : '2 3'} />
              <text x={padL - 6} y={y + 3} fontSize="9" fontFamily={REPOS_FONTS.mono} fill={t.textMute} textAnchor="end">{v}</text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#trendArea)" />
        <path d={path} fill="none" stroke={t.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {pts.map((p, i) => {
          const isLast = i === pts.length - 1;
          return (
            <g key={i}>
              <circle cx={p[0]} cy={p[1]} r={isLast ? 5 : 2.5} fill={isLast ? '#fff' : t.accent} stroke={isLast ? t.accent : 'none'} strokeWidth="2" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function WeeklyVolumeChart({ t }) {
  const data = DESKTOP_DATA.volumeTrend;
  const W = 400, H = 180, padL = 30, padR = 12, padT = 28, padB = 20;
  const max = 110;
  const bw = (W - padL - padR) / data.length;
  const mev = 60, mav = 95;

  return (
    <div style={{
      background: t.surface, borderRadius: 12,
      border: `1px solid ${t.line}`, padding: '16px 18px 14px',
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        marginBottom: 10,
      }}>
        <div>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, letterSpacing: 1.2, marginBottom: 4,
          }}>TOTAL HARD SETS · WEEKLY · 12W</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{
              fontSize: 26, fontWeight: 700, fontFamily: REPOS_FONTS.mono,
              letterSpacing: -0.8,
            }}>102</span>
            <span style={{ fontSize: 11, color: t.textMute, fontFamily: REPOS_FONTS.mono }}>sets</span>
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 11, color: t.warn,
              marginLeft: 6, display: 'flex', alignItems: 'center', gap: 2,
            }}>
              NEAR MRV · DELOAD W6
            </span>
          </div>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* MEV/MAV guide lines */}
        {[
          { val: mev, label: 'MEV', c: t.heat2 },
          { val: mav, label: 'MAV', c: t.warn },
        ].map(g => {
          const y = padT + (1 - g.val / max) * (H - padT - padB);
          return (
            <g key={g.label}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke={g.c} strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
              <text x={W - padR - 4} y={y - 3} fontSize="9" fontFamily={REPOS_FONTS.mono} fill={g.c} textAnchor="end">{g.label} {g.val}</text>
            </g>
          );
        })}
        {data.map((v, i) => {
          const h = (v / max) * (H - padT - padB);
          const x = padL + i * bw + 2;
          const y = H - padB - h;
          const isCurrent = i === data.length - 1;
          const color = v >= mav ? t.warn : v >= mev ? t.accent : t.heat2;
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw - 4} height={h} rx="2"
                fill={color}
                opacity={isCurrent ? 1 : 0.75}
              />
              {isCurrent && (
                <text x={x + (bw - 4) / 2} y={y - 5} fontSize="9" fontFamily={REPOS_FONTS.mono} fill={t.text} textAnchor="middle" fontWeight="600">{v}</text>
              )}
            </g>
          );
        })}
        {/* x axis week labels */}
        {['W1','','','','','W6','','','','','','W12'].map((l, i) => (
          l && <text key={i} x={padL + i * bw + bw/2} y={H - 4} fontSize="9" fontFamily={REPOS_FONTS.mono} fill={t.textMute} textAnchor="middle">{l}</text>
        ))}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Week schedule (right column)
// ─────────────────────────────────────────────────────────────
function WeekSchedule({ t }) {
  return (
    <div style={{
      background: t.surface, borderRadius: 12,
      border: `1px solid ${t.line}`,
      padding: '18px 18px 14px',
      display: 'flex', flexDirection: 'column', gap: 10,
      minHeight: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, letterSpacing: 1.2, marginBottom: 4,
          }}>THIS WEEK</div>
          <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap' }}>Apr 06 – 12</div>
        </div>
        <span style={{ fontFamily: REPOS_FONTS.mono, fontSize: 11, color: t.good, whiteSpace: 'nowrap' }}>4 / 7 DONE</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {DESKTOP_DATA.schedule.map((d, i) => (
          <ScheduleRow key={i} t={t} day={d} />
        ))}
      </div>
    </div>
  );
}

function ScheduleRow({ t, day }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '32px 1fr auto',
      gap: 10, alignItems: 'center',
      padding: '9px 10px', borderRadius: 8,
      background: day.active ? t.accentGlow : 'transparent',
      border: `1px solid ${day.active ? t.accentDim : 'transparent'}`,
      position: 'relative',
    }}>
      {day.active && (
        <div style={{
          position: 'absolute', left: -1, top: 6, bottom: 6, width: 2,
          background: t.accent, borderRadius: 100,
        }} />
      )}
      <div style={{
        fontFamily: REPOS_FONTS.mono, fontSize: 10,
        color: day.active ? t.accent : t.textMute,
        letterSpacing: 0.8, fontWeight: day.active ? 700 : 500,
      }}>{day.day}</div>
      <div>
        <div style={{
          fontSize: 13, fontWeight: 500,
          color: day.rest ? t.textMute : t.text,
          letterSpacing: -0.2,
        }}>{day.type}</div>
        {!day.rest && (
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, marginTop: 1,
          }}>{day.ex} {day.cardio ? 'block' : 'exercises'}</div>
        )}
      </div>
      {day.done ? (
        <div style={{
          width: 18, height: 18, borderRadius: 100,
          background: t.good,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="check" size={10} color="#0A1220" strokeWidth={3} />
        </div>
      ) : day.active ? (
        <Chip color={t.accent} bg="transparent" style={{ border: `1px solid ${t.accent}` }}>NOW</Chip>
      ) : day.rest ? (
        <span style={{ fontFamily: REPOS_FONTS.mono, fontSize: 10, color: t.textMute }}>—</span>
      ) : (
        <div style={{
          width: 18, height: 18, borderRadius: 100,
          border: `1.5px dashed ${t.lineStrong}`,
        }} />
      )}
    </div>
  );
}

function PRFeed({ t }) {
  return (
    <div style={{
      background: t.surface, borderRadius: 12,
      border: `1px solid ${t.line}`,
      padding: '14px 16px',
    }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10,
      }}>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 10,
          color: t.textMute, letterSpacing: 1.2,
        }}>RECENT PRs</div>
        <Icon name="trend" size={12} color={t.good} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {DESKTOP_DATA.prs.map((pr, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '1fr auto',
            gap: 4, padding: '8px 0',
            borderTop: i > 0 ? `1px solid ${t.line}` : 'none',
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{pr.lift}</div>
              <div style={{
                fontFamily: REPOS_FONTS.mono, fontSize: 10,
                color: t.textMute, marginTop: 1,
              }}>{pr.old} → <span style={{ color: t.text }}>{pr.now}</span></div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                fontFamily: REPOS_FONTS.mono, fontSize: 12,
                fontWeight: 700, color: t.good,
              }}>{pr.delta}</div>
              <div style={{
                fontFamily: REPOS_FONTS.mono, fontSize: 9,
                color: t.textMute, marginTop: 2,
              }}>{pr.date}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { DesktopDashboard });
