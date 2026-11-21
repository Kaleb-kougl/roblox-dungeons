/**
 * Damage number pool (port of project-kaleb-vale src/fx/numbers/numberPool.ts @ 42897e2): spawning, merging, the
 * "CAP" tag throttle and the per-number animation curves. Pure, preallocated arrays, no allocation per frame. Times
 * are SimClock seconds (sim time: numbers freeze with pause / hitstop).
 *
 *   hit      a number pops at the hit (+ a render-side PRNG jitter of +-JITTER_PX), rises RISE_PX over RISE_TIME with
 *            an ease-out, fades out over the last NUMBER_FADE of NUMBER_LIFE. Pop: integer scale 2 for POP_TIME.
 *   merge    another hit of the same style on the same actor within MERGE_WINDOW of its last hit adds to the existing
 *            number and re-pops it (restarts its life) instead of spawning a new one: a bow stream stays one number.
 *   heavy    damageHeavy colour, scale 2 throughout (no pop); heavy and normal hits never merge into each other.
 *   CAP      a small damageCapped tag beside a capped boss, at most once per CAP_THROTTLE.
 *   full     the pool drops its oldest number (least recently popped) for the new one.
 * Under reducedMotion (motion = 0): no jitter, no rise, no pop; numbers still appear and fade in place.
 *
 * @module
 */
import { formatDecimal } from "shared/l10n";
import { BAR_GAP } from "./bars";
import { RenderRng } from "./rng";

/** Numbers alive at once. */
export const NUMBER_POOL_SIZE = 48;
/** Hits on the same actor this close (s) to its number's last hit merge into it. */
export const MERGE_WINDOW = 0.25;
/** A number's life after its last (re)pop (s). */
export const NUMBER_LIFE = 0.7;
/** Rise distance (px) and time (s, ease-out), then it hangs until it fades. */
export const RISE_PX = 12;
/**
 * Seconds a number takes to rise RISE_PX (quadratic ease-out); for the rest of NUMBER_LIFE it hangs at the top. No rise
 * under reduced motion.
 */
export const RISE_TIME = 0.6;
/** Fade-out over the last part of the life (s). */
export const NUMBER_FADE = 0.2;
/** Pop: normal numbers draw at scale 2 for this long after a (re)spawn (s): 3 frames at 60 fps. */
export const POP_TIME = 3 / 60;
/** Horizontal spawn jitter, whole px in [-JITTER_PX, JITTER_PX]. */
export const JITTER_PX = 4;
/** At most one CAP tag per this long (s). */
export const CAP_THROTTLE = 0.5;
/** Glyph scales: normal 1, heavy / popping 2. */
export const NUMBER_SCALE_NORMAL = 1;
/**
 * Integer glyph scale of a heavy number (for its whole life) and of a normal number during its POP_TIME pop: twice
 * NUMBER_SCALE_NORMAL.
 */
export const NUMBER_SCALE_BIG = 2;

/** Number styles. */
export const NumberStyle = { NORMAL: 0, HEAVY: 1, CAP: 2 } as const;
/**
 * One of the NumberStyle values: which kind of number a pool entry is. It picks the colour and scale, and hits only
 * merge into a number of the same style.
 */
export type NumberStyleId = (typeof NumberStyle)[keyof typeof NumberStyle];

function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < n; i++) out.push(v);
	return out;
}

/**
 * The fixed pool of floating damage numbers (NUMBER_POOL_SIZE entries, parallel arrays indexed by entry; `live` is 1
 * for a shown one). The client's DamageNumberController adds the hit tracker's hits to it (merging a stream on one
 * actor into one number) and CAP tags, then draws every live entry each frame from its age since `born`. Positions are
 * sim units plus a pixel offset; times are SimClock seconds. When full, the oldest number is replaced.
 */
export class DamageNumberPool {
	readonly capacity: number;
	readonly live: number[];
	readonly style: number[];
	readonly slot: number[];
	readonly actorId: number[];
	/** World anchor (the hit's interpolated feet position, sim units). */
	readonly x: number[];
	readonly z: number[];
	/** Pixel offset from the anchor: jitter / side offset (dx) and the start height above the feet (dy). */
	readonly dx: number[];
	readonly dy: number[];
	readonly value: number[];
	/** Last (re)pop: life, rise and pop count from here. */
	readonly born: number[];
	/** Last hit merged in (the merge window counts from here). */
	readonly lastHit: number[];
	/** Last time a CAP tag was shown (-math.huge: never). */
	lastCap = -math.huge;
	/** Numbers dropped (oldest replaced) because the pool was full, since creation. */
	overflowed = 0;
	readonly rng: RenderRng;

	constructor(capacity = NUMBER_POOL_SIZE, seed?: number) {
		this.capacity = capacity;
		this.live = filled(capacity, 0);
		this.style = filled(capacity, 0);
		this.slot = filled(capacity, 0);
		this.actorId = filled(capacity, 0);
		this.x = filled(capacity, 0);
		this.z = filled(capacity, 0);
		this.dx = filled(capacity, 0);
		this.dy = filled(capacity, 0);
		this.value = filled(capacity, 0);
		this.born = filled(capacity, 0);
		this.lastHit = filled(capacity, 0);
		this.rng = new RenderRng(seed);
	}

	clear(): void {
		for (let i = 0; i < this.capacity; i++) this.live[i] = 0;
		this.lastCap = -math.huge;
	}

	/** Live numbers. */
	count(): number {
		let n = 0;
		for (let i = 0; i < this.capacity; i++) n += this.live[i];
		return n;
	}

	/** A free entry, or the oldest one (least recently popped) when full. */
	private allocate(): number {
		let oldest = 0;
		for (let i = 0; i < this.capacity; i++) {
			if (this.live[i] === 0) return i;
			if (this.born[i] < this.born[oldest]) oldest = i;
		}
		this.overflowed++;
		return oldest;
	}

