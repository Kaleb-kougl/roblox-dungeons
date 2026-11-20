/**
 * The tutorial's guidance arrow logic (docs/TUTORIAL_ARROW.md §2; a Roblox-port feature, no web source): where the
 * floor chevron beside the player points, whether it shows, and its fade. The client's TutorialArrowController calls
 * `update()` once per rendered frame with the director's marker target, the floor's dungeon and the interpolated
 * player, and draws the returned view; the look (slide, transparency) is shared/view/hud `tutorialArrowLook`.
 *
 * Per frame:
 *   1. Path field (shared/dungeon pathField) to the target's tile, rebuilt only when that tile or the dungeon object
 *      (a floor change) changes; a moving boss target rebuilds at most every `arrowFieldSeconds`.
 *   2. Aim point: the target itself when the player's body has a clear straight walk to it (clearWalk, pits block),
 *      else the farthest tile of the next `arrowLookaheadTiles` of the path with a clear walk (string pulling: the
 *      next corner, not the next tile). Unreachable (the field has no path from the player's tile): the target in a
 *      straight line, and `unreachable` set for the client to warn once.
 *   3. Show rule: a target, farther than `arrowHideTiles` (path tiles; straight-line tiles when unreachable), and not
 *      (on screen and a clear walk). A change of the rule takes effect after holding `arrowHoldSeconds`; no target
 *      hides at once. Alpha fades toward the rule over `arrowFadeSeconds`.
 *   4. Heading: damped toward the aim heading the shortest way (`arrowTurnTau`); it snaps while the arrow is fully
 *      faded out (so the first shown frame, and the first frame after a floor change, point straight at the aim).
 *      Position: the player plus `arrowOrbitTiles` along the damped heading.
 *
 * Heading convention (shared/view markings.ts `heading`, the sim's patterns.ts): heading h <-> world XZ unit direction
 * (sin h, cos h); h = 0 is +Z, h = pi / 2 is +X; always in [-pi, pi). Units: world (sim) units = tiles, seconds.
 *
 * Pure (no Roblox services or Instances) and deterministic for an input sequence; never touches the sim. Steady state
 * (same target tile, same floor) allocates nothing: the view object and the path scratch are reused, so keep the
 * returned view for reading only (it is overwritten by the next update).
 *
 * @module
 */
import {
	clearWalk,
	pathAhead,
	pathDistance,
	pathField,
	walkBlocker,
	worldToGrid,
	type BulletBlocker,
	type Dungeon,
	type PathField,
} from "shared/dungeon";
import { PLAYER_RADIUS } from "shared/sim";
import { heading } from "shared/view";
import type { TutorialMarker } from "./director";
import type { TutorialMarkerKind } from "./steps";

const TAU = 2 * math.pi;
/** Aim points closer than this (squared world units) to the player give no heading: it keeps the last one. */
const AIM_EPS2 = 1e-12;

/**
 * The guide's tunables (seconds and tiles; docs/TUTORIAL_ARROW.md §3). shared/view/hud TUTORIAL_VIEW has them all:
 * the client passes `new TutorialGuide(TUTORIAL_VIEW)`.
 */
export interface GuideTuning {
	/** The arrow's distance from the player's feet along its heading (tiles). */
	readonly arrowOrbitTiles: number;
	/** Hidden at or under this path distance to the target (BFS tiles). */
	readonly arrowHideTiles: number;
	/** Tiles of the path ahead searched for the farthest clear aim point. */
	readonly arrowLookaheadTiles: number;
	/** A boss target's field is rebuilt at most this often (seconds). */
	readonly arrowFieldSeconds: number;
	/** Heading damping time constant (seconds; 0 = no damping). */
	readonly arrowTurnTau: number;
	/** Alpha 0 <-> 1 over this long (seconds; 0 = instant). */
	readonly arrowFadeSeconds: number;
	/** A show-rule change takes effect after holding this long (seconds). */
	readonly arrowHoldSeconds: number;
}

/** One rendered frame, as the guide sees it. */
export interface GuideInput {
	/** The current floor's dungeon (the client: SimController's context; the same object for the whole floor). */
	readonly dungeon: Dungeon;
	/** The director's marker target (TutorialView.marker), or undefined for none. */
	readonly target: TutorialMarker | undefined;
	/** The player's interpolated world XZ (lerp(prev, cur, alpha)). */
	readonly px: number;
	readonly pz: number;
	/** The target's floor point is inside the inset viewport and in front of the camera (client: arrowScreenInset). */
	readonly targetOnScreen: boolean;
	/** Real seconds since the previous frame. */
	readonly dt: number;
}

/** What the arrow draws. Reused and overwritten by every update(). */
export interface GuideView {
	/** alpha > 0: draw it. */
	visible: boolean;
	/** Fade, 0 (hidden) .. 1 (fully shown). */
	alpha: number;
	/** The damped heading (see the file comment's convention), radians in [-pi, pi). */
	heading: number;
	/** Where the arrow's centre lies (world XZ): the player plus arrowOrbitTiles along `heading`. */
	x: number;
	z: number;
	/** The point it is turning toward this frame (world XZ): the target, or the farthest clear tile of the path. */
	aimX: number;
	aimZ: number;
	/** Path distance (BFS tiles) from the player's tile to the target; math.huge without a target or a path. */
	pathTiles: number;
	/** There is a target but no path to it from the player's tile (straight-line heading; the client warns once). */
	unreachable: boolean;
}

/** `a` wrapped into [-pi, pi). */
function wrapAngle(a: number): number {
	return a - TAU * math.floor((a + math.pi) / TAU);
}

