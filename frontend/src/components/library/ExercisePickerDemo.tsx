import { useState } from 'react';
import { ExercisePicker } from './ExercisePicker.tsx';
import type { Exercise } from '../../lib/api/exercises.ts';

export function ExercisePickerDemo() {
  const [picked, setPicked] = useState<Exercise | null>(null);
  return (
    <div style={{ padding: 32, color: '#fff', fontFamily: 'Inter Tight' }}>
      <h2>Exercise Picker (component demo)</h2>
      <ExercisePicker onPick={setPicked} />
      {picked && <div style={{ marginTop: 24 }}>Picked: <code>{picked.slug}</code></div>}
    </div>
  );
}
