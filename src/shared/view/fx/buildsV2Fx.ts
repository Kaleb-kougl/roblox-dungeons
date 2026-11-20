/**
 * Builds v2, wave 1 effects: what the wave 1 planners share (docs/BUILDS_V2.md Architecture 6, BV11).
 *
 *   - Time is SIM time: a record's age is (state.tick + alpha - record.tick) x SIM_DT (waveOneAgeSec), never negative;
 *     state.tick and the run view's alpha are what the bodies are drawn at (lerp(prev, cur, alpha)), so an effect born on
 *     a tick starts with the bodies of that tick, a pause, the draft and a freeze hold it, and a frame that ran several
 *     ticks (co-op catch-up, frame pacing) ages each record by its own tick.
 *   - Owners: every effect carries its owner and `mine` (owner = the view player, getViewPlayerIndex); a teammate's is
 *     drawn at BUILDS_V2_FX.teammateOpacity (ownerOpacity). Records of a player outside the party are ignored.
 *   - Floor text (COUNTER xN, PINNED, SLAM) is a FloorShoutRequest the client hands to ComboController.requestShout
 *     (the combo shout's construction: under every bullet, ducking near enemy bullets, CD9) with floorShoutText.
 *   - WaveOneRings: the ring planner the Ballista bursts, the slam's shock ring, the smash pops and the Demolition blasts
 *     use (one class, one output list per owner of it): radius r0 -> r1 eased out over its life (r1 throughout under
 *     reduced motion), fading over the last fadeShare, an optional fan (a facing and a half angle; pi: a full ring),
 *     capped per look (a new one past the cap replaces the oldest).
 *
 * No allocation in steady state (slots are reused). Presentation only.
 *
 * @module
 */
import { Boon, SIM_DT, buildLevel, type SimState } from "shared/sim";
import type { BuildFxLevel } from "shared/settings";
import type { ColorRole, StringVars } from "shared/theme";
import { buildFxCount, lifeFade, ringRadius } from "./buildFxRules";
import { BUILDS_V2_FX, type WaveOneRingBlock } from "./buildsV2FxConfig";

/** A full turn's half: a fan of this half angle is a full ring. */
export const FULL_RING_HALF_ANGLE = math.pi;

/** Sim seconds since `recordTick` at state tick `tick` and interpolation `alpha` (never negative). */
export function waveOneAgeSec(recordTick: number, tick: number, alpha: number): number {
	return math.max(0, (tick + alpha - recordTick) * SIM_DT);
}

/** An effect's opacity factor by owner: 1 for the view player's, BUILDS_V2_FX.teammateOpacity for a teammate's. */
export function ownerOpacity(owner: number, viewIndex: number): number {
	return owner === viewIndex ? 1 : BUILDS_V2_FX.teammateOpacity;
}

/** Player `player` owns Riposte (any level) in this run (false without builds or for an unknown index). */
export function isRiposteOwner(state: Readonly<SimState>, player: number): boolean {
	const p = state.builds?.players[player];
	return p !== undefined && buildLevel(p, Boon.RIPOSTE) > 0;
}

/**
 * One floor text for the combo shout's slot: the client calls ComboController.requestShout(floorShoutText(pack, r),
 * pack.color(r.role), r.lifeSec, r.priority). The view player's only (the text sits under the player the screen
 * follows).
 */
export interface FloorShoutRequest {
	/** Theme string key (capitals in the string; never upper-cased in code). */
	readonly key: string;
	/** The string's vars (COUNTER's `n`), or undefined. */
	readonly vars: StringVars | undefined;
	readonly role: ColorRole;
	readonly lifeSec: number;
	/** FLOOR_SHOUT_PRIORITY's entry. */
	readonly priority: number;
	/** Whose effect asked for it. */
	readonly player: number;
}

/** What floorShoutText reads of a theme pack (ThemePack fits as is). */
export interface FloorShoutStrings {
	str(key: string, vars?: StringVars): string;
}

/** The request's text. */
export function floorShoutText(strings: FloorShoutStrings, r: Readonly<FloorShoutRequest>): string {
	return strings.str(r.key, r.vars);
}

