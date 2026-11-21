/**
 * 'turret.sprayer' (M1 sandbox; source: `src/sim/actors/archetypes/turretSprayer.ts`): a 16-bullet ring every 1.2 s, alternate rings turned by the spiral step.
 *
 * @module
 */

import { BulletKind, FULL_RING } from "../../patterns";
import { registerArchetype } from "../registry";
import { turretBurst, turretData, turretDef } from "./turretShared";

/**
 * The registered `turret.sprayer` archetype: a 16-bullet full ring at 3.2 world units per second every 1.2 s (the first
 * after 0.6 s awake), the heading turned after each burst.
 */
export const TURRET_SPRAYER = registerArchetype(
	turretDef(
		"turret.sprayer",
		turretData("enemy.sprayer", turretBurst(16, FULL_RING, 3.2, BulletKind.SPRAYER), 1.2, 0.6, false),
	),
);
