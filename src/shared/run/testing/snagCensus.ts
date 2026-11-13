/**
 * The snag census (docs/WALL_SLIDE.md WS5), shared by its shard specs (snagCensus.<n>.spec.ts): on real endless floors (buildEndlessFloor, vaults on; breakables and the vault
 * chest as SolidCells, as the sim passes them), walk WALK_TICKS from the centre of every FLOOR cell that touches an
 * obstacle, in the 8 keyboard screen directions and 32 stick directions, through the real input path (radial deadzone,
 * the camera's yaw, quantizeAxis), with the web build's mover (moveCircle) and the player's slide (slideCircle,
 * PLAYER_SLIDE).
 *
 *   stall      the walk ended less than STALL_SHARE of the open-floor distance from its start
 *   excused    it ends pressing a face within EXCUSE_DEG of the input (a real wall), or in a dead end: no direction the
 *              contacts leave open makes progress along the input (pressed into a concave corner)
 *   class      what an unexcused stall ends touching, first match: chest, breakable, pillar (an isolated 1x1 grid
 *              blocker), a solid decor kind (Dungeon.solidDecor), stepped wall (a 1:1 notch cell within one cell),
 *              wall corner / door frame (a box-corner contact), other
 *
 * Gate: zero unexcused pillar stalls with the slide, and the slide never stalls more than the web mover in any class.
 * A log with that gate, not a tuning tool (WS8 tunes in play). A walk stops early once it has gone STALL_SHARE of the
 * open distance along the input (both movers never move against it, so it can no longer stall) or once it stands still
 * for a tick (both movers are pure: it would stand there for good).
 *
 * docs/ARCHER.md AR4: the same floors walked as ROLLS too, in the 8 key directions: ROLL_TICKS ticks of the roll's steps
 * (the dash ROLL_DASH_TICKS ticks at the character's `rollDashPercent`, then the recovery), each tick cut into equal
 * sub-steps of at most MAX_MOVE_STEP as movePlayer cuts it, for the Knight (100 %, 2.5 tiles) and the Archer (140 %,
 * 3.38 tiles). A roll stalls when it ends less than STALL_SHARE of its open-floor distance from its start; the same
 * excuses and classes. Gate for the Archer's roll: zero unexcused pillar stalls with the slide, never more than the web
 * mover in any class (WS5's gate); the Knight's is printed beside it.
 *
 * Each shard gates its own seeds (zero pillar stalls and never more than the web mover per shard), which is stricter
 * than the single file's gate over all seeds was. Test support only.
 */
import {
	TILE_SIZE,
	blocksMove,
	buildEndlessFloor,
	cellKey,
	generateDungeon,
	isIsolatedBlocker,
	moveCircle,
	slideCircle,
	tileAt,
	worldToGrid,
	TileType,
	type Dungeon,
	type SolidCells,
} from "shared/dungeon";
import { applyRadialDeadzone, screenToWorld } from "shared/play";
import {
	AXIS_MAX,
	MAX_MOVE_STEP,
	PLAYER_RADIUS,
	ROLL_DASH_STEP,
	ROLL_DASH_TICKS,
	ROLL_RECOVERY_STEP,
	ROLL_TICKS,
	SQRT1_2,
	STEP_TOLERANCE,
	WALK_STEP,
	quantizeAxis,
	scalePercent,
} from "shared/sim";
import { characterTraits, type CharacterId } from "shared/characters";

/**
 * Run seeds 1..seeds, one floor each, cycling through floors 1..floors (seed s walks floor 1 + (s - 1) % floors), so
 * every floor depth is walked seeds / floors times. The plan's full 40 x 10 grid would take some 40 minutes headless
 * (about 6 s a floor); this cut keeps the census near 3 minutes, split over `shards` spec files of consecutive seeds
 * (snagCensus.<n>.spec.ts: seeds 1-10, 11-20, 21-30, so each shard walks every floor depth once).
 */
export const SNAG_CENSUS = { seeds: 30, floors: 10, shards: 3 } as const;
const WALK_TICKS = 40;
const STALL_SHARE = 0.25;
const EXCUSE_DEG = 20;
/** A blocking cell within this of r counts as touched at the end. */
const CONTACT_EPS = 1e-3;
const R = PLAYER_RADIUS;
const EXCUSE_COS = math.cos((EXCUSE_DEG * math.pi) / 180);

