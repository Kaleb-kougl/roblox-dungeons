/**
 * The SYNC! callout's timeline (docs/RUN_RECAP.md CM5, B2), pure: TEAM_MOMENTS_VIEW.callout / tether. One at a time; a
 * new or grown sync restarts it; the text pops in (not under reduced motion) and fades out; the tether (tethered syncs
 * only) snaps from wide to thin (reduced motion: no snap, the thin bar) and fades. The client's SyncCalloutController
 * draws it on the combo shout's construction (shared/view/hud syncCallout.ts: label, size). Presentation only.
 */
import { MAX_PARTY_SIZE } from "shared/sim";
import type { SyncParryMoment } from "./teamMoments";
import { TEAM_MOMENTS_VIEW } from "./teamMomentsConfig";

function clamp01(u: number): number {
	return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** The SYNC! text's pop-in factor at `ageSec`: popScale -> 1 over popSec, eased out; 1 afterwards and under reduced motion. */
export function syncCalloutPop(ageSec: number, reducedMotion: boolean): number {
	const c = TEAM_MOMENTS_VIEW.callout;
	if (reducedMotion || ageSec >= c.popSec) return 1;
	const u = clamp01(ageSec / c.popSec);
	const eased = 1 - (1 - u) * (1 - u);
	return c.popScale + (1 - c.popScale) * eased;
}

/** The SYNC! text's opacity factor at `ageSec`: 1, then linearly to 0 over the last fadeSec of its life. */
export function syncCalloutFade(ageSec: number): number {
	const c = TEAM_MOMENTS_VIEW.callout;
	const left = c.sec - ageSec;
	if (left >= c.fadeSec) return 1;
	return left <= 0 ? 0 : left / c.fadeSec;
}

/** The tether's opacity factor at `ageSec` (0 once over): 1, then linearly to 0 over its last fadeSec. */
export function syncTetherFade(ageSec: number): number {
	const t = TEAM_MOMENTS_VIEW.tether;
	const left = t.sec - ageSec;
	if (left <= 0) return 0;
	return left >= t.fadeSec ? 1 : left / t.fadeSec;
}

/** The tether's width in tiles at `ageSec`: flashWidthTiles -> widthTiles over snapSec (eased out); thin under reduced motion. */
export function syncTetherWidth(ageSec: number, reducedMotion: boolean): number {
	const t = TEAM_MOMENTS_VIEW.tether;
	if (reducedMotion || ageSec >= t.snapSec) return t.widthTiles;
	const u = clamp01(ageSec / t.snapSec);
	const eased = 1 - (1 - u) * (1 - u);
	return t.flashWidthTiles + (t.widthTiles - t.flashWidthTiles) * eased;
}

/** A floor point (sim units). */
export interface SyncCalloutPoint {
	x: number;
	z: number;
}

/** The SYNC! callout this frame. Mutable, reused. */
export interface SyncCalloutLook {
	/** A callout shows. */
	active: boolean;
	/** It (re)started this frame (a new or grown sync): the controller resets its ducks. */
	isNew: boolean;
	/** The sync's id (SyncParryMoment.id). */
	id: number;
	/** Distinct players (2: "SYNC!", 3+: "SYNC x{n}"). */
	count: number;
	/** One text at `mid` and a tether (true), or a small text at each point (false). */
	tethered: boolean;
	/** The points' mean. */
	readonly mid: SyncCalloutPoint;
	/** The parry points (join order), `pointCount` of them. */
	readonly points: SyncCalloutPoint[];
	pointCount: number;
	ageSec: number;
	/** Text pop (syncCalloutPop) and fade (syncCalloutFade); the controller multiplies its cap and duck. */
	pop: number;
	fade: number;
	/** The tether shows (tethered and not yet over). */
	tetherOn: boolean;
	/** Tether opacity factor (syncTetherFade, before TEAM_MOMENTS_VIEW.tether.maxOpacity) and width (tiles). */
	tetherFade: number;
	tetherWidthTiles: number;
}

/**
 * The SYNC! callout's timeline (CM5): `show` each sync record of the frame (a new one, or a grown one: it restarts with
 * the new count and points), then `frame(dt, reducedMotion)` once per rendered frame; `clear` drops it (quiet, a new
 * run, no run). One callout at a time: TeamMoments forms at most one sync per TEAM_MOMENTS.syncCooldownSec, longer than
 * the callout lives.
 */
export class SyncCallout {
	readonly look: SyncCalloutLook;
	private fresh = false;

	constructor() {
		const points: SyncCalloutPoint[] = [];
		for (let i = 0; i < MAX_PARTY_SIZE; i++) points.push({ x: 0, z: 0 });
		this.look = {
			active: false,
			isNew: false,
			id: 0,
			count: 0,
			tethered: false,
			mid: { x: 0, z: 0 },
			points,
			pointCount: 0,
			ageSec: 0,
			pop: 1,
			fade: 0,
			tetherOn: false,
			tetherFade: 0,
			tetherWidthTiles: 0,
		};
	}

	/** A sync record (copied; points past MAX_PARTY_SIZE are dropped). */
	show(m: Pick<SyncParryMoment, "id" | "count" | "tethered" | "midX" | "midZ" | "points">): void {
		const L = this.look;
		L.active = true;
		L.id = m.id;
		L.count = m.count;
		L.tethered = m.tethered;
		L.mid.x = m.midX;
		L.mid.z = m.midZ;
		const n = math.min(m.points.size(), MAX_PARTY_SIZE);
		for (let i = 0; i < n; i++) {
			L.points[i].x = m.points[i].x;
			L.points[i].z = m.points[i].z;
		}
		L.pointCount = n;
		L.ageSec = 0;
		this.fresh = true;
	}

	clear(): void {
		this.look.active = false;
		this.look.isNew = false;
		this.look.tetherOn = false;
		this.fresh = false;
	}

	/** Steps by `dt` real seconds (a fresh callout's first frame is age 0). */
	frame(dt: number, reducedMotion: boolean): SyncCalloutLook {
		const L = this.look;
		L.isNew = false;
		if (!L.active) return L;
		if (this.fresh) {
			this.fresh = false;
			L.isNew = true;
		} else L.ageSec += math.max(0, dt);
		if (L.ageSec >= TEAM_MOMENTS_VIEW.callout.sec) {
			this.clear();
			return L;
		}
		L.pop = syncCalloutPop(L.ageSec, reducedMotion);
		L.fade = syncCalloutFade(L.ageSec);
		L.tetherFade = L.tethered && L.pointCount >= 2 ? syncTetherFade(L.ageSec) : 0;
		L.tetherOn = L.tetherFade > 0;
		L.tetherWidthTiles = syncTetherWidth(L.ageSec, reducedMotion);
		return L;
	}
}
