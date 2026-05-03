// Apple Health weight integration — desktop-rich, mobile-minimal.
// Contract: POST /api/health/weight { weight_lbs, date, time, source }
// Cadence: once-daily Shortcut automation. Stale > 36h.

const WEIGHT_DATA = {
  current: 185.4,
  date: '2026-04-26',
  time: '07:32',
  source: 'Apple Health',
  lastSyncMinutesAgo: 38,
  trend7d: -0.6,
  trend30d: -2.1,
  trend90d: -5.8,
  goal: 180,
  // 90 days of synthetic morning weight, lbs. Slight downtrend with noise.
  series: (() => {
    const out = [];
    let w = 191.2;
    for (let i = 0; i < 90; i++) {
      const drift = -0.066;
      const noise = Math.sin(i * 0.7) * 0.6 + Math.cos(i * 0.31) * 0.4 + (Math.random() - 0.5) * 0.5;
      w += drift + noise * 0.18;
      out.push({ d: i, w: +(w).toFixed(1), missed: i === 71 || i === 72 });
    }
    return out;
  })(),
};

// 7-day moving average
function smoothed(series) {
  return series.map((p, i) => {
    const start = Math.max(0, i - 6);
    const slice = series.slice(start, i + 1).filter(x => !x.missed);
    const avg = slice.reduce((a, b) => a + b.w, 0) / (slice.length || 1);
    return { d: p.d, w: +avg.toFixed(2) };
  });
}

