/**
 * The room clear celebration's timeline (docs/ROOM_CLEAR.md RC2), pure. The controller, once per frame and in this
 * order: beginFrame(); collapse() if danger; start() for each new clear; frame(dt); then reads `look`. One full
 * sequence at a time (a new one releases the old one's bonus at once and replaces it) and up to ROOM_CLEAR.chip.max
 * corner chips (a new chip past the cap merges the oldest at once). Every bonus is released exactly once:
 * `look.bonusLanded` is the points released this frame, `look.held` the points not yet released.
 *
 * @module
 */
import { TILE_SIZE } from "shared/sim";
import { ROOM_CLEAR } from "./roomClearConfig";
import type { RoomClear } from "./roomClears";

export type RoomClearStyle = "full" | "chip";

/**
 * A co-op team perfect's stamp facts (docs/RUN_RECAP.md CM2: shared/view/fx TeamPerfectMoment fits): the stamp reads
 * TEAM PERFECT, with its streak once `showStreak`; a chip reads TEAM PERFECT.
 */
export interface RoomClearTeam {
	readonly streak: number;
	readonly showStreak: boolean;
}
/**
 * A tally segment. `kills` and `pellets` (docs/PELLETS.md PL7: the pellet points earned in the room) are points already
 * scored, shown as they are; `clear` / `perfect` / `fast` / `sweep` (the Sweep bonus) are the bonus that flies to the
 * score panel.
 */
export type TallyKind = "kills" | "pellets" | "clear" | "perfect" | "fast" | "sweep" | "horde";

/** Tally segments at most (kills, pellets, clear, perfect, fast, sweep, horde: docs/FORTUNE.md FO7). */
export const ROOM_CLEAR_SEGMENTS = 7;

function clamp01(u: number): number {
	return u <= 0 ? 0 : u >= 1 ? 1 : u;
}

/** Ease out back on [0, 1]: overshoots past 1, settles at 1. */
export function easeOutBack(u: number): number {
	const c1 = ROOM_CLEAR.stamp.easeBack;
	const c3 = c1 + 1;
	const v = clamp01(u) - 1;
	return 1 + c3 * v * v * v + c1 * v * v;
}

/**
 * The clear's bonus points (what flies to the score panel): ROOMS / PERFECT / FAST and the Sweep, and a Horde room's
 * doubled half of them (docs/FORTUNE.md FO7: hordeBonusPoints, awarded on the clear tick with them).
 */
export function roomClearBonus(c: RoomClear): number {
	return c.clearPoints + c.perfectPoints + c.fastPoints + c.sweepPoints + c.hordeBonusPoints;
}

/** One tally segment as the clear's numbers give it (kind and final value), before any counting. */
export interface TallyEntry {
	readonly kind: TallyKind;
	readonly value: number;
}

/**
 * The tally's segments for a clear, in order: kills, pellets, clear, perfect, fast, sweep, horde (docs/FORTUNE.md FO7:
 * a Horde room's doubled half, always last); every one but `clear` only when it is not 0. `foldPellets` (the row would
 * not fit, docs/PELLETS.md PL7: shared/view/hud roomClearFoldPellets) adds the pellet points to the kills segment
 * instead of a segment of their own.
 */
export function roomClearSegments(c: RoomClear, foldPellets = false): TallyEntry[] {
	const out: TallyEntry[] = [];
	const kills = foldPellets ? c.killPoints + c.pelletPoints : c.killPoints;
	if (kills > 0) out.push({ kind: "kills", value: kills });
	if (!foldPellets && c.pelletPoints > 0) out.push({ kind: "pellets", value: c.pelletPoints });
	out.push({ kind: "clear", value: c.clearPoints });
	if (c.perfectPoints > 0) out.push({ kind: "perfect", value: c.perfectPoints });
	if (c.fastPoints > 0) out.push({ kind: "fast", value: c.fastPoints });
	if (c.sweepPoints > 0) out.push({ kind: "sweep", value: c.sweepPoints });
	if (c.hordePoints > 0) out.push({ kind: "horde", value: c.hordePoints });
	return out;
}

/** Full sequence or corner chip (RCD12): solo always full; co-op full when the view position is near the room. */
export function roomClearStyle(c: RoomClear, viewX: number, viewZ: number, solo: boolean): RoomClearStyle {
	if (solo) return "full";
	const m = ROOM_CLEAR.nearTiles * TILE_SIZE;
	const near = viewX >= c.minX - m && viewX <= c.maxX + m && viewZ >= c.minZ - m && viewZ <= c.maxZ + m;
	return near ? "full" : "chip";
}

export interface TallySegment {
	kind: TallyKind;
	value: number;
	/** The counted-up value now (whole points). */
	shown: number;
	started: boolean;
}

