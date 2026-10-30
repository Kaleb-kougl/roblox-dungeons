/**
 * The boon draft reveal's per-frame state machine (docs/DRAFT_REVEAL.md DR1), pure: no Roblox API, no sim access.
 * Tunables: DRAFT_REVEAL in draftRevealConfig.ts. The client's DraftRevealController (DR6) drives it and the overlay
 * (DR5) draws its frame with no further logic.
 *
 * API (one instance per client; every time is real, unpaused seconds):
 *   - `begin(rarities, reducedMotion)`: a new reveal of the local draft's cards, by OFFER index (1 to 3 rarities,
 *     shared/sim Rarity). Call it on the first frame the draft is open and the stage cover is fading or gone; t = 0
 *     is that moment. Replaces any running reveal. reducedMotion is fixed for the whole reveal.
 *   - `skip()`: the player pressed confirm during the reveal (DRD6, DraftRevealGate in shared/play): every card still
 *     face down flips at once over DRAFT_REVEAL.skipFlipSec with ONE flip cue; a legendary keeps its flash, burst,
 *     pop, sting and halo, but its charge (cues, tremble) stops and the hush is dropped; a pending music-dip request
 *     is cancelled. Does nothing once settled, while leaving, or before `begin`.
 *   - `pick(index)`: the local player's draftChosen (offer index). The card stamps, the others drop and fade, the
 *     overlay fades out after the stamp; `done` when it has. A pick before the reveal settled snaps every card to its
 *     settled face first (no more reveal cues). Ignored before `begin` or once leaving.
 *   - `step(dt)`: advance (dt clamped to [0, DRAFT_REVEAL.maxFrameDtSec]: a hitch delays the timeline, it never
 *     skips anything) and return the frame. Call it once per unpaused rendered frame (a solo pause freezes it).
 *   - `clear()`: drop the reveal (leave run / restart). The frame goes inactive.
 *
 * The frame (`DraftRevealFrame`, ONE object reused every step: read it, never keep it):
 *   - `active` (begun and not done), `count` (cards), `elapsed` (seconds since begin), `titleAlpha` (the title's
 *     fade in), `overlayAlpha` (the whole overlay: the exit fade after a pick), `settled` (draw the selection and the
 *     key hint, let the confirm through: DraftRevealGate's `revealing` = active and not settled), `leaving` (picked;
 *     keep the overlay mounted from the controller's copy of the offers), `done` (the exit fade ended: unmount).
 *   - `cues`: this step's sounds, in order, each exactly once: `{ id, speed, volume }` (speed = PlaybackSpeed, from
 *     semitones as 2^(st / 12)). Ids are DRAFT_REVEAL_SFX.
 *   - `duck`: seconds of music dip to request this step (charge + hush, on the charge's start), 0 = none.
 *   - `cards[i]` for i < DRAFT_OFFER_COUNT, by OFFER index (never reveal order); `shown` is false past `count`:
 *       face        0 = the back, 1 = the face (a step at the flip's midpoint; a crossfade under reduced motion: draw
 *                   the back at 1 - face and the face at face)
 *       width       flip width factor (X scale about the card's centre; 1 at rest, 0 mid-flip, overshoot 1.04)
 *       rise        reference px below its slot (the deal: 24 -> 0)
 *       alpha       card opacity (deal fade in, the drop's fade on a pick)
 *       textAlpha   name / rarity / effect opacity (0 until the face lands)
 *       dim         darkening 0..1 (0.5 = half brightness: the others during a legendary charge)
 *       tremble     reference px X offset (the charging legendary back)
 *       glow        edge glow 0..1 in the card's rarity colour (rare stroke flare, legendary charge / halo pulse)
 *       eyes        the back's red eyes 0..1 (legendary charge; held after)
 *       flash       white flash over the card area 0..1 (legendary flare, pick stamp)
 *       burst       ray burst progress 0..1, or -1 (none); burstScale / burstAlpha to draw it
 *       pop         card scale of the legendary pop (1 at rest)
 *       shine       shine sweep progress 0..1 across the card, or -1 (none)
 *       haloAlpha   ray ring opacity behind the card (0 = hidden); haloAngle its rotation, degrees
 *       stamp       card scale of the pick stamp (1 at rest); draw scale = pop * stamp
 *       drop        reference px below its slot (the others on a pick)
 *
 * Order (DRD5): non-legendary cards flip left to right (revealOrder), then every legendary at once (DRD7: one charge,
 * one hush, one flare, one sting). Reduced motion (docs "Rules"): a flip is a crossfade ending where the flip lands,
 * no rise, tremble, pop, burst, ray rotation, stamp scale or drop, no flash (the glow is already full at the flare);
 * every cue, the duck and the settle keep their times.
 */
