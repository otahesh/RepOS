// Fetches /api/muscles/joint-stress — server-side catalog of joint root
// constants. Replaces the dropped frontend/src/lib/jointRoot.ts mirror.
// [C-JOINT-ROOT-ENDPOINT]
export type JointStressCatalog = {
  JOINT_ROOT: Record<string, string>;
  MUSCLE_JOINT_ROOTS: Record<string, string[]>;
};

export async function getJointStressCatalog(): Promise<JointStressCatalog> {
  const r = await fetch('/api/muscles/joint-stress', { credentials: 'include' });
  if (!r.ok) throw new Error(`getJointStressCatalog: ${r.status}`);
  return r.json();
}
