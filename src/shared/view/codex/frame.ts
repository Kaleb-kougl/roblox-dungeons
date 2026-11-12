/**
 * The Codex tracker's per-frame input (claude/codex-plan.md CX4): a small, plain, read-only view of what the client sees
 * this frame, so the tracker (tracker.ts) is pure and its specs build frames by hand. The client fills one CodexFrame
 * per render frame:
 *
 *   readCodexFrame (here)   everything readable from the sim state: the floor, whether the local player left, the local
 *                           player's open draft (card ids + their CardKind at the deal), boons / levels / duos / relics /
 *                           curses, the Greed altar curse the VIEW player's card names, the boost drops and living
 *                           actors within SIGHTING_VIEW.radius of the VIEW player, the boosts running on the LOCAL
 *                           player (state, never the snapshot's `boosts`: those follow the view player, CX0 #15)
 *   the caller              what only the frame's events know: `deaths` (FxTracker `killed` events since the last frame,
 *                           pushCodexDeath), `pedestalRelics` (this frame's `relic` run events: the relics whose toast
 *                           is on screen), `bossEngaged` / `bossDefeated` (the frame's boss events) and `runOver`
 *                           (SimController.isRunOver)
 *
 * Sightings follow the view player (the spectated teammate after a co-op death); finds are the local player's own,
 * plus party kills while the local player is in the run. Read-only on the sim; presentation only.
 */