/** A walk tick for quantized move axes, exactly as stepPlayer turns them into a step (clamped to unit length). */
function stepOf(qx: number, qz: number): [number, number] {
	let mx = qx / AXIS_MAX;
	let mz = qz / AXIS_MAX;
	const l2 = mx * mx + mz * mz;
	if (l2 > 1) {
		const inv = 1 / math.sqrt(l2);
		mx *= inv;
		mz *= inv;
	}
	return [mx * WALK_STEP, mz * WALK_STEP];
}

/** A screen-relative input (right, up) through the iso camera's yaw and the frame's quantization, as a walk tick. */
function inputStep(right: number, up: number): [number, number] {
	const w = screenToWorld(right, up);
	return stepOf(quantizeAxis(w.x), quantizeAxis(w.z));
}

interface Dir {
	readonly dx: number;
	readonly dz: number;
}

const KEYS: Dir[] = [];
for (const [right, up] of [
	[0, 1],
	[SQRT1_2, SQRT1_2],
	[1, 0],
	[SQRT1_2, -SQRT1_2],
	[0, -1],
	[-SQRT1_2, -SQRT1_2],
	[-1, 0],
	[-SQRT1_2, SQRT1_2],
] as const) {
	const [dx, dz] = inputStep(right, up);
	KEYS.push({ dx, dz });
}

/** 32 full-deflection stick directions through the radial deadzone, the yaw and quantizeAxis. */
const STICKS: Dir[] = [];
for (let k = 0; k < 32; k++) {
	const a = (2 * math.pi * k) / 32;
	const v = applyRadialDeadzone(math.cos(a), math.sin(a));
	const [dx, dz] = inputStep(v.x, v.y);
	STICKS.push({ dx, dz });
}

type Mover = (d: Dungeon, x: number, z: number, dx: number, dz: number, solid: SolidCells) => { x: number; z: number };
const MOVERS: ReadonlyArray<readonly [string, Mover]> = [
	["web", (d, x, z, dx, dz, solid) => moveCircle(d, x, z, dx, dz, R, solid)],
	["slide", (d, x, z, dx, dz, solid) => slideCircle(d, x, z, dx, dz, R, solid)],
];
const INPUTS: ReadonlyArray<readonly [string, ReadonlyArray<Dir>]> = [
	["keys", KEYS],
	["sticks", STICKS],
];

const CLASSES = ["pillar", "breakable", "chest", "decor", "stepped", "corner", "other"] as const;
type StallClass = (typeof CLASSES)[number];

interface Tally {
	walks: number;
	stalls: number;
	excusedFace: number;
	excusedDeadEnd: number;
	byClass: Map<StallClass, number>;
	byDecor: Map<string, number>;
	/** Summed distance every walk / roll ended from its start (AR4's sanity check: the Archer's rolls go farther). */
	moved: number;
}

function newTally(): Tally {
	const byClass = new Map<StallClass, number>();
	for (const c of CLASSES) byClass.set(c, 0);
	return { walks: 0, stalls: 0, excusedFace: 0, excusedDeadEnd: 0, byClass, byDecor: new Map(), moved: 0 };
}

interface CensusFloor {
	readonly d: Dungeon;
	readonly solid: SolidCells;
	readonly chest: number | undefined;
	readonly decor: Map<number, string>;
	readonly starts: ReadonlyArray<readonly [number, number]>;
}

function censusFloor(runSeed: number, floor: number): CensusFloor {
	const l = buildEndlessFloor(runSeed, floor, (p) => generateDungeon(p), 1, { vaults: true });
	const d = l.dungeon;
	const solid = new Map<number, number>();
	let chest: number | undefined;
	(l.breakables ?? []).forEach((b, i) => {
		solid.set(cellKey(b.x, b.y), i);
		if (b.kind === "chest") chest = cellKey(b.x, b.y);
	});
	const decor = new Map<number, string>();
	for (const p of d.solidDecor)
		for (let gy = p.y; gy < p.y + p.h; gy++)
			for (let gx = p.x; gx < p.x + p.w; gx++) decor.set(cellKey(gx, gy), p.kind);
	const starts: Array<[number, number]> = [];
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			if (tileAt(d, gx, gy) !== TileType.FLOOR || solid.has(cellKey(gx, gy))) continue;
			let touches = false;
			for (let oy = -1; oy <= 1 && !touches; oy++)
				for (let ox = -1; ox <= 1; ox++) if (blocksMove(d, gx + ox, gy + oy, solid)) touches = true;
			if (touches) starts.push([gx, gy]);
		}
	return { d, solid, chest, decor, starts };
}

