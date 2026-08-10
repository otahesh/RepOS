// W3.4 Task 22 — Settings → Injuries page.
//
// Hosts the InjuryChipsEditor (Tasks 20/21) at a reachable route. Per
// project memory feedback_user_reachability_dod.md, a component shipped
// without a click path from `/` is not "done". The G7 reachability audit
// (Task 24) verifies `/` → Settings → Injuries ≤3 clicks.

import { FONTS } from '../tokens';
import { InjuryChipsEditor } from '../components/settings/InjuryChipsEditor';
import { Page, PageHeader } from '../components/ui';

export default function SettingsInjuriesPage(): JSX.Element {
  return (
    <Page width="standard" style={{ color: '#fff', fontFamily: FONTS.ui }}>
      <PageHeader
        eyebrow="Profile"
        title="Injuries"
        description="Mark affected joints. RepOS demotes—but never hides—load-bearing exercise suggestions."
      />
      <InjuryChipsEditor />
    </Page>
  );
}
