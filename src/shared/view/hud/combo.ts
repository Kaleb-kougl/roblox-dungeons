/**
 * The combo's per-frame display state machine and the floor shout's bullet test (docs/COMBO.md CB2), pure. The
 * client's ComboController (CB7) calls `ComboDisplay.frame(input)` once per rendered frame with the live score state
 * (state.score combo / comboTimer, comboWindowTicks) and the frame's combo events (shared/view/fx ComboEvents, CB1),
 * then draws the returned `ComboDisplayFrame` (COMBO_UI bindings, CB6) and plays its one-frame edges (the sting, the
 * shatter, the camera kick, the floor shout).
 *
 * The rules it implements (docs/COMBO.md "Player experience", CD3 - CD9, CD14):
 *   - every feed (a kill or graze on the frame) pops the multiplier from its tier's popScale (`multScale`);
 *   - a frame whose peak reaches a higher tier than its start raises ONE `tierUp` edge for the highest new tier,
 *     slams the tier name in (`slotScale`, the tier slot's own scale: the name is what slams, the multiplier keeps its
 *     pop) and flashes the meter white; re-earning a tier after a cut plays it again (it is judged per frame from the
 *     frame's own start and peak, never from a "best tier so far");
 *   - a cut (a landed hit that cut the combo) raises `cut`, flashes the meter uiHealth, shakes the row and drops a
 *     `-xN.N` (the frame's total cut); a cut across a tier down fades the old name out and the lower one in. Only a
 *     real loss is a crack: cuts whose total is <= 0 (a hit at x1.0, a kill and a hit on one tick that net nothing)
 *     show nothing (the collector already records only a tick that ended below its start; this is a second guard);
 *   - a reset (`ended`) during a fight is a break: grey, the lost value struck through, COMBO LOST, the WHOLE meter
 *     track shatters in the lost tier's colour (the fill is empty by then: a break is the timer reaching 0) and stays
 *     grey, and the camera kicks (a small break, lost < x2.0, has no shards or kick); with no fight on it is a lapse:
 *     the empty track and the multiplier fade to grey and BEST xN.N shows; either ends at once when a new streak
 *     starts (combo above x1.0);
 *   - reduced motion: no pop, slam, shake, shards or kick; the warning blink is a steady dim; colours, names, the
 *     struck value, fades and every edge (so every sound) stay;
 *   - `covered` (the stage cover is up): no edges and no transient visuals (running ones are dropped), just the plain
 *     state, so the reveal shows the result; `runOver`: no tier up, break or lapse (the run-over panel takes it). The
 *     audio mapper's sting and break follow the same two gates (shared/view/fx comboQuiet / audibleCombo).
 *
 * The events are read through a LOCAL structural interface (`ComboDisplayEvents`, the subset of CB1's
 * `ComboFrameSource` this reads), so this compiles on its own; a `ComboFrameSource` passes as is.
 */
import { COMBO_MIN, TILE_SIZE } from "shared/sim";
import { easeOutBack } from "shared/view/fx";
import {
	COMBO_BROKEN_ROLE,
	COMBO_FLASH_ROLES,
	COMBO_SHOUT,
	COMBO_TIERS,
	COMBO_VIEW,
	type ComboFlashRole,
	comboTier,
} from "./comboConfig";

/** One tick's hit cut, tenths (CB1 ComboCut). */
export interface ComboDisplayCut {
	readonly before: number;
	readonly after: number;
}

/** The streak ended (CB1 ComboReset). */
export interface ComboDisplayReset {
	/** Tenths the combo had at the start of the reset tick (> COMBO_MIN). */
	readonly lost: number;
	/** Highest combo of the streak that ended (tenths, >= lost). */
	readonly peak: number;
	/** A fight was on at the reset tick (shared/view fightOn): a break, else a lapse (CD3). */
	readonly fight: boolean;
}