/** A 1:1 staircase notch (docs/WALL_SLIDE.md Design 4): a FLOOR cell in a step of a diagonal wall, not a square corner. */
function isNotch(d: Dungeon, gx: number, gy: number): boolean {
	if (tileAt(d, gx, gy) !== TileType.FLOOR) return false;
	for (const sx of [-1, 1])
		for (const sz of [-1, 1]) {
			if (!blocksMove(d, gx + sx, gy) || !blocksMove(d, gx, gy + sz) || !blocksMove(d, gx + sx, gy + sz))
				continue;
			if (!blocksMove(d, gx + sx, gy - sz) && !blocksMove(d, gx - sx, gy + sz)) return true;
		}
	return false;
}

interface Contact {
	gx: number;
	gy: number;
	nx: number;
	nz: number;
	face: boolean;
}

/** Blocking cells the circle at (x, z) touches (within CONTACT_EPS), with the outward normal and face / corner. */
function contactsAt(f: CensusFloor, x: number, z: number): Contact[] {
	const half = TILE_SIZE / 2;
	const reach = R + CONTACT_EPS;
	const out: Contact[] = [];
	for (let gy = worldToGrid(z - reach); gy <= worldToGrid(z + reach); gy++)
		for (let gx = worldToGrid(x - reach); gx <= worldToGrid(x + reach); gx++) {
			if (!blocksMove(f.d, gx, gy, f.solid)) continue;
			const x0 = gx - half,
				x1 = gx + half,
				z0 = gy - half,
				z1 = gy + half;
			const cx = math.clamp(x, x0, x1),
				cz = math.clamp(z, z0, z1);
			const ddx = x - cx,
				ddz = z - cz;
			const dist = math.sqrt(ddx * ddx + ddz * ddz);
			if (dist > reach || dist === 0) continue;
			const face = (x > x0 && x < x1) || (z > z0 && z < z1);
			out.push({ gx, gy, nx: ddx / dist, nz: ddz / dist, face });
		}
	return out;
}

/** True when no direction the contacts leave open (d . n >= 0 for each) has a positive part along (ux, uz). */
function deadEnd(contacts: ReadonlyArray<Contact>, ux: number, uz: number): boolean {
	const open = (dx: number, dz: number) => {
		if (dx * ux + dz * uz <= 1e-9) return false;
		for (const c of contacts) if (dx * c.nx + dz * c.nz < -1e-9) return false;
		return true;
	};
	if (open(ux, uz)) return false;
	for (const c of contacts) if (open(-c.nz, c.nx) || open(c.nz, -c.nx)) return false;
	return true;
}

function classify(f: CensusFloor, contacts: ReadonlyArray<Contact>, ex: number, ez: number): [StallClass, string?] {
	let breakable = false,
		pillar = false,
		corner = false;
	let decorKind: string | undefined;
	for (const c of contacts) {
		const key = cellKey(c.gx, c.gy);
		if (key === f.chest) return ["chest"];
		if (f.solid.has(key)) breakable = true;
		else if (isIsolatedBlocker(f.d, c.gx, c.gy, f.solid)) pillar = true;
		else if (f.decor.has(key)) decorKind = f.decor.get(key);
		if (!c.face) corner = true;
	}
	if (breakable) return ["breakable"];
	if (pillar) return ["pillar"];
	if (decorKind !== undefined) return ["decor", decorKind];
	const gx = worldToGrid(ex),
		gy = worldToGrid(ez);
	for (let oy = -1; oy <= 1; oy++)
		for (let ox = -1; ox <= 1; ox++) if (isNotch(f.d, gx + ox, gy + oy)) return ["stepped"];
	if (corner) return ["corner"];
	return ["other"];
}

