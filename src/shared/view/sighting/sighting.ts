/**
 * First sightings (docs/ENEMY_VARIANTS.md EV12, EVD10): which new enemies and affixes the watched view shows this frame,
 * and the queue that turns the ones this account has not seen yet into one toast at a time. Pure (no Roblox API):
 * the client's SightingController feeds it the run state, the onboarding status and the clock, shows the line on the
 * SightingCard (left edge under the status panel, not the top-centre toasts; theme string `bestiary.<id>`,
 * shared/onboarding sightingStringKey) and reports the id (`bestiarySeen`).
 *
 *   - sightingsInView: every living actor within SIGHTING_VIEW.radius of the watched player (the view index: the
 *     spectated teammate after a co-op death) whose archetype has a sighting (ARCHETYPE_SIGHTINGS: `imp`, `slime` and
 *     `slime.small` (as `slime`), `summoner`) or who carries an affix (`affix.<id>` by shared/dungeon AffixKind). The
 *     ids come out in canonical order (shared/onboarding SIGHTING_IDS), each once. The power pellet (`pellet.power`,
 *     docs/PELLETS.md PL14) counts while it lies untaken in a live room within the same radius (shared/view/pellets
 *     livePowerPellet); the tutorial never shows one (its caller skips the tutorial anyway).
 *   - withRumourSighting: the first-time card of the Goldling's rumours (`golden.rumour`, docs/GOLDLING_RUMOURS.md
 *     GR7): added once this floor's first rumour cue has played (shared/view/golden GoldenRumourClock.heard), so it is
 *     queued on that cue. It is SIGHTING_IDS' last id, so the canonical order holds; one card at a time (the queue), so
 *     it never shows on top of the Goldling's own `golden` card.
 *   - SightingQueue: the account's seen set (every `onboardingStatus.seen`, unioned: a later status never forgets a
 *     local sighting), the queue of ids found but not shown yet, and the one-at-a-time clock. Nothing is queued before a
 *     LOADED status arrived (`loaded: false` = the stored set is unknown, so no toast at all rather than repeat them all
 *     to a veteran). `next` hands out the queue head when the caller can show it and the previous toast plus
 *     SIGHTING_VIEW.gapSeconds is over, and marks it seen at once (the caller reports it). `clear` (run exit) drops the
 *     queued ids that were never shown: they are found again the next time they are on screen.
 *
 * Co-op: each client keeps its own account's set, so a teammate who has seen an Imp gets no toast while one who has not
 * does. Read-only on the sim.
 */
import { affixThemeIndex } from "shared/dungeon";
import { AFFIX_SIGHTING_IDS, SIGHTING_IDS, type OnboardingStatus } from "shared/onboarding";
import { NO_KIND, affixSlotAt, archetypeIndex, partySize, playerAt, type SimState } from "shared/sim";
import { livePowerPellet } from "../pellets";
import { SIGHTING_VIEW } from "./config";

/** The power pellet's sighting id (shared/onboarding SIGHTING_IDS, docs/PELLETS.md PL14). */
export const POWER_PELLET_SIGHTING = "pellet.power";

/** The first Goldling rumour's sighting id (shared/onboarding SIGHTING_IDS, docs/GOLDLING_RUMOURS.md GR7, RD7). */
export const GOLDEN_RUMOUR_SIGHTING = "golden.rumour";

/** Archetype id -> its sighting id (the archetypes a first sighting announces; a slimelet is an Ooze). */
export const ARCHETYPE_SIGHTINGS: ReadonlyMap<string, string> = new Map([
	["imp", "imp"],
	["slime", "slime"],
	["slime.small", "slime"],
	["summoner", "summoner"],
	// docs/NEW_ENEMIES.md NED13
	["bomber", "bomber"],
	["charger", "charger"],
	["stormcaller", "stormcaller"],
	["warbanner", "warbanner"],
	["reaper", "reaper"],
	// docs/FORTUNE.md FO6: the Goldling
	["golden", "golden"],
]);

/** Archetype index -> sighting id, built once (an unregistered id is left out). */
let kindSightings: Map<number, string> | undefined;

function sightingOfKind(kind: number): string | undefined {
	if (kindSightings === undefined) {
		const map = new Map<number, string>();
		for (const [id, sighting] of ARCHETYPE_SIGHTINGS) {
			const [ok, index] = pcall(() => archetypeIndex(id));
			if (ok) map.set(index as number, sighting);
		}
		kindSightings = map;
	}
	return kindSightings.get(kind);
}

/** The sighting id of an affix (shared/dungeon AffixKind), or undefined for none / an unknown kind. */
export function affixSighting(affix: number): string | undefined {
	const i = affixThemeIndex(affix);
	return i >= 0 ? AFFIX_SIGHTING_IDS[i] : undefined;
}

/**
 * The sighting ids the watched view shows: living actors within `radius` of player `viewIndex` (falls back to player 0
 * when the index is not in the party). Clears `out`, fills it in canonical order and returns it.
 */