/** One live wave 1 floor ring (a Ballista burst, the slam's shock ring, a smash pop, a Demolition blast). */
export interface WaveOneRingView {
	readonly x: number;
	readonly z: number;
	/** Current radius, sim units (tiles). */
	readonly radius: number;
	/** Opacity factor: life fade x ownerOpacity. */
	readonly fade: number;
	readonly role: ColorRole;
	/** Segments to draw (a fan's share of the full ring's; Reduced: buildFxCount). */
	readonly segments: number;
	/** Its drawing block (thickness, width, lift). */
	readonly block: Readonly<WaveOneRingBlock>;
	/** The fan's facing (unit) and half angle; FULL_RING_HALF_ANGLE: a full ring (the facing is then unused). */
	readonly dirX: number;
	readonly dirZ: number;
	readonly halfAngleRad: number;
	readonly owner: number;
	readonly mine: boolean;
	readonly ageSec: number;
}

interface RingSlot {
	x: number;
	z: number;
	radius: number;
	fade: number;
	role: ColorRole;
	segments: number;
	block: Readonly<WaveOneRingBlock>;
	dirX: number;
	dirZ: number;
	halfAngleRad: number;
	owner: number;
	mine: boolean;
	ageSec: number;
	r1: number;
	bornTick: number;
}

/** The segments of a fan of `halfAngleRad` on a ring of `segments` (its share, at least 1 when segments > 0). */
export function fanSegments(segments: number, halfAngleRad: number): number {
	if (segments <= 0) return 0;
	if (halfAngleRad >= FULL_RING_HALF_ANGLE) return segments;
	return math.max(1, math.ceil((segments * math.max(halfAngleRad, 0)) / FULL_RING_HALF_ANGLE));
}

/** The ring planner the wave 1 rings share (see the file comment). */
export class WaveOneRings {
	readonly rings: WaveOneRingView[] = [];
	private readonly live: RingSlot[] = [];
	private readonly free: RingSlot[] = [];

	/** Forgets every ring. */
	clear(): void {
		for (const r of this.live) this.free.push(r);
		this.live.clear();
		this.rings.clear();
	}

	/**
	 * A new ring of `block` born on `bornTick` at (x, z), ending at `r1` tiles (block.r1Tiles when undefined), a fan of
	 * `halfAngleRad` about (dirX, dirZ) (FULL_RING_HALF_ANGLE: a ring). Drops the look's oldest past block.maxAlive.
	 */
	add(
		block: Readonly<WaveOneRingBlock>,
		x: number,
		z: number,
		owner: number,
		viewIndex: number,
		bornTick: number,
		level: BuildFxLevel,
		r1: number | undefined = undefined,
		dirX = 0,
		dirZ = 0,
		halfAngleRad: number = FULL_RING_HALF_ANGLE,
	): void {
		let same = 0;
		let oldest = -1;
		for (let i = 0; i < this.live.size(); i++) {
			if (this.live[i].block !== block) continue;
			same++;
			if (oldest < 0) oldest = i;
		}
		if (same >= block.maxAlive && oldest >= 0) this.free.push(this.live.remove(oldest)!);
		const g =
			this.free.pop() ??
			({
				x: 0,
				z: 0,
				radius: 0,
				fade: 1,
				role: block.role,
				segments: 0,
				block,
				dirX: 0,
				dirZ: 0,
				halfAngleRad: FULL_RING_HALF_ANGLE,
				owner: 0,
				mine: true,
				ageSec: 0,
				r1: 0,
				bornTick: 0,
			} as RingSlot);
		g.x = x;
		g.z = z;
		g.block = block;
		g.role = block.role;
		g.r1 = r1 ?? block.r1Tiles;
		g.radius = block.r0Tiles;
		g.fade = 1;
		g.dirX = dirX;
		g.dirZ = dirZ;
		g.halfAngleRad = halfAngleRad;
		g.segments = fanSegments(buildFxCount(block.segments, level), halfAngleRad);
		g.owner = owner;
		g.mine = owner === viewIndex;
		g.ageSec = 0;
		g.bornTick = bornTick;
		this.live.push(g);
	}

	/** Ages every ring to (tick, alpha) and rebuilds `rings`; drops the ones past their life. */
	age(tick: number, alpha: number, reducedMotion: boolean): void {
		const out = this.rings;
		out.clear();
		let w = 0;
		const n = this.live.size();
		for (let r = 0; r < n; r++) {
			const g = this.live[r];
			const b = g.block;
			const age = waveOneAgeSec(g.bornTick, tick, alpha);
			if (age >= b.sec) {
				this.free.push(g);
				continue;
			}
			this.live[w] = g;
			w++;
			g.ageSec = age;
			g.radius = ringRadius(age, b.sec, b.r0Tiles, g.r1, reducedMotion);
			g.fade = lifeFade(age, b.sec, b.fadeShare) * (g.mine ? 1 : BUILDS_V2_FX.teammateOpacity);
			out.push(g);
		}
		while (this.live.size() > w) this.live.pop();
	}
}