function walkOne(f: CensusFloor, mover: Mover, gx: number, gy: number, dir: Dir, t: Tally): void {
	const len = math.sqrt(dir.dx * dir.dx + dir.dz * dir.dz);
	if (len === 0) return;
	const ux = dir.dx / len,
		uz = dir.dz / len;
	const free = len * WALK_TICKS;
	const enough = STALL_SHARE * free;
	let x = gx,
		z = gy;
	for (let i = 0; i < WALK_TICKS; i++) {
		const p = mover(f.d, x, z, dir.dx, dir.dz, f.solid);
		const still = p.x === x && p.z === z;
		x = p.x;
		z = p.z;
		if (still || (x - gx) * ux + (z - gy) * uz >= enough) break;
	}
	judge(f, gx, gy, x, z, ux, uz, enough, t);
}

/** A walk (or roll) from (gx, gy) along unit (ux, uz) ended at (x, z): tallies it (a stall, its excuse or class). */
function judge(
	f: CensusFloor,
	gx: number,
	gy: number,
	x: number,
	z: number,
	ux: number,
	uz: number,
	enough: number,
	t: Tally,
): void {
	t.walks++;
	const moved = math.sqrt((x - gx) * (x - gx) + (z - gy) * (z - gy));
	t.moved += moved;
	if (moved >= enough) return;
	t.stalls++;
	const contacts = contactsAt(f, x, z);
	for (const c of contacts)
		if (c.face && -(c.nx * ux + c.nz * uz) >= EXCUSE_COS) {
			t.excusedFace++;
			return;
		}
	if (contacts.size() > 0 && deadEnd(contacts, ux, uz)) {
		t.excusedDeadEnd++;
		return;
	}
	const [cls, kind] = classify(f, contacts, x, z);
	t.byClass.set(cls, t.byClass.get(cls)! + 1);
	if (kind !== undefined) t.byDecor.set(kind, (t.byDecor.get(kind) ?? 0) + 1);
}

/**
 * One roll (AR4) from the centre of (gx, gy) along the key direction `dir` at `dashPercent`: the roll's per-tick steps,
 * each cut like movePlayer cuts it; stops once a tick moves nothing (a pure mover would stand there for good).
 */
function rollOne(f: CensusFloor, mover: Mover, gx: number, gy: number, dir: Dir, dashPercent: number, t: Tally): void {
	const len = math.sqrt(dir.dx * dir.dx + dir.dz * dir.dz);
	if (len === 0) return;
	const ux = dir.dx / len,
		uz = dir.dz / len;
	const dash = scalePercent(ROLL_DASH_STEP, dashPercent);
	const free = ROLL_DASH_TICKS * dash + (ROLL_TICKS - ROLL_DASH_TICKS) * ROLL_RECOVERY_STEP;
	let x = gx,
		z = gy;
	for (let i = 0; i < ROLL_TICKS; i++) {
		const dist = i < ROLL_DASH_TICKS ? dash : ROLL_RECOVERY_STEP;
		const n = dist <= STEP_TOLERANCE ? 1 : math.ceil(dist / MAX_MOVE_STEP);
		const sx = (ux * dist) / n,
			sz = (uz * dist) / n;
		const x0 = x,
			z0 = z;
		for (let k = 0; k < n; k++) {
			const p = mover(f.d, x, z, sx, sz, f.solid);
			x = p.x;
			z = p.z;
		}
		if (x === x0 && z === z0) break;
	}
	judge(f, gx, gy, x, z, ux, uz, STALL_SHARE * free, t);
}

/** The census floors of seeds firstSeed..lastSeed, built once for both censuses (about 6 s a floor). */
const floorsCache = new Map<string, CensusFloor[]>();
function censusFloors(firstSeed: number, lastSeed: number): CensusFloor[] {
	const key = `${firstSeed}-${lastSeed}`;
	let floors = floorsCache.get(key);
	if (floors === undefined) {
		floors = [];
		for (let seed = firstSeed; seed <= lastSeed; seed++)
			floors.push(censusFloor(seed, 1 + ((seed - 1) % SNAG_CENSUS.floors)));
		floorsCache.set(key, floors);
	}
	return floors;
}

function row(name: string, t: Tally): string {
	let s = `${name}: walks ${t.walks}, stalls ${t.stalls}, excused face ${t.excusedFace} / dead end ${t.excusedDeadEnd}; unexcused`;
	for (const c of CLASSES) s += ` ${c} ${t.byClass.get(c)}`;
	if (t.byDecor.size() > 0) {
		const kinds: string[] = [];
		t.byDecor.forEach((n, k) => kinds.push(`${k} ${n}`));
		kinds.sort();
		s += ` (decor: ${kinds.join(", ")})`;
	}
	return s;
}