export interface RoomClearChipLook {
	shown: boolean;
	perfect: boolean;
	/** A team perfect (CM2): the chip reads TEAM PERFECT. */
	team: boolean;
	rooms: number;
	points: number;
	/** Reference px to the right of its resting place (the slide in). */
	offsetPx: number;
	transparency: number;
}

export interface RoomClearLook {
	/** A full sequence is running (the stamp / tally are drawn). */
	active: boolean;
	perfect: boolean;
	/** A team perfect (CM2): the stamp reads TEAM PERFECT; `teamStreak` > 0 adds its streak ("TEAM PERFECT x3"). */
	team: boolean;
	teamStreak: number;
	rooms: number;
	stampScale: number;
	stampTransparency: number;
	/** PERFECT's shine: the UIGradient's x offset, -1 (left, off the letters) .. 1. */
	shineOffset: number;
	readonly segments: TallySegment[];
	segmentCount: number;
	/** Sum of the segments' shown values. */
	total: number;
	tallyTransparency: number;
	/** The flying bonus chip's progress 0..1, -1 hidden. */
	flyProgress: number;
	flyPoints: number;
	readonly chips: RoomClearChipLook[];
	/** Bonus points not yet released (the score panel hides them). */
	held: number;
	/**
	 * docs/FORTUNE.md FO7: the tally row's scale (the Horde segment's slam: 1 but while it lands; always 1 under reduced
	 * motion), and whether the Horde segment shows (the controller draws it in `pact.horde`).
	 */
	tallyScale: number;
	hordeShown: boolean;
	// --- one-shot cues of this frame (cleared by beginFrame) ---
	/** The stamp landed (jingle, camera kick). */
	landed: boolean;
	/** Tally segments that started counting (the tick sound). */
	ticks: number;
	/** Chips started (the half-volume jingle). */
	chipsStarted: number;
	/** Of those, team perfects (CM4: the team jingle at the chip's volume). */
	teamChipsStarted: number;
	/** Bonus points released this frame (the land sound, the slower roll). */
	bonusLanded: number;
	/** The Horde segment slammed in this frame (sfx.horde.double; never on a collapse). */
	hordeSlammed: boolean;
}

class Chip {
	live = false;
	merged = false;
	t = 0;
	points = 0;
	perfect = false;
	team = false;
	rooms = 1;
	motion = 1;
}

export class RoomClearSequence {
	readonly look: RoomClearLook;
	private active = false;
	private t = 0;
	private motion = 1;
	private collapseAt = -1;
	private landedDone = false;
	private released = true;
	private bonus = 0;
	/** docs/FORTUNE.md FO7: this sequence's extra length (a Horde segment), and that segment's index (-1: none). */
	private extend = 0;
	private hordeAt = -1;
	private readonly chipState: Chip[] = [];

	constructor() {
		const segments: TallySegment[] = [];
		for (let i = 0; i < ROOM_CLEAR_SEGMENTS; i++)
			segments.push({ kind: "clear", value: 0, shown: 0, started: false });
		const chips: RoomClearChipLook[] = [];
		for (let i = 0; i < ROOM_CLEAR.chip.max; i++) {
			chips.push({
				shown: false,
				perfect: false,
				team: false,
				rooms: 1,
				points: 0,
				offsetPx: 0,
				transparency: 1,
			});
			this.chipState.push(new Chip());
		}
		this.look = {
			active: false,
			perfect: false,
			team: false,
			teamStreak: 0,
			rooms: 1,
			stampScale: 1,
			stampTransparency: 1,
			shineOffset: -1,
			segments,
			segmentCount: 0,
			total: 0,
			tallyTransparency: 1,
			flyProgress: -1,
			flyPoints: 0,
			chips,
			held: 0,
			tallyScale: 1,
			hordeShown: false,
			landed: false,
			ticks: 0,
			chipsStarted: 0,
			teamChipsStarted: 0,
			bonusLanded: 0,
			hordeSlammed: false,
		};
	}

	/** A new run: drop everything without releasing (the roller is reset too). */
	clear(): void {
		this.active = false;
		this.released = true;
		for (const c of this.chipState) c.live = false;
		const L = this.look;
		L.active = false;
		L.held = 0;
		L.flyProgress = -1;
		for (const c of L.chips) c.shown = false;
		this.beginFrame();
	}

	/** Start of every frame: clear the one-shot cues. */
	beginFrame(): void {
		const L = this.look;
		L.landed = false;
		L.ticks = 0;
		L.chipsStarted = 0;
		L.teamChipsStarted = 0;
		L.bonusLanded = 0;
		L.hordeSlammed = false;
	}

