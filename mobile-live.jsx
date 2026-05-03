// Mobile: Live workout logging screen.
// Hero flow for RepOS. Big numbers, gritty copy, RPE slider, rest timer.

const WORKOUT_DATA = {
  name: 'UPPER · HEAVY',
  week: 'Mesocycle 2 · Week 3 of 5',
  startedAt: '4:32 PM',
  elapsed: '38:14',
  exercises: [
    {
      id: 'bench',
      name: 'Barbell Bench Press',
      target: '3 × 5',
      rir: 'RIR 2',
      substitution: ['DB Bench Press', 'Machine Chest Press', 'Smith Bench'],
      lastTime: '185 × 5 @ RIR 2',
      sets: [
        { planned: '185 × 5', weight: 185, reps: 5, rpe: 8, done: true, pr: false },
        { planned: '190 × 5', weight: 190, reps: 5, rpe: 8.5, done: true, pr: true },
        { planned: '195 × 5', weight: null, reps: null, rpe: null, done: false, active: true },
      ],
      science: 'Hard sets near failure drive hypertrophy. RIR 1–3 is the productive zone — every rep in reserve past 3 leaves gains on the floor.',
    },
    { id: 'row', name: 'Chest-Supported Row', target: '3 × 8', done: false },
    { id: 'ohp', name: 'Seated DB Shoulder Press', target: '3 × 10', done: false },
    { id: 'pull', name: 'Lat Pulldown', target: '3 × 12', done: false },
  ],
};