import { AffixKind } from "shared/dungeon";
import {
	CURSES,
	NO_BOOST,
	NO_KIND,
	PactDim,
	PactKind,
	activeBoosts,
	affixSlotAt,
	archetypeAt,
	buildPlayer,
	cardKind,
	dropsGround,
	greedCurseFor,
	hasLeft,
	pactAvailability,
	partySize,
	playerAt,
	runPlayer,
	scoreFloor,
	type ActiveBoost,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { pactCardsNear } from "../pacts";
import { SIGHTING_VIEW } from "../sighting";

/** An actor as the tracker reads it: its archetype id (`archetypeAt(kind).id`) and shared/dungeon AffixKind (NONE: no affix). */
export interface CodexActorView {
	readonly archetype: string;
	readonly affix: number;
}

/** One frame's input (see the file comment for where each field comes from). */
export interface CodexFrame {
	/** The local player's index (SimController.getLocalPlayerIndex). */
	readonly localIndex: number;
	/** The watched player's index (SimController.getViewPlayerIndex: the spectated teammate after a co-op death). */
	readonly viewIndex: number;
	/** The floor (state.endless.floor; 1 outside endless): a found entry's floor and the toast budget's period. */
	readonly floor: number;
	/** The local player left the run (shared/sim hasLeft): nothing counts from that frame on. */
	readonly left: boolean;
	/** The run is over (SimController.isRunOver): nothing counts from that frame on; the summary freezes. */
	readonly runOver: boolean;
	/** The local player's open draft: card ids, left to right (empty when no draft is open). */
	readonly draftOffers: ReadonlyArray<number>;
	/** CardKind per offer (shared/sim cardKind, read at the deal), -1 for none. Same length as draftOffers. */
	readonly draftKinds: ReadonlyArray<number>;
	/** The local player's owned boons (Boon indices, RunPlayerState.boons). */
	readonly boons: ReadonlyArray<number>;
	/** The local player's boon levels per Boon index (builds' levels; empty without builds): III = evolved. */
	readonly levels: ReadonlyArray<number>;
	/** The local player's duos (Duo indices). */
	readonly duos: ReadonlyArray<number>;
	/** The local player's relics (Relic indices). */
	readonly relics: ReadonlyArray<number>;
	/** Relic indices whose relic toast (`hud.toast.relic`) the local player got this frame: pedestal takes. */
	readonly pedestalRelics: ReadonlyArray<number>;
	/** The local player's curses (Curse indices). */
	readonly curses: ReadonlyArray<number>;
	/** The curse the Pact of Greed altar's card names to the VIEW player this frame (Curse index), -1 none. */
	readonly greedCurse: number;
	/** Boost kinds (Boost indices) of the ground drops within the sighting radius of the VIEW player. */
	readonly drops: ReadonlyArray<number>;
	/** Boost kinds running on the LOCAL player. */
	readonly boosts: ReadonlyArray<number>;
	/** Living actors within the sighting radius of the VIEW player. */
	readonly actors: ReadonlyArray<CodexActorView>;
	/** Actors that died since the last frame (any party member's kill; slimelets and summons included). */
	readonly deaths: ReadonlyArray<CodexActorView>;
	/** The archetype id of a boss that engaged this frame (`boss.act1`), undefined none. */
	readonly bossEngaged: string | undefined;
	/** The archetype id of a boss that died this frame, undefined none. */
	readonly bossDefeated: string | undefined;
}

/** A CodexFrame the client owns and refills every frame (readCodexFrame, then the event fields). */
export interface CodexFrameBuffer extends CodexFrame {
	localIndex: number;
	viewIndex: number;
	floor: number;
	left: boolean;
	runOver: boolean;
	readonly draftOffers: number[];
	readonly draftKinds: number[];
	readonly boons: number[];
	readonly levels: number[];
	readonly duos: number[];
	readonly relics: number[];
	readonly pedestalRelics: number[];
	readonly curses: number[];
	greedCurse: number;
	readonly drops: number[];
	readonly boosts: number[];
	readonly actors: CodexActorView[];
	readonly deaths: CodexActorView[];
	bossEngaged: string | undefined;
	bossDefeated: string | undefined;
}

/** No curse / no player (CodexFrame.greedCurse). */
export const CODEX_NO_CURSE = -1;

/** An empty frame: nobody, floor 1, nothing in view. */
export function newCodexFrame(): CodexFrameBuffer {
	return {
		localIndex: 0,
		viewIndex: 0,
		floor: 1,
		left: false,
		runOver: false,
		draftOffers: [],
		draftKinds: [],
		boons: [],
		levels: [],
		duos: [],
		relics: [],
		pedestalRelics: [],
		curses: [],
		greedCurse: CODEX_NO_CURSE,
		drops: [],
		boosts: [],
		actors: [],
		deaths: [],
		bossEngaged: undefined,
		bossDefeated: undefined,
	};
}

/** Clears the fields only the caller fills (deaths, pedestal relics, boss events); readCodexFrame keeps the rest. */
export function clearCodexFrameEvents(out: CodexFrameBuffer): void {
	out.deaths.clear();
	out.pedestalRelics.clear();
	out.bossEngaged = undefined;
	out.bossDefeated = undefined;
}

function copyInto(out: number[], from: ReadonlyArray<number> | undefined): void {
	out.clear();
	if (from === undefined) return;
	for (const v of from) out.push(v);
}

const boostScratch: ActiveBoost[] = [];

/**
 * Fills `out`'s state fields from `state` for local player `localIndex` and view player `viewIndex` (an index outside
 * the party reads as player 0, like sightingsInView): floor, left, the open draft and its card kinds, the local
 * player's boons / levels / duos / relics / curses and running boosts, the Greed curse the view player's altar card
 * names (only while the cards show and Greed is available to the view player: pactCardsNear / pactAvailability NONE),
 * and the boost drops and living actors within `radius` of the view player. Leaves deaths, pedestalRelics, the boss
 * fields and runOver to the caller. Returns `out`.
 */
export function readCodexFrame(
	state: Readonly<SimState>,
	config: Readonly<SimConfig>,
	localIndex: number,
	viewIndex: number,
	out: CodexFrameBuffer,
	radius: number = SIGHTING_VIEW.radius,
): CodexFrameBuffer {
	const n = partySize(state);
	const me = localIndex >= 0 && localIndex < n ? localIndex : 0;
	const view = viewIndex >= 0 && viewIndex < n ? viewIndex : 0;
	out.localIndex = me;
	out.viewIndex = view;
	out.floor = scoreFloor(state);
	out.left = hasLeft(state, me);

	const rp = runPlayer(state, me);
	out.draftOffers.clear();
	out.draftKinds.clear();
	if (rp !== undefined && rp.draftOpen !== 0) {
		for (const card of rp.draftOffers) {
			out.draftOffers.push(card);
			out.draftKinds.push(cardKind(state, me, card));
		}
	}
	copyInto(out.boons, rp?.boons);
	copyInto(out.relics, rp?.relics);
	copyInto(out.curses, rp?.curses);
	const bp = buildPlayer(state, me);
	copyInto(out.levels, bp?.levels);
	copyInto(out.duos, bp?.duos);

	out.boosts.clear();
	for (const b of activeBoosts(state, me, boostScratch)) out.boosts.push(b.kind);

	out.greedCurse = CODEX_NO_CURSE;
	if (pactCardsNear(state, view) && pactAvailability(state, config, view, PactKind.GREED) === PactDim.NONE) {
		const curse = greedCurseFor(state, view);
		if (curse >= 0 && curse < CURSES.size()) out.greedCurse = curse;
	}

	const viewer = playerAt(state, view);
	const r2 = radius * radius;
	out.drops.clear();
	for (const d of dropsGround(state)) {
		if (d.kind === NO_BOOST) continue;
		const dx = d.x - viewer.x;
		const dz = d.z - viewer.z;
		if (dx * dx + dz * dz <= r2) out.drops.push(d.kind);
	}
	out.actors.clear();
	const actors = state.combat.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const dx = a.x - viewer.x;
		const dz = a.z - viewer.z;
		if (dx * dx + dz * dz > r2) continue;
		out.actors.push({
			archetype: archetypeAt(a.kind).id,
			affix: affixSlotAt(state, i, a)?.affix ?? AffixKind.NONE,
		});
	}
	return out;
}

/**
 * Pushes the actor in slot `slot` onto `out.deaths` (an FxTracker `killed` event: read on its corpse frame, while the
 * slot still holds the dead actor; its affix through affixSlotAt, guarded by the actor id). A free slot pushes nothing.
 */
export function pushCodexDeath(state: Readonly<SimState>, out: CodexFrameBuffer, slot: number): void {
	const a = state.combat.actors[slot];
	if (a === undefined || a.kind === NO_KIND) return;
	out.deaths.push({ archetype: archetypeAt(a.kind).id, affix: affixSlotAt(state, slot, a)?.affix ?? AffixKind.NONE });
}