import { DRAFT_OFFER_COUNT, Rarity, type RarityId } from "shared/sim";
import { semitonesToSpeed } from "./comboConfig";
import { DRAFT_REVEAL, DRAFT_REVEAL_FULL_TURN_DEG, DRAFT_REVEAL_SFX } from "./draftRevealConfig";

/** One sound to play this step. */
export interface DraftRevealCue {
	readonly id: string;
	/** PlaybackSpeed factor (2^(semitones / 12)). */
	readonly speed: number;
	/** Volume factor (1 = the sound's own). */
	readonly volume: number;
}

/** One card's look this step (by offer index). See the file header. */
export interface DraftRevealCardFrame {
	shown: boolean;
	rarity: RarityId;
	face: number;
	width: number;
	rise: number;
	alpha: number;
	textAlpha: number;
	dim: number;
	tremble: number;
	glow: number;
	eyes: number;
	flash: number;
	burst: number;
	burstScale: number;
	burstAlpha: number;
	pop: number;
	shine: number;
	haloAlpha: number;
	haloAngle: number;
	stamp: number;
	drop: number;
}

/** The reveal's frame. One object, reused every step. See the file header. */
export interface DraftRevealFrame {
	active: boolean;
	count: number;
	elapsed: number;
	titleAlpha: number;
	overlayAlpha: number;
	settled: boolean;
	leaving: boolean;
	done: boolean;
	readonly cards: DraftRevealCardFrame[];
	readonly cues: DraftRevealCue[];
	duck: number;
}

type CueKind = "flip" | "rare" | "charge" | "sting" | "pick";

interface ScheduledCue extends DraftRevealCue {
	readonly at: number;
	readonly kind: CueKind;
	/** The card it belongs to (rare), or -1. */
	readonly card: number;
}

/** One card's timeline. */
interface CardPlan {
	rarity: RarityId;
	legendary: boolean;
	/** The flip (or crossfade) runs over [flipAt, flipAt + flipSec); it lands at flipAt + flipSec. */
	flipAt: number;
	flipSec: number;
	/** Width and face at the flip's start (a skip can restart a flip mid-squash / mid-crossfade). */
	fromWidth: number;
	fromFace: number;
}

const NONE = -1;
const HALF = 0.5;

