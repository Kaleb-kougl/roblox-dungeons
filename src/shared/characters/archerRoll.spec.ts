// docs/ARCHER.md AR3: the Archer's dodge through the sim's traits (SimConfig.traits / PartyConfig.traits): the dash
// step x 140 % (2.5 -> 3.38 tiles in the same 21 ticks), i-frames x 125 % folded with Slippery in one rounding (15;
// 23 / 26 / 30 with Slippery I-III; the Knight's 12 / 18 / 21 / 24 unchanged), a bullet on the 14th roll tick misses
// the Archer and hits the Knight, a roll into a wall stops flush and slides, co-op per player, Wrecker's longer reach,
// determinism. Without traits (and with NEUTRAL_TRAITS) the roll is exactly today's.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BULLET_Y,
	BUILDS_CONFIG,
	BREAKABLES_CONFIG,
	BulletKind,
	BulletPayload,
	Boon,
	Button,
	EMPTY_INPUT,
	HIT_NORMAL,
	MAX_MOVE_STEP,
	NEUTRAL_TRAITS,
	NOT_BROKEN,
	PLAYER_RADIUS,
	ROLL_DASH_STEP,
	ROLL_DASH_TICKS,
	ROLL_DISTANCE,
	ROLL_IFRAME_TICKS,
	ROLL_RECOVERY_STEP,
	ROLL_TICKS,
	compose,
	createRunState,
	createSimState,
	gen,
	grantCard,
	hashState,
	mod,
	playerTraits,
	rollIframeTicks,
	scalePercent,
	step,
	stepParty,
	stepPlayer,
	type InputFrame,
	type MoveResolver,
	type PlayerTraits,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { TileType, gridToWorld, tileAt, type BreakablePlacement, type Dungeon, type Room } from "shared/dungeon";
import { endlessRunFloor, playerMover } from "shared/run";
import { ARCHER_ROLL_DASH_PERCENT, ARCHER_ROLL_IFRAME_PERCENT, characterTraits } from "shared/characters";

const ARCHER: PlayerTraits = characterTraits("archer");
const KNIGHT: PlayerTraits = characterTraits("knight");
const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...over });
const IDLE = frame();
/** A roll toward +X (a press edge on the first tick). */
const ROLL_X = frame({ moveX: 1000, buttons: Button.ROLL });
/** A free resolver that counts its calls (so the sub-steps are real calls, as on any floor). */
function freeMover(calls: number[]): MoveResolver {
	return (x, z, dx, dz) => {
		calls.push(math.sqrt(dx * dx + dz * dz));
		return { x: x + dx, z: z + dz };
	};
}
/** The Archer's open-floor roll: 12 dash ticks at 140 % plus 9 recovery ticks. */
const ARCHER_DISTANCE =
	ROLL_DASH_TICKS * scalePercent(ROLL_DASH_STEP, ARCHER_ROLL_DASH_PERCENT) +
	(ROLL_TICKS - ROLL_DASH_TICKS) * ROLL_RECOVERY_STEP;

/** One roll to the end (21 rolling ticks), from (0, 0); returns the state. */
function rollOnce(config: SimConfig): SimState {
	const s = createSimState(1, 0, 0, config);
	step(s, ROLL_X, config);
	while (s.player.rollTicks > 0) step(s, IDLE, config);
	return s;
}

/** A tiny walled box from ASCII rows ('#' wall, '.' floor), for the mover (dungeon/collision.spec.ts's helper). */
function asciiDungeon(rows: ReadonlyArray<string>): Dungeon {
	const H = rows.size();
	const W = rows[0].size();
	const grid = new Array<number>(W * H, 0);
	rows.forEach((row, y) => {
		for (let x = 0; x < W; x++)
			grid[y * W + x] = string.sub(row, x + 1, x + 1) === "#" ? TileType.WALL : TileType.FLOOR;
	});
	const room: Room = {
		id: 0,
		cx: 2,
		cy: 2,
		w: 3,
		h: 3,
		arch: "s",
		shape: "rect",
		sx0: 2,
		sy0: 2,
		type: "entrance",
		depth: 0,
		difficulty: 0,
		degree: 0,
	};
	return {
		valid: true,
		params: { seed: 0, roomCount: 1, loopChance: 0, decorDensity: 0, themeKey: "ancient" },
		seed: 0,
		name: "test",
		W,
		H,
		grid,
		roomId: new Array<number>(W * H, -1),
		corridor: new Array<number>(W * H, 0),
		doorway: new Array<number>(W * H, 0),
		bfs: new Array<number>(W * H, 0),
		maxBfs: 0,
		rooms: [room],
		edges: [],
		entrance: 0,
		boss: 0,
		maxDepth: 1,
		props: [],
		spawns: [],
		torches: [],
		pools: [],
		lakeCells: [],
		lakeMask: new Array<number>(W * H, 0),
		arches: [],
		solidDecor: [],
		stats: { rooms: 1, edges: 0, loops: 0, critLen: 0, floorTiles: 0, reach: 0, genMs: 0, attempts: 1 },
	};
}

