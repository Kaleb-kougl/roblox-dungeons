/** 'turret.sniper' (M1 sandbox; source: `src/sim/actors/archetypes/turretSniper.ts`): a 5-bullet, 0.5 rad arc aimed at the player every 0.8 s. */

import { BulletKind } from "../../patterns";
import { registerArchetype } from "../registry";
import { turretBurst, turretData, turretDef } from "./turretShared";

export const TURRET_SNIPER = registerArchetype(
	turretDef("turret.sniper", turretData("enemy.sniper", turretBurst(5, 0.5, 5.5, BulletKind.SNIPER), 0.8, 0.5, true)),
);
