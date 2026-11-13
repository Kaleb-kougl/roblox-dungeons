// The Goldling hunt census (docs/GOLDLING_RUMOURS.md GR8; it replaces docs/FORTUNE.md GE4's chase census): a hunt bot
// plays every Goldling of a set of run seeds on floors 2 / 6 / 12 from the floor's spawn. It walks to the Goldling's
// room and its glinting barrel or crate (the floor's FloorGolden piece cell, as a player who sees the glint would; the
// sim's goldenPieceAt is asserted on that slot until the break), breaks it open and chases what comes out. Logged per
// row: the catch rate, the damaging hits to a catch, the seconds from the room's engagement (the room rumour's cue) to
// the release and from the release to the catch, the Goldling's hp and what a catch and an escape pay.
//
// Modes (the bot's order of business in the Goldling room):
//   focused  the piece first, then the Goldling only (the room's enemies ignored: harmless, god mode solo, hearts
//            topped up in the party). Perfect aim and no enemy pressure: an UPPER bound for a real player.
//   during   the piece first (it comes out with the room's fight on), then GE4's `sword, room` bot: the nearest living
//            member of the room's score record, the Goldling only while it is within SWITCH_TILES or once the record
//            has no living member.
//   after    fights the room first (the nearest living record member) and breaks the piece after the clear
//            (docs/GOLDLING_RUMOURS.md RD12), then the Goldling only: a calm chase in an empty room.
// focused and during play the same inputs to the release, so their engage -> release seconds match. A break with the
// actor pool full (MAX_ACTORS: the focused bot wakes every room on its way and fights none) is SKIPPED: counted in its
// row's note, not as a Goldling that came out.
//
// Weapons: the sword (the Knight, DEFAULT_CHARACTER) and the bow as the Archer character (docs/ARCHER.md: the bow in
// set 0, the Archer's traits; the dev world's `characters`). GE4's bow rows swapped to weapon set 1, which has been
// empty for the Knight since the Archer change, and read 0 / 6. The bot walks a BFS path round walls, pillars and the
// intact pieces (avoiding the open stairwell), straight at a target once in sight within CLOSE_TILES; when its walk
// stalls against a body it swings along the walk for a while (the endless bot's walkTo rule). The sword swings at the
// piece within its reach and at a target within reach + the target's radius; the bow fires at the piece in sight
// within BOW_RANGE and at a target whenever it has a line of sight (keeping BOW_KEEP from it), leading it by the
// arrow's flight (the Archer tuning bot's aim, characterTune.ts; without the lead the stream missed a fleeing Goldling
// every time).
//
// Test-only surgery: none on the hunt (honest inputs from the floor's spawn); drafts never open (the dev world's floor
// jump; the party run's startFloor / startDepth). The default run is a smoke sample (1 Goldling floor per row, floors
// 2 and 6); `--census` (shared/run/testing censusRequested; npm run test:only -- --census run/goldenCensus) runs the
// full table: 6 Goldling floors per row (GE4's sample) on floors 2 / 6 / 12. SWEEP (off) prints a tuning sweep
// (escape window x hp scale) instead.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { CharacterId } from "shared/characters";
import {
	bulletBlocker,
	gridToWorld,
	lineOfSight,
	pathField,
	worldToGrid,
	type Dungeon,
	type PathField,
} from "shared/dungeon";
import {
	BOW_DATA,
	Button,
	ENDLESS_GOLDEN_CONFIG,
	GOLDEN_KIND,
	GoldenStatus,
	NOT_BROKEN,
	SIM_HZ,
	SWORD_DATA,
	ScoreSource,
	archetypeIndex,
	createSimState,
	goldenPieceAt,
	partySize,
	playerAt,
	step,
	stepParty,
	type ActorState,
	type GoldenConfig,
	type InputFrame,
	type RoomScore,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildDevRunConfig, buildEndlessRunConfig, devStartDepth } from "shared/run";
import { censusRequested, frame, walkDir } from "shared/run/testing";

type Weapon = "sword" | "bow";
type Mode = "focused" | "during" | "after";

interface RowSpec {
	readonly weapon: Weapon;
	readonly mode: Mode;
	readonly n: number;
}

/** Off: the census table. On: the escape window x hp sweep (sword, during the fight, solo); never on in a commit. */
const SWEEP = false;
const FULL = censusRequested();

