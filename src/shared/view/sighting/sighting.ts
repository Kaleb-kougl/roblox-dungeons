/**
 * First sightings (docs/ENEMY_VARIANTS.md EV12, EVD10): which new enemies and affixes the watched view shows this frame,
 * and the queue that turns the ones this account has not seen yet into one toast at a time. Pure (no Roblox API):
 * the client's SightingController feeds it the run state, the onboarding status and the clock, shows the toast
 * (ToastPanel, theme string `bestiary.<id>`, shared/onboarding sightingStringKey) and reports the id (`bestiarySeen`).
 *
 *   - sightingsInView: every living actor within SIGHTING_VIEW.radius of the watched player (the view index: the
 *     spectated teammate after a co-op death) whose archetype has a sighting (ARCHETYPE_SIGHTINGS: `imp`, `slime` and
 *     `slime.small` (as `slime`), `summoner`) or who carries an affix (`affix.<id>` by shared/dungeon AffixKind). The
 *     ids come out in canonical order (shared/onboarding SIGHTING_IDS), each once.
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
import { SIGHTING_VIEW } from "./config";

/** Archetype id -> its sighting id (the archetypes a first sighting announces; a slimelet is an Ooze). */
export const ARCHETYPE_SIGHTINGS: ReadonlyMap<string, string> = new Map([
	["imp", "imp"],
	["slime", "slime"],
	["slime.small", "slime"],
	["summoner", "summoner"],
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
	for (const id of SIGHTING_IDS) if (found.has(id)) out.push(id);
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
		for (const id of seen) this.seen.add(id);
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

	/** A run ended: forget the queued ids that were never shown (they will be found again). */
	clear(): void {
		this.queued.clear();
	}
}
