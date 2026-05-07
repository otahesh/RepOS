import type { FastifyInstance } from 'fastify';
import { db } from '../db/client.js';
import { requireBearerOrCfAccess } from '../middleware/cfAccess.js';
import { EquipmentProfileSchema } from '../schemas/equipmentProfile.js';
import { zodToFieldError } from '../utils/zodToFieldError.js';
import { PRESETS, isPreset } from '../services/equipmentProfile.js';
import type { EquipmentProfileResponse } from '../schemas/equipment.js';

export async function equipmentRoutes(app: FastifyInstance) {
  app.get('/equipment/profile', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const { rows } = await db.query(
      `SELECT equipment_profile FROM users WHERE id=$1`, [userId]
    );
    reply.header('cache-control', 'no-store');
    return rows[0]?.equipment_profile ?? { _v: 1 };
  });

  app.put('/equipment/profile', { preHandler: requireBearerOrCfAccess }, async (req, reply) => {
    const userId = (req as any).userId as string;
    const parsed = EquipmentProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return zodToFieldError(parsed.error);
    }
    await db.query(
      `UPDATE users SET equipment_profile=$1::jsonb WHERE id=$2`,
      [JSON.stringify(parsed.data), userId],
    );
    return parsed.data as EquipmentProfileResponse;
  });

  app.post<{ Params: { name: string } }>(
    '/equipment/profile/preset/:name',
    { preHandler: requireBearerOrCfAccess },
    async (req, reply) => {
      const userId = (req as any).userId as string;
      if (!isPreset(req.params.name)) {
        reply.code(400);
        return { error: 'unknown preset', field: 'name' };
      }
      const profile = PRESETS[req.params.name];
      await db.query(
        `UPDATE users SET equipment_profile=$1::jsonb WHERE id=$2`,
        [JSON.stringify(profile), userId],
      );
      return profile as unknown as EquipmentProfileResponse;
    },
  );
}