/** True when the body at (x, z) overlaps a wall cell of `d` by more than `eps`. */
function overlapsWall(d: Dungeon, x: number, z: number, eps = 1e-9): boolean {
	for (let gy = 0; gy < d.H; gy++)
		for (let gx = 0; gx < d.W; gx++) {
			if (tileAt(d, gx, gy) !== TileType.WALL) continue;
			const cx = math.clamp(x, gx - 0.5, gx + 0.5);
			const cz = math.clamp(z, gy - 0.5, gy + 0.5);
			const dx = x - cx;
			const dz = z - cz;
			if (dx * dx + dz * dz < (PLAYER_RADIUS - eps) * (PLAYER_RADIUS - eps)) return true;
		}
	return false;
}

describe("the Archer's roll: distance (dash x 140 %)", () => {
	it("without traits, with NEUTRAL_TRAITS, with the Knight's: exactly today's roll (same hash every tick)", () => {
		const plain: SimConfig = {};
		const a = createSimState(1, 0, 0, plain);
		const others = [
			{ traits: NEUTRAL_TRAITS },
			{ traits: KNIGHT },
			{ traits: { rollDashPercent: 100, rollIframePercent: 100, heartsMaxDelta: 0 } },
		];
		const states = others.map((c) => createSimState(1, 0, 0, c));
		for (let t = 0; t < ROLL_TICKS + 5; t++) {
			const input = t === 0 ? ROLL_X : IDLE;
			step(a, input, plain);
			for (let k = 0; k < others.size(); k++) {
				step(states[k], input, others[k]);
				expect([t, k, hashState(states[k])]).toEqual([t, k, hashState(a)]);
			}
		}
		expect(a.player.x).toBeCloseTo(ROLL_DISTANCE, 9);
		expect(playerTraits(plain, 0)).toBe(NEUTRAL_TRAITS);
	});

	it("at 140 % an open-floor roll covers 3.38 tiles in 21 ticks, in 3 sub-steps a dash tick", () => {
		const calls: number[] = [];
		const config: SimConfig = { moveResolver: freeMover(calls), traits: ARCHER };
		const s = createSimState(1, 0, 0, config);
		const steps: number[] = [];
		let rolling = 0;
		step(s, ROLL_X, config);
		steps.push(s.player.x - s.player.prevX);
		rolling++;
		while (s.player.rollTicks > 0) {
			step(s, IDLE, config);
			if (s.player.x !== s.player.prevX) steps.push(s.player.x - s.player.prevX);
			if (s.player.rollTicks > 0) rolling++;
		}
		expect(rolling).toBe(ROLL_TICKS);
		expect(steps.size()).toBe(ROLL_TICKS);
		for (let t = 0; t < ROLL_TICKS; t++) {
			const want =
				t < ROLL_DASH_TICKS ? scalePercent(ROLL_DASH_STEP, ARCHER_ROLL_DASH_PERCENT) : ROLL_RECOVERY_STEP;
			expect(steps[t]).toBeCloseTo(want, 12);
		}
		expect(s.player.x).toBeCloseTo(ARCHER_DISTANCE, 9);
		expect(s.player.x).toBeCloseTo(3.38, 9);
		expect(s.player.z).toBe(0);
		let longest = 0;
		for (const l of calls) longest = math.max(longest, l);
		expect(longest).toBeLessThanOrEqual(MAX_MOVE_STEP);
		expect(calls.size()).toBe(ROLL_DASH_TICKS * 3 + (ROLL_TICKS - ROLL_DASH_TICKS));
		// The Knight's: 2.5 tiles, 2 sub-steps a dash tick (today's).
		const kc: number[] = [];
		expect(rollOnce({ moveResolver: freeMover(kc) }).player.x).toBeCloseTo(ROLL_DISTANCE, 9);
		expect(kc.size()).toBe(ROLL_DASH_TICKS * 2 + (ROLL_TICKS - ROLL_DASH_TICKS));
	});

	it("the roll's timing is unchanged: 21 rolling ticks, the dash phase 12", () => {
		const s = createSimState(1, 0, 0, { traits: ARCHER });
		step(s, ROLL_X, { traits: ARCHER });
		expect(s.player.rollTicks).toBe(ROLL_TICKS);
	});
});

