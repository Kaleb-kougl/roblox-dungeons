# Room clear celebration: implementation guide

Step-by-step build instructions for `docs/ROOM_CLEAR.md`, written for an implementer who has not seen the planning
discussion. Do the steps **in order**, one commit each. Every step says what to read, what to write, which specs to add
and how to check it. Where this guide gives code, use it as written unless the compiler or a spec proves it wrong. If it
is wrong, fix it the smallest way and say so in the commit message.

Steps marked **[owner]** need Studio, a published place or the owner's ears. Do not do them; leave their checkboxes in
`docs/ROOM_CLEAR.md` open.

## 0. Rules for this work

Read `CLAUDE.md` first (all of it), then `docs/ROOM_CLEAR.md`. The rules that matter most here:

1. **Never edit `src/shared/sim/**`, `src/shared/dungeon/**`, `fixtures/**` or the source project.** This feature only
   READS the sim (`state.score`, `state.combat.actors`, `state.endless`). If a step seems to need a sim change, **stop
   and report**.
2. **Run `npm run verify` before every commit.** It must pass. Rerun only the specs you touched with
   `npm run test:only -- <path filter>` (for example `npm run test:only -- view/fx/roomClear`).
3. **No magic numbers.** Every tunable goes in `ROOM_CLEAR` (`src/shared/view/fx/roomClearConfig.ts`) or
   `ROOM_CLEAR_VIEW` (`src/shared/view/hud/roomClear.ts`). Inline literals are only 0, 1, -1, 2 in arithmetic and loop
   bounds.
4. **Barrels.** Export every new module from its directory's `index.ts`; import from the directory (`shared/view/fx`,
   `shared/view/hud`, `shared/sim`), never from the file. Inside `src/shared/view/fx` itself, import siblings by file
   (`./roomClearConfig`), as the existing files do.
5. **roblox-ts traps** (from CLAUDE.md):
   - `null` -> `undefined`; `.length` -> `.size()`; no `splice` / `slice` (use `arr.remove(i)`, `arr.clear()`).
   - `for (let i = 0; i < arr.size(); i++)` reads the bound once; use `while` if the body changes the array.
   - Keep the loop variable alone on the left of a `for` condition.
   - Interface members that are functions: type them as properties `f: (a: T) => U`.
   - `Map` / `Set` iteration order is not insertion order: use arrays where order matters.
   - `**` compiles to `^`; write plain multiplication.
6. **Client code cannot be tested headlessly.** Only `src/shared/**` specs run. For client steps, "verified" means
   typecheck + lint + build pass; the Studio checks are [owner] steps.
7. **Janitor** for cleanup; every connection and Instance a controller makes goes into its Janitor.
8. **Follow the last similar change.** Many steps say "add X everywhere Y appears". Do it with a search, e.g.
   `grep -rn "sfx.boost.aegisbreak" src art` lists every list a new port sound must join. Put the new entry right after
   the found one, with a short comment naming `docs/ROOM_CLEAR.md`.
9. **Stop and report** (plain text: what failed, the file, the command output) when the baseline `npm run verify`
   fails before you start, when a spec you did not write fails and this guide does not say how to fix it, when a name
   this guide uses does not exist and the right one is not obvious, or when a command needs a tool you do not have.

**Before step RC1:** `git status` must be clean. If it shows changes you did not make (another feature in progress),
stop and ask the owner to commit them. Then `git switch -c room-clear` from `main`, and run `npm run verify` once to
confirm the baseline passes.

## What you are building (short version)

When the sim clears an encounter room (`clearRoom` in `src/shared/sim/score/score.ts` sets `RoomScore.cleared` to 1
and awards the `ROOMS`, maybe `PERFECT`, maybe `FAST` score sources):

- **Solo, or co-op near the room:** a full sequence, 1.5 s: slow motion (0.5x easing back; solo only), a ring of
  sparks at the last kill, a **CLEAR** / **PERFECT** stamp at the top centre, one tally row under it counting up
  segment by segment (`Kills 1240   Clear +250   No hits +500   Speed +87   = 2077`), then a `+bonus` chip flies to
  the score panel, which rolls up.
- **Co-op, the view player far from the room:** a small chip under the score panel (`PERFECT +1250`) that merges into
  the score.
- The score panel never shows a bonus before it lands, and rolls instead of jumping.
- Juice setting **Room clear** On / Off (default On).

Everything is presentation. The data comes from a per-tick collector that diffs `state.score`.

---

## RC1. The collector (pure)

**Goal:** every room clear of every tick, with exact points, delivered to the views once per frame.

**Read:** `src/shared/sim/score/score.ts` (the file comment, `RoomScore`, `clearRoom`, `stepScore`),
`src/shared/sim/score/scoreData.ts` (`ScoreSource`), `src/shared/view/boosts/events.ts` (the pattern: `reset()` per
frame, `collect(state)` per tick), `src/shared/play/liveRun.ts` (`RunView`, `observeTick`, `frame`),
`src/shared/lockstep/client.ts` (`pump`).

### 1a. `src/shared/view/fx/roomClears.ts`

```ts
/**
 * Room clears for the celebration (docs/ROOM_CLEAR.md RC1). The sim's score records (shared/sim score.ts RoomScore)
 * flip `cleared` 0 -> 1 on the tick a room clears and award ROOMS / PERFECT / FAST in the same tick. A rendered frame
 * may run several ticks, so the run views (shared/play LiveRun, shared/lockstep LockstepClient) `collect` after every
 * tick and `reset` at the start of every frame, as they do BoostFrameEvents. Read-only on the sim; no allocation per
 * tick except a clear record (a few per floor). Presentation only: nothing here is hashed or written back.
 *
 * Points are this tick's per-source deltas of `score.points` (exact award values, every multiplier included). Two rooms
 * that clear on the same tick cannot be split, so they make ONE clear with `rooms` 2 (perfect only when both were:
 * the PERFECT award count rose by `rooms`). Room points = score total now - the total before the room's engagement
 * tick (the tick its engageTick left -1); kill points = room points - the bonus (0 when the engagement was not seen).
 */
import { NO_KIND, ScoreSource, type RoomScore, type ScoreState, type SimState } from "shared/sim";

/** One room clear (or two on the same tick). Plain numbers. */
export interface RoomClear {
	/** RoomScore.room of the first room that cleared this tick (record order). */
	readonly room: number;
	/** Rooms that cleared on this tick (1, rarely 2+). */
	readonly rooms: number;
	/** Every room of this clear got the perfect award. */
	readonly perfect: boolean;
	/** Points scored from the engagement to the clear, bonuses excluded (0 when unknown). */
	readonly killPoints: number;
	/** This tick's ROOMS / PERFECT / FAST award points. */
	readonly clearPoints: number;
	readonly perfectPoints: number;
	readonly fastPoints: number;
	/** The last killed member's position (sim units), else the room's centre. */
	readonly x: number;
	readonly z: number;
	/** The last killed member's actor slot and ActorState.id (-1 / 0: none found). */
	readonly slot: number;
	readonly actorId: number;
	/** The first room's bounds (sim units). */
	readonly minX: number;
	readonly maxX: number;
	readonly minZ: number;
	readonly maxZ: number;
	/** state.tick at the end of the clear tick. */
	readonly tick: number;
}

/** What the views read once per frame (RoomClearEvents satisfies it). */
export interface RoomClearSource {
	readonly clears: ReadonlyArray<RoomClear>;
	/** Rooms that engaged during this frame's ticks (a new fight started: the celebration collapses). */
	readonly engaged: number;
}

const HALF = 0.5;

/** The member of `r` that died last (alive 0, smallest deadTicks; ties: the first), or -1. */
function lastKilledMember(state: Readonly<SimState>, r: Readonly<RoomScore>): number {
	let best = -1;
	let bestTicks = math.huge;
	for (let k = 0; k < r.memberSlots.size(); k++) {
		const a = state.combat.actors[r.memberSlots[k]];
		if (a === undefined || a.kind === NO_KIND || a.id !== r.memberIds[k] || a.alive !== 0) continue;
		if (a.deadTicks < bestTicks) {
			bestTicks = a.deadTicks;
			best = k;
		}
	}
	return best;
}

export class RoomClearEvents implements RoomClearSource {
	readonly clears: RoomClear[] = [];
	engaged = 0;

	private started = false;
	private floor = 0;
	private roomCount = 0;
	private prevTotal = 0;
	private prevRooms = 0;
	private prevPerfect = 0;
	private prevPerfectCount = 0;
	private prevFast = 0;
	private readonly prevCleared: number[] = [];
	private readonly prevEngage: number[] = [];
	/** Score total before each room's engagement tick, -1 unknown. */
	private readonly totalAtEngage: number[] = [];

	/** A new frame: forget the last one's clears. */
	reset(): void {
		this.clears.clear();
		this.engaged = 0;
	}

	/** After every tick. No-op without scoring. */
	collect(state: Readonly<SimState>): void {
		const s = state.score;
		if (s === undefined) return;
		const floor = state.endless?.floor ?? 0;
		if (!this.started || floor !== this.floor || s.rooms.size() !== this.roomCount) {
			this.baseline(s, floor);
			return;
		}
		let n = 0;
		let first = -1;
		for (let i = 0; i < s.rooms.size(); i++) {
			const r = s.rooms[i];
			if (this.prevEngage[i] < 0 && r.engageTick >= 0) {
				this.totalAtEngage[i] = this.prevTotal;
				this.engaged += 1;
			}
			if (this.prevCleared[i] === 0 && r.cleared !== 0) {
				n += 1;
				if (first < 0) first = i;
			}
			this.prevEngage[i] = r.engageTick;
			this.prevCleared[i] = r.cleared;
		}
		if (n > 0) this.pushClear(state, s, first, n);
		this.remember(s);
	}

	private pushClear(state: Readonly<SimState>, s: Readonly<ScoreState>, first: number, n: number): void {
		const r = s.rooms[first];
		const clearPoints = s.points[ScoreSource.ROOMS] - this.prevRooms;
		const perfectPoints = s.points[ScoreSource.PERFECT] - this.prevPerfect;
		const fastPoints = s.points[ScoreSource.FAST] - this.prevFast;
		const perfects = s.counts[ScoreSource.PERFECT] - this.prevPerfectCount;
		const bonus = clearPoints + perfectPoints + fastPoints;
		const engagedAt = this.totalAtEngage[first];
		const killPoints = engagedAt >= 0 ? math.max(0, s.total - engagedAt - bonus) : 0;
		const k = lastKilledMember(state, r);
		const a = k >= 0 ? state.combat.actors[r.memberSlots[k]] : undefined;
		this.clears.push({
			room: r.room,
			rooms: n,
			perfect: perfects >= n,
			killPoints,
			clearPoints,
			perfectPoints,
			fastPoints,
			x: a !== undefined ? a.x : (r.minX + r.maxX) * HALF,
			z: a !== undefined ? a.z : (r.minZ + r.maxZ) * HALF,
			slot: a !== undefined ? r.memberSlots[k] : -1,
			actorId: a !== undefined ? a.id : 0,
			minX: r.minX,
			maxX: r.maxX,
			minZ: r.minZ,
			maxZ: r.maxZ,
			tick: state.tick,
		});
	}

	/** First tick, a floor change (records rebuilt) or a record count change: take a fresh baseline, emit nothing. */
	private baseline(s: Readonly<ScoreState>, floor: number): void {
		this.started = true;
		this.floor = floor;
		this.roomCount = s.rooms.size();
		this.prevCleared.clear();
		this.prevEngage.clear();
		this.totalAtEngage.clear();
		for (const r of s.rooms) {
			this.prevCleared.push(r.cleared);
			this.prevEngage.push(r.engageTick);
			this.totalAtEngage.push(-1);
		}
		this.remember(s);
	}

	private remember(s: Readonly<ScoreState>): void {
		this.prevTotal = s.total;
		this.prevRooms = s.points[ScoreSource.ROOMS];
		this.prevPerfect = s.points[ScoreSource.PERFECT];
		this.prevPerfectCount = s.counts[ScoreSource.PERFECT];
		this.prevFast = s.points[ScoreSource.FAST];
	}
}

/** No clears (a run view without scoring, the specs' default). */
export const NO_ROOM_CLEARS: RoomClearSource = new RoomClearEvents();
```

