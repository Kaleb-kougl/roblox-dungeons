/**
 * What SimController hands the HUD store (docs/SIM_CONTROLLER.md step 4; moved out of SimController.ts unchanged,
 * its fields now parameters): the run's {@link runInfo} (run start, floor change) and the two HUD snapshots
 * ({@link soloSnapshot}, {@link coopSnapshot}). Reads only; the caller sets the store.
 *
 * @module
 */
import type { RunInfo } from "client/store";
import type { Dungeon } from "shared/dungeon";
import type { LockstepClient } from "shared/lockstep";
import { takeSnapshot, type LiveRun } from "shared/play";
import { biomeIndexOf } from "shared/run";
import { BIOMES, type ThemePack } from "shared/theme";
import { playerCharacterOf, type SpectateView } from "shared/view";
import type { GoldenRumourPhaseId } from "shared/view/golden";
import { floorModifierOf, type RunContext } from "./context";

/** The name key of the biome `dungeon` is themed as (the HUD's place line), or "" without one. */
function placeKeyFor(pack: ThemePack, dungeon: Dungeon | undefined): string {
	if (dungeon === undefined) return "";
	const biome = BIOMES.find((b) => b.forgeTheme === dungeon.params.themeKey);
	return biome !== undefined ? pack.biome(biome.id).nameKey : "";
}

/** The store's RunInfo of `ctx` (`debug`: KV_Debug as read at the run's start; `notice`: the start notice). */
export function runInfo(pack: ThemePack, ctx: RunContext, notice: string, debug: boolean): RunInfo {
	return {
		seed: ctx.seed,
		world: ctx.world,
		placeKey: placeKeyFor(pack, ctx.dungeon),
		dungeonName: ctx.dungeon?.name ?? "",
		debug,
		run: ctx.counter,
		notice,
		biome: biomeIndexOf(ctx.dungeon),
		coop: ctx.coop !== undefined,
		lobbyId: ctx.lobbyId,
		character: playerCharacterOf(ctx.characters, ctx.run.state, ctx.localIndex) ?? "",
		floorModifier: floorModifierOf(ctx),
	};
}

/** The solo HUD snapshot (`goldenRumour`: the rumour clock's chip, shared/view/golden GoldenRumourClock.chip). */
export function soloSnapshot(run: LiveRun, goldenRumour: GoldenRumourPhaseId) {
	return takeSnapshot(run.state, {
		paused: run.isPaused(),
		outcome: run.outcome(),
		recordedTicks: run.ticks(),
		kills: run.kills,
		hitsTaken: run.hitsTaken,
		endTick: run.endTick(),
		config: run.setup.config,
		goldenRumour,
	});
}

/**
 * The co-op HUD snapshot: this client's own items, the vitals and spectate bar of the player the views follow. `ctx`:
 * the controller's current context; `spectateView`: its getSpectateView(); `goldenRumour`: the rumour clock's chip.
 */
export function coopSnapshot(
	coop: LockstepClient,
	ctx: RunContext | undefined,
	spectateView: SpectateView | undefined,
	goldenRumour: GoldenRumourPhaseId,
) {
	const over = coop.isOver();
	const view = ctx !== undefined && ctx.coop === coop ? spectateView : undefined;
	// The spectate bar only while the run goes on: after a wipe or a server-ended run the tracker still watches the
	// last player (the camera and vitals stay there) but the run-over panel takes over.
	const watched = view !== undefined && view.active && !over ? view.viewIndex : undefined;
	return takeSnapshot(coop.state, {
		paused: false,
		outcome: over ? "dead" : "playing",
		recordedTicks: coop.state.tick,
		kills: coop.kills,
		hitsTaken: coop.hitsTaken,
		endTick: coop.state.tick,
		playerIndex: coop.localIndex,
		vitalsIndex: view?.viewIndex,
		spectate:
			view !== undefined && watched !== undefined
				? { name: ctx?.memberNames[watched] ?? "", position: view.position, count: view.count }
				: undefined,
		config: coop.config,
		goldenRumour,
	});
}
