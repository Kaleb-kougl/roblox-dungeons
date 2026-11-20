/**
 * 'turret.caster' (M1 sandbox; source: `src/sim/actors/archetypes/turretCaster.ts`): a slow 3-arm spiral, a small burst every 0.1 s, its heading turned a step each time.
 *
 * @module
 */

import { BulletKind, FULL_RING } from "../../patterns";
import { registerArchetype } from "../registry";
import { turretBurst, turretData, turretDef } from "./turretShared";

/**
 * The registered `turret.caster` archetype: 3 bullets on a full ring at 3 world units per second every 0.1 s (the first
 * after 0.3 s awake), the heading turned after each burst.
 */
export const TURRET_CASTER = registerArchetype(
	turretDef(
		"turret.caster",
		turretData("enemy.caster", turretBurst(3, FULL_RING, 3, BulletKind.CASTER), 0.1, 0.3, false),
	),
);