const FLOORS: ReadonlyArray<number> = FULL ? [2, 6, 12] : [2, 6];
/** Goldling floors per (floor, party size): the first this many run seeds whose floor rolled one. */
const SEEDS_PER_FLOOR = FULL ? 6 : 1;
const MAX_SEED = 400;
const ROWS: ReadonlyArray<RowSpec> = [
	{ weapon: "sword", mode: "focused", n: 1 },
	{ weapon: "sword", mode: "during", n: 1 },
	{ weapon: "sword", mode: "after", n: 1 },
	{ weapon: "bow", mode: "focused", n: 1 },
	{ weapon: "bow", mode: "after", n: 1 },
	{ weapon: "sword", mode: "focused", n: 2 },
];
/** The bot walks straight at a target (no path) once in sight within this many tiles. */
const CLOSE_TILES = 3;
/** The bow keeps this far from a target. */
const BOW_KEEP = 5;
/** The bow shoots at the piece from this close (tiles), in sight. */
const BOW_RANGE = 7;
/** The chase's path is rebuilt every this many ticks (the walk's and the fight's whenever a piece breaks). */
const PATH_TICKS = 10;
/** `during` goes for the Goldling while it is this close (tiles), else fights the nearest member. */
const SWITCH_TILES = 4;
/** A stalled walk (no move for STUCK_TICKS under a move input) swings along it for STUCK_SWING_TICKS. */
const STUCK_TICKS = 20;
const STUCK_SWING_TICKS = 30;
const STUCK_EPS = 1e-3;
/** Budgets (ticks): the whole hunt up to the release; `after`'s fight (then it goes for the piece anyway). */
const HUNT_MAX_TICKS = 12000;
const FIGHT_MAX_TICKS = 7200;

const fmt1 = (x: number) => string.format("%.1f", x);

interface Outcome {
	/** Its piece broken (by the bot) within the budget. */
	readonly released: boolean;
	readonly caught: boolean;
	/** Damaging hits taken by the Goldling (hits to catch when caught). */
	readonly hits: number;
	/** Ticks from its room's engagement to the release (released only). */
	readonly engageToRelease: number;
	/** Ticks from the release to the catch (caught only). */
	readonly releaseToCatch: number;
	/** ScoreSource.GOLDEN points it paid in all (coins, + the jackpot when caught). */
	readonly points: number;
	readonly hp: number;
	/** `after` only: the fight ran out of budget before the room cleared. */
	readonly uncleared: boolean;
	/** Its piece broke with the actor pool full: SKIPPED (it never came out). */
	readonly skipped: boolean;
}

/** Tuning knobs of one hunt (the sweep): the escape window and an hp multiplier on its spawn hp. */
interface Knobs {
	readonly escapeTicks?: number;
	readonly hpScale?: number;
}

const seedCache = new Map<string, number[]>();

/** The first SEEDS_PER_FLOOR run seeds whose `floor` (party of `n`) rolled a Goldling. */
function goldenSeeds(floor: number, n: number): number[] {
	const key = `${floor}/${n}`;
	const hit = seedCache.get(key);
	if (hit !== undefined) return hit;
	const out: number[] = [];
	for (let seed = 1; seed <= MAX_SEED && out.size() < SEEDS_PER_FLOOR; seed++)
		if (buildEndlessRunConfig(seed, n).endlessFloor(floor).golden !== undefined) out.push(seed);
	seedCache.set(key, out);
	return out;
}

interface Hunt {
	readonly config: SimConfig;
	readonly s: SimState;
	readonly d: Dungeon;
	readonly stair: readonly [number, number];
}

