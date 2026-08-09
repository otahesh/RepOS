// api/src/constants/parQ.ts
// Beta W2.3 — PAR-Q-lite 9-question constants.
// PAR_Q_VERSION must be bumped every time PAR_Q_QUESTIONS changes;
// users whose users.par_q_version < PAR_Q_VERSION are re-prompted on
// next page load via GET /api/me/par-q.
//
// Source: PAR-Q+ 2014 (Bredin et al.), simplified to 9 high-signal items.
// v2 changes from v1 (panel findings I-Q7-COPY, I-Q9-ADD):
//   - Q7 wording widened from "6 weeks" to "6 months" (clinical return-
//     to-training consensus for post-partum).
//   - Q9 added: chronic condition (diabetes/asthma/heart/kidney/COPD).
//
// Soft-gate copy lives in the frontend (ParQGate.tsx) — backend stores
// only versioned questions + boolean answers + accepted_at timestamp.
//
// Q5 (bone or joint problem) has a special UI follow-up: when answered
// 'yes', the gate reveals a joint multi-select (PAR_Q_Q5_JOINT_OPTIONS).
// Selected joints write rows to user_injuries (severity='mod',
// source='par_q_v{N}') in the same transaction as the par_q_acknowledgments
// INSERT. See api/src/routes/parQ.ts POST handler.

export const PAR_Q_VERSION = 2;

export const PAR_Q_QUESTIONS: readonly string[] = [
  'Has a doctor ever said you have a heart condition or that you should only do physical activity recommended by a doctor?',
  'Do you feel pain in your chest when you do physical activity?',
  'In the past month, have you had chest pain when you were not doing physical activity?',
  'Do you lose your balance because of dizziness or do you ever lose consciousness?',
  'Do you have a bone or joint problem that could be made worse by a change in your physical activity?',
  'Is your doctor currently prescribing drugs for your blood pressure or a heart condition?',
  'Are you currently pregnant or have you given birth in the past 6 months?',
  'Do you have a chronic condition (diabetes, asthma, heart, kidney, COPD) that affects how you exercise?',
  'Do you know of any other reason why you should not do physical activity?',
] as const;

// Q5 follow-up joint multi-select (user decision D1). When answer at
// index 4 (Q5) is true, the gate reveals this picker. Each checked joint
// writes a row to user_injuries (joint=<enum>, severity='mod',
// notes='From PAR-Q v{PAR_Q_VERSION} self-report', source='par_q_v{N}').
// Joint enum values match InjuryJoint from api/src/schemas/userInjuries.ts;
// JOINT_ROOT mapping in api/src/services/injuryRanker.ts is the
// authoritative taxonomy.
//
// 'other' is offered in the UI for completeness, but the W3-shipped
// user_injuries.joint CHECK constraint (migration 032) does NOT include
// 'other' and the injuryRanker JOINT_ROOT has no mapping for it. The POST
// handler therefore FILTERS OUT 'other' before inserting user_injuries rows
// (it still records the full q5_joints array — including 'other' — in the
// account_events meta + the par_q_acknowledgments responses snapshot). This
// preserves the W3 injuryRanker invariant. Documented W2 deviation.
export const PAR_Q_Q5_JOINT_OPTIONS = [
  'shoulder_left',
  'shoulder_right',
  'low_back',
  'knee_left',
  'knee_right',
  'elbow',
  'wrist',
  'other',
] as const;
export type ParQ5Joint = (typeof PAR_Q_Q5_JOINT_OPTIONS)[number];

// Joints actually written to user_injuries — the W3 CHECK-constrained set.
// 'other' is excluded (see PAR_Q_Q5_JOINT_OPTIONS note).
export const PAR_Q_Q5_INJURY_JOINTS: readonly ParQ5Joint[] = [
  'shoulder_left',
  'shoulder_right',
  'low_back',
  'knee_left',
  'knee_right',
  'elbow',
  'wrist',
] as const;

// Q5 (index 4) is the only question that triggers the joint follow-up.
export const PAR_Q_Q5_INDEX = 4;

// Q8 (index 7) chronic condition triggers an additional soft-gate copy
// line in the banner: "Discuss with clinician before increasing volume."
export const PAR_Q_Q8_CHRONIC_INDEX = 7;