function MobileLive({ theme, persona, science }) {
  const t = REPOS_TOKENS[theme];
  const dark = theme === 'dark';
  const ex = WORKOUT_DATA.exercises[0];
  const activeSetIdx = 2;

  return (
    <IOSDevice width={402} height={956} dark={dark}>
      <div style={{
        background: t.bg, color: t.text, minHeight: '100%',
        fontFamily: REPOS_FONTS.ui, paddingTop: 62,
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Top header — mesocycle / session meta */}
        <div style={{
          padding: '14px 20px 14px',
          borderBottom: `1px solid ${t.line}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flex: 1 }}>
            <div style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 9.5,
              letterSpacing: 1.4, color: t.textMute, textTransform: 'uppercase',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>MESO 2 · WEEK 3 / 5</div>
            <div style={{
              fontSize: 19, fontWeight: 700, letterSpacing: -0.4,
              color: t.text, whiteSpace: 'nowrap',
            }}>{WORKOUT_DATA.name}</div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 10px', borderRadius: 6,
            background: t.surface2, border: `1px solid ${t.line}`,
            flexShrink: 0,
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: 10, background: t.good,
              boxShadow: `0 0 8px ${t.good}`,
            }} />
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 12,
              color: t.text, fontVariantNumeric: 'tabular-nums',
            }}>{WORKOUT_DATA.elapsed}</span>
          </div>
        </div>

        {/* Exercise header */}
        <div style={{ padding: '14px 20px 0' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px', borderRadius: 8,
            background: t.surface, border: `1px solid ${t.line}`,
            marginBottom: 6,
          }}>
            <Icon name="heart" size={12} color={t.accent} />
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 10,
              color: t.textMute, letterSpacing: 1.2,
            }}>BW</span>
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 14, fontWeight: 700,
              color: t.text, fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}>185.4</span>
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 10,
              color: t.textMute, letterSpacing: 0.4,
            }}>lb</span>
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 10,
              color: t.good, letterSpacing: 0.4, marginLeft: 'auto',
              whiteSpace: 'nowrap',
            }}>↓ 0.6 · 7D</span>
            <span style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 9,
              color: t.textMute, letterSpacing: 0.6,
            }}>· 7:32 AM</span>
          </div>
        </div>

        {/* Exercise header */}
        <div style={{ padding: '8px 20px 8px' }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            marginBottom: 6, gap: 8,
          }}>
            <div style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 11,
              color: t.accent, letterSpacing: 1.2, whiteSpace: 'nowrap',
            }}>EX 01 / 04</div>
            <div style={{
              fontFamily: REPOS_FONTS.mono, fontSize: 10,
              color: t.textMute, letterSpacing: 0.6, whiteSpace: 'nowrap',
            }}>LAST · 185×5 · RPE 8</div>
          </div>
          <div style={{
            fontSize: 26, fontWeight: 700, letterSpacing: -0.7,
            lineHeight: 1.1, color: t.text, marginBottom: 12,
          }}>{ex.name}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip color={t.accent} bg={t.accentGlow} style={{ whiteSpace: 'nowrap' }}>{ex.target}</Chip>
            <Chip color={t.textDim} bg={t.surface2} style={{ whiteSpace: 'nowrap' }}>{ex.rir}</Chip>
            <Chip color={t.textDim} bg={t.surface2} style={{ whiteSpace: 'nowrap' }}>
              <Icon name="swap" size={10} /> SUB
            </Chip>
          </div>
        </div>

        {/* BIG SET CARD — live input */}
        <div style={{ padding: '18px 20px 0' }}>
          <div style={{
            background: t.surface, borderRadius: 16,
            border: `1px solid ${t.lineStrong}`,
            overflow: 'hidden',
            boxShadow: dark ? '0 1px 0 rgba(255,255,255,0.04) inset, 0 20px 40px -20px rgba(0,0,0,0.5)' : '0 1px 0 rgba(255,255,255,1) inset, 0 20px 40px -20px rgba(10,20,40,0.1)',
          }}>
            {/* header row */}
            <div style={{
              padding: '11px 14px',
              borderBottom: `1px solid ${t.line}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: t.surface2,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', flexShrink: 0 }}>
                <span style={{
                  fontFamily: REPOS_FONTS.mono, fontSize: 11,
                  color: t.textMute, letterSpacing: 1.2,
                }}>SET</span>
                <span style={{
                  fontSize: 18, fontWeight: 700, color: t.text,
                  fontFamily: REPOS_FONTS.mono, fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1,
                }}>3</span>
                <span style={{
                  fontFamily: REPOS_FONTS.mono, fontSize: 11,
                  color: t.textMute, letterSpacing: 1.2,
                }}>/&nbsp;3</span>
              </div>
              <div style={{
                fontFamily: REPOS_FONTS.mono, fontSize: 10,
                color: t.textMute, letterSpacing: 0.6, whiteSpace: 'nowrap',
                flexShrink: 0,
              }}>PLAN · 195×5 · RIR 2</div>
            </div>

            {/* weight + reps — huge numerics */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1px 1fr',
              borderBottom: `1px solid ${t.line}`,
            }}>
              <LiveNumberField t={t} label="WEIGHT" value="195" unit="lb" primary />
              <div style={{ background: t.line }} />
              <LiveNumberField t={t} label="REPS" value="5" unit="" />
            </div>

            {/* RPE slider */}
            <div style={{ padding: '16px 16px 18px' }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                marginBottom: 12,
              }}>
                <div style={{
                  fontFamily: REPOS_FONTS.mono, fontSize: 11,
                  color: t.textMute, letterSpacing: 1.2, whiteSpace: 'nowrap',
                }}>EFFORT · RPE</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
                  <span style={{
                    fontSize: 26, fontWeight: 700, color: t.accent,
                    fontFamily: REPOS_FONTS.mono, fontVariantNumeric: 'tabular-nums',
                    lineHeight: 1,
                  }}>8.5</span>
                  <span style={{
                    fontFamily: REPOS_FONTS.mono, fontSize: 10,
                    color: t.textDim, letterSpacing: 0.6,
                  }}>RIR 1–2</span>
                </div>
              </div>
              <RPESlider t={t} value={8.5} />
            </div>

            {/* action row */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1.6fr',
              borderTop: `1px solid ${t.line}`,
            }}>
              <button style={{
                border: 'none', background: 'transparent',
                padding: '16px 12px', color: t.textDim,
                fontFamily: REPOS_FONTS.ui, fontSize: 14, fontWeight: 500,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                borderRight: `1px solid ${t.line}`,
              }}>
                <Icon name="swap" size={14} /> SUB EXERCISE
              </button>
              <button style={{
                border: 'none',
                background: t.accent, color: '#fff',
                padding: '16px 12px',
                fontFamily: REPOS_FONTS.ui, fontSize: 15, fontWeight: 700,
                letterSpacing: 0.3, textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                boxShadow: `0 8px 24px -8px ${t.accentDim}`,
              }}>
                LOCK IT IN <Icon name="arrowRight" size={16} color="#fff" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>

        {/* Completed sets — compact history */}
        <div style={{ padding: '18px 20px 0' }}>
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: t.textMute, letterSpacing: 1.4,
            marginBottom: 8, textTransform: 'uppercase',
          }}>LOGGED · {activeSetIdx}/3</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ex.sets.slice(0, 2).map((s, i) => (
              <LoggedSetRow key={i} t={t} idx={i + 1} set={s} />
            ))}
          </div>
        </div>

        {/* Science callout (collapsible-feeling card) */}
        {science && (
          <div style={{ padding: '16px 20px 0' }}>
            <div style={{
              background: t.accentGlow,
              border: `1px solid ${t.accentDim}`,
              borderRadius: 10, padding: '12px 14px',
              display: 'flex', gap: 10,
            }}>
              <div style={{ color: t.accent, flexShrink: 0, paddingTop: 2 }}>
                <Icon name="info" size={14} color={t.accent} />
              </div>
              <div>
                <div style={{
                  fontFamily: REPOS_FONTS.mono, fontSize: 10,
                  letterSpacing: 1.2, color: t.accent, marginBottom: 4,
                }}>WHY THIS WORKS</div>
                <div style={{
                  fontSize: 12.5, color: t.textDim, lineHeight: 1.45,
                  textWrap: 'pretty',
                }}>{ex.science}</div>
              </div>
            </div>
          </div>
        )}

        {/* Rest timer — floating-ish bottom bar */}
        <div style={{ marginTop: 'auto', padding: '18px 20px 36px' }}>
          <RestTimer t={t} remaining={94} total={180} />
        </div>
      </div>
    </IOSDevice>
  );
}