function huntRun(seed: number, floor: number, n: number, weapon: Weapon, knobs: Knobs): Hunt {
	const golden: GoldenConfig | undefined =
		knobs.escapeTicks !== undefined ? { ...ENDLESS_GOLDEN_CONFIG, escapeTicks: knobs.escapeTicks } : undefined;
	if (n === 1) {
		const characters: CharacterId[] = [weapon === "bow" ? "archer" : "knight"];
		const dev = buildDevRunConfig(seed, { startFloor: floor, invulnerable: true }, undefined, characters);
		const config: SimConfig = golden !== undefined ? { ...dev.config, golden } : dev.config;
		const w = dev.endlessFloor!(floor);
		return {
			config,
			s: createSimState(seed, dev.spawn!.x, dev.spawn!.z, config),
			d: dev.dungeon!,
			stair: [w.stairX, w.stairZ],
		};
	}
	if (weapon !== "sword") error("golden census: party rows are Knights (sword)", 0);
	const party = buildEndlessRunConfig(seed, n);
	let config: SimConfig = {
		...party.config,
		endless: { ...party.config.endless!, startFloor: floor, startDepth: devStartDepth(floor) },
	};
	if (golden !== undefined) config = { ...config, golden };
	const w = party.endlessFloor(floor);
	return { config, s: createSimState(seed, w.spawnX, w.spawnZ, config), d: w.dungeon, stair: [w.stairX, w.stairZ] };
}

function tickAll(h: Hunt, frames: InputFrame[]): void {
	const n = partySize(h.s);
	for (let i = 0; i < n; i++) {
		const p = playerAt(h.s, i);
		if (p.dead === 0) p.hearts = p.heartsMax;
	}
	if (h.s.party === undefined) step(h.s, frames[0], h.config);
	else stepParty(h.s, frames, h.config);
}

/** The intact breakables' cells as pathField's `blocked` (y * W + x). */
function blockedCells(h: Hunt): Set<number> {
	const out = new Set<number>();
	for (const p of h.s.breakables?.pieces ?? []) if (p.brokenTick === NOT_BROKEN) out.add(p.y * h.d.W + p.x);
	return out;
}

/** The living members of the Goldling room's score record. */
function members(s: SimState, r: RoomScore | undefined): ActorState[] {
	const out: ActorState[] = [];
	if (r === undefined) return out;
	for (let k = 0; k < r.memberSlots.size(); k++) {
		const a: ActorState | undefined = s.combat.actors[r.memberSlots[k]];
		if (a !== undefined && a.kind >= 0 && a.id === r.memberIds[k] && a.alive !== 0) out.push(a);
	}
	return out;
}

function nearest(p: { x: number; z: number }, list: ReadonlyArray<ActorState>): ActorState | undefined {
	let best: ActorState | undefined;
	let bestD = math.huge;
	for (const o of list) {
		const d = (o.x - p.x) * (o.x - p.x) + (o.z - p.z) * (o.z - p.z);
		if (d < bestD) {
			bestD = d;
			best = o;
		}
	}
	return best;
}

/** One player's frame against the target `a` (the Goldling or a room member), along `field` (a path to it). */
function targetFrame(h: Hunt, i: number, a: ActorState, field: PathField, weapon: Weapon): InputFrame {
	const p = playerAt(h.s, i);
	const dx = a.x - p.x;
	const dz = a.z - p.z;
	const dist = math.sqrt(dx * dx + dz * dz);
	const ux = dist > 1e-9 ? dx / dist : 1;
	const uz = dist > 1e-9 ? dz / dist : 0;
	const sight = lineOfSight(bulletBlocker(h.d), p.x, p.z, a.x, a.z);
	let [mx, mz] = sight && dist <= CLOSE_TILES ? [ux, uz] : walkDir(field, p.x, p.z);
	let buttons = 0;
	if (weapon === "bow") {
		if (sight && dist <= BOW_KEEP + 2) {
			const radial = math.max(-1, math.min(1, (dist - BOW_KEEP) * 0.8));
			mx = ux * radial;
			mz = uz * radial;
		}
		if (sight) buttons = Button.FIRE;
		// Lead the target by the arrow's flight (the Archer tuning bot's aim, characterTune.ts bowMove).
		const flight = dist / BOW_DATA.speed;
		const lx = dx + (a.x - a.prevX) * SIM_HZ * flight;
		const lz = dz + (a.z - a.prevZ) * SIM_HZ * flight;
		const ll = math.sqrt(lx * lx + lz * lz);
		return frame(mx, mz, buttons, ll > 1e-9 ? lx / ll : ux, ll > 1e-9 ? lz / ll : uz);
	}
	if (dist <= SWORD_DATA.reach + a.radius) buttons = Button.FIRE;
	return frame(mx, mz, buttons, ux, uz);
}