	/**
	 * A clear: its full sequence (replacing a running one, whose bonus is released at once) or a corner chip.
	 * `foldPellets`: the pellet points join the kills segment (see roomClearSegments). `team`: the clear is a co-op team
	 * perfect (docs/RUN_RECAP.md CM2; only with c.perfect).
	 */
	start(
		c: RoomClear,
		style: RoomClearStyle,
		motion: number,
		foldPellets = false,
		team: RoomClearTeam | undefined = undefined,
	): void {
		const isTeam = team !== undefined && c.perfect;
		if (style === "chip") {
			this.startChip(c, motion, isTeam);
			return;
		}
		if (this.active) this.release();
		this.active = true;
		this.t = 0;
		this.motion = motion;
		this.collapseAt = -1;
		this.landedDone = false;
		this.released = false;
		this.bonus = roomClearBonus(c);
		const L = this.look;
		L.perfect = c.perfect;
		L.team = isTeam;
		L.teamStreak = isTeam && team.showStreak ? team.streak : 0;
		L.rooms = c.rooms;
		L.flyPoints = this.bonus;
		const entries = roomClearSegments(c, foldPellets);
		for (let n = 0; n < entries.size(); n++) {
			const s = L.segments[n];
			s.kind = entries[n].kind;
			s.value = entries[n].value;
			s.shown = 0;
			s.started = false;
		}
		L.segmentCount = entries.size();
		this.hordeAt = -1;
		for (let n = 0; n < entries.size(); n++) if (entries[n].kind === "horde") this.hordeAt = n;
		this.extend = this.hordeAt >= 0 ? ROOM_CLEAR.horde.extraSec : 0;
		L.tallyScale = 1;
		L.hordeShown = false;
	}

	/** When tally segment `i` starts: its slot in the row, or the Horde segment's slam after the one before it. */
	private segmentAt(i: number): number {
		const T = ROOM_CLEAR.tally;
		if (i !== this.hordeAt || i === 0) return T.startSec + i * T.gapSec;
		return T.startSec + (i - 1) * T.gapSec + T.countSec + ROOM_CLEAR.horde.leadSec;
	}

	/**
	 * Danger or a transition: release the bonus now and fade out over collapseSec. No-op when idle or collapsing. A
	 * collapse before the stamp landed still raises `landed` (once), so the room clear jingle is never lost.
	 */
	collapse(): void {
		if (!this.active || this.collapseAt >= 0) return;
		this.release();
		this.collapseAt = this.t;
		if (!this.landedDone) this.look.landed = true;
		this.landedDone = true;
	}

	frame(dt: number): RoomClearLook {
		const d = math.max(0, dt);
		this.stepChips(d);
		const L = this.look;
		if (this.active) this.stepFull(d);
		L.active = this.active;
		L.held = (this.released ? 0 : this.bonus) + this.chipsHeld();
		return L;
	}

	private release(): void {
		if (this.released) return;
		this.released = true;
		this.look.bonusLanded += this.bonus;
	}

	private stepFull(d: number): void {
		this.t += d;
		const t = this.t;
		const L = this.look;
		const S = ROOM_CLEAR.stamp;
		const collapsing = this.collapseAt >= 0;
		const u = clamp01((t - S.delaySec) / S.slamSec);
		if (!this.landedDone && t >= S.delaySec + S.slamSec) {
			this.landedDone = true;
			L.landed = true;
		}
		const base = L.perfect ? S.perfectScale : 1;
		L.stampScale = this.motion > 0 ? base * (S.slamFromScale + (1 - S.slamFromScale) * easeOutBack(u)) : base;
		const fadeIn = t < S.delaySec ? 0 : clamp01(u / S.fadeInFraction);
		const ext = this.extend;
		let out = clamp01((t - ROOM_CLEAR.fadeStartSec - ext) / (ROOM_CLEAR.totalSec - ROOM_CLEAR.fadeStartSec));
		if (collapsing) out = math.max(out, clamp01((t - this.collapseAt) / ROOM_CLEAR.collapseSec));
		L.stampTransparency = 1 - fadeIn * (1 - out);
		L.shineOffset = L.perfect ? -1 + 2 * clamp01((t - S.delaySec - S.slamSec) / S.shineSec) : -1;

		const T = ROOM_CLEAR.tally;
		const H = ROOM_CLEAR.horde;
		let total = 0;
		for (let i = 0; i < L.segmentCount; i++) {
			const s = L.segments[i];
			const at = this.segmentAt(i);
			const horde = i === this.hordeAt;
			if (!s.started && (collapsing || t >= at)) {
				s.started = true;
				if (!collapsing) {
					if (horde) L.hordeSlammed = true;
					else L.ticks += 1;
				}
			}
			// The Horde segment slams in at its full value (it doubles the total at once); the others count up.
			if (s.started)
				s.shown = collapsing || horde ? s.value : math.floor(s.value * clamp01((t - at) / T.countSec));
			total += s.shown;
		}
		L.total = total;
		L.tallyTransparency = out;
		const hordeSeg = this.hordeAt >= 0 ? L.segments[this.hordeAt] : undefined;
		L.hordeShown = hordeSeg !== undefined && hordeSeg.started;
		if (L.hordeShown && this.motion > 0 && !collapsing) {
			const v = clamp01((t - this.segmentAt(this.hordeAt)) / H.slamSec);
			L.tallyScale = H.slamFromScale + (1 - H.slamFromScale) * easeOutBack(v);
		} else L.tallyScale = 1;

		const F = ROOM_CLEAR.fly;
		const flyAt = F.startSec + ext;
		if (t >= flyAt + F.sec) this.release();
		L.flyProgress = this.released || this.motion <= 0 || t < flyAt ? -1 : clamp01((t - flyAt) / F.sec);

		const endAt = collapsing ? this.collapseAt + ROOM_CLEAR.collapseSec : ROOM_CLEAR.totalSec + ext;
		if (t >= endAt) {
			this.release();
			this.active = false;
			L.stampTransparency = 1;
			L.tallyTransparency = 1;
			L.tallyScale = 1;
			L.flyProgress = -1;
		}
	}

