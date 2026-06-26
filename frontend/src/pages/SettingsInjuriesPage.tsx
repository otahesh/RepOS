// W3.4 Task 22 — Settings → Injuries page.
//
// Hosts the InjuryChipsEditor (Tasks 20/21) at a reachable route. Per
// project memory feedback_user_reachability_dod.md, a component shipped
// without a click path from `/` is not "done". The G7 reachability audit
// (Task 24) verifies `/` → Settings → Injuries ≤3 clicks.

import { FONTS } from '../tokens';
import { InjuryChipsEditor } from '../components/settings/InjuryChipsEditor';

export default function SettingsInjuriesPage(): JSX.Element {
  return (
    <main style={{ padding: 16, color: '#fff', fontFamily: FONTS.ui }}>
      <h1 style={{ fontSize: 22, marginBottom: 12 }}>Injuries</h1>
      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14, marginBottom: 16 }}>
        Tap a chip to mark a joint. Active chips demote (but never block) load-bearing exercises
        during workouts.
      </p>
      <InjuryChipsEditor />
    </main>
  );
}
