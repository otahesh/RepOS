import { LandmarksEditor } from '../components/settings/LandmarksEditor';
import { LandmarksSummary } from '../components/settings/LandmarksSummary';
import { useIsMobile } from '../lib/useIsMobile';

// [I-FEATURE-FLAG-INLINE] Single read site — no featureFlag.ts abstraction.
// Default ON for Beta per master plan §321.
const BETA_LANDMARKS_EDITOR = (import.meta.env.VITE_BETA_LANDMARKS_EDITOR ?? 'on') !== 'off';

export default function SettingsProgramPrefsPage() {
  const isMobile = useIsMobile();
  if (!BETA_LANDMARKS_EDITOR) {
    return <div style={{ padding: 24, color: 'rgba(255,255,255,0.6)' }}>Program preferences are temporarily unavailable.</div>;
  }
  // Desktop = editor (data management); mobile = read-only summary. Same route,
  // viewport-aware — no /mobile/* subtree (project_responsive_chrome.md).
  return isMobile ? <LandmarksSummary /> : <LandmarksEditor />;
}