	/** The live number a hit of `style` on (slot, actorId) at `now` merges into, or -1. */
	findMerge(slot: number, actorId: number, style: NumberStyleId, now: number): number {
		for (let i = 0; i < this.capacity; i++) {
			if (
				this.live[i] === 1 &&
				this.style[i] === style &&
				this.slot[i] === slot &&
				this.actorId[i] === actorId &&
				now - this.lastHit[i] <= MERGE_WINDOW
			) {
				return i;
			}
		}
		return -1;
	}

	/**
	 * A hit: merges into the actor's recent number of the same style (sum + re-pop) or spawns one at (x, z), `baseY` px
	 * above the feet, jittered by +-JITTER_PX when `motion` > 0. Returns the entry.
	 */
	hit(
		slot: number,
		actorId: number,
		x: number,
		z: number,
		damage: number,
		heavy: boolean,
		baseY: number,
		now: number,
		motion: number,
	): number {
		const style = heavy ? NumberStyle.HEAVY : NumberStyle.NORMAL;
		let i = this.findMerge(slot, actorId, style, now);
		if (i >= 0) {
			this.value[i] += damage;
			this.x[i] = x;
			this.z[i] = z;
			this.dy[i] = baseY;
		} else {
			i = this.allocate();
			this.live[i] = 1;
			this.style[i] = style;
			this.slot[i] = slot;
			this.actorId[i] = actorId;
			this.x[i] = x;
			this.z[i] = z;
			this.value[i] = damage;
			this.dx[i] = motion > 0 ? this.rng.int(JITTER_PX) : 0;
			this.dy[i] = baseY;
		}
		this.born[i] = now;
		this.lastHit[i] = now;
		return i;
	}

	/** A CAP tag at (x, z) + (dx, baseY) px, unless one was shown within CAP_THROTTLE. Returns the entry or -1. */
	cap(slot: number, actorId: number, x: number, z: number, dx: number, baseY: number, now: number): number {
		if (now - this.lastCap < CAP_THROTTLE) return -1;
		this.lastCap = now;
		const i = this.allocate();
		this.live[i] = 1;
		this.style[i] = NumberStyle.CAP;
		this.slot[i] = slot;
		this.actorId[i] = actorId;
		this.x[i] = x;
		this.z[i] = z;
		this.value[i] = 0;
		this.dx[i] = dx;
		this.dy[i] = baseY;
		this.born[i] = now;
		this.lastHit[i] = now;
		return i;
	}

	/** Retire numbers past their life at `now`. */
	expire(now: number): void {
		for (let i = 0; i < this.capacity; i++) {
			if (this.live[i] === 1 && now - this.born[i] >= NUMBER_LIFE) this.live[i] = 0;
		}
	}
}

// --- Animation curves (age = now - born, seconds) ---

/** Pixels risen at `age`: ease-out (quadratic) to RISE_PX over RISE_TIME, whole px; 0 under reducedMotion. */
export function numberRise(age: number, motion: number): number {
	if (motion <= 0 || !(age > 0)) return 0;
	const t = age >= RISE_TIME ? 1 : age / RISE_TIME;
	return math.round(RISE_PX * motion * (1 - (1 - t) * (1 - t)));
}

/** Opacity at `age`: 1, then a linear fade over the last NUMBER_FADE of NUMBER_LIFE, 0 after. */
export function numberAlpha(age: number): number {
	if (age >= NUMBER_LIFE) return 0;
	const left = NUMBER_LIFE - age;
	return left >= NUMBER_FADE ? 1 : left / NUMBER_FADE;
}

/** Integer glyph scale at `age`: normal 1 (2 while popping), heavy 2 throughout, CAP 1; no pop under reducedMotion. */
export function numberScale(style: number, age: number, motion: number): number {
	if (style === NumberStyle.HEAVY) return NUMBER_SCALE_BIG;
	if (style === NumberStyle.CAP || motion <= 0) return NUMBER_SCALE_NORMAL;
	return age >= 0 && age < POP_TIME ? NUMBER_SCALE_BIG : NUMBER_SCALE_NORMAL;
}

// --- Placement (px above the actor's feet) ---

/** A number's bottom edge starts this many px above the drawn sprite's top: just over the health bar. */
export const NUMBER_BASE_GAP = BAR_GAP + 5;
/** Bosses are big: their numbers start low on the body (this fraction of the drawn height) instead of over the head. */
export const BOSS_NUMBER_HEIGHT = 0.3;
/** The CAP tag sits beside the boss: CAP_SIDE_PX right of the sprite's edge, at CAP_HEIGHT of its height. */
export const CAP_SIDE_PX = 2;
/**
 * Height of the CAP tag on a boss, as a fraction (0..1) of the boss's drawn height above its feet: the same height its
 * damage numbers start at (BOSS_NUMBER_HEIGHT).
 */
export const CAP_HEIGHT = 0.3;

/** Start height (px above the feet) of a number on an actor drawn `h` px tall. */
export function numberBaseY(h: number, boss: boolean): number {
	return boss ? math.round(h * BOSS_NUMBER_HEIGHT) : h + NUMBER_BASE_GAP;
}

/** Decimals a fractional damage number shows. */
export const NUMBER_DECIMALS = 1;

/**
 * The text a pooled number shows: its value (whole numbers without decimals; a fraction with the number locale's
 * decimal separator, shared/l10n formatDecimal), or `capText` for a CAP tag.
 */
export function numberText(style: number, value: number, capText: string): string {
	if (style === NumberStyle.CAP) return capText;
	return value === math.floor(value) ? tostring(value) : formatDecimal(value, NUMBER_DECIMALS);
}