/** What the display reads of the frame's combo events (a structural subset of CB1's ComboFrameSource). */
export interface ComboDisplayEvents {
	/** Combo before the frame's first tick (tenths). */
	readonly startCombo: number;
	/** Combo after the frame's last tick. */
	readonly endCombo: number;
	/** Highest combo at the end of any of the frame's ticks (>= startCombo, endCombo). */
	readonly peak: number;
	readonly kills: number;
	readonly grazes: number;
	/** Ticks that cut the combo, in order. */
	readonly cuts: ReadonlyArray<ComboDisplayCut>;
	/** The frame's last streak end. */
	readonly ended: ComboDisplayReset | undefined;
}

/** One frame's input. */
export interface ComboDisplayInput {
	/** Real seconds since the last frame (clamped to COMBO_VIEW.maxFrameDtSec). */
	readonly dt: number;
	/** The live combo (state.score.combo, tenths) at the frame's end. */
	readonly combo: number;
	/** state.score.comboTimer (ticks left) at the frame's end. */
	readonly comboTimer: number;
	/** The window the timer refills to (shared/sim comboWindowTicks). */
	readonly windowTicks: number;
	readonly events: ComboDisplayEvents;
	/** The stage cover is up (StageController). */
	readonly covered: boolean;
	/** The run is over (the run-over panel shows). */
	readonly runOver: boolean;
	/** The effective reduced-motion setting. */
	readonly reducedMotion: boolean;
	/** The Screen shake setting (the kick also needs reduced motion off). */
	readonly screenShake: boolean;
}

/** What the combo row's slot shows: the tier name, COMBO LOST, BEST xN.N, or nothing. */
export type ComboSlot = "tier" | "lost" | "best" | "none";
/** The break edge: none, a full break (shatter, shards, kick) or a small one (CD14, half volume). */
export type ComboBreakKind = "none" | "break" | "small";

/** The display's output. One object, reused every frame: read it, never keep it. */
export interface ComboDisplayFrame {
	/** The live tier (comboTier of the live combo). */
	tier: number;
	/**
	 * Colour role of the meter fill and the multiplier. Draw lerp(role, COMBO_BROKEN_ROLE, greyMix): a break is
	 * COMBO_BROKEN_ROLE at once; a lapse fades from the lost tier's role to grey over COMBO_VIEW.lapse.greySec.
	 */
	role: string;
	greyMix: number;
	/**
	 * The meter TRACK (its empty background): draw lerp(its uiPanel, COMBO_BROKEN_ROLE, trackGrey). 1 while a break
	 * shows (the shards fly over a grey track), the lapse's fade (0 -> 1 over COMBO_VIEW.lapse.greySec) while a lapse
	 * shows, else 0.
	 */
	trackGrey: number;
	/** The multiplier to show (tenths): the lost value while a break shows, else the live combo. */
	tenths: number;
	/** Draw the multiplier struck through (a break). */
	struck: boolean;
	slot: ComboSlot;
	/** slot "tier": the tier whose name shows (COMBO_TIERS[slotTier].nameKey; it can lag `tier` while fading). */
	slotTier: number;
	/** slot "best": the streak's peak (tenths). */
	slotTenths: number;
	/** The slot's opacity (a tier-down name fade), 0..1. */
	slotAlpha: number;
	/** The tier slot's UIScale: the tier-up slam (COMBO_VIEW.slam, 1.6 -> 1), else 1. 1 under reduced motion. */
	slotScale: number;
	/** The multiplier's UIScale: the feed pop (the tier's popScale -> 1), else 1. 1 under reduced motion. */
	multScale: number;
	/** The row's horizontal offset, reference px (the crack's shake). 0 under reduced motion. */
	shakePx: number;
	/** Meter fill 0..1 (comboTimer / windowTicks; 0 while a break or lapse shows). */
	fill: number;
	/** The meter's flash overlay: role and opacity (0 = none). */
	flashRole: ComboFlashRole;
	flashAlpha: number;
	/** The timer is in its last COMBO_VIEW.warnFraction. */
	warn: boolean;
	/** Draw the fill dimmed this frame (the 4 Hz blink; steady while warning under reduced motion). */
	dim: boolean;
	/** The meter's pulse: a fraction toward white, 0..COMBO_VIEW.pulse.amount. */
	pulse: number;
	/** The shine sweep's progress 0..1 across the row, or -1 (none). */
	shine: number;
	/**
	 * The shatter's progress 0..1, or -1 (none): COMBO_VIEW.break.shards pieces of the WHOLE meter track (never sized
	 * from the fill, which is empty at a break), in `shardRole`.
	 */
	shards: number;
	/** Colour role of the shards: the lost tier's (COMBO_TIERS[comboTier(lost)].role). */
	shardRole: string;
	/** The crack's `-xN.N`: the frame's total cut (tenths) and its drop / fade progress 0..1, or -1 (none). */
	dropTenths: number;
	dropProgress: number;
	// --- one-frame edges (the controller plays sounds / the shout / the kick from these) ---
	/** The tier reached this frame (0 = none): sfx.combo.tier at tierStingSpeed(tierUp) and the floor shout. */
	tierUp: number;
	/** A reset during a fight: sfx.combo.break (COMBO_VIEW.smallBreakVolume for "small"). */
	broke: ComboBreakKind;
	/** A reset with no fight on (no sound). */
	lapsed: boolean;
	/** A landed hit cut the combo (visual only, CD4). */
	cut: boolean;
	/** The comboBreak camera nudge (COMBO_VIEW.break.kickDelaySec after a full break; Screen shake on). */
	kick: boolean;
}