describe("the Archer's roll: i-frames (x 125 %, with Slippery in one rounding)", () => {
	function iframesAfterRoll(traits: PlayerTraits, slippery: number): number {
		const config: SimConfig = { builds: BUILDS_CONFIG, traits };
		const s = createSimState(1, 0, 0, config);
		s.run = createRunState(undefined, 1);
		for (let l = 0; l < slippery; l++) grantCard(s, 0, Boon.SLIPPERY);
		expect(rollIframeTicks(s, 0, ROLL_IFRAME_TICKS, traits.rollIframePercent) >= ROLL_IFRAME_TICKS).toBe(true);
		stepPlayer(s, ROLL_X, config, s.player, s.combat.weapons, 0, playerTraits(config, 0));
		return s.player.iframeTicks;
	}

	it("Archer 15 / 23 / 26 / 30 (Slippery none / I / II / III); Knight 12 / 18 / 21 / 24 (unchanged)", () => {
		expect([0, 1, 2, 3].map((l) => iframesAfterRoll(ARCHER, l))).toEqual([15, 23, 26, 30]);
		expect([0, 1, 2, 3].map((l) => iframesAfterRoll(KNIGHT, l))).toEqual([12, 18, 21, 24]);
		expect(ARCHER_ROLL_IFRAME_PERCENT).toBe(125);
	});

	it("a bullet meeting the player on the 14th roll tick misses the Archer and hits the Knight", () => {
		const hitOn14th = (traits: PlayerTraits): number => {
			const config: SimConfig = { traits };
			const s = createSimState(1, 0, 0, config);
			step(s, ROLL_X, config);
			for (let k = 2; k <= 13; k++) step(s, IDLE, config);
			// A still bullet on the player, now: it overlaps them through tick 14 (the recovery moves 1/30 a tick).
			const payload = BulletPayload.pack({ damage: HIT_NORMAL, kind: BulletKind.SNIPER });
			s.combat.enemyBullets.fireAt(
				{ x: s.player.x, y: BULLET_Y, z: s.player.z },
				() => compose(gen.arc(1, 0, 0, 0), mod.payload(payload)),
				0,
			);
			step(s, IDLE, config); // roll tick 14
			expect(s.player.rollTicks).toBe(ROLL_TICKS - 13);
			return s.events.playerHits;
		};
		expect(hitOn14th(ARCHER)).toBe(0);
		expect(hitOn14th(KNIGHT)).toBe(1);
	});
});

describe("the Archer's roll: walls (the slide at the longer step)", () => {
	const BOX = asciiDungeon([
		"############",
		"#..........#",
		"#..........#",
		"#..........#",
		"#..........#",
		"############",
	]);
	const PILLAR = asciiDungeon([
		"##############",
		"#............#",
		"#............#",
		"#.....#......#",
		"#............#",
		"#............#",
		"##############",
	]);

	it("a roll into a wall stops flush (both); a diagonal roll slides along it and never overlaps a wall", () => {
		for (const traits of [ARCHER, KNIGHT]) {
			const config: SimConfig = { moveResolver: playerMover(BOX), traits };
			const s = createSimState(1, gridToWorld(8), gridToWorld(2), config);
			step(s, ROLL_X, config);
			while (s.player.rollTicks > 0) {
				step(s, IDLE, config);
				expect(overlapsWall(BOX, s.player.x, s.player.z)).toBe(false);
			}
			// The +X wall's face is at x = 10.5: the body stops flush against it.
			expect(s.player.x).toBeCloseTo(gridToWorld(11) - 0.5 - PLAYER_RADIUS, 9);
			// Diagonally into the same wall: flush in x, still travelling along it in z.
			const d = createSimState(1, gridToWorld(9), gridToWorld(1) + 0.2, config);
			step(d, frame({ moveX: 707, moveZ: 707, buttons: Button.ROLL }), config);
			while (d.player.rollTicks > 0) {
				step(d, IDLE, config);
				expect(overlapsWall(BOX, d.player.x, d.player.z)).toBe(false);
			}
			expect(d.player.x).toBeCloseTo(gridToWorld(11) - 0.5 - PLAYER_RADIUS, 6);
			expect(d.player.z).toBeGreaterThan(gridToWorld(1) + 1.2);
		}
	});

	it("a roll at an isolated pillar a little off its line slips round it (the pillar slip): past the contact, sideways", () => {
		const endOf = (traits: PlayerTraits): [number, number] => {
			const config: SimConfig = { moveResolver: playerMover(PILLAR), traits };
			// The pillar is cell (6, 3); start 3 tiles before it, 0.2 off its centre line (the slip goes to +z).
			const s = createSimState(1, gridToWorld(3), gridToWorld(3) + 0.2, config);
			step(s, ROLL_X, config);
			while (s.player.rollTicks > 0) {
				step(s, IDLE, config);
				expect(overlapsWall(PILLAR, s.player.x, s.player.z)).toBe(false);
			}
			return [s.player.x, s.player.z];
		};
		const [ax, az] = endOf(ARCHER);
		const [kx, kz] = endOf(KNIGHT);
		print(`[archer roll] pillar: Archer ends (${ax}, ${az}), Knight (${kx}, ${kz})`);
		// Flush on the pillar's -x face the body would stand at x = 5.15: the Archer's longer roll slips on past it.
		const flush = gridToWorld(6) - 0.5 - PLAYER_RADIUS;
		expect(ax > flush + 0.05).toBe(true);
		expect(az > gridToWorld(3) + 0.2 + 0.1).toBe(true);
		expect(ax > kx).toBe(true);
	});
});

