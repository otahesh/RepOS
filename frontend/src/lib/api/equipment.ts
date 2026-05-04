export type EquipmentProfile = Record<string, unknown> & { _v: 1 };

export async function getEquipmentProfile(): Promise<EquipmentProfile> {
  const r = await fetch('/api/equipment/profile', { credentials: 'include' });
  if (!r.ok) throw new Error(`getEquipmentProfile: ${r.status}`);
  return r.json();
}

export async function applyPreset(
  name: 'home_minimal' | 'garage_gym' | 'commercial_gym',
): Promise<EquipmentProfile> {
  const r = await fetch(`/api/equipment/profile/preset/${name}`, {
    method: 'POST', credentials: 'include',
  });
  if (!r.ok) throw new Error(`applyPreset: ${r.status}`);
  return r.json();
}

export async function putEquipmentProfile(p: EquipmentProfile): Promise<EquipmentProfile> {
  const r = await fetch('/api/equipment/profile', {
    method: 'PUT', credentials: 'include',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(p),
  });
  if (!r.ok) throw new Error(`putEquipmentProfile: ${r.status}`);
  return r.json();
}

export function isProfileEmpty(p: EquipmentProfile): boolean {
  return Object.keys(p).filter(k => k !== '_v').length === 0;
}
