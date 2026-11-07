/**
 * The player's mover in every world's config (docs/WALL_SLIDE.md WS4, Design 5, WSD1): the slide by default (M1, endless,
 * the tutorial), `PlayerMover.WEB` exactly the web build's circleMover, and the kind read when the config is built.
 */
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import {
	TileType,
	blocksMove,
	cellKey,
	moveCircle,
	slideCircle,
	tileAt,
	type Dungeon,
	type SolidCells,
} from "shared/dungeon";
import { PLAYER_RADIUS, SQRT1_2, WALK_STEP, type MoveResolver } from "shared/sim";
import {
	PlayerMover,
	buildEndlessRunConfig,
	buildRunConfig,
	buildTutorialRunConfig,
	playerMoverKind,
	setPlayerMover,
	type PlayerMoverKind,
} from "shared/run";

const SEED = 1337;
/** A walk tick in the 8 world directions. */
const DIRS: ReadonlyArray<readonly [number, number]> = [
	[WALK_STEP, 0],
	[-WALK_STEP, 0],
	[0, WALK_STEP],
	[0, -WALK_STEP],
	[WALK_STEP * SQRT1_2, WALK_STEP * SQRT1_2],
	[WALK_STEP * SQRT1_2, -WALK_STEP * SQRT1_2],
	[-WALK_STEP * SQRT1_2, WALK_STEP * SQRT1_2],
	[-WALK_STEP * SQRT1_2, -WALK_STEP * SQRT1_2],
];
/** Starts inside a cell: its centre and four points 0.3 off it. */
const OFFSETS: ReadonlyArray<readonly [number, number]> = [
	[0, 0],
	[0.3, 0.3],
	[-0.3, 0.3],
	[0.3, -0.3],
	[-0.3, -0.3],
];
const WALK_TICKS = 60;

const restore: PlayerMoverKind = playerMoverKind();
afterAll(() => {
	setPlayerMover(restore);
});

/** FLOOR cells with a blocking 8-neighbour (grid or `solid`): where the two movers can differ. */
function edgeCells(d: Dungeon, solid?: SolidCells): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			if (tileAt(d, gx, gy) !== TileType.FLOOR || (solid !== undefined && solid.has(cellKey(gx, gy)))) continue;
			let touches = false;
			for (let oy = -1; oy <= 1 && !touches; oy++)
				for (let ox = -1; ox <= 1; ox++) if (blocksMove(d, gx + ox, gy + oy, solid)) touches = true;
			if (touches) out.push([gx, gy]);
		}
	return out;
}

interface Compared {
	moves: number;
	/** Moves where `resolver` was not bit-identical to `expected`. */
	mismatches: number;
	/** Moves where slideCircle and moveCircle differ (the two movers are really different here). */
	differ: number;
	/** Walks of WALK_TICKS from a start where moveCircle stalls (< 25 % of a free walk) and the resolver goes past (> 75 %). */
	unstuck: number;
}

/** One move from every start of every edge cell in every direction, and one walk of WALK_TICKS from each cell centre. */
function compare(d: Dungeon, resolver: MoveResolver, kind: PlayerMoverKind, solid?: SolidCells): Compared {
	const out: Compared = { moves: 0, mismatches: 0, differ: 0, unstuck: 0 };
	const free = WALK_STEP * WALK_TICKS;
	for (const [gx, gy] of edgeCells(d, solid)) {
		for (const [dx, dz] of DIRS) {
			for (const [ox, oz] of OFFSETS) {
				const x = gx + ox,
					z = gy + oz;
				const got = resolver(x, z, dx, dz, solid);
				const s = slideCircle(d, x, z, dx, dz, PLAYER_RADIUS, solid);
				const c = moveCircle(d, x, z, dx, dz, PLAYER_RADIUS, solid);
				const want = kind === PlayerMover.WEB ? c : s;
				out.moves++;
				if (got.x !== want.x || got.z !== want.z) out.mismatches++;
				if (s.x !== c.x || s.z !== c.z) out.differ++;
			}
			let rx = gx,
				rz = gy,
				cx = gx,
				cz = gy;
			for (let t = 0; t < WALK_TICKS; t++) {
				const r = resolver(rx, rz, dx, dz, solid);
				rx = r.x;
				rz = r.z;
				const c = moveCircle(d, cx, cz, dx, dz, PLAYER_RADIUS, solid);
				cx = c.x;
				cz = c.z;
			}
			const cMoved = math.sqrt((cx - gx) * (cx - gx) + (cz - gy) * (cz - gy));
			const rMoved = math.sqrt((rx - gx) * (rx - gx) + (rz - gy) * (rz - gy));
			if (cMoved < 0.25 * free && rMoved > 0.75 * free) out.unstuck++;
		}
	}
	return out;
}