const IDLE = -1;
const FULL_TURN = 2 * math.pi;
/** The blink is on for one half of each cycle. */
const BLINK_HALVES = 2;

/** Progress of a timer `t` (seconds since it started) over `sec`: 0..1 while running, IDLE before / after. */
function progress(t: number, sec: number): number {
	if (t < 0 || t >= sec) return IDLE;
	return sec > 0 ? t / sec : 0;
}

function clamp01(u: number): number {
	return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** Advances a running timer (IDLE stays IDLE). */
function advance(t: number, d: number): number {
	return t >= 0 ? t + d : t;
}

/** Colour role of a tier (ember below x2). */
function tierRole(tier: number): string {
	return COMBO_TIERS[tier].role;
}

/** The combo row's state machine (see the file header). `frame` once per rendered frame; `clear` on a new run. */
export class ComboDisplay {
	readonly look: ComboDisplayFrame;
	/** Seconds since the shown tier last changed (pulse / shine clock). */
	private tierClock = 0;
	private shownTier = 0;
	private blinkT = 0;
	private popT = IDLE;
	private popFrom = 1;
	private slamT = IDLE;
	private flashT = IDLE;
	private flashSec = 0;
	private crackT = IDLE;
	private nameFadeT = IDLE;
	private nameFromTier = 0;
	private breakT = IDLE;
	private breakLost = COMBO_MIN;
	private breakRole = tierRole(0);
	private shardT = IDLE;
	private kickT = IDLE;
	private lapseT = IDLE;
	private lapseBest = COMBO_MIN;
	private lapseRole = tierRole(0);

	constructor() {
		this.look = {
			tier: 0,
			role: tierRole(0),
			greyMix: 0,
			trackGrey: 0,
			tenths: COMBO_MIN,
			struck: false,
			slot: "none",
			slotTier: 0,
			slotTenths: COMBO_MIN,
			slotAlpha: 1,
			slotScale: 1,
			multScale: 1,
			shakePx: 0,
			fill: 0,
			flashRole: COMBO_FLASH_ROLES.tierUp,
			flashAlpha: 0,
			warn: false,
			dim: false,
			pulse: 0,
			shine: IDLE,
			shards: IDLE,
			shardRole: tierRole(0),
			dropTenths: 0,
			dropProgress: IDLE,
			tierUp: 0,
			broke: "none",
			lapsed: false,
			cut: false,
			kick: false,
		};
	}

	/** A new run: drop every timer and edge. */
	clear(): void {
		this.dropTransients();
		this.tierClock = 0;
		this.shownTier = 0;
		this.blinkT = 0;
		this.clearEdges();
	}

	frame(input: ComboDisplayInput): ComboDisplayFrame {
		const d = math.clamp(input.dt, 0, COMBO_VIEW.maxFrameDtSec);
		const motion = !input.reducedMotion;
		this.clearEdges();
		this.advanceTimers(d);
		if (input.covered) this.dropTransients();
		else this.readEvents(input, motion);
		if (input.runOver) {
			this.breakT = IDLE;
			this.lapseT = IDLE;
			this.shardT = IDLE;
			this.kickT = IDLE;
		}
		this.write(input, d, motion);
		return this.look;
	}

	private clearEdges(): void {
		const L = this.look;
		L.tierUp = 0;
		L.broke = "none";
		L.lapsed = false;
		L.cut = false;
		L.kick = false;
	}

	private dropTransients(): void {
		this.popT = IDLE;
		this.slamT = IDLE;
		this.flashT = IDLE;
		this.crackT = IDLE;
		this.nameFadeT = IDLE;
		this.breakT = IDLE;
		this.shardT = IDLE;
		this.kickT = IDLE;
		this.lapseT = IDLE;
	}

	private advanceTimers(d: number): void {
		this.popT = advance(this.popT, d);
		this.slamT = advance(this.slamT, d);
		this.flashT = advance(this.flashT, d);
		this.crackT = advance(this.crackT, d);
		this.nameFadeT = advance(this.nameFadeT, d);
		this.breakT = advance(this.breakT, d);
		this.shardT = advance(this.shardT, d);
		this.kickT = advance(this.kickT, d);
		this.lapseT = advance(this.lapseT, d);
	}

	private readEvents(input: ComboDisplayInput, motion: boolean): void {
		const ev = input.events;
		const L = this.look;
		if (ev.kills + ev.grazes > 0 && motion) {
			this.popT = 0;
			this.popFrom = COMBO_TIERS[comboTier(ev.endCombo)].popScale;
		}
		const peakTier = comboTier(ev.peak);
		if (peakTier > comboTier(ev.startCombo) && !input.runOver) {
			L.tierUp = peakTier;
			if (motion) this.slamT = 0;
			this.startFlash(COMBO_FLASH_ROLES.tierUp, COMBO_VIEW.tierFlashSec);
			this.nameFadeT = IDLE;
		}
		const cuts = ev.cuts;
		let lost = 0;
		for (const c of cuts) lost += c.before - c.after;
		// Only a real loss is a crack (a hit at x1.0, or a kill and a hit netting nothing, shows nothing).
		if (lost > 0) {
			L.cut = true;
			L.dropTenths = lost;
			this.crackT = 0;
			this.startFlash(COMBO_FLASH_ROLES.crack, COMBO_VIEW.crack.flashSec);
			const before = this.shownTier;
			if (comboTier(input.combo) < before) {
				this.nameFadeT = 0;
				this.nameFromTier = before;
			}
		}
		const ended = ev.ended;
		if (ended !== undefined && !input.runOver) {
			if (ended.fight) {
				const small = ended.lost < COMBO_VIEW.smallBreakBelow;
				L.broke = small ? "small" : "break";
				this.breakT = 0;
				this.breakLost = ended.lost;
				this.breakRole = tierRole(comboTier(ended.lost));
				this.lapseT = IDLE;
				if (!small && motion) {
					this.shardT = 0;
					if (input.screenShake) this.kickT = 0;
				}
			} else {
				L.lapsed = true;
				this.lapseT = 0;
				this.lapseBest = ended.peak;
				this.lapseRole = tierRole(comboTier(ended.lost));
				this.breakT = IDLE;
			}
		}
		if (this.kickT >= COMBO_VIEW.break.kickDelaySec) {
			L.kick = true;
			this.kickT = IDLE;
		}
	}

	private startFlash(role: ComboFlashRole, sec: number): void {
		this.look.flashRole = role;
		this.flashT = 0;
		this.flashSec = sec;
	}

	private write(input: ComboDisplayInput, d: number, motion: boolean): void {
		const L = this.look;
		const combo = input.combo;
		const tier = comboTier(combo);
		if (tier !== this.shownTier) {
			this.shownTier = tier;
			this.tierClock = 0;
		} else this.tierClock += d;
		L.tier = tier;

		// A new streak (combo above x1.0) ends a showing break or lapse at once.
		const quiet = combo <= COMBO_MIN;
		const breaking = quiet && progress(this.breakT, COMBO_VIEW.break.sec) >= 0;
		const lapseU = quiet ? progress(this.lapseT, COMBO_VIEW.lapse.bestSec) : IDLE;
		if (!breaking) this.breakT = IDLE;
		if (lapseU < 0) this.lapseT = IDLE;

		const live = input.windowTicks > 0 ? clamp01(input.comboTimer / input.windowTicks) : 0;
		L.struck = false;
		L.slotAlpha = 1;
		L.slotTier = tier;
		L.pulse = 0;
		L.shine = IDLE;
		L.warn = false;
		if (breaking) {
			L.role = COMBO_BROKEN_ROLE;
			L.greyMix = 1;
			L.tenths = this.breakLost;
			L.struck = true;
			L.slot = "lost";
			L.fill = 0;
			L.trackGrey = 1;
		} else if (lapseU >= 0) {
			// The fill is empty (the timer ran out): the track and the multiplier fade to grey.
			const grey = clamp01(this.lapseT / COMBO_VIEW.lapse.greySec);
			L.role = grey >= 1 ? COMBO_BROKEN_ROLE : this.lapseRole;
			L.greyMix = grey;
			L.trackGrey = grey;
			L.tenths = combo;
			L.slot = "best";
			L.slotTenths = this.lapseBest;
			L.fill = 0;
		} else {
			L.role = tierRole(tier);
			L.greyMix = 0;
			L.trackGrey = 0;
			L.tenths = combo;
			L.fill = live;
			L.warn = combo > COMBO_MIN && input.comboTimer > 0 && live <= COMBO_VIEW.warnFraction;
			this.writeSlot(tier);
			this.writeTierExtras(tier);
		}

		if (L.warn) this.blinkT += d;
		else this.blinkT = 0;
		const half = math.floor(this.blinkT * COMBO_VIEW.blinkHz * BLINK_HALVES) % BLINK_HALVES === 1;
		L.dim = L.warn && (!motion || half);

		this.writeMotion(motion);

		const flashU = progress(this.flashT, this.flashSec);
		L.flashAlpha = flashU >= 0 ? 1 - flashU : 0;
		L.dropProgress = progress(this.crackT, COMBO_VIEW.crack.dropSec);
		L.shards = progress(this.shardT, COMBO_VIEW.break.shardSec);
		L.shardRole = this.breakRole;
	}

	/** The tier slot: the name, fading out the old one and in the lower one after a tier-down cut. */
	private writeSlot(tier: number): void {
		const L = this.look;
		const fadeU = progress(this.nameFadeT, COMBO_VIEW.crack.nameFadeSec);
		if (fadeU >= 0) {
			const firstHalf = fadeU < 1 / 2;
			L.slotTier = firstHalf ? this.nameFromTier : tier;
			L.slotAlpha = firstHalf ? 1 - 2 * fadeU : 2 * fadeU - 1;
		}
		L.slot = L.slotTier > 0 ? "tier" : "none";
	}

	/** CARNAGE / DOMINATING's pulse and UNSTOPPABLE's shine (colour and light, kept under reduced motion). */
	private writeTierExtras(tier: number): void {
		const L = this.look;
		const def = COMBO_TIERS[tier];
		if (def.pulseHz > 0)
			L.pulse = COMBO_VIEW.pulse.amount * (1 - math.cos(FULL_TURN * def.pulseHz * this.tierClock)) * (1 / 2);
		if (def.shine) {
			const S = COMBO_VIEW.shine;
			const phase = this.tierClock % S.periodSec;
			L.shine = phase < S.sweepSec ? phase / S.sweepSec : IDLE;
		}
	}

	/** The tier slot's slam, the multiplier's pop and the crack's shake; none under reduced motion. */
	private writeMotion(motion: boolean): void {
		const L = this.look;
		L.slotScale = 1;
		L.multScale = 1;
		L.shakePx = 0;
		if (!motion) return;
		const slamU = progress(this.slamT, COMBO_VIEW.slam.sec);
		const popU = progress(this.popT, COMBO_VIEW.pop.sec);
		if (slamU >= 0) {
			const from = COMBO_VIEW.slam.fromScale;
			L.slotScale = from + (1 - from) * easeOutBack(slamU);
		}
		if (popU >= 0) L.multScale = this.popFrom + (1 - this.popFrom) * popU;
		const C = COMBO_VIEW.crack;
		const shakeU = progress(this.crackT, C.shakeSec);
		if (shakeU >= 0) L.shakePx = C.shakePx * math.sin(FULL_TURN * C.shakeCycles * shakeU);
	}
}

/**
 * What shoutDucked reads of a bullet pool: shared/sim's `BulletSimulation` (state.combat.enemyBullets) fits as is.
 * The test walks slots 0 .. highWater() - 1 and reads positionAt only for visible slots, exactly like
 * HudOcclusionController and BulletRenderController: no allocation, one pass.
 */
export interface ShoutBullets {
	highWater(): number;
	isVisible(i: number): boolean;
	positionAt(i: number): Readonly<{ x: number; z: number }>;
}

/**
 * The floor shout's box in sim floor units (x, z; TILE_SIZE per tile): its centre, the unit floor vector it reads
 * along (screen-right on the floor for the camera's yaw, shared/view isoBasis) and its half extents along that axis
 * and across it (up-screen). The controller keeps one and refills it each frame (shoutBoxAt).
 */
export interface ShoutBox {
	x: number;
	z: number;
	rightX: number;
	rightZ: number;
	halfWidth: number;
	halfDepth: number;
}

/** Fills `out` for a shout centred at (x, z) reading along the unit vector (rightX, rightZ); sizes from COMBO_SHOUT. */
export function shoutBoxAt(out: ShoutBox, x: number, z: number, rightX: number, rightZ: number): ShoutBox {
	out.x = x;
	out.z = z;
	out.rightX = rightX;
	out.rightZ = rightZ;
	out.halfWidth = (COMBO_SHOUT.widthTiles * TILE_SIZE) / 2;
	out.halfDepth = (COMBO_SHOUT.depthTiles * TILE_SIZE) / 2;
	return out;
}

/**
 * CD9: true when any visible bullet of `bullets` (pass the ENEMY pool: player bullets never duck the shout) lies inside
 * `box` grown by `margin` (sim units, default COMBO_SHOUT.duckMarginTiles) on every side; a bullet exactly on the
 * grown edge counts as inside. Stops at the first hit. Only the floor position (x, z) matters: the shout is on the
 * floor and the camera looks down at it.
 */
export function shoutDucked(
	box: Readonly<ShoutBox>,
	bullets: ShoutBullets,
	margin: number = COMBO_SHOUT.duckMarginTiles * TILE_SIZE,
): boolean {
	const halfW = box.halfWidth + margin;
	const halfD = box.halfDepth + margin;
	const n = bullets.highWater();
	for (let i = 0; i < n; i++) {
		if (!bullets.isVisible(i)) continue;
		const p = bullets.positionAt(i);
		const dx = p.x - box.x;
		const dz = p.z - box.z;
		const along = dx * box.rightX + dz * box.rightZ;
		const across = dz * box.rightX - dx * box.rightZ;
		if (math.abs(along) <= halfW && math.abs(across) <= halfD) return true;
	}
	return false;
}