Export it from `src/shared/view/fx/index.ts` (`export * from "./roomClears";`). If `NO_KIND`, `ScoreSource` or
`RoomScore` do not import from `shared/sim`, check `src/shared/sim/index.ts` and import what it exports (do not add
exports to the sim).

### 1b. Spec `src/shared/view/fx/roomClears.spec.ts`

Build a fake state by hand (the collector only reads `score.total`, `score.points`, `score.counts`, `score.rooms`,
`endless.floor`, `combat.actors`, `tick`) and cast it: `const state = fake as unknown as SimState`. A helper:

```ts
function fakeState(): { tick: number; score: { total: number; points: number[]; counts: number[]; rooms: RoomScoreLike[] };
	combat: { actors: ActorLike[] }; endless?: { floor: number } }
```

with `points` / `counts` of length `SCORE_SOURCE_COUNT` (from `shared/sim`), one room
`{ room: 3, minX: 0, maxX: 10, minZ: 0, maxZ: 8, parTicks: 600, engageTick: -1, hitsAtEngage: 0, cleared: 0,
memberSlots: [0, 1], memberIds: [11, 12] }` and two actors `{ kind: 0, id: 11, alive: 1, deadTicks: 0, x: 2, z: 3 }`,
`{ kind: 0, id: 12, alive: 1, deadTicks: 0, x: 7, z: 5 }`. Mutate it between `collect` calls to play ticks. Cases:

1. First `collect` is a baseline: no clears even if a room is already cleared.
2. Engage on tick 2 (`engageTick = 2`, `total` 100 before): `engaged` 1 on that collect; then kills raise `total` to
   400; on the clear tick set `cleared = 1`, actors dead (`alive 0`, one `deadTicks 5`, the other `deadTicks 0`),
   `points[ROOMS] += 250`, `points[PERFECT] += 500`, `counts[PERFECT] += 1`, `points[FAST] += 90`,
   `total += 840`. Expect one clear: `perfect` true, `clearPoints` 250, `perfectPoints` 500, `fastPoints` 90,
   `killPoints` 300 (1240 - 100 - 840), position (7, 5), `slot` 1, `actorId` 12, `rooms` 1.
3. Same without the perfect award: `perfect` false, `perfectPoints` 0.
4. No member found (both ids changed): position is the room centre (5, 4), `slot` -1.
5. Two rooms clear on one tick, one perfect award: one clear, `rooms` 2, `perfect` false; with two perfect awards:
   `perfect` true.
6. A floor change (`endless.floor` 1 -> 2) on the same collect as `cleared` flips: baseline, no clear.
7. A clear whose engagement was never seen (engaged before the baseline): `killPoints` 0.
8. `reset()` empties `clears` and zeroes `engaged`; a state without `score` never emits.

Write numbers as literals in the spec (specs may), and assert with `toBe` / `toEqual` (no float tolerance: nothing
here passes through a Roblox property).

### 1c. Wire it into the run views