function solidOfFloor(breakables: ReadonlyArray<{ x: number; y: number }> | undefined): SolidCells | undefined {
	if (breakables === undefined || breakables.size() === 0) return undefined;
	const m = new Map<number, number>();
	breakables.forEach((b, i) => m.set(cellKey(b.x, b.y), i));
	return m;
}

describe("playerMover (WALL_SLIDE.md WS4)", () => {
	it("defaults to the slide; setPlayerMover returns the previous kind", () => {
		expect(playerMoverKind()).toBe(PlayerMover.SLIDE);
		expect(setPlayerMover(PlayerMover.WEB)).toBe(PlayerMover.SLIDE);
		expect(playerMoverKind()).toBe(PlayerMover.WEB);
		expect(setPlayerMover(PlayerMover.SLIDE)).toBe(PlayerMover.WEB);
	});

	it("M1's default config moves with the slide: a wall-corner walk moveCircle stalls on ends past it", () => {
		setPlayerMover(PlayerMover.SLIDE);
		const setup = buildRunConfig(SEED);
		const d = setup.dungeon!;
		const r = compare(d, setup.config.moveResolver!, PlayerMover.SLIDE);
		print(
			`[playerMover] M1 ${SEED} slide: ${r.moves} moves, ${r.differ} differ from moveCircle, ${r.unstuck} walks unstuck`,
		);
		expect(r.mismatches).toBe(0);
		expect(r.differ).toBeGreaterThan(0);
		expect(r.unstuck).toBeGreaterThan(0);
	});

	it("PlayerMover.WEB gives exactly circleMover's positions (M1, scored M1, endless, tutorial)", () => {
		const prev = setPlayerMover(PlayerMover.WEB);
		try {
			for (const setup of [buildRunConfig(SEED), buildRunConfig(SEED, { scoring: {} })]) {
				const r = compare(setup.dungeon!, setup.config.moveResolver!, PlayerMover.WEB);
				expect(r.mismatches).toBe(0);
				expect(r.unstuck).toBe(0);
			}
			const endless = buildEndlessRunConfig(SEED).endlessFloor(1);
			const er = compare(
				endless.dungeon,
				endless.config.moveResolver!,
				PlayerMover.WEB,
				solidOfFloor(endless.breakables),
			);
			expect(er.mismatches).toBe(0);
			const tut = buildTutorialRunConfig().endlessFloor(1);
			expect(compare(tut.dungeon, tut.config.moveResolver!, PlayerMover.WEB).mismatches).toBe(0);
		} finally {
			setPlayerMover(prev);
		}
	});

	it("endless and the tutorial move with the slide by default (breakables as SolidCells)", () => {
		setPlayerMover(PlayerMover.SLIDE);
		const endless = buildEndlessRunConfig(SEED).endlessFloor(1);
		const solid = solidOfFloor(endless.breakables);
		const er = compare(endless.dungeon, endless.config.moveResolver!, PlayerMover.SLIDE, solid);
		print(
			`[playerMover] endless ${SEED} floor 1 slide: ${er.moves} moves, ${er.differ} differ, ${er.unstuck} unstuck`,
		);
		expect(er.mismatches).toBe(0);
		expect(er.unstuck).toBeGreaterThan(0);
		const tut = buildTutorialRunConfig().endlessFloor(1);
		const tr = compare(tut.dungeon, tut.config.moveResolver!, PlayerMover.SLIDE);
		expect(tr.mismatches).toBe(0);
		expect(tr.differ).toBeGreaterThan(0);
	});

	it("the kind is read when the config is built: later floors keep it after the switch is restored", () => {
		const prev = setPlayerMover(PlayerMover.WEB);
		const web = buildEndlessRunConfig(SEED);
		const webTutorial = buildTutorialRunConfig();
		setPlayerMover(PlayerMover.SLIDE);
		try {
			const f2 = web.endlessFloor(2);
			expect(
				compare(f2.dungeon, f2.config.moveResolver!, PlayerMover.WEB, solidOfFloor(f2.breakables)).mismatches,
			).toBe(0);
			const t2 = webTutorial.endlessFloor(2);
			expect(compare(t2.dungeon, t2.config.moveResolver!, PlayerMover.WEB).mismatches).toBe(0);
			const slide2 = buildEndlessRunConfig(SEED).endlessFloor(2);
			expect(
				compare(slide2.dungeon, slide2.config.moveResolver!, PlayerMover.SLIDE, solidOfFloor(slide2.breakables))
					.mismatches,
			).toBe(0);
		} finally {
			setPlayerMover(prev);
		}
	});
});