// ─────────────────────────────────────────────────────────────
// Sync status pill (desktop topbar)
// ─────────────────────────────────────────────────────────────
function SyncStatusPill({ t }) {
  const fresh = WEIGHT_DATA.lastSyncMinutesAgo < 60 * 36;
  const c = fresh ? t.good : t.warn;
  return (
    <div style={{
      height: 36, padding: '0 12px', borderRadius: 8,
      border: `1px solid ${t.line}`, background: t.surface,
      display: 'flex', alignItems: 'center', gap: 10,
      fontFamily: REPOS_FONTS.mono, fontSize: 11,
      whiteSpace: 'nowrap',
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: 10, background: c,
        boxShadow: `0 0 8px ${c}`,
      }} />
      <span style={{ color: t.textMute, letterSpacing: 0.6 }}>SYNCED</span>
      <span style={{ color: t.text, fontVariantNumeric: 'tabular-nums' }}>
        {WEIGHT_DATA.time}
      </span>
      <span style={{ color: t.textMute }}>·</span>
      <span style={{ color: t.textDim }}>APPLE HEALTH</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Bodyweight chart (90d) — signature analysis card
// ─────────────────────────────────────────────────────────────
function BodyweightChart({ t }) {
  const W = 820, H = 220, padL = 40, padR = 60, padT = 20, padB = 26;
  const series = WEIGHT_DATA.series;
  const smooth = smoothed(series);
  const all = series.filter(p => !p.missed).map(p => p.w);
  const minV = Math.min(...all) - 1.5;
  const maxV = Math.max(...all) + 1.5;
  const xStep = (W - padL - padR) / (series.length - 1);
  const x = i => padL + i * xStep;
  const y = v => padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB);
  const goalY = y(WEIGHT_DATA.goal);

  const rawPts = series.filter(p => !p.missed).map(p => [x(p.d), y(p.w)]);
  const smoothPath = smooth.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.d)} ${y(p.w)}`).join(' ');
  const smoothArea = `${smoothPath} L ${x(smooth.at(-1).d)} ${H - padB} L ${x(0)} ${H - padB} Z`;

  const last = series.at(-1);
  const lastSmooth = smooth.at(-1);

  return (
    <div style={{
      background: t.surface, borderRadius: 12,
      border: `1px solid ${t.line}`, padding: '18px 20px 14px',
    }}>
      {/* header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 14, gap: 16,
      }}>
        <div>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, letterSpacing: 1.2, marginBottom: 4,
          }}>BODYWEIGHT · 90D · APPLE HEALTH</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, whiteSpace: 'nowrap' }}>
            <span style={{
              fontSize: 30, fontWeight: 700, fontFamily: REPOS_FONTS.mono,
              letterSpacing: -0.9, fontVariantNumeric: 'tabular-nums',
            }}>{WEIGHT_DATA.current}</span>
            <span style={{ fontSize: 12, color: t.textMute, fontFamily: REPOS_FONTS.mono }}>lb</span>
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 11, color: t.good,
              marginLeft: 6, whiteSpace: 'nowrap',
            }}>↓ {Math.abs(WEIGHT_DATA.trend90d)} lb · 90d</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
          <DeltaStat t={t} label="7D" v={WEIGHT_DATA.trend7d} />
          <DeltaStat t={t} label="30D" v={WEIGHT_DATA.trend30d} />
          <DeltaStat t={t} label="GOAL" v={WEIGHT_DATA.current - WEIGHT_DATA.goal} positive="up" suffix="to 180" />
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="bwArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={t.accent} stopOpacity="0.28" />
            <stop offset="100%" stopColor={t.accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y grid */}
        {[0, 0.25, 0.5, 0.75, 1].map(p => {
          const yy = padT + p * (H - padT - padB);
          const v = (maxV - p * (maxV - minV)).toFixed(1);
          return (
            <g key={p}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke={t.line} strokeWidth="1" strokeDasharray={p === 0 || p === 1 ? '0' : '2 3'} />
              <text x={padL - 6} y={yy + 3} fontSize="9" fontFamily={REPOS_FONTS.mono} fill={t.textMute} textAnchor="end">{v}</text>
            </g>
          );
        })}

        {/* Goal line */}
        <line x1={padL} x2={W - padR} y1={goalY} y2={goalY} stroke={t.good} strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
        <text x={W - padR + 4} y={goalY + 3} fontSize="9" fontFamily={REPOS_FONTS.mono} fill={t.good}>GOAL 180</text>

        {/* Smoothed area + line (7-day MA) */}
        <path d={smoothArea} fill="url(#bwArea)" />
        <path d={smoothPath} fill="none" stroke={t.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Raw daily points (small) */}
        {rawPts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill={t.textMute} opacity="0.6" />
        ))}

        {/* Missed-sync markers */}
        {series.filter(p => p.missed).map(p => (
          <g key={p.d}>
            <line x1={x(p.d)} x2={x(p.d)} y1={padT} y2={H - padB} stroke={t.warn} strokeWidth="1" strokeDasharray="2 2" opacity="0.45" />
            <circle cx={x(p.d)} cy={H - padB - 4} r="2" fill={t.warn} />
          </g>
        ))}

        {/* Latest point — emphasized */}
        <circle cx={x(last.d)} cy={y(last.w)} r="5" fill="#fff" stroke={t.accent} strokeWidth="2" />
        <line x1={x(last.d)} x2={x(last.d)} y1={y(last.w) - 8} y2={padT + 6} stroke={t.accent} strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
        <text x={x(last.d) + 8} y={y(last.w) - 4} fontSize="10" fontFamily={REPOS_FONTS.mono} fill={t.accent} fontWeight="600">TODAY</text>

        {/* X axis week markers */}
        {[0, 30, 60, 89].map(d => (
          <text key={d} x={x(d)} y={H - 6} fontSize="9" fontFamily={REPOS_FONTS.mono} fill={t.textMute} textAnchor={d === 0 ? 'start' : d === 89 ? 'end' : 'middle'}>
            {d === 0 ? '−90D' : d === 89 ? 'TODAY' : `−${90 - d}D`}
          </text>
        ))}
      </svg>

      {/* Legend */}
      <div style={{
        display: 'flex', gap: 16, alignItems: 'center', marginTop: 6,
        paddingTop: 10, borderTop: `1px solid ${t.line}`,
      }}>
        <LegendItem t={t} dot={t.textMute} label="DAILY · SHORTCUT" />
        <LegendItem t={t} dot={t.accent} line label="7-DAY AVG" />
        <LegendItem t={t} dot={t.good} dashed label="GOAL 180 lb" />
        <LegendItem t={t} dot={t.warn} dashed label="MISSED SYNC · 2D" />
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: REPOS_FONTS.mono, fontSize: 10, color: t.textMute, whiteSpace: 'nowrap' }}>
          88 / 90 DAYS LOGGED · 97.8% ADHERENCE
        </span>
      </div>
    </div>
  );
}

function DeltaStat({ t, label, v, positive = 'down', suffix }) {
  // For weight loss: down is good. positive='up' for goal-distance.
  const isGood = positive === 'down' ? v < 0 : v > 0;
  const c = positive === 'up' ? t.accent : (v < 0 ? t.good : t.warn);
  const sign = v > 0 ? '+' : '';
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{
        fontFamily: REPOS_FONTS.mono, fontSize: 10,
        color: t.textMute, letterSpacing: 1.2, marginBottom: 2,
      }}>{label}</div>
      <div style={{
        fontFamily: REPOS_FONTS.mono, fontSize: 16, fontWeight: 700,
        color: c, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>{sign}{v.toFixed(1)} <span style={{ fontSize: 10, color: t.textMute, fontWeight: 500 }}>lb</span></div>
      {suffix && (
        <div style={{ fontFamily: REPOS_FONTS.mono, fontSize: 9, color: t.textMute, marginTop: 1 }}>{suffix}</div>
      )}
    </div>
  );
}

function LegendItem({ t, dot, label, line, dashed }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {line ? (
        <div style={{ width: 14, height: 2, background: dot, borderRadius: 100 }} />
      ) : dashed ? (
        <div style={{
          width: 14, height: 0, borderTop: `1.5px dashed ${dot}`,
        }} />
      ) : (
        <div style={{ width: 6, height: 6, borderRadius: 100, background: dot }} />
      )}
      <span style={{
        fontFamily: REPOS_FONTS.mono, fontSize: 10, color: t.textDim,
        letterSpacing: 0.6, whiteSpace: 'nowrap',
      }}>{label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sync source / spec card — doubles as engineer handoff
// ─────────────────────────────────────────────────────────────
function SyncSourceCard({ t }) {
  return (
    <div style={{
      background: t.surface, borderRadius: 12,
      border: `1px solid ${t.line}`, padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, letterSpacing: 1.2, marginBottom: 4,
          }}>SYNC SOURCE</div>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap' }}>iOS Shortcut → Apple Health</div>
        </div>
        <Chip color={t.good} bg="rgba(107,226,139,0.12)">
          <span style={{
            width: 6, height: 6, borderRadius: 10, background: t.good,
            boxShadow: `0 0 6px ${t.good}`,
          }} />HEALTHY
        </Chip>
      </div>

      <div style={{
        background: t.bg, borderRadius: 8,
        border: `1px solid ${t.line}`,
        padding: '10px 12px',
        fontFamily: REPOS_FONTS.mono, fontSize: 11,
        color: t.textDim, lineHeight: 1.6,
      }}>
        <div style={{ color: t.accent, fontSize: 10, letterSpacing: 1, marginBottom: 6 }}>
          POST /api/health/weight
        </div>
        <div>{'{'}</div>
        <div style={{ paddingLeft: 14 }}>
          <span style={{ color: t.textMute }}>"weight_lbs":</span> <span style={{ color: t.text }}>185.4</span>,
        </div>
        <div style={{ paddingLeft: 14 }}>
          <span style={{ color: t.textMute }}>"date":</span> <span style={{ color: t.good }}>"2026-04-26"</span>,
        </div>
        <div style={{ paddingLeft: 14 }}>
          <span style={{ color: t.textMute }}>"time":</span> <span style={{ color: t.good }}>"07:32:00"</span>,
        </div>
        <div style={{ paddingLeft: 14 }}>
          <span style={{ color: t.textMute }}>"source":</span> <span style={{ color: t.good }}>"Apple Health"</span>
        </div>
        <div>{'}'}</div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
        <SpecRow t={t} k="LAST FIRED" v="Today · 07:32 AM" good />
        <SpecRow t={t} k="CADENCE" v="Daily · 07:30 ± 5 min" />
        <SpecRow t={t} k="STALE AFTER" v="36 h · absorbs drift" />
        <SpecRow t={t} k="DEDUPE KEY" v="(date, source)" />
        <SpecRow t={t} k="GAPS · 90D" v="2 days · backfilled" warn />
      </div>

      <button style={{
        marginTop: 4, height: 34, borderRadius: 8,
        border: `1px solid ${t.lineStrong}`, background: t.surface2,
        color: t.text, fontFamily: REPOS_FONTS.ui, fontSize: 12,
        fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        TEST SYNC NOW
      </button>
    </div>
  );
}

function SpecRow({ t, k, v, good, warn }) {
  const c = good ? t.good : warn ? t.warn : t.text;
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '6px 0',
      borderTop: `1px solid ${t.line}`,
    }}>
      <span style={{
        fontFamily: REPOS_FONTS.mono, fontSize: 10,
        color: t.textMute, letterSpacing: 1.2, whiteSpace: 'nowrap',
      }}>{k}</span>
      <span style={{
        fontFamily: REPOS_FONTS.mono, fontSize: 11, color: c,
        whiteSpace: 'nowrap',
      }}>{v}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Settings → Integrations page (separate surface)
// Where the sync spec actually belongs.
// ─────────────────────────────────────────────────────────────
function SettingsIntegrations({ theme = 'dark' }) {
  const t = REPOS_TOKENS[theme];
  const integrations = [
    { name: 'Apple Health', sub: 'Bodyweight · daily', status: 'connected', primary: true },
    { name: 'Strava', sub: 'Cardio sessions', status: 'connected' },
    { name: 'WHOOP', sub: 'Recovery & strain', status: 'available' },
    { name: 'Garmin Connect', sub: 'Heart-rate · GPS', status: 'available' },
    { name: 'Oura', sub: 'Sleep · HRV', status: 'available' },
  ];
  return (
    <div style={{
      width: 1440, height: 900, background: t.bg, color: t.text,
      fontFamily: REPOS_FONTS.ui,
      display: 'grid', gridTemplateColumns: '232px 1fr', overflow: 'hidden',
    }}>
      <DesktopSidebarSettings t={t} />
      <div style={{ display: 'grid', gridTemplateRows: '72px 1fr', minHeight: 0 }}>
        {/* Topbar */}
        <header style={{
          borderBottom: `1px solid ${t.line}`, padding: '0 32px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 10,
              color: t.textMute, letterSpacing: 1.4, marginBottom: 2,
            }}>SETTINGS</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4 }}>Integrations</div>
          </div>
          <SyncStatusPill t={t} />
        </header>

        <div style={{
          padding: '24px 32px', overflow: 'hidden',
          display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 24,
        }}>
          {/* Left: integrations list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 10,
              color: t.textMute, letterSpacing: 1.2, marginBottom: 4, padding: '0 4px',
            }}>SOURCES</div>
            {integrations.map(i => (
              <div key={i.name} style={{
                padding: '12px 14px', borderRadius: 10,
                background: i.primary ? t.surface : 'transparent',
                border: `1px solid ${i.primary ? t.lineStrong : t.line}`,
                display: 'flex', alignItems: 'center', gap: 12,
                position: 'relative',
              }}>
                {i.primary && (
                  <div style={{
                    position: 'absolute', left: 0, top: 10, bottom: 10, width: 2,
                    background: t.accent, borderRadius: 100,
                  }} />
                )}
                <div style={{
                  width: 36, height: 36, borderRadius: 8,
                  background: i.status === 'connected'
                    ? `linear-gradient(135deg, ${t.accent} 0%, ${t.heat3} 100%)`
                    : t.surface2,
                  border: `1px solid ${t.line}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: REPOS_FONTS.mono, fontSize: 14, fontWeight: 700,
                  color: i.status === 'connected' ? '#fff' : t.textMute,
                }}>{i.name[0]}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{i.name}</div>
                  <div style={{
                    fontFamily: REPOS_FONTS.mono, fontSize: 10,
                    color: t.textMute, letterSpacing: 0.4, marginTop: 1,
                  }}>{i.sub}</div>
                </div>
                {i.status === 'connected' ? (
                  <Chip color={t.good} bg="rgba(107,226,139,0.12)">ON</Chip>
                ) : (
                  <Chip color={t.textDim} bg={t.surface2}>ADD</Chip>
                )}
              </div>
            ))}
          </div>

          {/* Right: detail for the selected (Apple Health) */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0, overflow: 'hidden',
          }}>
            <div style={{
              background: t.surface, borderRadius: 12,
              border: `1px solid ${t.line}`, padding: '20px 22px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <div style={{
                    fontFamily: REPOS_FONTS.mono, fontSize: 10,
                    color: t.textMute, letterSpacing: 1.2, marginBottom: 4,
                  }}>INTEGRATION</div>
                  <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Apple Health</div>
                  <div style={{ fontSize: 13, color: t.textDim, marginTop: 4, maxWidth: 520 }}>
                    Once-daily bodyweight push from an iOS Shortcut. Reads your morning weight from Health and posts it to RepOS. No reverse-write.
                  </div>
                </div>
                <button style={{
                  height: 34, padding: '0 14px', borderRadius: 8,
                  border: `1px solid ${t.lineStrong}`, background: t.surface2,
                  color: t.text, fontFamily: REPOS_FONTS.ui, fontSize: 12,
                  fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>DISCONNECT</button>
              </div>

              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 0, borderTop: `1px solid ${t.line}`,
              }}>
                {[
                  { k: 'STATUS', v: 'Healthy', c: t.good },
                  { k: 'LAST FIRED', v: 'Today · 7:32 AM' },
                  { k: 'CADENCE', v: 'Daily · 7:30' },
                  { k: 'GAPS · 90D', v: '2 days', c: t.warn },
                ].map(s => (
                  <div key={s.k} style={{
                    padding: '14px 16px',
                    borderRight: `1px solid ${t.line}`,
                  }}>
                    <div style={{
                      fontFamily: REPOS_FONTS.mono, fontSize: 9,
                      color: t.textMute, letterSpacing: 1.2, marginBottom: 6,
                    }}>{s.k}</div>
                    <div style={{
                      fontFamily: REPOS_FONTS.mono, fontSize: 14, fontWeight: 600,
                      color: s.c || t.text, whiteSpace: 'nowrap',
                    }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Spec card lives here, where it belongs */}
            <SyncSourceCard t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}

function DesktopSidebarSettings({ t }) {
  const items = [
    { name: 'Today', icon: 'flame' },
    { name: 'Program', icon: 'calendar' },
    { name: 'Library', icon: 'dumbbell' },
    { name: 'Progress', icon: 'trend' },
    { name: 'Cardio', icon: 'heart' },
    { name: 'Settings', icon: 'settings', active: true, sub: ['Integrations', 'Units & equipment', 'Account'] },
  ];
  return (
    <aside style={{
      background: t.surface, borderRight: `1px solid ${t.line}`,
      padding: '20px 14px', display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 10px 24px' }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: `linear-gradient(135deg, ${t.accent} 0%, ${t.heat3} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 12px ${t.accentGlow}`,
        }}>
          <div style={{ fontFamily: REPOS_FONTS.mono, fontSize: 13, fontWeight: 700, color: '#fff' }}>R</div>
        </div>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 14, fontWeight: 600,
          letterSpacing: 1, color: t.text,
        }}>REPOS</div>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map(it => (
          <React.Fragment key={it.name}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '9px 12px', borderRadius: 7,
              fontSize: 13, fontWeight: it.active ? 600 : 500,
              color: it.active ? t.text : t.textDim,
              background: it.active ? t.surface2 : 'transparent',
              border: it.active ? `1px solid ${t.line}` : '1px solid transparent',
              position: 'relative',
            }}>
              {it.active && (
                <div style={{
                  position: 'absolute', left: 0, top: 8, bottom: 8, width: 2,
                  background: t.accent, borderRadius: 100,
                }} />
              )}
              <Icon name={it.icon} size={16} color={it.active ? t.accent : t.textDim} />
              <span style={{ flex: 1 }}>{it.name}</span>
            </div>
            {it.sub && (
              <div style={{ paddingLeft: 38, display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
                {it.sub.map((s, i) => (
                  <div key={s} style={{
                    fontSize: 12, padding: '5px 10px', borderRadius: 6,
                    color: i === 0 ? t.accent : t.textMute,
                    fontWeight: i === 0 ? 600 : 500,
                    background: i === 0 ? t.accentGlow : 'transparent',
                  }}>{s}</div>
                ))}
              </div>
            )}
          </React.Fragment>
        ))}
      </nav>
    </aside>
  );
}

Object.assign(window, { SyncStatusPill, BodyweightChart, SyncSourceCard, SettingsIntegrations, WEIGHT_DATA });
