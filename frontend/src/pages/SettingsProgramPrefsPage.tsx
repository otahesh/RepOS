import { LandmarksEditor } from '../components/settings/LandmarksEditor';
import { DataState, Page, PageHeader } from '../components/ui';

// [I-FEATURE-FLAG-INLINE] Single read site — no featureFlag.ts abstraction.
// Default ON for Beta per master plan §321.
const BETA_LANDMARKS_EDITOR = (import.meta.env.VITE_BETA_LANDMARKS_EDITOR ?? 'on') !== 'off';

export default function SettingsProgramPrefsPage() {
  if (!BETA_LANDMARKS_EDITOR) {
    return (
      <Page width="standard">
        <PageHeader eyebrow="Training" title="Program preferences" />
        <DataState
          kind="warning"
          title="Program preferences are temporarily unavailable"
          body="Your current program and saved landmarks are unchanged."
        />
      </Page>
    );
  }
  return <LandmarksEditor />;
}