/** A census's printed lines and its gate failures (empty: the gate holds). */
export interface SnagCensusResult {
	readonly lines: ReadonlyArray<string>;
	readonly problems: ReadonlyArray<string>;
}

/** Zero unexcused pillar stalls with the slide, and never more stalls than the web mover in any class. */
function gate(name: string, web: Tally, slide: Tally, out: string[]): void {
	if (slide.byClass.get("pillar") !== 0) out.push(`${name}: ${slide.byClass.get("pillar")} unexcused pillar stalls`);
	for (const c of CLASSES)
		if (slide.byClass.get(c)! > web.byClass.get(c)!)
			out.push(`${name}: slide ${slide.byClass.get(c)} ${c} stalls, web ${web.byClass.get(c)}`);
}

/** WS5: walks on seeds firstSeed..lastSeed, keys and sticks, the web mover and the slide. */
export function snagWalkCensus(firstSeed: number, lastSeed: number): SnagCensusResult {
	const tallies = new Map<string, Tally>();
	for (const [inputName] of INPUTS)
		for (const [moverName] of MOVERS) tallies.set(`${inputName}/${moverName}`, newTally());
	let floors = 0,
		starts = 0;
	for (const f of censusFloors(firstSeed, lastSeed)) {
		floors++;
		starts += f.starts.size();
		for (const [inputName, dirs] of INPUTS)
			for (const [moverName, mover] of MOVERS) {
				const t = tallies.get(`${inputName}/${moverName}`)!;
				for (const [gx, gy] of f.starts) for (const dir of dirs) walkOne(f, mover, gx, gy, dir, t);
			}
	}
	const lines = [`[snag census] ${floors} floors, ${starts} start cells, ${WALK_TICKS} ticks a walk`];
	for (const [inputName] of INPUTS)
		for (const [moverName] of MOVERS)
			lines.push(row(`${inputName} ${moverName}`, tallies.get(`${inputName}/${moverName}`)!));
	const problems: string[] = [];
	for (const [inputName] of INPUTS)
		gate(inputName, tallies.get(`${inputName}/web`)!, tallies.get(`${inputName}/slide`)!, problems);
	return { lines, problems };
}

/** AR4: rolls on seeds firstSeed..lastSeed in the 8 key directions, the Knight's and the Archer's, both movers. */
export function snagRollCensus(firstSeed: number, lastSeed: number): SnagCensusResult {
	const who: ReadonlyArray<CharacterId> = ["knight", "archer"];
	const tallies = new Map<string, Tally>();
	for (const c of who) for (const [moverName] of MOVERS) tallies.set(`${c}/${moverName}`, newTally());
	let floors = 0,
		starts = 0;
	for (const f of censusFloors(firstSeed, lastSeed)) {
		floors++;
		starts += f.starts.size();
		for (const c of who) {
			const pct = characterTraits(c).rollDashPercent;
			for (const [moverName, mover] of MOVERS) {
				const t = tallies.get(`${c}/${moverName}`)!;
				for (const [gx, gy] of f.starts) for (const dir of KEYS) rollOne(f, mover, gx, gy, dir, pct, t);
			}
		}
	}
	const lines = [`[snag census] rolls: ${floors} floors, ${starts} start cells, 8 key directions`];
	for (const c of who)
		for (const [moverName] of MOVERS) lines.push(row(`roll ${c} ${moverName}`, tallies.get(`${c}/${moverName}`)!));
	for (const c of who) {
		const t = tallies.get(`${c}/slide`)!;
		lines.push(`roll ${c} slide: mean distance ${string.format("%.3f", t.moved / t.walks)}`);
	}
	const problems: string[] = [];
	const knight = tallies.get("knight/slide")!;
	const slide = tallies.get("archer/slide")!;
	// The Archer's rolls do go farther (the census is not rolling the Knight's roll twice).
	if (!(slide.moved > knight.moved)) problems.push(`archer rolls ${slide.moved}, knight ${knight.moved}`);
	gate("archer", tallies.get("archer/web")!, slide, problems);
	if (slide.walks !== knight.walks) problems.push(`archer ${slide.walks} rolls, knight ${knight.walks}`);
	return { lines, problems };
}