/** One player's frame toward the piece at world (px, pz) along `field`: swing / shoot at it once in reach. */
function pieceFrame(h: Hunt, i: number, px: number, pz: number, field: PathField, weapon: Weapon): InputFrame {
	const p = playerAt(h.s, i);
	const dx = px - p.x;
	const dz = pz - p.z;
	const dist = math.sqrt(dx * dx + dz * dz);
	const ux = dist > 1e-9 ? dx / dist : 1;
	const uz = dist > 1e-9 ? dz / dist : 0;
	const sight = lineOfSight(bulletBlocker(h.d), p.x, p.z, px, pz);
	if (weapon === "bow") {
		if (sight && dist <= BOW_RANGE) return frame(0, 0, Button.FIRE, ux, uz);
		const [mx, mz] = walkDir(field, p.x, p.z);
		return frame(mx, mz, 0, ux, uz);
	}
	if (dist <= SWORD_DATA.reach) return frame(ux, uz, Button.FIRE, ux, uz);
	const [mx, mz] = sight && dist <= CLOSE_TILES ? [ux, uz] : walkDir(field, p.x, p.z);
	return frame(mx, mz, 0, ux, uz);
}

/** Paths to grid cells, built on first use (one hunt). */
class Fields {
	private readonly cache = new Map<number, PathField>();
	constructor(private readonly h: Hunt) {}
	to(x: number, z: number): PathField {
		const gx = worldToGrid(x);
		const gz = worldToGrid(z);
		const key = gz * this.h.d.W + gx;
		let f = this.cache.get(key);
		if (f === undefined) {
			f = pathField(this.h.d, gridToWorld(gx), gridToWorld(gz), this.h.stair, blockedCells(this.h));
			this.cache.set(key, f);
		}
		return f;
	}
	/** Pieces broke: the cached paths go round pieces that are gone. */
	reset(): void {
		this.cache.clear();
	}
}

