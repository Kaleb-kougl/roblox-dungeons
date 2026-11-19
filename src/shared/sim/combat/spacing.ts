/**
 * The spacing list (docs/SWORD_SPACING.md Design 1, SP1; a Roblox-port feature, no web source): one entry per live
 * contact enemy, rebuilt from hashed state (kind, alive, x, z, radius) and never hashed itself, like the Warbanner
 * aura mask. ./spacingBrake.ts brakes a step against it.
 */
import { PLAYER_RADIUS } from "../playerData";
import type { SimState } from "../state";
import { archetypeAt } from "./actors/registry";
import { NO_KIND } from "./actors/types";
import { clearSpacingList, newSpacingList, pushSpacingEntry, type SpacingList, type SpacingTick } from "./spacingBrake";
import { SWORD_SPACING, type SpacingConfig } from "./spacingData";

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

/** The sim's own list (module scratch, reused every tick; the predictor keeps its own). */
const simList = newSpacingList();
/** The sim's tick brake (module scratch: `config` rewritten by every tickSpacing, `list` is simList). */
const simTick: { list: SpacingList; config: Readonly<SpacingConfig> } = {
	list: simList,
	config: SWORD_SPACING,
};

/**
 * This tick's brake (docs/SWORD_SPACING.md Design 1, SP2): undefined without `config` (SimConfig.spacing absent: no
 * list built, nothing braked); else the sim's list rebuilt from `state` as it stands (step.ts calls it once per tick,
 * before any stepPlayer, so the walk and the lunge read tick-start positions) with `config`. The result is module
 * scratch, valid until the next call.
 */
export function tickSpacing(
	state: Readonly<SimState>,
	config: Readonly<SpacingConfig> | undefined,
): SpacingTick | undefined {
	if (config === undefined) return undefined;
	buildSpacingList(state, config, simList);
	simTick.config = config;
	return simTick;
}