// Big bold number input cell
function LiveNumberField({ t, label, value, unit, primary }) {
  return (
    <div style={{ padding: '16px 16px 16px', position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 11,
          color: t.textMute, letterSpacing: 1.2,
        }}>{label}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={{
            width: 22, height: 22, borderRadius: 5,
            border: `1px solid ${t.lineStrong}`, background: t.surface2,
            color: t.textDim, padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name="minus" size={10} color={t.textDim} /></button>
          <button style={{
            width: 22, height: 22, borderRadius: 5,
            border: `1px solid ${t.lineStrong}`, background: t.surface2,
            color: t.textDim, padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}><Icon name="plus" size={10} color={t.textDim} /></button>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{
          fontSize: primary ? 54 : 54, fontWeight: 700,
          fontFamily: REPOS_FONTS.mono,
          color: t.text,
          lineHeight: 1, letterSpacing: -1.8,
          fontVariantNumeric: 'tabular-nums',
        }}>{value}</div>
        {unit && (
          <div style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 13,
            color: t.textMute, letterSpacing: 0.6,
            textTransform: 'uppercase',
          }}>{unit}</div>
        )}
      </div>
    </div>
  );
}

// Slider with 0–10 hash marks
function RPESlider({ t, value }) {
  const pct = (value / 10) * 100;
  return (
    <div style={{ position: 'relative', paddingTop: 14, paddingBottom: 16 }}>
      {/* track */}
      <div style={{
        height: 6, background: t.surface2, borderRadius: 100,
        position: 'relative', overflow: 'visible',
      }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${t.accent} 0%, ${t.accent} 70%, ${t.warn} 100%)`,
          borderRadius: 100,
        }} />
        {/* thumb */}
        <div style={{
          position: 'absolute', top: '50%', left: `${pct}%`,
          transform: 'translate(-50%, -50%)',
          width: 22, height: 22, borderRadius: 100,
          background: '#fff',
          border: `2px solid ${t.accent}`,
          boxShadow: `0 0 0 4px ${t.accentGlow}, 0 4px 12px rgba(0,0,0,0.25)`,
        }} />
      </div>
      {/* hash marks / labels */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginTop: 10, paddingLeft: 2, paddingRight: 2,
      }}>
        {['6', '7', '8', '9', '10'].map(n => (
          <span key={n} style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 10,
            color: n === '8' || n === '9' ? t.accent : t.textMute,
            letterSpacing: 0.6,
          }}>{n}</span>
        ))}
      </div>
    </div>
  );
}

function LoggedSetRow({ t, idx, set }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '24px 1fr auto auto auto',
      alignItems: 'center', gap: 10,
      padding: '10px 14px',
      background: t.surface, borderRadius: 8,
      border: `1px solid ${t.line}`,
    }}>
      <span style={{
        fontFamily: REPOS_FONTS.mono, fontSize: 11,
        color: t.textMute,
      }}>{String(idx).padStart(2, '0')}</span>
      <span style={{
        fontFamily: REPOS_FONTS.mono, fontSize: 14,
        color: t.text, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>{set.weight} × {set.reps}</span>
      <Chip color={t.textDim} bg={t.surface2} style={{ fontSize: 9, whiteSpace: 'nowrap' }}>RPE {set.rpe}</Chip>
      {set.pr ? (
        <Chip color={t.good} bg="rgba(107,226,139,0.12)" style={{ fontSize: 9, whiteSpace: 'nowrap' }}>
          PR
        </Chip>
      ) : <span />}
      <div style={{
        width: 22, height: 22, borderRadius: 100,
        background: t.good,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="check" size={12} color="#0A1220" strokeWidth={2.5} />
      </div>
    </div>
  );
}

function RestTimer({ t, remaining, total }) {
  const pct = (remaining / total) * 100;
  const mm = String(Math.floor(remaining / 60)).padStart(1, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  return (
    <div style={{
      background: t.surface,
      border: `1px solid ${t.lineStrong}`,
      borderRadius: 14, padding: '12px 14px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      {/* circular timer */}
      <div style={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }}>
        <svg width="48" height="48" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="24" cy="24" r="20" fill="none" stroke={t.surface3} strokeWidth="4" />
          <circle cx="24" cy="24" r="20" fill="none" stroke={t.accent} strokeWidth="4"
            strokeDasharray={2 * Math.PI * 20}
            strokeDashoffset={2 * Math.PI * 20 * (1 - pct / 100)}
            strokeLinecap="round"
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name="timer" size={16} color={t.accent} />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: REPOS_FONTS.mono, fontSize: 10,
          color: t.textMute, letterSpacing: 1.4, marginBottom: 2,
          whiteSpace: 'nowrap',
        }}>REST · AUTO</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{
            fontSize: 22, fontWeight: 700, color: t.text,
            fontFamily: REPOS_FONTS.mono, fontVariantNumeric: 'tabular-nums',
            letterSpacing: -0.5,
          }}>{mm}:{ss}</span>
          <span style={{
            fontFamily: REPOS_FONTS.mono, fontSize: 11,
            color: t.textMute,
          }}>/ 3:00</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={{
          width: 36, height: 36, borderRadius: 8,
          border: `1px solid ${t.lineStrong}`,
          background: t.surface2, color: t.textDim,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="minus" size={14} color={t.textDim} /></button>
        <button style={{
          width: 36, height: 36, borderRadius: 8,
          border: `1px solid ${t.lineStrong}`,
          background: t.surface2, color: t.textDim,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="plus" size={14} color={t.textDim} /></button>
        <button style={{
          width: 36, height: 36, borderRadius: 8,
          border: 'none',
          background: t.accent, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icon name="pause" size={14} color="#fff" strokeWidth={2} /></button>
      </div>
    </div>
  );
}

Object.assign(window, { MobileLive });