describe("the Archer's roll: co-op, Wrecker, determinism", () => {
	it("co-op: an Archer and a Knight rolling the same input end 3.38 / 2.5 tiles out (PartyConfig.traits)", () => {
		const config: SimConfig = { party: { size: 3, traits: [ARCHER, KNIGHT] } };
		const s = createSimState(1, 0, 0, config);
		stepParty(s, [ROLL_X, ROLL_X, ROLL_X], config);
		for (let t = 0; t < ROLL_TICKS; t++) stepParty(s, [IDLE, IDLE, IDLE], config);
		const p = s.party!.players;
		expect(p[0].x).toBeCloseTo(ARCHER_DISTANCE, 9);
		expect(p[1].x).toBeCloseTo(ROLL_DISTANCE, 9);
		expect(p[2].x).toBeCloseTo(ROLL_DISTANCE, 9); // no entry: SimConfig.traits, else neutral
		// SimConfig.traits is every player's fallback; party.traits[i] wins.
		const fallback: SimConfig = { traits: ARCHER, party: { size: 2, traits: [undefined, KNIGHT] } };
		expect([playerTraits(fallback, 0), playerTraits(fallback, 1)]).toEqual([ARCHER, KNIGHT]);
	});

	it("Wrecker: the Archer's smash reaches a crate 4 tiles ahead, the Knight's does not; 3 tiles both", () => {
		// An open patch of a real endless floor (wrecker.spec's harness), run without endless mode.
		let found: { config: SimConfig; gx: number; gy: number } | undefined;
		for (let runSeed = 1; runSeed <= 40 && found === undefined; runSeed++) {
			const fl = endlessRunFloor(runSeed, 1);
			const d = fl.dungeon;
			for (let gy = 8; gy < d.H - 8 && found === undefined; gy++)
				for (let gx = 8; gx < d.W - 8 && found === undefined; gx++) {
					let open = true;
					for (let oy = -8; oy <= 8 && open; oy++)
						for (let ox = -8; ox <= 8 && open; ox++)
							if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) open = false;
					if (open) found = { config: fl.config, gx, gy };
				}
		}
		const patch = found!;
		const broken = (traits: PlayerTraits, ahead: number): boolean => {
			const pieces: BreakablePlacement[] = [{ x: patch.gx + ahead, y: patch.gy, kind: "crate" }];
			const config: SimConfig = {
				...patch.config,
				encounter: { ...patch.config.encounter!, spawns: [] },
				breakables: { ...BREAKABLES_CONFIG, pieces },
				builds: BUILDS_CONFIG,
				traits,
			};
			const s = createSimState(1, gridToWorld(patch.gx), gridToWorld(patch.gy), config);
			s.builds!.players[0].levels[Boon.WRECKER] = 1;
			step(s, ROLL_X, config);
			for (let t = 0; t < ROLL_TICKS; t++) step(s, IDLE, config);
			return s.breakables!.pieces[0].brokenTick !== NOT_BROKEN;
		};
		expect([broken(ARCHER, 4), broken(KNIGHT, 4)]).toEqual([true, false]);
		expect([broken(ARCHER, 3), broken(KNIGHT, 3)]).toEqual([true, true]);
	});

	it("two runs of an Archer and a Knight rolling, walking and rolling again hash the same every tick", () => {
		const config: SimConfig = { party: { size: 2, traits: [ARCHER, KNIGHT] } };
		const a = createSimState(9, 0, 0, config);
		const b = createSimState(9, 0, 0, config);
		for (let t = 0; t < 120; t++) {
			const input =
				t % 30 === 0
					? frame({ moveX: 600, moveZ: 800, buttons: Button.ROLL })
					: frame({ moveX: -800, moveZ: 600 });
			stepParty(a, [input, input], config);
			stepParty(b, [input, input], config);
			expect([t, hashState(a)]).toEqual([t, hashState(b)]);
		}
		expect(a.party!.players[0].x).never.toBe(a.party!.players[1].x);
	});
});
