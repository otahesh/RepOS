import { useState } from 'react';
import { ExercisePicker } from './ExercisePicker.tsx';
import { SubstitutionRow } from './SubstitutionRow.tsx';
import type { Exercise } from '../../lib/api/exercises.ts';

export function ExercisePickerDemo() {
  const [picked, setPicked] = useState<Exercise | null>(null);
  return (
    <div style={{ padding: 32, color: '#fff', fontFamily: 'Inter Tight', maxWidth: 720 }}>
      <h2>Exercise Picker (component demo)</h2>
      <ExercisePicker onPick={setPicked} />
      {picked && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 1.4, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
            PICKED: {picked.slug}
          </div>
          <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, letterSpacing: 1.4, color: '#4D8DFF', marginTop: 16, marginBottom: 8 }}>
            SUBSTITUTIONS
          </div>
          <SubstitutionRow fromSlug={picked.slug} onSelect={(slug) => alert(`Selected substitute: ${slug}`)} />
        </div>
      )}
    </div>
  );
}