/** The guidance arrow's state machine (see the file comment). One per tutorial run; `update()` once per frame. */
export class TutorialGuide {
	private readonly view: GuideView = {
		visible: false,
		alpha: 0,
		heading: 0,
		x: 0,
		z: 0,
		aimX: 0,
		aimZ: 0,
		pathTiles: math.huge,
		unreachable: false,
	};
	private dungeon: Dungeon | undefined;
	private blocked: BulletBlocker | undefined;
	private field: PathField | undefined;
	private fieldGx = 0;
	private fieldGy = 0;
	private fieldKind: TutorialMarkerKind | undefined;
	/** Seconds since the field was built. */
	private fieldAge = 0;
	private builds = 0;
	/** The held show rule (what alpha fades toward). */
	private shown = false;
	/** How long the raw rule has disagreed with `shown` (seconds). */
	private held = 0;
	/** pathAhead scratch (x, z pairs), reused every frame. */
	private readonly ahead: number[] = [];

	/**
	 * @param tuning the tunables (TUTORIAL_VIEW)
	 * @param bodyRadius the walker's radius for clearWalk (world units; the player's)
	 */
	constructor(private readonly tuning: GuideTuning, private readonly bodyRadius: number = PLAYER_RADIUS) {}

	/** The current view (the same object update() returns). */
	getView(): Readonly<GuideView> {
		return this.view;
	}

	/** Path fields built so far (diagnostics and specs: one per target tile, throttled for the boss). */
	fieldBuildCount(): number {
		return this.builds;
	}

	/** Advances one frame (see the file comment) and returns the reused view. */
	update(input: GuideInput): Readonly<GuideView> {
		const v = this.view;
		const tu = this.tuning;
		const dt = math.max(input.dt, 0);
		const d = input.dungeon;
		const target = input.target;
		const px = input.px;
		const pz = input.pz;
		if (d !== this.dungeon) {
			// A new floor: forget the old field and start hidden (the heading snaps when it next shows).
			this.dungeon = d;
			this.blocked = walkBlocker(d);
			this.field = undefined;
			this.shown = false;
			this.held = 0;
			v.alpha = 0;
		}
		this.fieldAge += dt;
		let aimX = px;
		let aimZ = pz;
		v.unreachable = false;
		if (target === undefined) {
			// Nothing to point at: fade out now (no hold), keeping the last heading.
			v.pathTiles = math.huge;
			this.shown = false;
			this.held = 0;
		} else {
			const f = this.fieldFor(d, target);
			const blocked = this.blocked!;
			const r = this.bodyRadius;
			const path = pathDistance(f, px, pz);
			const clear = clearWalk(blocked, px, pz, target.x, target.z, r);
			aimX = target.x;
			aimZ = target.z;
			let distance = path;
			if (path === math.huge) {
				v.unreachable = true;
				const dx = target.x - px;
				const dz = target.z - pz;
				distance = math.sqrt(dx * dx + dz * dz);
			} else if (!clear) {
				const ahead = this.ahead;
				const n = pathAhead(f, px, pz, tu.arrowLookaheadTiles, ahead);
				if (n > 0) {
					aimX = ahead[0];
					aimZ = ahead[1];
				}
				for (let k = n - 1; k >= 0; k--) {
					if (clearWalk(blocked, px, pz, ahead[2 * k], ahead[2 * k + 1], r)) {
						aimX = ahead[2 * k];
						aimZ = ahead[2 * k + 1];
						break;
					}
				}
			}
			v.pathTiles = path;
			const want = distance > tu.arrowHideTiles && !(input.targetOnScreen && clear);
			if (want !== this.shown) {
				this.held += dt;
				if (this.held >= tu.arrowHoldSeconds) {
					this.shown = want;
					this.held = 0;
				}
			} else {
				this.held = 0;
			}
		}
		const wasHidden = v.alpha <= 0;
		const fade = tu.arrowFadeSeconds > 0 ? dt / tu.arrowFadeSeconds : 1;
		v.alpha = this.shown ? math.min(1, v.alpha + fade) : math.max(0, v.alpha - fade);
		v.visible = v.alpha > 0;
		v.aimX = aimX;
		v.aimZ = aimZ;
		const dx = aimX - px;
		const dz = aimZ - pz;
		if (dx * dx + dz * dz > AIM_EPS2) {
			const aim = heading(dx, dz);
			if (wasHidden || tu.arrowTurnTau <= 0) {
				v.heading = wrapAngle(aim);
			} else {
				const k = 1 - math.exp(-dt / tu.arrowTurnTau);
				v.heading = wrapAngle(v.heading + wrapAngle(aim - v.heading) * k);
			}
		}
		v.x = px + math.sin(v.heading) * tu.arrowOrbitTiles;
		v.z = pz + math.cos(v.heading) * tu.arrowOrbitTiles;
		return v;
	}

	/** The field to `target`'s tile: kept while the tile is the same; a boss's rebuilt at most every arrowFieldSeconds. */
	private fieldFor(d: Dungeon, target: TutorialMarker): PathField {
		const gx = worldToGrid(target.x);
		const gy = worldToGrid(target.z);
		const f = this.field;
		if (f !== undefined) {
			if (gx === this.fieldGx && gy === this.fieldGy) return f;
			const moving = target.kind === "boss" && this.fieldKind === "boss";
			if (moving && this.fieldAge < this.tuning.arrowFieldSeconds) return f;
		}
		const built = pathField(d, target.x, target.z);
		this.field = built;
		this.fieldGx = gx;
		this.fieldGy = gy;
		this.fieldKind = target.kind;
		this.fieldAge = 0;
		this.builds++;
		return built;
	}
}