function clamp01(u: number): number {
	return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

function easeOutQuad(u: number): number {
	const v = 1 - clamp01(u);
	return 1 - v * v;
}

function easeOutBack(u: number): number {
	const c1 = DRAFT_REVEAL.flare.popEaseBack;
	const c3 = c1 + 1;
	const v = clamp01(u) - 1;
	return 1 + c3 * v * v * v + c1 * v * v;
}

function lerp(a: number, b: number, u: number): number {
	return a + (b - a) * u;
}

/**
 * The flip beats (DRD5, DRD7): each non-legendary card alone, left to right, then every legendary card in ONE beat.
 * `[c, l, r]` -> [[0], [2], [1]]; `[l, l, c]` -> [[2], [0, 1]].
 */
export function revealOrder(rarities: ReadonlyArray<RarityId>): number[][] {
	const beats: number[][] = [];
	const legendaries: number[] = [];
	for (let i = 0; i < rarities.size(); i++) {
		if (rarities[i] === Rarity.LEGENDARY) legendaries.push(i);
		else beats.push([i]);
	}
	if (legendaries.size() > 0) beats.push(legendaries);
	return beats;
}

/** One hit of the legendary charge ladder: seconds after the charge starts, semitones, volume. */
export interface ChargeHit {
	readonly offset: number;
	readonly semitones: number;
	readonly volume: number;
}

/**
 * The charge's pitch-up ladder (DRD11, DRAFT_REVEAL.chargeLadder): hits placed backwards from the charge's end (the last
 * one lastHitLeadSec before the hush), the gaps closing linearly from firstGapSec to lastGapSec, the pitch climbing
 * linearly 0 -> topSemitones.
 */
export function chargeLadder(): ChargeHit[] {
	const L = DRAFT_REVEAL.chargeLadder;
	const hits = L.hits;
	const offsets: number[] = [];
	let at = DRAFT_REVEAL.charge.sec - L.lastHitLeadSec;
	offsets.push(at);
	const gaps = hits - 1;
	for (let k = gaps - 1; k >= 0; k--) {
		const gap = gaps > 1 ? lerp(L.firstGapSec, L.lastGapSec, k / (gaps - 1)) : L.firstGapSec;
		at -= gap;
		offsets.push(at);
	}
	const out: ChargeHit[] = [];
	for (let j = 0; j < hits; j++) {
		const u = hits > 1 ? j / (hits - 1) : 1;
		out.push({
			offset: offsets[hits - 1 - j],
			semitones: L.topSemitones * u,
			volume: lerp(L.fromVolume, L.toVolume, u),
		});
	}
	return out;
}

/** Rarity letters of the KV_DraftRevealDebug attribute (DR6): `c` / `r` / `l` or the full names. */
const DEBUG_RARITY: ReadonlyMap<string, RarityId> = new Map<string, RarityId>([
	["c", Rarity.COMMON],
	["common", Rarity.COMMON],
	["r", Rarity.RARE],
	["rare", Rarity.RARE],
	["l", Rarity.LEGENDARY],
	["legendary", Rarity.LEGENDARY],
]);

/**
 * The KV_DraftRevealDebug attribute (`"c,l,r"`, `"l,l"`, `"r"`; spaces and case ignored) -> the rarities the next
 * reveal plays, or undefined (empty, an unknown letter, or not 1..DRAFT_OFFER_COUNT entries).
 */
export function parseDraftRevealDebug(text: string): RarityId[] | undefined {
	const [compact] = text.lower().gsub("%s", "");
	if (compact === "") return undefined;
	const out: RarityId[] = [];
	for (const token of compact.split(",")) {
		const r = DEBUG_RARITY.get(token);
		if (r === undefined) return undefined;
		out.push(r);
	}
	return out.size() >= 1 && out.size() <= DRAFT_OFFER_COUNT ? out : undefined;
}

function newCardFrame(): DraftRevealCardFrame {
	return {
		shown: false,
		rarity: Rarity.COMMON,
		face: 0,
		width: 1,
		rise: 0,
		alpha: 0,
		textAlpha: 0,
		dim: 0,
		tremble: 0,
		glow: 0,
		eyes: 0,
		flash: 0,
		burst: NONE,
		burstScale: 1,
		burstAlpha: 0,
		pop: 1,
		shine: NONE,
		haloAlpha: 0,
		haloAngle: 0,
		stamp: 1,
		drop: 0,
	};
}

function hideCard(c: DraftRevealCardFrame): void {
	c.shown = false;
	c.face = 0;
	c.width = 1;
	c.rise = 0;
	c.alpha = 0;
	c.textAlpha = 0;
	c.dim = 0;
	c.tremble = 0;
	c.glow = 0;
	c.eyes = 0;
	c.flash = 0;
	c.burst = NONE;
	c.burstScale = 1;
	c.burstAlpha = 0;
	c.pop = 1;
	c.shine = NONE;
	c.haloAlpha = 0;
	c.haloAngle = 0;
	c.stamp = 1;
	c.drop = 0;
}

/** Inserts `cue` after every cue at or before its time (stable for equal times). */
function insertCue(list: ScheduledCue[], cue: ScheduledCue): void {
	let i = list.size();
	while (i > 0 && list[i - 1].at > cue.at) i--;
	list.insert(i, cue);
}

/** The reveal (see the file header). */
export class DraftReveal {
	readonly frame: DraftRevealFrame;
	private begun = false;
	private reduced = false;
	private t = 0;
	private count = 0;
	private readonly plans: CardPlan[] = [];
	private hasLegendary = false;
	/** The charge runs over [chargeAt, chargeEnd) (a skip cuts chargeEnd); the legendaries land (flare) at flareAt. */
	private chargeAt = 0;
	private chargeEnd = 0;
	private flareAt = 0;
	/** Cues not yet played, in order (`nextCue` indexes the next one). */
	private cues: ScheduledCue[] = [];
	private nextCue = 0;
	private duckAt = NONE;
	private duckSec = 0;
	private settleAt = 0;
	private skipped = false;
	private flipsPlayed = 0;
	private pickAt = NONE;
	private chosen = NONE;

	constructor() {
		const cards: DraftRevealCardFrame[] = [];
		for (let i = 0; i < DRAFT_OFFER_COUNT; i++) cards.push(newCardFrame());
		this.frame = {
			active: false,
			count: 0,
			elapsed: 0,
			titleAlpha: 0,
			overlayAlpha: 0,
			settled: false,
			leaving: false,
			done: false,
			cards,
			cues: [],
			duck: 0,
		};
	}

	/** A new reveal of `rarities` (by offer index; at most DRAFT_OFFER_COUNT are used). */
	begin(rarities: ReadonlyArray<RarityId>, reducedMotion: boolean): void {
		const F = DRAFT_REVEAL.flip;
		this.begun = true;
		this.reduced = reducedMotion;
		this.t = 0;
		this.count = math.min(rarities.size(), DRAFT_OFFER_COUNT);
		this.plans.clear();
		this.cues = [];
		this.nextCue = 0;
		this.duckAt = NONE;
		this.duckSec = 0;
		this.skipped = false;
		this.flipsPlayed = 0;
		this.pickAt = NONE;
		this.chosen = NONE;
		this.hasLegendary = false;

		const used: RarityId[] = [];
		for (let i = 0; i < this.count; i++) used.push(rarities[i]);
		for (let i = 0; i < this.count; i++) {
			const rarity = used[i];
			this.plans.push({
				rarity,
				legendary: rarity === Rarity.LEGENDARY,
				flipAt: 0,
				flipSec: F.sec,
				fromWidth: 1,
				fromFace: 0,
			});
		}

		// Non-legendary cards, left to right (revealOrder's single-card beats).
		let beat = 0;
		let lastLand = NONE;
		for (let i = 0; i < this.count; i++) {
			const p = this.plans[i];
			if (p.legendary) continue;
			p.flipAt = F.firstAtSec + beat * F.intervalSec;
			lastLand = p.flipAt + p.flipSec;
			const semis = beat * DRAFT_REVEAL.flipSemitoneStep;
			this.cues.push({
				at: p.flipAt,
				kind: "flip",
				card: i,
				id: DRAFT_REVEAL_SFX.flip,
				speed: semitonesToSpeed(semis),
				volume: 1,
			});
			if (p.rarity === Rarity.RARE)
				this.cues.push({ at: lastLand, kind: "rare", card: i, id: DRAFT_REVEAL_SFX.rare, speed: 1, volume: 1 });
			beat++;
		}

		// Every legendary in one beat: charge, hush, fast flip, flare.
		for (let i = 0; i < this.count; i++) if (this.plans[i].legendary) this.hasLegendary = true;
		if (this.hasLegendary) {
			const C = DRAFT_REVEAL.charge;
			this.chargeAt = lastLand >= 0 ? lastLand : F.firstAtSec;
			this.chargeEnd = this.chargeAt + C.sec;
			const flipAt = this.chargeEnd + DRAFT_REVEAL.hushSec;
			for (let i = 0; i < this.count; i++) {
				const p = this.plans[i];
				if (!p.legendary) continue;
				p.flipAt = flipAt;
				p.flipSec = DRAFT_REVEAL.fastFlipSec;
			}
			this.flareAt = flipAt + DRAFT_REVEAL.fastFlipSec;
			for (const hit of chargeLadder())
				this.cues.push({
					at: this.chargeAt + hit.offset,
					kind: "charge",
					card: NONE,
					id: DRAFT_REVEAL_SFX.charge,
					speed: semitonesToSpeed(hit.semitones),
					volume: hit.volume,
				});
			this.cues.push({
				at: this.flareAt,
				kind: "sting",
				card: NONE,
				id: DRAFT_REVEAL_SFX.legendary,
				speed: 1,
				volume: 1,
			});
			this.duckAt = this.chargeAt;
			this.duckSec = C.sec + DRAFT_REVEAL.hushSec;
		}
		this.sortCues();
		this.updateSettleAt();

		const fr = this.frame;
		fr.active = true;
		fr.count = this.count;
		fr.settled = false;
		fr.leaving = false;
		fr.done = false;
		this.evaluate();
		fr.cues.clear();
		fr.duck = 0;
	}

	/** The player pressed confirm during the reveal (DRD6). See the file header. */
	skip(): void {
		if (!this.begun || this.frame.settled || this.pickAt >= 0 || this.skipped) return;
		const t = this.t;
		const sec = DRAFT_REVEAL.skipFlipSec;
		const reflipped: boolean[] = [];
		let any = false;
		let rare = false;
		let legendary = false;
		for (let i = 0; i < this.count; i++) {
			const p = this.plans[i];
			const faceDown = t < p.flipAt + p.flipSec * HALF;
			reflipped.push(faceDown);
			if (!faceDown) continue;
			any = true;
			const w = this.widthOf(p, t);
			const f = this.faceOf(p, t);
			p.fromWidth = w;
			p.fromFace = f;
			p.flipAt = t;
			p.flipSec = sec;
			if (p.rarity === Rarity.RARE) rare = true;
			if (p.legendary) legendary = true;
		}
		if (!any) return;
		this.skipped = true;

		// Pending cues: keep a face-up card's chime and an already flipping legendary's sting; drop flips and charge.
		const kept: ScheduledCue[] = [];
		for (let i = this.nextCue; i < this.cues.size(); i++) {
			const c = this.cues[i];
			if (c.kind === "rare" && !reflipped[c.card]) kept.push(c);
			else if (c.kind === "sting" && !legendary) kept.push(c);
		}
		this.cues = kept;
		this.nextCue = 0;
		const semis = this.flipsPlayed * DRAFT_REVEAL.flipSemitoneStep;
		insertCue(this.cues, {
			at: t,
			kind: "flip",
			card: NONE,
			id: DRAFT_REVEAL_SFX.flip,
			speed: semitonesToSpeed(semis),
			volume: 1,
		});
		if (rare)
			insertCue(this.cues, {
				at: t + sec,
				kind: "rare",
				card: NONE,
				id: DRAFT_REVEAL_SFX.rare,
				speed: 1,
				volume: 1,
			});
		if (legendary) {
			if (this.chargeEnd > t) this.chargeEnd = t;
			this.flareAt = t + sec;
			insertCue(this.cues, {
				at: this.flareAt,
				kind: "sting",
				card: NONE,
				id: DRAFT_REVEAL_SFX.legendary,
				speed: 1,
				volume: 1,
			});
		}
		if (this.duckAt > t) this.duckAt = NONE; // not dipped yet: no dip at all
		this.updateSettleAt();
	}

	/** The local player took the card at offer `index`. See the file header. */
	pick(index: number): void {
		if (!this.begun || this.pickAt >= 0) return;
		const t = this.t;
		if (!this.frame.settled) this.snapSettled(t);
		this.pickAt = t;
		this.chosen = index >= 0 && index < this.count ? index : NONE;
		this.cues = [];
		this.nextCue = 0;
		this.cues.push({ at: t, kind: "pick", card: this.chosen, id: DRAFT_REVEAL_SFX.pick, speed: 1, volume: 1 });
	}

	/** Drops the reveal (leave run / restart). */
	clear(): void {
		this.begun = false;
		this.count = 0;
		this.plans.clear();
		this.cues = [];
		this.nextCue = 0;
		const fr = this.frame;
		fr.active = false;
		fr.count = 0;
		fr.elapsed = 0;
		fr.titleAlpha = 0;
		fr.overlayAlpha = 0;
		fr.settled = false;
		fr.leaving = false;
		fr.done = false;
		fr.cues.clear();
		fr.duck = 0;
		for (const c of fr.cards) hideCard(c);
	}

	/** Advances by `dt` real seconds (clamped) and returns the frame. */
	step(dt: number): DraftRevealFrame {
		const fr = this.frame;
		fr.cues.clear();
		fr.duck = 0;
		if (!this.begun || fr.done) return fr;
		this.t += math.clamp(dt, 0, DRAFT_REVEAL.maxFrameDtSec);
		const t = this.t;
		if (this.duckAt >= 0 && this.duckAt <= t) {
			fr.duck = this.duckSec;
			this.duckAt = NONE;
		}
		while (this.nextCue < this.cues.size() && this.cues[this.nextCue].at <= t) {
			const c = this.cues[this.nextCue];
			this.nextCue++;
			if (c.kind === "flip") this.flipsPlayed++;
			fr.cues.push({ id: c.id, speed: c.speed, volume: c.volume });
		}
		this.evaluate();
		return fr;
	}

	// --- internals ---

	private sortCues(): void {
		const sorted: ScheduledCue[] = [];
		for (const c of this.cues) insertCue(sorted, c);
		this.cues = sorted;
		this.nextCue = 0;
	}

	private updateSettleAt(): void {
		let at = 0;
		for (let i = 0; i < this.count; i++) {
			const p = this.plans[i];
			at = math.max(at, p.flipAt + p.flipSec + DRAFT_REVEAL.textFadeSec);
		}
		if (this.hasLegendary) at = math.max(at, this.flareAt + DRAFT_REVEAL.flare.popSec);
		this.settleAt = at;
	}

	/** A pick before the reveal settled: every card lands now, every effect already over, no more reveal cues. */
	private snapSettled(t: number): void {
		const R = DRAFT_REVEAL;
		const past =
			math.max(R.flare.burstSec, R.flare.popSec, R.flare.undimSec, R.rare.flareSec, R.rare.shineSec) +
			R.textFadeSec;
		for (let i = 0; i < this.count; i++) {
			const p = this.plans[i];
			if (p.flipAt + p.flipSec <= t - past) continue;
			p.flipAt = t - past - p.flipSec;
		}
		if (this.hasLegendary) {
			this.chargeEnd = math.min(this.chargeEnd, t - past);
			this.flareAt = math.min(this.flareAt, t - past);
		}
		this.duckAt = NONE;
		this.settleAt = t;
	}

	private widthOf(p: CardPlan, t: number): number {
		if (this.reduced) return 1;
		const F = DRAFT_REVEAL.flip;
		if (t < p.flipAt) return 1;
		const u = (t - p.flipAt) / p.flipSec;
		if (u >= 1) return 1;
		if (u < HALF) return p.fromWidth * (1 - u / HALF);
		const v = (u - HALF) / HALF;
		if (v < F.overshootAt) return F.overshoot * easeOutQuad(v / F.overshootAt);
		return lerp(F.overshoot, 1, (v - F.overshootAt) / (1 - F.overshootAt));
	}

	private faceOf(p: CardPlan, t: number): number {
		const land = p.flipAt + p.flipSec;
		if (this.reduced) {
			// The crossfade ends where the flip lands (a skip's crossfade runs over the whole skip flip).
			const xf = math.min(DRAFT_REVEAL.reducedMotion.crossfadeSec, p.flipSec);
			const start = land - xf;
			if (t < start) return p.fromFace;
			return lerp(p.fromFace, 1, clamp01((t - start) / xf));
		}
		return t >= p.flipAt + p.flipSec * HALF ? 1 : 0;
	}

	/** The charge's progress 0..1 at t (held after it ends; 0 when a skip cut it before it began). */
	private chargeProgress(t: number): number {
		if (!this.hasLegendary || this.chargeEnd <= this.chargeAt) return 0;
		return clamp01((math.min(t, this.chargeEnd) - this.chargeAt) / DRAFT_REVEAL.charge.sec);
	}

	private evaluate(): void {
		const R = DRAFT_REVEAL;
		const fr = this.frame;
		const t = this.t;
		const reduced = this.reduced;
		fr.elapsed = t;
		fr.titleAlpha = clamp01(t / R.titleFadeSec);
		if (!fr.settled && t >= this.settleAt) fr.settled = true;
		const picking = this.pickAt >= 0;
		fr.leaving = picking;
		let overlay = 1;
		if (picking) {
			const fadeAt = this.pickAt + R.pick.stampSec;
			overlay = 1 - clamp01((t - fadeAt) / R.pick.exitFadeSec);
			if (t >= fadeAt + R.pick.exitFadeSec) {
				fr.done = true;
				fr.active = false;
			}
		}
		fr.overlayAlpha = overlay;

		// Legendary group values.
		const charge = this.chargeProgress(t);
		const charging = this.hasLegendary && t >= this.chargeAt && t < this.chargeEnd;
		let dim = 0;
		if (this.hasLegendary && this.chargeEnd > this.chargeAt) {
			dim = R.charge.dim * clamp01((math.min(t, this.chargeEnd) - this.chargeAt) / R.charge.dimInSec);
			if (t >= this.flareAt) dim *= 1 - clamp01((t - this.flareAt) / R.flare.undimSec);
		}

		for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
			const c = fr.cards[i];
			if (i >= this.count) {
				hideCard(c);
				continue;
			}
			const p = this.plans[i];
			const land = p.flipAt + p.flipSec;
			c.shown = true;
			c.rarity = p.rarity;

			// The deal.
			const deal = clamp01((t - i * R.deal.staggerSec) / R.deal.sec);
			c.alpha = deal;
			c.rise = reduced ? 0 : R.deal.risePx * (1 - easeOutQuad(deal));

			// The flip.
			c.width = this.widthOf(p, t);
			c.face = this.faceOf(p, t);
			c.textAlpha = t >= land ? clamp01((t - land) / R.textFadeSec) : 0;

			c.dim = 0;
			c.tremble = 0;
			c.glow = 0;
			c.eyes = 0;
			c.flash = 0;
			c.burst = NONE;
			c.burstScale = 1;
			c.burstAlpha = 0;
			c.pop = 1;
			c.shine = NONE;
			c.haloAlpha = 0;
			c.haloAngle = 0;

			if (p.legendary) {
				c.eyes = charge;
				if (charging && !reduced) {
					const since = t - this.chargeAt;
					c.tremble = R.charge.tremblePx * charge * math.sin(2 * math.pi * R.charge.trembleHz * since);
				}
				// The rays turn during the charge and from the fast flip on (frozen through the hush).
				const turning = math.max(0, math.min(t, this.chargeEnd) - this.chargeAt) + math.max(0, t - p.flipAt);
				c.haloAngle = reduced
					? 0
					: (turning * R.halo.revPerSec * DRAFT_REVEAL_FULL_TURN_DEG) % DRAFT_REVEAL_FULL_TURN_DEG;
				if (t < this.flareAt) {
					c.glow = charge;
					c.haloAlpha = R.charge.rayAlpha * charge;
				} else {
					const since = t - this.flareAt;
					const H = R.halo;
					c.glow = lerp(H.glowMin, 1, HALF + HALF * math.cos(2 * math.pi * H.pulseHz * since));
					c.haloAlpha = H.alpha;
					if (!reduced) {
						const fl = R.flare;
						if (since < fl.flashSec) c.flash = fl.flashFrom * (1 - since / fl.flashSec);
						if (since < fl.burstSec) {
							const u = since / fl.burstSec;
							c.burst = u;
							c.burstScale = lerp(fl.burstFrom, fl.burstTo, easeOutQuad(u));
							c.burstAlpha = 1 - u;
						}
						if (since < fl.popSec) c.pop = lerp(fl.popFrom, 1, easeOutBack(since / fl.popSec));
					}
				}
			} else {
				c.dim = dim;
				if (p.rarity === Rarity.RARE && t >= land) {
					const since = t - land;
					c.glow = 1 - clamp01(since / R.rare.flareSec);
					if (since < R.rare.shineSec) c.shine = since / R.rare.shineSec;
				}
			}

			// The pick.
			c.stamp = 1;
			c.drop = 0;
			if (picking) {
				const since = t - this.pickAt;
				if (i === this.chosen) {
					const P = R.pick;
					if (since < P.stampSec) {
						const u = since / P.stampSec;
						const tri = u < HALF ? u / HALF : (1 - u) / HALF;
						if (!reduced) c.stamp = lerp(1, P.stampScale, tri);
						c.flash = math.max(c.flash, P.stampFlash * (1 - u));
					}
				} else {
					const v = clamp01(since / R.pick.dropSec);
					c.drop = reduced ? 0 : R.pick.dropPx * easeOutQuad(v);
					c.alpha *= 1 - v;
				}
			}
		}
	}
}