	private startChip(c: RoomClear, motion: number, team: boolean): void {
		let slot = -1;
		let oldest = 0;
		for (let i = 0; i < this.chipState.size(); i++) {
			const ch = this.chipState[i];
			if (!ch.live) {
				slot = i;
				break;
			}
			if (ch.t > this.chipState[oldest].t) oldest = i;
		}
		if (slot < 0) {
			this.mergeChip(this.chipState[oldest]);
			slot = oldest;
		}
		const ch = this.chipState[slot];
		ch.live = true;
		ch.merged = false;
		ch.t = 0;
		ch.points = roomClearBonus(c);
		ch.perfect = c.perfect;
		ch.team = team;
		ch.rooms = c.rooms;
		ch.motion = motion;
		this.look.chipsStarted += 1;
		if (team) this.look.teamChipsStarted += 1;
	}

	private mergeChip(ch: Chip): void {
		if (ch.merged) return;
		ch.merged = true;
		this.look.bonusLanded += ch.points;
	}

	private chipsHeld(): number {
		let held = 0;
		for (const ch of this.chipState) if (ch.live && !ch.merged) held += ch.points;
		return held;
	}

	private stepChips(d: number): void {
		const C = ROOM_CLEAR.chip;
		for (let i = 0; i < this.chipState.size(); i++) {
			const ch = this.chipState[i];
			const L = this.look.chips[i];
			if (!ch.live) {
				L.shown = false;
				continue;
			}
			ch.t += d;
			if (ch.t >= C.mergeSec) this.mergeChip(ch);
			if (ch.t >= ROOM_CLEAR.totalSec) {
				this.mergeChip(ch);
				ch.live = false;
				L.shown = false;
				continue;
			}
			const slide = clamp01(ch.t / C.slideSec);
			const out = clamp01((ch.t - ROOM_CLEAR.fadeStartSec) / (ROOM_CLEAR.totalSec - ROOM_CLEAR.fadeStartSec));
			L.shown = true;
			L.perfect = ch.perfect;
			L.team = ch.team;
			L.rooms = ch.rooms;
			L.points = ch.points;
			L.offsetPx = ch.motion > 0 ? C.slidePx * (1 - slide) : 0;
			L.transparency = 1 - slide * (1 - out);
		}
	}
}

/**
 * The score panel's rolling number (RCD7): shows trueScore - held, rolling up over ROOM_CLEAR.roll.killSec (or
 * bonusSec on a frame a bonus landed). Never counts down: a lower target (a new run) snaps.
 */
export class ScoreRoller {
	private from = 0;
	private to = 0;
	private t = 0;
	private dur = 0;
	shown = 0;

	reset(score: number): void {
		this.from = score;
		this.to = score;
		this.t = 0;
		this.dur = 0;
		this.shown = score;
	}

	frame(dt: number, trueScore: number, held: number, bonusLanded: boolean): number {
		const target = math.max(0, trueScore - held);
		if (target < this.shown) {
			this.reset(target);
			return this.shown;
		}
		if (target !== this.to) {
			this.from = this.exact();
			this.to = target;
			this.t = 0;
			this.dur = bonusLanded ? ROOM_CLEAR.roll.bonusSec : ROOM_CLEAR.roll.killSec;
		}
		this.t += math.max(0, dt);
		this.shown = math.floor(this.exact());
		return this.shown;
	}

	private exact(): number {
		if (this.dur <= 0) return this.to;
		return this.from + (this.to - this.from) * clamp01(this.t / this.dur);
	}
}
