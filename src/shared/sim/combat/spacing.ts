/**
 * The spacing list (docs/SWORD_SPACING.md Design 1, SP1; a Roblox-port feature, no web source): one entry per live
 * contact enemy, rebuilt from hashed state (kind, alive, x, z, radius) and never hashed itself, like the Warbanner
 * aura mask. ./spacingBrake.ts brakes a step against it.
 */
import { PLAYER_RADIUS } from "../playerData";
import type { SimState } from "../state";
import { archetypeAt } from "./actors/registry";
import { NO_KIND } from "./actors/types";
import { clearSpacingList, pushSpacingEntry, type SpacingList } from "./spacingBrake";
import type { SpacingConfig } from "./spacingData";

/**
 * Clears `out`, then pushes every live actor with contact damage (`contactDamage > 0`), in slot order, as
 * (x, z, keep) with keep = radius + PLAYER_RADIUS + `config.marginTiles` (its contact range plus the margin).
 * Allocates nothing once the list's arrays have grown to the pool's live count.
 */
export function buildSpacingList(state: Readonly<SimState>, config: Readonly<SpacingConfig>, out: SpacingList): void {
	clearSpacingList(out);
	const actors = state.combat.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === NO_KIND || a.alive === 0) continue;
		if (archetypeAt(a.kind).data.contactDamage <= 0) continue;
		pushSpacingEntry(out, a.x, a.z, a.radius + PLAYER_RADIUS + config.marginTiles);
	}
}