export function sightingsInView(
	state: Readonly<SimState>,
	viewIndex: number,
	out: string[],
	radius: number = SIGHTING_VIEW.radius,
): string[] {
	out.clear();
	const viewer = playerAt(state, viewIndex >= 0 && viewIndex < partySize(state) ? viewIndex : 0);
	const r2 = radius * radius;
	const found = new Set<string>();
	const actors = state.combat.actors;
	for (let i = 0; i < actors.size(); i++) {
		const a = actors[i];
		if (a.kind === NO_KIND || a.alive === 0) continue;
		const dx = a.x - viewer.x;
		const dz = a.z - viewer.z;
		if (dx * dx + dz * dz > r2) continue;
		const kind = sightingOfKind(a.kind);
		if (kind !== undefined) found.add(kind);
		const slot = affixSlotAt(state, i, a);
		const affix = slot !== undefined ? affixSighting(slot.affix) : undefined;
		if (affix !== undefined) found.add(affix);
	}
	const power = livePowerPellet(state);
	const pellets = state.pellets;
	if (power >= 0 && pellets !== undefined) {
		const dx = pellets.x[power] - viewer.x;
		const dz = pellets.z[power] - viewer.z;
		if (dx * dx + dz * dz <= r2) found.add(POWER_PELLET_SIGHTING);
	}
	for (const id of SIGHTING_IDS) if (found.has(id)) out.push(id);
	return out;
}

/**
 * `out` (sightingsInView's canonical list) plus GOLDEN_RUMOUR_SIGHTING when `heard` (this floor's first rumour cue has
 * played) and it is not listed yet; returns `out`. GOLDEN_RUMOUR_SIGHTING is SIGHTING_IDS' last id: the order holds.
 */
export function withRumourSighting(out: string[], heard: boolean): string[] {
	if (heard && !out.includes(GOLDEN_RUMOUR_SIGHTING)) out.push(GOLDEN_RUMOUR_SIGHTING);
	return out;
}

/** The seen set, the queue of new sightings and the one-toast-at-a-time clock (see the file comment). */
export class SightingQueue {
	private loaded = false;
	private readonly seen = new Set<string>();
	private readonly queued = new Array<string>();
	/** os.clock() before which no next toast starts. */
	private readyAt = -math.huge;

	/** An onboarding status (join load, a request's answer, after a tutorial finish): learn what the account has seen. */
	receive(status: Readonly<OnboardingStatus>): void {
		if (status.loaded) this.loaded = true;
		const seen = status.seen;
		if (seen === undefined) return;
		this.learn(seen);
	}

	/**
	 * More ids this account has seen, from another record (claude/codex-plan.md CX6: a seeded Codex doc's sightings,
	 * shared/view/codex codexSeenSightings), unioned into the seen set; queued ones drop. Does not mark the queue loaded.
	 */
	learn(ids: ReadonlyArray<string>): void {
		for (const id of ids) this.seen.add(id);
		// Drop queued ids the account turned out to have seen (another server, a late status).
		let i = 0;
		while (i < this.queued.size()) {
			if (this.seen.has(this.queued[i])) this.queued.remove(i);
			else i++;
		}
	}

	/** True once a loaded status arrived (until then nothing is queued). */
	isLoaded(): boolean {
		return this.loaded;
	}

	isSeen(id: string): boolean {
		return this.seen.has(id);
	}

	/** The ids waiting for their toast, oldest first (specs / debug; a copy). */
	pending(): string[] {
		return [...this.queued];
	}

	/** This frame's shown ids (sightingsInView): queues each one not seen and not queued yet. */
	observe(ids: ReadonlyArray<string>): void {
		if (!this.loaded) return;
		for (const id of ids) {
			if (!this.seen.has(id) && !this.queued.includes(id)) this.queued.push(id);
		}
	}

	/**
	 * The id whose toast starts now, or undefined: nothing queued, `canShow` false (the caller's gates: a draft open,
	 * paused, ...) or the previous toast and its gap are not over at `now` (seconds). The returned id is seen from now on.
	 */
	next(now: number, canShow: boolean): string | undefined {
		if (!canShow || this.queued.size() === 0 || now < this.readyAt) return undefined;
		const id = this.queued.remove(0)!;
		this.seen.add(id);
		this.readyAt = now + SIGHTING_VIEW.toastSeconds + SIGHTING_VIEW.gapSeconds;
		return id;
	}

	/**
	 * The card shows something else now (claude/codex-plan.md CX6: a codex toast through the sighting slot): true when
	 * `canShow` and the previous toast plus its gap are over at `now`; the slot is then taken (the next sighting waits a
	 * toast and a gap, as after one of its own). A queued sighting goes first: call `next` before this.
	 */
	claimSlot(now: number, canShow: boolean): boolean {
		if (!canShow || now < this.readyAt) return false;
		this.readyAt = now + SIGHTING_VIEW.toastSeconds + SIGHTING_VIEW.gapSeconds;
		return true;
	}

	/** A run ended: forget the queued ids that were never shown (they will be found again). */
	clear(): void {
		this.queued.clear();
	}
}
