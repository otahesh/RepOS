import { apiFetch } from '../../auth';
import { jsonOrThrow } from './_http';

export type EquipmentProfile = Record<string, unknown> & { _v: 1 };

export async function getEquipmentProfile(): Promise<EquipmentProfile> {
  return jsonOrThrow<EquipmentProfile>(await apiFetch('/api/equipment/profile'));
}

export async function applyPreset(
  name: 'home_minimal' | 'garage_gym' | 'commercial_gym',
): Promise<EquipmentProfile> {
  return jsonOrThrow<EquipmentProfile>(
    await apiFetch(`/api/equipment/profile/preset/${name}`, { method: 'POST' }),
  );
}

export async function putEquipmentProfile(p: EquipmentProfile): Promise<EquipmentProfile> {
  return jsonOrThrow<EquipmentProfile>(
    await apiFetch('/api/equipment/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(p),
    }),
  );
}

export function isProfileEmpty(p: EquipmentProfile): boolean {
  return Object.keys(p).filter((k) => k !== '_v').length === 0;
}