/** One Goldling hunted from the floor's spawn to its catch or escape (see the file comment). */
function hunt(seed: number, floor: number, n: number, weapon: Weapon, mode: Mode, knobs: Knobs = {}): Outcome {
	const h = huntRun(seed, floor, n, weapon, knobs);
	const s = h.s;
	const g = s.golden!;
	const f = g.floor;
	if (f === undefined) error(`seed ${seed} floor ${floor}: no Goldling`, 0);
	const startFloor = s.endless!.floor;
	const px = gridToWorld(f.pieceX);
	const pz = gridToWorld(f.pieceY);
	const rec = g.record >= 0 ? s.score?.rooms[g.record] : undefined;
	const fields = new Fields(h);
	let walkField = fields.to(px, pz);
	let intact = s.breakables!.intact;
	const lastX: number[] = [];
	const lastZ: number[] = [];
	const still: number[] = [];
	const swing: number[] = [];
	for (let i = 0; i < n; i++) {
		lastX.push(playerAt(s, i).x);
		lastZ.push(playerAt(s, i).z);
		still.push(0);
		swing.push(0);
	}
	let fightTicks = 0;
	let uncleared = false;
	let points0 = 0;
	let hp = 0;
	let t = 0;
	while (g.status === GoldenStatus.WAITING && t < HUNT_MAX_TICKS) {
		if (s.endless!.floor !== startFloor) error(`seed ${seed} floor ${floor}: left the floor while hunting`, 0);
		expect(goldenPieceAt(s, f.piece)).toBe(true);
		if (s.breakables!.intact !== intact) {
			fields.reset();
			intact = s.breakables!.intact;
			walkField = fields.to(px, pz);
		}
		const fighting = mode === "after" && g.engageTick >= 0 && rec !== undefined && rec.cleared === 0 && !uncleared;
		if (fighting && ++fightTicks > FIGHT_MAX_TICKS) uncleared = true;
		const room = fighting ? members(s, rec) : [];
		const frames: InputFrame[] = [];
		for (let i = 0; i < n; i++) {
			const p = playerAt(s, i);
			let fr: InputFrame;
			const target = fighting ? nearest(p, room) : undefined;
			if (fighting)
				fr =
					target !== undefined
						? targetFrame(h, i, target, fields.to(target.x, target.z), weapon)
						: frame(0, 0);
			else fr = pieceFrame(h, i, px, pz, walkField, weapon);
			// A walk stalled against a body: swing along it a while (the endless bot's walkTo rule).
			if (swing[i] > 0) {
				swing[i]--;
				fr = frame(fr.moveX, fr.moveZ, bit32.bor(fr.buttons, Button.FIRE), fr.moveX, fr.moveZ);
			}
			frames.push(fr);
		}
		tickAll(h, frames);
		for (let i = 0; i < n; i++) {
			const p = playerAt(s, i);
			const moved = math.abs(p.x - lastX[i]) + math.abs(p.z - lastZ[i]) > STUCK_EPS;
			const pushing = frames[i].moveX !== 0 || frames[i].moveZ !== 0;
			still[i] = moved || !pushing ? 0 : still[i] + 1;
			if (still[i] >= STUCK_TICKS) {
				still[i] = 0;
				swing[i] = STUCK_SWING_TICKS;
			}
			lastX[i] = p.x;
			lastZ[i] = p.z;
		}
		t++;
	}
	if (g.status === GoldenStatus.WAITING) {
		return {
			released: false,
			caught: false,
			hits: 0,
			engageToRelease: -1,
			releaseToCatch: -1,
			points: 0,
			hp: 0,
			uncleared,
			skipped: false,
		};
	}
	if (g.status === GoldenStatus.SKIPPED) {
		let live = 0;
		for (const o of s.combat.actors) if (o.kind >= 0) live++;
		print(`[golden] GR8: seed ${seed} floor ${floor} ${weapon} ${mode} party ${n}: SKIPPED (${live} actors live)`);
		return {
			released: false,
			caught: false,
			hits: 0,
			engageToRelease: g.releaseTick - g.engageTick,
			releaseToCatch: -1,
			points: 0,
			hp: 0,
			uncleared,
			skipped: true,
		};
	}
	if (g.status !== GoldenStatus.RUNNING) error(`seed ${seed} floor ${floor}: status ${g.status} at the release`, 0);
	const a = s.combat.actors[g.actorSlot];
	expect(a.kind).toBe(archetypeIndex(GOLDEN_KIND));
	if (knobs.hpScale !== undefined) {
		a.hpMax *= knobs.hpScale;
		a.hp = a.hpMax;
	}
	hp = a.hpMax;
	// Coins before the release (none: it was hidden) are not this chase's.
	points0 = s.score!.points[ScoreSource.GOLDEN];
	let field = pathField(h.d, a.x, a.z, undefined, blockedCells(h));
	let target: ActorState = a;
	let k = 0;
	while (g.status === GoldenStatus.RUNNING) {
		let tg: ActorState = a;
		if (mode === "during") {
			const p = s.player;
			const da = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
			if (da > SWITCH_TILES * SWITCH_TILES) tg = nearest(p, members(s, rec)) ?? a;
		}
		if (k % PATH_TICKS === 0 || tg !== target) field = pathField(h.d, tg.x, tg.z, undefined, blockedCells(h));
		target = tg;
		const frames: InputFrame[] = [];
		for (let i = 0; i < n; i++) frames.push(targetFrame(h, i, tg, field, weapon));
		tickAll(h, frames);
		k++;
	}
	const caught = g.status === GoldenStatus.CAUGHT;
	return {
		released: true,
		caught,
		hits: g.hits,
		engageToRelease: g.releaseTick - g.engageTick,
		releaseToCatch: caught ? s.tick - 1 - g.releaseTick : -1,
		points: s.score!.points[ScoreSource.GOLDEN] - points0,
		hp,
		uncleared,
		skipped: false,
	};
}

interface Row {
	readonly m: number;
	readonly released: number;
	readonly caught: number;
	readonly hp: number;
	readonly hits: number;
	readonly engageSec: number;
	readonly catchSec: number;
	readonly pointsCaught: number;
	readonly pointsEscaped: number;
	readonly uncleared: number;
	readonly skipped: number;
}