- `src/shared/play/liveRun.ts`:
  - `RunView` gains `readonly roomClears: RoomClearSource;` with a doc comment ("the room clears of the last frame's
    ticks, docs/ROOM_CLEAR.md").
  - `LiveRun` gains `readonly roomClears = new RoomClearEvents();` next to `boostEvents`.
  - In `frame()`: `this.roomClears.reset();` right after `this.boostEvents.reset();`.
  - In `observeTick()`: `this.roomClears.collect(state);` right after `this.boostEvents.collect(state);`.
  - Import `RoomClearEvents, type RoomClearSource` from `shared/view/fx` (the file already imports from there).
- `src/shared/lockstep/client.ts` (`LockstepClient`): the same three changes (field, `reset()` next to
  `this.boostEvents.reset();` in `pump`, `collect(state)` next to `this.boostEvents.collect(state);`).
- Anything else that implements `RunView` (search `implements RunView` and object literals typed `RunView` in specs)
  gets `roomClears: NO_ROOM_CLEARS`.

**Verify:** `npm run verify`. Every golden / replay / hash spec must be unchanged: you touched no sim file.
**Commit:** `Room clear RC1: per-tick room clear collector on the run views`.

---

## RC2. Tunables, style, sequence, roller (pure)

**Goal:** the whole 1.5 s timeline as a pure state machine the controller only reads.

**Read:** `src/shared/view/fx/hitstop.ts` (`smoothstep01`), `src/shared/view/fx/hurtFlash.ts` (a small pure timed
effect and its spec), `src/shared/sim/units.ts` (`TILE_SIZE`).

### 2a. `src/shared/view/fx/roomClearConfig.ts`

```ts
/**
 * Room clear celebration tunables (docs/ROOM_CLEAR.md). Real (unpaused) seconds unless the name says otherwise. The
 * sequence clock is NOT slowed by hitstop: the stamp must not crawl through its own slow motion. Data only.
 */
export const ROOM_CLEAR = {
	/** Every phase of the full sequence and of a chip ends by this (RCD10). */
	totalSec: 1.5,
	/** Longest step one frame may take (a hitch never skips the stamp). */
	maxFrameDtSec: 0.1,
	/** Solo slow motion (RCD11): HitstopClock.requestSlowMo(ms, fromScale). */
	slowMo: {
		clear: { fromScale: 0.5, ms: 500 },
		perfect: { fromScale: 0.5, ms: 700 },
	},
	stamp: {
		delaySec: 0.06,
		slamSec: 0.1,
		/** Scale at the start of the slam (it eases out back to 1). */
		slamFromScale: 2,
		/** The stamp is opaque after this fraction of the slam. */
		fadeInFraction: 0.4,
		/** PERFECT is drawn this much larger. */
		perfectScale: 1.1,
		/** PERFECT's shine sweeps once across the letters after the landing. */
		shineSec: 0.4,
		/** Ease-out-back overshoot constant (the standard 1.70158). */
		easeBack: 1.70158,
	},
	/** The tally row: segment i starts at startSec + i x gapSec and counts up over countSec. */
	tally: { startSec: 0.3, gapSec: 0.12, countSec: 0.2 },
	/** The bonus chip flies to the score panel; it lands (the bonus is released) at startSec + sec. */
	fly: { startSec: 0.95, sec: 0.2 },
	/** Stamp, tally and chips fade out from here to totalSec. */
	fadeStartSec: 1.2,
	/** A collapsed sequence fades out over this. */
	collapseSec: 0.15,
	/** The corner chip (RCD12): slides in from the right, merges into the score at mergeSec. */
	chip: { slideSec: 0.12, slidePx: 40, mergeSec: 0.9, max: 2, jingleVolume: 0.5 },
	/** The score panel rolls a kill's points over killSec and a landed bonus over bonusSec. */
	roll: { killSec: 0.15, bonusSec: 0.3 },
	/** Co-op: the view player within this many tiles of the room's bounds gets the full sequence, else a chip. */
	nearTiles: 4,
	/** Co-op: the last killed member's sprite holds this long (instead of slow motion). */
	coopHoldSec: 0.2,
	/** The spark ring at the last kill (ParticleController chips, BOOST_VIEW burst shape). */
	burst: { chunks: 0, bits: 16, sparks: 10, startPx: 8, radiusTiles: 0.4, speed: 1.4 },
	/** burstSeed salt (actors use 0..3, breakables 11 / 12, boosts 13 / 14). */
	burstSeedSalt: 15,
} as const;
```

### 2b. `src/shared/view/fx/roomClearSequence.ts`

```ts
/**
 * The room clear celebration's timeline (docs/ROOM_CLEAR.md RC2), pure. The controller, once per frame and in this
 * order: beginFrame(); collapse() if danger; start() for each new clear; frame(dt); then reads `look`. One full
 * sequence at a time (a new one releases the old one's bonus at once and replaces it) and up to ROOM_CLEAR.chip.max
 * corner chips (a new chip past the cap merges the oldest at once). Every bonus is released exactly once:
 * `look.bonusLanded` is the points released this frame, `look.held` the points not yet released.
 */
import { TILE_SIZE } from "shared/sim";
import { ROOM_CLEAR } from "./roomClearConfig";
import type { RoomClear } from "./roomClears";

export type RoomClearStyle = "full" | "chip";
export type TallyKind = "kills" | "clear" | "perfect" | "fast";

/** Tally segments at most (kills, clear, perfect, fast). */
export const ROOM_CLEAR_SEGMENTS = 4;

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

/** The clear's bonus points (what flies to the score panel). */
export function roomClearBonus(c: RoomClear): number {
	return c.clearPoints + c.perfectPoints + c.fastPoints;
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
	// --- one-shot cues of this frame (cleared by beginFrame) ---
	/** The stamp landed (jingle, camera kick). */
	landed: boolean;
	/** Tally segments that started counting (the tick sound). */
	ticks: number;
	/** Chips started (the half-volume jingle). */
	chipsStarted: number;
	/** Bonus points released this frame (the land sound, the slower roll). */
	bonusLanded: number;
}

class Chip {
	live = false;
	merged = false;
	t = 0;
	points = 0;
	perfect = false;
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
	private readonly chipState: Chip[] = [];

	constructor() {
		const segments: TallySegment[] = [];
		for (let i = 0; i < ROOM_CLEAR_SEGMENTS; i++) segments.push({ kind: "clear", value: 0, shown: 0, started: false });
		const chips: RoomClearChipLook[] = [];
		for (let i = 0; i < ROOM_CLEAR.chip.max; i++) {
			chips.push({ shown: false, perfect: false, rooms: 1, points: 0, offsetPx: 0, transparency: 1 });
			this.chipState.push(new Chip());
		}
		this.look = {
			active: false,
			perfect: false,
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
			landed: false,
			ticks: 0,
			chipsStarted: 0,
			bonusLanded: 0,
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
		L.bonusLanded = 0;
	}

	start(c: RoomClear, style: RoomClearStyle, motion: number): void {
		if (style === "chip") {
			this.startChip(c, motion);
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
		L.rooms = c.rooms;
		L.flyPoints = this.bonus;
		let n = 0;
		const put = (kind: TallyKind, value: number) => {
			const s = L.segments[n];
			s.kind = kind;
			s.value = value;
			s.shown = 0;
			s.started = false;
			n += 1;
		};
		if (c.killPoints > 0) put("kills", c.killPoints);
		put("clear", c.clearPoints);
		if (c.perfectPoints > 0) put("perfect", c.perfectPoints);
		if (c.fastPoints > 0) put("fast", c.fastPoints);
		L.segmentCount = n;
	}

	/** Danger or a transition: release the bonus now and fade out over collapseSec. No-op when idle or collapsing. */
	collapse(): void {
		if (!this.active || this.collapseAt >= 0) return;
		this.release();
		this.collapseAt = this.t;
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
		let out = clamp01((t - ROOM_CLEAR.fadeStartSec) / (ROOM_CLEAR.totalSec - ROOM_CLEAR.fadeStartSec));
		if (collapsing) out = math.max(out, clamp01((t - this.collapseAt) / ROOM_CLEAR.collapseSec));
		L.stampTransparency = 1 - fadeIn * (1 - out);
		L.shineOffset = L.perfect ? -1 + 2 * clamp01((t - S.delaySec - S.slamSec) / S.shineSec) : -1;

		const T = ROOM_CLEAR.tally;
		let total = 0;
		for (let i = 0; i < L.segmentCount; i++) {
			const s = L.segments[i];
			const at = T.startSec + i * T.gapSec;
			if (!s.started && (collapsing || t >= at)) {
				s.started = true;
				if (!collapsing) L.ticks += 1;
			}
			if (s.started) s.shown = collapsing ? s.value : math.floor(s.value * clamp01((t - at) / T.countSec));
			total += s.shown;
		}
		L.total = total;
		L.tallyTransparency = out;

		const F = ROOM_CLEAR.fly;
		if (t >= F.startSec + F.sec) this.release();
		L.flyProgress =
			this.released || this.motion <= 0 || t < F.startSec ? -1 : clamp01((t - F.startSec) / F.sec);

		const endAt = collapsing ? this.collapseAt + ROOM_CLEAR.collapseSec : ROOM_CLEAR.totalSec;
		if (t >= endAt) {
			this.release();
			this.active = false;
			L.stampTransparency = 1;
			L.tallyTransparency = 1;
			L.flyProgress = -1;
		}
	}

	private startChip(c: RoomClear, motion: number): void {
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
		ch.rooms = c.rooms;
		ch.motion = motion;
		this.look.chipsStarted += 1;
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
```

Export both files from `src/shared/view/fx/index.ts`. Run `npm run lint:fix` (eslint + prettier, `--max-warnings=0` in
verify) after pasting any code from this guide: it reformats to the repo's prettier settings.

### 2c. Spec `src/shared/view/fx/roomClearSequence.spec.ts`

Make a `RoomClear` literal helper (`clear({ perfect, killPoints, ... })` with the RC1 field defaults). Drive the
sequence with a fixed step `STEP = 1 / 60` through a helper `run(seq, seconds)` that calls `beginFrame()` +
`frame(STEP)` repeatedly and sums `ticks` / `bonusLanded` / counts `landed`. Cases:

1. `roomClearStyle`: solo is always `full`; co-op inside the bounds, exactly `nearTiles` outside (full) and just past
   it (chip).
2. Timeline: `landed` fires once, at the first frame with `t >= 0.16`; the stamp scale dips below 1 (the ease-out-back
   overshoot of the shrink) and ends at 1 (1.1 for perfect); four segments tick four times, in order, each `shown` ending at its value; `total`
   ends at the sum; `bonusLanded` totals the bonus exactly once, at about 1.15 s; `active` is false by 1.5 s.
3. Segments: no kills segment when `killPoints` 0; no perfect / fast segments when those points are 0.
4. `held` equals the bonus until the fly lands, then 0.
5. Reduced motion (`motion` 0): `stampScale` stays at 1 (1.1 perfect), `flyProgress` stays -1, the bonus still
   lands once.
6. `collapse()` at 0.05 s, 0.5 s and 1.0 s: the bonus lands exactly once in total, the full sequence is inactive within
   `collapseSec` + one step, `landed` never fires after a collapse; `collapse()` twice is harmless.
7. A second `start` mid-sequence releases the first bonus at once (bonusLanded on that frame) and runs the second.
8. Chips: a chip merges its points once at about 0.9 s; three chips with `max` 2: the oldest merges when the third
   starts; `held` counts unmerged chips; chips are hidden by 1.5 s; `offsetPx` is 0 under motion 0.
9. A huge step (`frame(5)`): everything released exactly once, inactive.
10. `ScoreRoller`: rolls up to `trueScore - held` over `killSec`; never shows a held bonus; after the bonus is
    released with `bonusLanded` true it reaches the true score within `bonusSec`; a lower target snaps (new run);
    `shown` is always a whole number and never decreases otherwise.
11. Every phase ends by `totalSec`: `fly.startSec + fly.sec + roll.bonusSec <= totalSec`,
    `chip.mergeSec + roll.bonusSec <= totalSec`, `fadeStartSec < totalSec`.

**Verify:** `npm run verify`.
**Commit:** `Room clear RC2: tunables, style, sequence and score roller (pure)`.

---

## RC3. The setting, the strings and the HUD numbers

**Goal:** Options > Juice > Room clear (On / Off), every string the feature shows, and the HUD layout numbers.

**Read:** `src/shared/settings/juice.ts`, `src/shared/settings/settings.spec.ts` (the `screenShake` case),
`src/shared/view/hud/strings.ts` (`SETTINGS_STRINGS`), `src/shared/view/preloadStrings.ts` and the "the loading
screen's strings" case in `src/shared/view/preload.spec.ts` (the pattern for required strings),
`src/shared/theme/contract.ts` (`TOUCH_STRING_KEYS`, `REQUIRED_STRING_KEYS`), `src/shared/view/hud/layout.ts`
(`HUD_VIEW`), `src/shared/view/hud/tutorial.ts` (`TUTORIAL_VIEW`).

### 3a. The setting

- `src/shared/settings/juice.ts`:
  - `JuiceSettings` gains, after `screenShake`:
    `/** Port (docs/ROOM_CLEAR.md RCD13): the room clear celebration. Off keeps only the room clear jingle. */`
    `roomClear: boolean;`
  - `JUICE_SETTING_KEYS`: `"roomClear"` after `"screenShake"`.
  - `defaultJuiceSettings`: `roomClear: true,` after `screenShake: true,`.
  - `readField`: `if (typeIs(raw.roomClear, "boolean")) out.roomClear = raw.roomClear;` after the screenShake line.
- `src/shared/settings/settings.spec.ts`: add `roomClear: true` to the default object the specs compare against (next
  to `screenShake: true`), and a case `"roomClear (port, docs/ROOM_CLEAR.md RC3): sanitized, round-trips, absent in
  old docs, cleared by a reset"` that copies the screenShake case line for line with `roomClear`.
- Search `src` for other places that list every juice key (`grep -rn "screenShake" src`); add `roomClear` next to
  each, except juiceRules.ts / freezeRules.ts (they read screenShake on purpose).

### 3b. The strings

- `src/shared/view/hud/strings.ts`: `SETTINGS_STRINGS` gains
  `/** Port (docs/ROOM_CLEAR.md RC3): the Room clear row. */ roomClear: "fx.settings.roomClear",` after `screenShake`.
- `src/shared/theme/contract.ts`, after `TOUCH_STRING_KEYS`:

```ts
/**
 * Roblox port (docs/ROOM_CLEAR.md RC3): the room clear celebration's strings (shared/view ROOM_CLEAR_STRINGS): the
 * two stamps, the stamp for several rooms on one tick (`{stamp}`, `{rooms}`), the tally segments (`{points}`), the
 * running total, the corner chip (`{stamp}`, `{points}`) and the flying bonus (`{points}`). The theme imports nothing
 * outside shared/theme, so the list is repeated here.
 */
export const ROOM_CLEAR_STRING_KEYS = [
	"roomClear.stamp.clear",
	"roomClear.stamp.perfect",
	"roomClear.stamp.multi",
	"roomClear.line.kills",
	"roomClear.line.clear",
	"roomClear.line.perfect",
	"roomClear.line.fast",
	"roomClear.total",
	"roomClear.chip",
	"roomClear.fly",
] as const;
```

  and `...ROOM_CLEAR_STRING_KEYS,` at the end of `REQUIRED_STRING_KEYS`. Export it from `src/shared/theme/index.ts` if
  `TOUCH_STRING_KEYS` is exported there.
- `src/shared/theme/packs/placeholder/manifest.ts`, after the `"touch.hint.mapClose"` line (only the placeholder
  manifest has these strings; the vale pack inherits them):

```ts
		// --- roomClear.* (docs/ROOM_CLEAR.md RC3: the room clear stamp, tally and chips) ------------------------
		"roomClear.stamp.clear": "CLEAR",
		"roomClear.stamp.perfect": "PERFECT",
		"roomClear.stamp.multi": "{stamp} x{rooms}",
		"roomClear.line.kills": "Kills {points}",
		"roomClear.line.clear": "Clear +{points}",
		"roomClear.line.perfect": "No hits +{points}",
		"roomClear.line.fast": "Speed +{points}",
		"roomClear.total": "= {points}",
		"roomClear.chip": "{stamp} +{points}",
		"roomClear.fly": "+{points}",
```

  and next to `"fx.settings.screenShake": "Screen shake",`: `"fx.settings.roomClear": "Room clear",`.

### 3c. `src/shared/view/hud/roomClear.ts` (export from `src/shared/view/hud/index.ts`)

```ts
/**
 * The room clear celebration's HUD (docs/ROOM_CLEAR.md RC3 / RC7): its strings, layout numbers (reference px, like
 * HUD_VIEW) and the pure text builders the controller uses. The stamp and its one-row tally sit in the boss bar's
 * slot at the top centre (no boss bar shows while a room record clears), above the toasts and the touch tutorial
 * prompt; the corner chips sit under the score panel (footprint.ts HUD_TRANSIENT.roomClear / roomClearChip).
 */
import type { StringVars } from "shared/theme";
import type { RoomClearLook, TallyKind } from "../fx";
import { HUD_VIEW } from "./layout";
import { TUTORIAL_VIEW } from "./tutorial";

/** Every theme string key the celebration reads; all REQUIRED (theme contract ROOM_CLEAR_STRING_KEYS). */
export const ROOM_CLEAR_STRINGS = {
	clear: "roomClear.stamp.clear",
	perfect: "roomClear.stamp.perfect",
	multi: "roomClear.stamp.multi",
	kills: "roomClear.line.kills",
	clearLine: "roomClear.line.clear",
	perfectLine: "roomClear.line.perfect",
	fast: "roomClear.line.fast",
	total: "roomClear.total",
	chip: "roomClear.chip",
	fly: "roomClear.fly",
} as const;

export const ROOM_CLEAR_VIEW = {
	/** The stamp row's width: the touch tutorial prompt's, which is proven to fit between the top corners on touch. */
	width: TUTORIAL_VIEW.touchPanelWidth,
	stampText: HUD_VIEW.bigText,
	/** The tally row's largest text size (it is TextScaled down to fit `width`). */
	tallyText: HUD_VIEW.smallText,
	/** Between the stamp and the tally row. */
	rowGap: 4,
	/** Between tally segments. */
	separator: "   ",
	/** PERFECT's shine band: half its width, as a fraction of the stamp (UIGradient keypoints). */
	shineHalfWidth: 0.08,
	/** The flying bonus chip. */
	flyText: HUD_VIEW.titleText,
	flyWidth: 160,
	/** Where it lands: this far below the safe area's top, under the score panel's number. */
	flyTargetY: 40,
	/** Corner chips: text size, and how many (must equal ROOM_CLEAR.chip.max; the spec checks). */
	chipText: HUD_VIEW.textSize,
	maxChips: 2,
} as const;

export type RoomClearStr = (key: string, vars?: StringVars) => string;

const SEGMENT_KEYS: Readonly<Record<TallyKind, string>> = {
	kills: ROOM_CLEAR_STRINGS.kills,
	clear: ROOM_CLEAR_STRINGS.clearLine,
	perfect: ROOM_CLEAR_STRINGS.perfectLine,
	fast: ROOM_CLEAR_STRINGS.fast,
};

/** CLEAR / PERFECT, or "PERFECT x2" for several rooms on one tick. */
export function roomClearStampText(perfect: boolean, rooms: number, s: RoomClearStr): string {
	const stamp = s(perfect ? ROOM_CLEAR_STRINGS.perfect : ROOM_CLEAR_STRINGS.clear);
	return rooms > 1 ? s(ROOM_CLEAR_STRINGS.multi, { stamp, rooms }) : stamp;
}

/** The tally row: every started segment with its counted value, then "= total" ("" before the first segment). */
export function roomClearTallyText(
	look: Pick<RoomClearLook, "segments" | "segmentCount" | "total">,
	s: RoomClearStr,
): string {
	const parts: string[] = [];
	for (let i = 0; i < look.segmentCount; i++) {
		const seg = look.segments[i];
		if (!seg.started) break;
		parts.push(s(SEGMENT_KEYS[seg.kind], { points: seg.shown }));
	}
	if (parts.size() === 0) return "";
	parts.push(s(ROOM_CLEAR_STRINGS.total, { points: look.total }));
	return parts.join(ROOM_CLEAR_VIEW.separator);
}
```

If `import type ... from "../fx"` makes a require cycle or lint complains, import the types from `"shared/view/fx"`
instead (type-only imports are erased, so either is safe at run time).

### 3d. Spec `src/shared/view/hud/roomClear.spec.ts`

1. The strings: `ROOM_CLEAR_STRINGS` values, in order, equal `[...ROOM_CLEAR_STRING_KEYS]`; each is in
   `REQUIRED_STRING_KEYS`; each exists in a `ThemePack` built from `PLACEHOLDER_MANIFEST` and from `VALE_MANIFEST`
   (copy the loading-strings case in `preload.spec.ts`, including its quiet warn sink).
2. `roomClearStampText` with the placeholder pack's `str`: `CLEAR`, `PERFECT`, `PERFECT x2`.
3. `roomClearTallyText`: empty before the first segment starts; with kills 300, clear 250, perfect 500, fast 90 all
   started and counted: `"Kills 300   Clear +250   No hits +500   Speed +90   = 1140"`; with only the first two
   started: stops after them and the total is theirs.
4. `ROOM_CLEAR_VIEW.maxChips === ROOM_CLEAR.chip.max`.

**Verify:** `npm run verify`. hud.spec.ts checks option string keys exist: if it fails on `fx.settings.roomClear`,
the placeholder line is missing.
**Commit:** `Room clear RC3: Room clear setting, strings and HUD numbers`.

---

## RC4. The sounds

**Goal:** three new port sound IDs (silent until the owner uploads them) and the mapper's jingle handed to the
celebration while it is on.

**Read:** `src/shared/theme/contract.ts` (`PORT_AUDIO_EVENTS`), `src/shared/view/audio/cues.ts` (`SFX`, `ALL_SFX`,
`PORT_SFX`, the priority table, `JINGLE_SFX`, `DUCKING_SFX`, `SFX_FALLBACK`, `AudioCueMapper.frame` where it plays
`SFX.roomClear`), `src/client/controllers/audio/AudioController.ts` (`fx.onFrame`, `play`), `art/audio.json`
(the `sfx.room.clear` entry), `docs/FX_AUDIO.md` (the audio pipeline section).

1. IDs: `sfx.room.perfect` (a jingle, PERFECT's stamp), `sfx.score.tick` (a tally segment starts),
   `sfx.score.land` (a bonus lands in the score panel).
2. `src/shared/theme/contract.ts`: append to `PORT_AUDIO_EVENTS`, with a comment line
   `// docs/ROOM_CLEAR.md RC4: PERFECT's jingle, a tally tick, a bonus landing in the score`:
   `"sfx.room.perfect", "sfx.score.tick", "sfx.score.land",`. Extend the doc comment's last sentence likewise.
   Update the expected list in `src/shared/theme/audio.spec.ts` ("lists the port's audio IDs ...").
3. `src/shared/theme/packs/placeholder/manifest.ts`: the three IDs `: SILENT,` after `"sfx.boost.aegisbreak": SILENT,`.
4. `src/shared/view/audio/cues.ts`:
   - `SFX` gains `roomPerfect: "sfx.room.perfect"`, `scoreTick: "sfx.score.tick"`, `scoreLand: "sfx.score.land"`
     (next to `roomClear`, with a one-line comment naming docs/ROOM_CLEAR.md).
   - Add the three to `ALL_SFX` and `PORT_SFX` (after `SFX.boostAegisBreak` in each).
   - Priority table: `[SFX.roomPerfect]: 72,` (next to roomClear), `[SFX.scoreLand]: 60,`, `[SFX.scoreTick]: 30,`.
     If the table's lowest existing value is above 30, use that lowest value.
   - `JINGLE_SFX` and `DUCKING_SFX`: add `SFX.roomPerfect` (a spec requires every jingle to duck).
   - `SFX_FALLBACK`: `[SFX.roomPerfect]: SFX.roomClear,` (a silent PERFECT jingle plays the CLEAR one).
   - `AudioCueMapper`: a public field
     `/** The room clear celebration plays the jingle itself (docs/ROOM_CLEAR.md RC4; Room clear On). */`
     `celebratesRoomClears = false;` and the jingle line becomes
     `if (w.roomCleared && !this.celebratesRoomClears) this.cue(SFX.roomClear, 1);`.
   - Fix every spec list the compiler or `npm test` names (`src/shared/view/audio/audio.spec.ts` has several: grep
     `boostAegisBreak` there and add the new IDs beside it). Add one case: with `celebratesRoomClears` true a frame
     whose watch saw a room clear cues no `sfx.room.clear`; false (default) cues it as before.
5. `src/client/controllers/audio/AudioController.ts`: inside `this.fx.onFrame((events) => { ... })`, before
   `this.mapper.frame(`, add `this.mapper.celebratesRoomClears = this.fx.settings().roomClear;`.
6. `art/audio.json`: after the `sfx.room.clear` entry, add (paths are relative to `art/vendor/`; none of these clips is
   used by another ID):

```json
		"sfx.room.perfect": {
			"category": "jingle",
			"clips": ["ninja-adventure/Audio/Jingles/Success2.wav"],
			"volume": 0.65,
			"notes": "docs/ROOM_CLEAR.md: PERFECT's stamp lands. Ducks the music.",
			"alternates": ["ninja-adventure/Audio/Jingles/Success4.wav", "ninja-adventure/Audio/Jingles/LevelUp3.wav"],
			"confirmed": false
		},
		"sfx.score.tick": {
			"category": "sfx",
			"clips": ["ninja-adventure/Audio/Sounds/Bonus/Coin2.wav"],
			"volume": 0.35,
			"notes": "docs/ROOM_CLEAR.md: a tally segment starts counting.",
			"alternates": ["ninja-adventure/Audio/Sounds/Menu/Move5.wav"],
			"confirmed": false
		},
		"sfx.score.land": {
			"category": "sfx",
			"clips": ["ninja-adventure/Audio/Sounds/Bonus/Coin3.wav"],
			"volume": 0.5,
			"notes": "docs/ROOM_CLEAR.md: the room bonus lands in the score panel.",
			"alternates": ["ninja-adventure/Audio/Sounds/Bonus/Gold2.wav"],
			"confirmed": false
		},
```

   Check the other entries' formatting (one clip per line, key order) and match it. Then run `npm run audio:lock` and
   `npm run audio:build`. If either fails (missing ffmpeg or vendor files), revert only the files those commands
   wrote, keep the `art/audio.json` edit, say so in the commit message and continue: the owner runs them.

**Verify:** `npm run verify`.
**Commit:** `Room clear RC4: perfect jingle, tally tick and score land sounds (silent until uploaded)`.

---

## RC5. Slow motion, camera kick, co-op hold, spark ring

**Goal:** the effect hooks the controller will call, each tested where it is pure.

**Read:** `src/shared/view/fx/freezeRules.ts` (`NudgeKind`, `NUDGE_MS`, `NUDGE_RANK`, `nudgeOffset`, the header),
`src/shared/view/fx/hitstop.ts` (`requestSlowMo`, `slowActive`, `slowDurationMs`, `slowFromScale`),
`src/shared/view/fx/hitReact.ts` (`HitReactSlots`), `src/client/controllers/fx/FreezeFrameController.ts`,
`src/client/controllers/render/ActorRenderController.ts` (`hitReact`, `hitNow`),
`src/client/controllers/fx/ParticleController.ts` (`onStart` palette, `boostBurst`, `chipBurstOf`).

### 5a. `src/shared/view/fx/roomClearRules.ts` (export from the fx barrel)

```ts
/**
 * The room clear celebration's freeze-frame hooks (docs/ROOM_CLEAR.md RC5), a port module apart from freezeRules.ts
 * (the web port). Solo only for the slow motion (RCD4): the caller never asks in co-op, where the clock does not pace
 * the sim (simPacerFor). The clock ignores the request when freezeFrameOn(settings) is false.
 */
import type { JuiceSettings } from "shared/settings";
import type { NudgeKind } from "./freezeRules";
import type { HitstopClock } from "./hitstop";
import { screenShakeOn } from "./juiceRules";
import { ROOM_CLEAR } from "./roomClearConfig";
import type { RoomClear } from "./roomClears";

/** Asks the clear's slow-motion ramp (RCD11). Returns true when the clock took it. */
export function applyRoomClearSlowMo(
	c: Pick<RoomClear, "perfect">,
	clock: HitstopClock,
	settings: Readonly<JuiceSettings>,
): boolean {
	if (!settings.roomClear) return false;
	const s = c.perfect ? ROOM_CLEAR.slowMo.perfect : ROOM_CLEAR.slowMo.clear;
	return clock.requestSlowMo(s.ms, s.fromScale, settings);
}

/** The stamp's camera kick: "stamp", or "none" with Room clear or screen shake off (or reduced motion). */
export function stampNudgeFor(settings: Readonly<JuiceSettings>): NudgeKind {
	return settings.roomClear && screenShakeOn(settings) ? "stamp" : "none";
}
```

If `requestSlowMo` does not return a boolean, return `true` after calling it when the settings allow
(`freezeFrameOn(settings)`), and say so in the commit.

### 5b. The `stamp` nudge (`src/shared/view/fx/freezeRules.ts`)

- `NudgeKind`: add `"stamp"` (`"none" | "heavy" | "stamp" | "phase" | "hurt" | "death"`).
- A constant `/** Port (docs/ROOM_CLEAR.md RC5): the room clear stamp's 1-texel kick down. */
  export const STAMP_NUDGE_MS = 60;`, used in `NUDGE_MS`: `stamp: STAMP_NUDGE_MS,`.
- `NUDGE_RANK`: `stamp: 1` (the heavy hit's rank: each can replace the other; neither cuts phase / hurt / death).
- `nudgeOffset`: `} else if (kind === "heavy" || kind === "stamp") {` (one texel down, `out.y = -1`).
- The header's "Port change" paragraph gains a sentence: "docs/ROOM_CLEAR.md RC5: the room clear stamp's 'stamp' nudge
  (1 texel down, STAMP_NUDGE_MS, the heavy rank)."
- Add cases to the freezeRules spec (find it with `grep -rln "nudgeReplaces" src/shared/view/fx`): the stamp offset is
  (0, -1) before 60 ms and (0, 0) after; `nudgeReplaces("stamp", "heavy")` and `("heavy", "stamp")` are true;
  `nudgeReplaces("hurt", "stamp")` is false.

### 5c. Spec `src/shared/view/fx/roomClearRules.spec.ts`

With `new HitstopClock()` and `defaultJuiceSettings()` (from `shared/settings`):

1. CLEAR asks 500 ms from 0.5 (`clock.slowActive`, `slowDurationMs`, `slowFromScale`); PERFECT 700 ms from 0.5.
2. `{ ...settings, roomClear: false }`: returns false, `slowActive` false.
3. `freezeFrame: false` and `reducedMotion: true`: no ramp (the clock's own rule).
4. `stampNudgeFor`: `"stamp"` by default; `"none"` with `roomClear` false, `screenShake` false or `reducedMotion` true.

### 5d. Client hooks (no specs: typecheck + lint + build)

- `FreezeFrameController`: a public method
  `/** Another controller's camera nudge (docs/ROOM_CLEAR.md RC5: the stamp's kick); the rank rule still applies. */`
  `requestNudge(k: NudgeKind): void { this.startNudge(k); }`.
- `src/shared/view/fx/hitReact.ts`, `HitReactSlots`: a public method (and a spec case in `hitReact.spec.ts`: it
  extends the hold of the matching actor only; another id or an out-of-range slot does nothing):

```ts
	/** Hold slot i's sprite until `until` if it still tracks `actorId` (docs/ROOM_CLEAR.md: the co-op last-kill hold). */
	hold(i: number, actorId: number, until: number): void {
		if (i < 0 || i >= this.capacity || this.id[i] !== actorId) return;
		this.extendHold(i, until);
	}
```

- `ActorRenderController`: a public method
  `/** Holds an actor's sprite for `seconds` of the hit-reaction clock (docs/ROOM_CLEAR.md RC5). */`
  `holdActor(slot: number, actorId: number, seconds: number): void { this.hitReact.hold(slot, actorId, this.hitNow + seconds); }`.
- `ParticleController`:
  - fields `private roomClearBase = PAL_SPARK;` and `private roomClearShape: ChipBurst | undefined;`, next to
    `collectBurst` (set them in `onStart`, as `collectBurst` is: never in a field initialiser, because `chipBurstOf`
    is declared after the class).
  - in `onStart`, after `this.poofBurst = ...`: `this.roomClearBase = this.palette.size();`
    `this.palette.push(pack.color("uiAccent"), pack.color("ember"));` (CLEAR's sparks, then PERFECT's) and
    `this.roomClearShape = chipBurstOf(ROOM_CLEAR.burst);`.
  - a public method:

```ts
	/** The room clear spark ring at sim (x, z) (docs/ROOM_CLEAR.md RC5): uiAccent, or ember for PERFECT. */
	roomClearBurst(x: number, z: number, perfect: boolean, seed: number): void {
		const shape = this.roomClearShape;
		if (shape === undefined) return;
		this.system.chips(x, z, this.roomClearBase + (perfect ? 1 : 0), shape, seed, this.fx.settings());
	}
```

  Import `ROOM_CLEAR` from `shared/view/fx`. If `ROOM_CLEAR.burst` does not type-check as the parameter of
  `chipBurstOf`, change the parameter type to `Pick<BoostBurstView, "chunks" | "bits" | "sparks" | "startPx" |
  "radiusTiles" | "speed">`.

**Verify:** `npm run verify`.
**Commit:** `Room clear RC5: slow-motion rule, stamp nudge, co-op hold and spark ring hooks`.

---

## RC6. The HUD footprint

**Goal:** the two new transient boxes, proven not to land on anything they must not cover.

**Read:** `src/shared/view/hud/footprint.ts` (all of it) and `footprint.spec.ts`.

1. `TransientAnchor`: add `"topRight"` (update its doc comment). `transientRect`: before the final `return`, add
   `if (box.anchor === "topRight") return { x: vw - HUD_VIEW.margin * scale - w, y: edge, w, h };`
   (the margin from the right edge, `edge` from the top).
2. `TransientPanel` and `TRANSIENT_PANELS`: add `"roomClear"` and `"roomClearChip"` (append, in that order).
3. `HUD_TRANSIENT` gains (import `ROOM_CLEAR_VIEW` from `./roomClear`):

```ts
	roomClear: {
		anchor: "topCentre",
		edge: HUD_VIEW.margin,
		width: ROOM_CLEAR_VIEW.width,
		height: line(ROOM_CLEAR_VIEW.stampText) + ROOM_CLEAR_VIEW.rowGap + line(ROOM_CLEAR_VIEW.tallyText),
		when: "a room clear's stamp and tally (1.5 s; never with the boss bar: boss rooms have no record)",
	},
	roomClearChip: {
		anchor: "topRight",
		edge: HUD_VIEW.margin + HUD_FOOTPRINT.score.maxH + HUD_VIEW.gap,
		width: HUD_VIEW.scoreWidth,
		height: stack(repeated(line(ROOM_CLEAR_VIEW.chipText), ROOM_CLEAR_VIEW.maxChips)),
		when: "a co-op teammate's room clear far from the view player (1.5 s)",
	},
```

   `HUD_FOOTPRINT` is declared above `HUD_TRANSIENT` in the file; if not, move the `roomClearChip` edge into a
   constant after both.
4. A touch helper next to `touchTutorialRect`, and make `touchTutorialRect` use it:

```ts
/** A transient box's screen rect on touch (the touch HUD scale floor), `topInset` as in footprintRects. */
export function touchTransientRect(box: TransientBox, vw: number, vh: number, userPercent: number, topInset = 0): ScreenRect {
	const scale = computeHudScale(vw, vh, false, userPercent, true);
	return shiftDown(transientRect(box, vw, vh - topInset, scale), topInset);
}
```

5. `footprint.spec.ts`, new cases:
   - The stamp row ends above the toasts and the touch tutorial prompt (all three are `topCentre` and scale alike, so
     the reference edges decide): `roomClear.edge + roomClear.height <= toasts.edge` and
     `<= TOUCH_TUTORIAL_BOX.edge`.
   - The chip box starts below the score box: `roomClearChip.edge >= HUD_VIEW.margin + HUD_FOOTPRINT.score.maxH`.
   - On touch (copy the loops of "the touch tutorial prompt ... does not intersect the status or score box"): neither
     `touchTransientRect(HUD_TRANSIENT.roomClear, ...)` nor `...roomClearChip...` overlaps any
     `touchFootprintRects(...)` box.
   - The existing "transient panels never land on an always-on panel" case now covers both boxes on desktop.
6. If a case fails: first lower `ROOM_CLEAR_VIEW.flyTargetY`-independent sizes in this order: `rowGap` (to 2),
   `width` (to 320). If it still fails, stop and report the failing viewport lines.

**Verify:** `npm run verify`.
**Commit:** `Room clear RC6: stamp and chip transient boxes in the HUD footprint`.

---

## RC7. The HUD components

**Goal:** the stamp, tally, flying bonus, corner chips and the rolling score, all driven by bindings (no re-render).

**Read:** `src/client/ui/hud/cornerFade.ts` (module bindings), `primitives.tsx` (`Text`), `ScorePanel.tsx`,
`GameHud.tsx`, `ToastPanel.tsx` (a top-centre transient), `src/client/ui/hud/index.ts`.

### 7a. `src/client/ui/hud/roomClearBindings.ts` (export from the hud barrel)

```ts
import { createBinding, type Binding } from "@rbxts/react";
import { ROOM_CLEAR_VIEW } from "shared/view/hud";

/**
 * One per-frame HUD value of the room clear celebration (docs/ROOM_CLEAR.md RC7): a React binding RoomClearController
 * writes, only on change. A binding update changes the one property it is bound to and never re-renders the tree.
 */
export class RoomClearValue<T> {
	readonly binding: Binding<T>;
	private readonly setter: (v: T) => void;
	private last: T;

	constructor(initial: T) {
		const [binding, setter] = createBinding(initial);
		this.binding = binding;
		this.setter = setter;
		this.last = initial;
	}

	set(v: T): void {
		if (v === this.last) return;
		this.last = v;
		this.setter(v);
	}
}

function perChip<T>(initial: T): RoomClearValue<T>[] {
	const out: RoomClearValue<T>[] = [];
	for (let i = 0; i < ROOM_CLEAR_VIEW.maxChips; i++) out.push(new RoomClearValue(initial));
	return out;
}

/** Everything RoomClearStamp, RoomClearChips and ScorePanel bind to. */
export const ROOM_CLEAR_UI = {
	visible: new RoomClearValue(false),
	stampText: new RoomClearValue(""),
	perfect: new RoomClearValue(false),
	stampScale: new RoomClearValue(1),
	stampTransparency: new RoomClearValue(1),
	shineOffset: new RoomClearValue(-1),
	tallyText: new RoomClearValue(""),
	tallyTransparency: new RoomClearValue(1),
	flyText: new RoomClearValue(""),
	flyProgress: new RoomClearValue(-1),
	chipText: perChip(""),
	chipPerfect: perChip(false),
	chipOffset: perChip(0),
	chipTransparency: perChip(1),
	/** The score panel's rolling number (ScoreRoller), as text. */
	scoreText: new RoomClearValue("0"),
};
```

### 7b. `Text` takes a binding

In `primitives.tsx`, `TextProps.text` becomes `text: string | React.Binding<string>;` (doc: "a binding for a value
written every frame: the rolling score"). Nothing else changes (`Text={props.text}` accepts both).

### 7c. `src/client/ui/hud/RoomClearStamp.tsx`

```tsx
import React, { useMemo } from "@rbxts/react";
import { HUD_FONT, role } from "client/ui/theme";
import { smoothstep01 } from "shared/view/fx";
import { FOOTPRINT_ESTIMATE, HUD_TRANSIENT, HUD_VIEW, ROOM_CLEAR_VIEW } from "shared/view/hud";
import { ROOM_CLEAR_UI as UI } from "./roomClearBindings";

const HALF = 0.5;
const HIDDEN = 1;
/** UIGradient multiplies TextColor3: white text lets the gradient carry the colour. */
const WHITE = new Color3(1, 1, 1);

/**
 * The room clear stamp and its tally row (docs/ROOM_CLEAR.md RC7), top centre in the boss bar's slot
 * (HUD_TRANSIENT.roomClear), and the bonus chip flying to the score panel. Every changing property is a
 * ROOM_CLEAR_UI binding written by RoomClearController; this component renders once per run.
 */
export function RoomClearStamp() {
	const box = HUD_TRANSIENT.roomClear;
	const slack = FOOTPRINT_ESTIMATE.lineSlack;
	const stampH = ROOM_CLEAR_VIEW.stampText + slack;
	const tallyH = ROOM_CLEAR_VIEW.tallyText + slack;
	const look = useMemo(() => {
		const gold = role("ember");
		const shine = role("uiText");
		const w = ROOM_CLEAR_VIEW.shineHalfWidth;
		return {
			clear: new ColorSequence(role("uiText")),
			perfect: new ColorSequence([
				new ColorSequenceKeypoint(0, gold),
				new ColorSequenceKeypoint(HALF - w, gold),
				new ColorSequenceKeypoint(HALF, shine),
				new ColorSequenceKeypoint(HALF + w, gold),
				new ColorSequenceKeypoint(1, gold),
			]),
			flyFrom: new UDim2(HALF, 0, 0, box.edge + box.height),
			flyTo: new UDim2(1, -(HUD_VIEW.margin + HUD_VIEW.scoreWidth * HALF), 0, HUD_VIEW.margin + ROOM_CLEAR_VIEW.flyTargetY),
		};
	}, []);
	return (
		<>
			<frame
				key="RoomClear"
				AnchorPoint={new Vector2(HALF, 0)}
				Position={new UDim2(HALF, 0, 0, box.edge)}
				Size={new UDim2(0, box.width, 0, box.height)}
				BackgroundTransparency={HIDDEN}
				Visible={UI.visible.binding}
			>
				<textlabel
					key="Stamp"
					AnchorPoint={new Vector2(HALF, HALF)}
					Position={new UDim2(HALF, 0, 0, stampH * HALF)}
					Size={new UDim2(1, 0, 0, stampH)}
					BackgroundTransparency={HIDDEN}
					Font={HUD_FONT}
					TextSize={ROOM_CLEAR_VIEW.stampText}
					TextColor3={WHITE}
					TextStrokeColor3={role("background")}
					TextTransparency={UI.stampTransparency.binding}
					TextStrokeTransparency={UI.stampTransparency.binding}
					Text={UI.stampText.binding}
				>
					<uiscale Scale={UI.stampScale.binding} />
					<uigradient
						Color={UI.perfect.binding.map((p) => (p ? look.perfect : look.clear))}
						Offset={UI.shineOffset.binding.map((x) => new Vector2(x, 0))}
					/>
				</textlabel>
				<textlabel
					key="Tally"
					Position={new UDim2(0, 0, 0, stampH + ROOM_CLEAR_VIEW.rowGap)}
					Size={new UDim2(1, 0, 0, tallyH)}
					BackgroundTransparency={HIDDEN}
					Font={HUD_FONT}
					TextScaled={true}
					TextColor3={role("uiText")}
					TextStrokeColor3={role("background")}
					TextTransparency={UI.tallyTransparency.binding}
					TextStrokeTransparency={UI.tallyTransparency.binding}
					Text={UI.tallyText.binding}
				>
					<uitextsizeconstraint MaxTextSize={ROOM_CLEAR_VIEW.tallyText} />
				</textlabel>
			</frame>
			<textlabel
				key="RoomClearFly"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UI.flyProgress.binding.map((p) => look.flyFrom.Lerp(look.flyTo, smoothstep01(p)))}
				Size={new UDim2(0, ROOM_CLEAR_VIEW.flyWidth, 0, ROOM_CLEAR_VIEW.flyText + slack)}
				BackgroundTransparency={HIDDEN}
				Font={HUD_FONT}
				TextSize={ROOM_CLEAR_VIEW.flyText}
				TextColor3={role("uiAccent")}
				TextStrokeColor3={role("background")}
				TextStrokeTransparency={0}
				Visible={UI.flyProgress.binding.map((p) => p >= 0)}
				Text={UI.flyText.binding}
			/>
		</>
	);
}
```

If lint flags the `useMemo` dependency list, add `box` to it. The `0` stroke transparency is "opaque", not a tunable.

### 7d. `src/client/ui/hud/RoomClearChips.tsx`

The same style: a frame `AnchorPoint (1, 0)`, `Position UDim2(1, -HUD_VIEW.margin, 0, HUD_TRANSIENT.roomClearChip.edge)`,
`Size` from `HUD_TRANSIENT.roomClearChip`, transparent; inside it, for `i` in `0 .. ROOM_CLEAR_VIEW.maxChips - 1`, a
right-aligned `textlabel` (`key={\`Chip${i}\`}`, `AnchorPoint (1, 0)`, height `chipText + lineSlack`, top
`i * (height + HUD_VIEW.gap)`, `Position` bound to `UI.chipOffset[i]` as `new UDim2(1, x, 0, top)`, `TextColor3` bound
to `UI.chipPerfect[i]` as `role(p ? "ember" : "uiText")`, `Text` / `TextTransparency` / `TextStrokeTransparency`
bound to `UI.chipText[i]` / `UI.chipTransparency[i]`, `Font={HUD_FONT}`, `TextSize={ROOM_CLEAR_VIEW.chipText}`,
`TextXAlignment={Enum.TextXAlignment.Right}`). Build the rows in a plain `for` loop into an array and render
`{rows}`.

### 7e. Mount and the rolling score

- `GameHud.tsx`: inside the `active` fragment, right after `<ScorePanel ... />`:
  `<RoomClearStamp key="RoomClearStamp" />` and `<RoomClearChips key="RoomClearChips" />`; import both. Add one line
  to the file's doc comment listing them.
- `ScorePanel.tsx`: the big score Text's `text={tostring(s.score)}` becomes `text={ROOM_CLEAR_UI.scoreText.binding}`
  (import from `./roomClearBindings`). Update its doc comment: "the score rolls up and waits for a room bonus to land
  (docs/ROOM_CLEAR.md RCD7)". Do not change anything else in the panel.

**Verify:** `npm run verify` (client code: typecheck, lint and build are the check).
**Commit:** `Room clear RC7: stamp, tally, flying bonus, corner chips and rolling score (bindings)`.

---

## RC8. RoomClearController (wires everything)

**Goal:** one controller that reads the clears, runs the sequence, triggers the effects and writes the bindings.

**Read:** `src/client/controllers/fx/HurtFlashController.ts` (an `fx.onFrame` controller with a `StateWatch`),
`FreezeFrameController.ts` (`hurtFrame`, `hurtKindLanded`), `ScorePopController.ts` (`sim.onRunStarted`,
`theme.getPack()`), `src/client/controllers/game/SimController.ts` (`getContext`, `getViewPlayerIndex`, `hitstop`,
`RunContext.live`), `src/client/store/stage.ts` (`selectStageCovered`).

`src/client/controllers/fx/RoomClearController.ts` (export from `src/client/controllers/fx/index.ts`):

```ts
import { Controller, OnStart } from "@flamework/core";
import { clientStore, selectStageCovered } from "client/store";
import { ROOM_CLEAR_UI as UI } from "client/ui";
import type { JuiceSettings } from "shared/settings";
import { isPartyWiped, partySize, playerAt } from "shared/sim";
import type { StringVars } from "shared/theme";
import { StateWatch } from "shared/view";
import { SFX } from "shared/view/audio";
import {
	ROOM_CLEAR,
	RoomClearSequence,
	ScoreRoller,
	applyRoomClearSlowMo,
	burstSeed,
	freezeFrameOn,
	hurtKindLanded,
	motionScale,
	roomClearStyle,
	stampNudgeFor,
	type RoomClearLook,
} from "shared/view/fx";
import { ROOM_CLEAR_STRINGS, roomClearStampText, roomClearTallyText } from "shared/view/hud";
import { AudioController } from "../audio/AudioController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { ActorRenderController } from "../render/ActorRenderController";
import { FreezeFrameController } from "./FreezeFrameController";
import { FxTrackerController } from "./FxTrackerController";
import { ParticleController } from "./ParticleController";

/**
 * The room clear celebration (docs/ROOM_CLEAR.md): once per frame it reads the run's room clears (RunView.roomClears),
 * collapses a running sequence on danger or a transition (the view player hurt, a room engaging, the stage cover, a
 * wipe), starts a full sequence or a corner chip per clear (Room clear On), asks the solo slow motion, the co-op
 * last-kill hold and the spark ring, plays the stamp / tick / land sounds and the stamp kick, rolls the score and
 * writes the HUD bindings (client/ui ROOM_CLEAR_UI). Real time, stopped while a solo run is paused; not slowed by
 * hitstop. Presentation only.
 */
@Controller({})
export class RoomClearController implements OnStart {
	private readonly seq = new RoomClearSequence();
	private readonly roller = new ScoreRoller();
	private readonly watch = new StateWatch();

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly audio: AudioController,
		private readonly freeze: FreezeFrameController,
		private readonly particles: ParticleController,
		private readonly actors: ActorRenderController,
	) {}

	onStart(): void {
		this.sim.onRunStarted(() => this.newRun());
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt));
	}

	private newRun(): void {
		this.seq.clear();
		this.watch.reset();
		this.roller.reset(this.sim.getState()?.score?.total ?? 0);
		UI.visible.set(false);
	}

	private frame(settings: Readonly<JuiceSettings>, rawDt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const state = ctx.run.state;
		const score = state.score;
		if (score === undefined) {
			UI.visible.set(false);
			return;
		}
		const paused = ctx.live?.isPaused() === true;
		const dt = paused ? 0 : math.min(math.max(rawDt, 0), ROOM_CLEAR.maxFrameDtSec);
		const seq = this.seq;
		seq.beginFrame();

		const view = this.sim.getViewPlayerIndex();
		this.watch.update(state, view);
		const hurt =
			view < this.watch.players() &&
			hurtKindLanded(this.watch.hurtKind[view], this.sim.getFrameEvents()?.playerHits) !== "none";
		const clears = ctx.run.roomClears;
		if (hurt || clears.engaged > 0 || isPartyWiped(state) || selectStageCovered(clientStore.getState())) {
			seq.collapse();
		}

		if (settings.roomClear) {
			const solo = partySize(state) <= 1;
			const me = playerAt(state, view);
			for (const c of clears.clears) {
				const style = roomClearStyle(c, me.x, me.z, solo);
				seq.start(c, style, motionScale(settings));
				if (solo) applyRoomClearSlowMo(c, this.sim.hitstop, settings);
				else if (freezeFrameOn(settings) && c.slot >= 0) {
					this.actors.holdActor(c.slot, c.actorId, ROOM_CLEAR.coopHoldSec);
				}
				if (style === "full") {
					this.particles.roomClearBurst(c.x, c.z, c.perfect, burstSeed(c.room, c.tick, ROOM_CLEAR.burstSeedSalt));
				}
			}
		}

		const look = seq.frame(dt);
		this.cues(look, settings);
		const shown = this.roller.frame(dt, score.total, look.held, look.bonusLanded > 0);
		this.write(look, shown);
	}

	private cues(look: Readonly<RoomClearLook>, settings: Readonly<JuiceSettings>): void {
		if (look.landed) {
			this.audio.play(look.perfect ? SFX.roomPerfect : SFX.roomClear, 1);
			this.freeze.requestNudge(stampNudgeFor(settings));
		}
		if (look.ticks > 0) this.audio.play(SFX.scoreTick, 1);
		if (look.chipsStarted > 0) this.audio.play(SFX.roomClear, ROOM_CLEAR.chip.jingleVolume);
		if (look.bonusLanded > 0) this.audio.play(SFX.scoreLand, 1);
	}

	private write(look: Readonly<RoomClearLook>, shown: number): void {
		const pack = this.theme.getPack();
		const s = (key: string, vars?: StringVars) => pack.str(key, vars);
		UI.visible.set(look.active);
		if (look.active) {
			UI.stampText.set(roomClearStampText(look.perfect, look.rooms, s));
			UI.perfect.set(look.perfect);
			UI.stampScale.set(look.stampScale);
			UI.stampTransparency.set(look.stampTransparency);
			UI.shineOffset.set(look.shineOffset);
			UI.tallyText.set(roomClearTallyText(look, s));
			UI.tallyTransparency.set(look.tallyTransparency);
		}
		UI.flyProgress.set(look.flyProgress);
		if (look.flyProgress >= 0) UI.flyText.set(s(ROOM_CLEAR_STRINGS.fly, { points: look.flyPoints }));
		for (let i = 0; i < look.chips.size(); i++) {
			const c = look.chips[i];
			UI.chipTransparency[i].set(c.shown ? c.transparency : 1);
			if (!c.shown) continue;
			const stamp = roomClearStampText(c.perfect, c.rooms, s);
			UI.chipText[i].set(s(ROOM_CLEAR_STRINGS.chip, { stamp, points: c.points }));
			UI.chipPerfect[i].set(c.perfect);
			UI.chipOffset[i].set(c.offsetPx);
		}
		UI.scoreText.set(tostring(shown));
	}
}
```

Adjust names to what exists (the compiler tells you): `hurtKindLanded` and `StateWatch` are what
`FreezeFrameController` uses (import them the same way it does); `getFrameEvents()` is SimController's; if
`ROOM_CLEAR_UI` is not re-exported by `client/ui`, import it from `client/ui/hud`. If Flamework reports a circular
dependency (one of the injected controllers injecting something that injects this one), stop and report.

**Verify:** `npm run verify`, then `npm run build:place` (it must still build the publishable place).
**Commit:** `Room clear RC8: RoomClearController (stamp, tally, chips, slow motion, sounds, rolling score)`.

---

## RC9. Docs

- `docs/ROOM_CLEAR.md`: tick RC1-RC9 in its task list; set the status line to "RC1-RC9 code-complete, verified
  headlessly only (typecheck, lint, build, the Lune suite: N spec files, M tests); the Studio check and RC10 pending",
  with the real N / M from the last `npm test` output; add an "As built" list of anything you did differently from this
  guide (and why).
- `docs/CLIENT.md`: in its FX section, one paragraph: RoomClearController, what it reads, what it writes.
- `CLAUDE.md` decision log: one bullet "**Room clear celebration (docs/ROOM_CLEAR.md).** Presentation only (no sim,
  dungeon, lockstep, hash, replay or fixture change). ..." covering: the per-tick collector on `RunView.roomClears`,
  Juice setting `roomClear` (default On, overrides-only, doc stays v2), required strings `ROOM_CLEAR_STRING_KEYS`, the
  three port audio IDs in `PORT_AUDIO_EVENTS` (SILENT in the placeholder), the `stamp` nudge, the two transient HUD
  boxes and the `topRight` anchor, `Text` taking a binding, the score panel's rolling number.
- No `PROVENANCE.md` rows: nothing here is ported from the web build (freezeRules.ts keeps its row; its header has the
  port-change line).

**Verify:** `npm run verify`.
**Commit:** `Room clear RC9: docs`.

---

## RC10. [owner] Studio check, sounds

Not for the implementer. The owner runs `docs/ROOM_CLEAR.md`'s Studio check, auditions the three sounds
(`npm run audio:audition`), uploads them, pastes the ids into `packs/vale/assetIds.ts`, and tunes `ROOM_CLEAR`.