function row(floor: number, spec: RowSpec, knobs: Knobs = {}): Row {
	const seeds = goldenSeeds(floor, spec.n);
	let released = 0;
	let caught = 0;
	let hits = 0;
	let engage = 0;
	let catchTicks = 0;
	let hp = 0;
	let pc = 0;
	let pe = 0;
	let uncleared = 0;
	let skipped = 0;
	for (const seed of seeds) {
		const o = hunt(seed, floor, spec.n, spec.weapon, spec.mode, knobs);
		if (o.uncleared) uncleared++;
		if (o.skipped) skipped++;
		if (!o.released) continue;
		released++;
		hp = o.hp;
		engage += o.engageToRelease;
		expect(o.points).toBeGreaterThanOrEqual(0);
		if (o.caught) {
			caught++;
			hits += o.hits;
			catchTicks += o.releaseToCatch;
			pc += o.points;
		} else pe += o.points;
	}
	return {
		m: seeds.size(),
		released,
		caught,
		hp,
		hits: caught > 0 ? hits / caught : -1,
		engageSec: released > 0 ? engage / released / SIM_HZ : -1,
		catchSec: caught > 0 ? catchTicks / caught / SIM_HZ : -1,
		pointsCaught: caught > 0 ? pc / caught : -1,
		pointsEscaped: released > caught ? pe / (released - caught) : -1,
		uncleared,
		skipped,
	};
}

const cell = (x: number) => (x < 0 ? "-" : fmt1(x));
const pct = (caught: number, all: number) =>
	`${caught}/${all} (${all > 0 ? math.floor((100 * caught) / all + 0.5) : 0} %)`;
const label = (spec: RowSpec) => `${spec.weapon === "bow" ? "bow (Archer)" : "sword (Knight)"}, ${spec.mode}`;

describe("golden: GR8 hunt census (hiding places)", () => {
	if (SWEEP) {
		it("sweep: escape window x hp scale, sword during the fight, solo", () => {
			const lines: string[] = [];
			for (const escapeTicks of [600, 720, 900]) {
				for (const hpScale of [1, 0.75]) {
					let caught = 0;
					let all = 0;
					const cells: string[] = [];
					for (const floor of FLOORS) {
						const r = row(floor, { weapon: "sword", mode: "during", n: 1 }, { escapeTicks, hpScale });
						caught += r.caught;
						all += r.m;
						cells.push(`f${floor} ${pct(r.caught, r.m)} ${cell(r.hits)} hits ${cell(r.catchSec)} s`);
					}
					lines.push(`escape ${escapeTicks} hp x${hpScale}: ${caught}/${all} | ${cells.join(" | ")}`);
				}
			}
			print(`[golden] GR8 sweep:\n${lines.join("\n")}`);
		});
		return;
	}

	it("catch rate, hits, engage -> release and release -> catch (sword / bow, focused / during / after, solo / party of 2)", () => {
		const lines: string[] = [
			"| bot | party | floor | Goldlings | released | caught | hp | hits to catch | s engage -> release | s release -> catch | points if caught | points if escaped |",
			"|---|---|---|---|---|---|---|---|---|---|---|---|",
		];
		const totals: string[] = [];
		let all = 0;
		for (const spec of ROWS) {
			let caught = 0;
			let m = 0;
			for (const floor of FLOORS) {
				const r = row(floor, spec);
				caught += r.caught;
				m += r.m;
				all += r.m;
				// Every hiding place is found and broken within the budget (GR1: reachable, glinting); a break with
				// the actor pool full is SKIPPED (the rumour's one miss, RD1).
				expect(r.released + r.skipped).toBe(r.m);
				let note = r.uncleared > 0 ? ` (${r.uncleared} fight(s) out of budget)` : "";
				if (r.skipped > 0) note += ` (${r.skipped} SKIPPED: pool full)`;
				lines.push(
					`| ${label(spec)}${note} | ${spec.n} | ${floor} | ${r.m} | ${r.released} | ${pct(
						r.caught,
						r.m,
					)} | ` +
						`${fmt1(r.hp)} | ${cell(r.hits)} | ${cell(r.engageSec)} | ${cell(r.catchSec)} | ` +
						`${cell(r.pointsCaught)} | ${cell(r.pointsEscaped)} |`,
				);
			}
			totals.push(`${label(spec)}, party ${spec.n}: ${pct(caught, m)}`);
		}
		print(`[golden] GR8 census (${SEEDS_PER_FLOOR} Goldling floor(s) per row and floor):\n${lines.join("\n")}`);
		print(`[golden] GR8 catch rates: ${totals.join("; ")}; the plan's solo target 50-65 %`);
		expect(all).toBe(SEEDS_PER_FLOOR * FLOORS.size() * ROWS.size());
	});
});
