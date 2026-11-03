// Breakable barrels and crates in the sim (docs/DECOR.md D4, B2-B5, task R12): opt-in state and its hash group, the
// movers' `solid` argument (players, plain and steered enemies), bullets blocked (walls, then pieces, before actors),
// every damage source with the B4 hit counts, the heavy arrow's pierce, the slam, scoring without the combo, clone,
// floor rebuilds on an endless run, co-op and replays.
import { describe, expect, it } from "@rbxts/jest-globals";
import "shared/sim/testing";
import { TileType, gridToWorld, tileAt, worldToGrid, type BreakablePlacement, type Dungeon } from "shared/dungeon";
import {
	AXIS_MAX,
	BOW_DATA,
	BREAKABLES_CONFIG,
	AFFIXES_SUBSYSTEM,
	BUILDS_SUBSYSTEM,
	PELLETS_SUBSYSTEM,
	BREAKABLES_SUBSYSTEM,
	DROPS_SUBSYSTEM,
	BREAKABLE_ENEMY_BULLET_DAMAGE,
	BREAKABLE_HP,
	BREAKABLE_SLAM_RADIUS,
	BossAttack,
	BossState,
	BreakableKind,
	BulletKind,
	Button,
	COMBO_MIN,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	NOT_BROKEN,
	PLAYER_RADIUS,
	Recorder,
	SWARMER_LAST_X,
	SWARMER_LAST_Z,
	SWORD_DATA,
	ScoreSource,
	SimCtx,
	V_MARK,
	START_HALF_HEARTS,
	cloneSimState,
	createSimState,
	engage,
	fireBurstRaw,
	hashLayout,
	hashState,
	packPayload,
	runReplay,
	slamBreakables,
	solidCells,
	step,
	stepParty,
	walkToward,
	type BreakablesConfig,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig, endlessRunFloor, type EndlessRunFloor } from "shared/run";

// ---------------------------------------------------------------------------------------------
// A real endless floor's world (movers, blocker, steering) with an open patch of floor, run WITHOUT endless mode so
// the pieces are exactly config.breakables.pieces.

/** The first endless floor with a cell whose Chebyshev radius-6 neighbourhood is all FLOOR. */
function openPatch(): { fl: EndlessRunFloor; gx: number; gy: number } {
	for (let run = 1; run <= 40; run++) {
		const fl = endlessRunFloor(run, 1);
		const d: Dungeon = fl.dungeon;
		for (let gy = 6; gy < d.H - 6; gy++)
			for (let gx = 6; gx < d.W - 6; gx++) {
				let open = true;
				for (let oy = -6; oy <= 6 && open; oy++)
					for (let ox = -6; ox <= 6 && open; ox++)
						if (tileAt(d, gx + ox, gy + oy) !== TileType.FLOOR) open = false;
				if (open) return { fl, gx, gy };
			}
	}
	error("no open patch");
}

const PATCH = openPatch();
const CX = gridToWorld(PATCH.gx);
const CZ = gridToWorld(PATCH.gy);

function piece(ox: number, oy: number, kind: "barrel" | "crate" = "crate"): BreakablePlacement {
	return { x: PATCH.gx + ox, y: PATCH.gy + oy, kind };
}

function world(
	pieces: ReadonlyArray<BreakablePlacement> | undefined,
	extra: Partial<SimConfig> = {},
	tunables: Partial<BreakablesConfig> = {},
): SimConfig {
	const c = PATCH.fl.config;
	return {
		...c,
		encounter: { ...c.encounter!, spawns: [] },
		breakables: pieces !== undefined ? { ...BREAKABLES_CONFIG, ...tunables, pieces } : undefined,
		...extra,
	};
}

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, aimZ: AXIS_MAX, ...over });
const IDLE = frame();
const FIRE = frame({ buttons: Button.FIRE });
const ALT = frame({ buttons: Button.ALT });

function run(s: SimState, config: SimConfig, input: InputFrame, ticks: number): void {
	for (let t = 0; t < ticks; t++) step(s, input, config);
}

/** Fires one enemy bullet from (x, z) toward (dirX, dirZ) at `speed` (a test emitter of its own). */
function enemyShot(s: SimState, emitter: number, x: number, z: number, dirX: number, dirZ: number, speed = 6): void {
	const payload = packPayload(1, BulletKind.ENEMY, 1);
	s.combat.enemySpawned += fireBurstRaw(s.combat.enemyBullets, emitter, x, z, dirX, dirZ, 1, 0, speed, 2, payload);
}

// ---------------------------------------------------------------------------------------------

describe("breakables: opt-in state and hash", () => {
	it("absent without SimConfig.breakables: no state, no group, every mover gets no solid cells", () => {
		const s = createSimState(1, CX, CZ, world(undefined));
		expect(s.breakables).toBe(undefined);
		expect(solidCells(s)).toBe(undefined);
		expect(
			hashLayout(s)
				.groups.map((g) => g.name)
				.includes(BREAKABLES_SUBSYSTEM),
		).toBe(false);
	});

	it("present: the pieces (kind, cell, hp, intact), the lookup, the group appended last with its dump names", () => {
		const s = createSimState(1, CX, CZ - 3, world([piece(0, 0, "barrel"), piece(2, 0, "crate")]));
		const b = s.breakables!;
		expect(b.pieces).toEqual([
			{ kind: BreakableKind.BARREL, x: PATCH.gx, y: PATCH.gy, hp: BREAKABLE_HP[0], brokenTick: NOT_BROKEN },
			{ kind: BreakableKind.CRATE, x: PATCH.gx + 2, y: PATCH.gy, hp: BREAKABLE_HP[1], brokenTick: NOT_BROKEN },
		]);
		expect(b.intact).toBe(2);
		expect(solidCells(s)).toBe(b.slotByCell);
		const layout = hashLayout(s, true);
		const last = layout.groups[layout.groups.size() - 1];
		expect(last.name).toBe(BREAKABLES_SUBSYSTEM);
		expect(last.finish - last.start).toBe(1 + 2 * 5);
		expect(layout.names[last.start]).toBe("breakables.length");
		expect(layout.names[last.start + 1]).toBe("breakables[0].kind");
		expect(layout.names[last.start + 10]).toBe("breakables[1].brokenTick");
	});

	it("clone copies the pieces and rebuilds the (unhashed) lookup", () => {
		const config = world([piece(0, 0, "barrel"), piece(3, 0)]);
		const s = createSimState(1, CX, CZ - 3, config);
		s.breakables!.pieces[1].hp = 1;
		const c = cloneSimState(s);
		expect(c.breakables!.pieces).toEqual(s.breakables!.pieces);
		expect(c.breakables!.pieces[0]).never.toBe(s.breakables!.pieces[0]);
		expect(c.breakables!.slotByCell).never.toBe(s.breakables!.slotByCell);
		expect(c.breakables!.slotByCell).toEqual(s.breakables!.slotByCell);
		expect(hashState(c)).toBe(hashState(s));
	});
});

describe("breakables: B4 toughness from the real damage numbers", () => {
	const hits = (hp: number, damage: number) => math.ceil(hp / damage);
	it("barrel 1 sword hit / 2 arrows / 4 enemy bullets; crate 2 / 4 / 8; a heavy arrow or the finisher breaks either", () => {
		const [barrel, crate] = BREAKABLE_HP;
		expect([hits(barrel, SWORD_DATA.damage), hits(barrel, BOW_DATA.damage)]).toEqual([1, 2]);
		expect(hits(barrel, BREAKABLE_ENEMY_BULLET_DAMAGE)).toBe(4);
		expect([hits(crate, SWORD_DATA.damage), hits(crate, BOW_DATA.damage)]).toEqual([2, 4]);
		expect(hits(crate, BREAKABLE_ENEMY_BULLET_DAMAGE)).toBe(8);
		for (const hp of BREAKABLE_HP) {
			expect(hits(hp, BOW_DATA.heavyDamage)).toBe(1);
			expect(hits(hp, SWORD_DATA.finisherDamage)).toBe(1);
		}
	});
});

describe("breakables: they block", () => {
	it("the player stops at a crate's face (and walks through that cell without breakables)", () => {
		const walk = frame({ moveZ: AXIS_MAX });
		const config = world([piece(0, 2)]);
		const s = createSimState(1, CX, CZ, config);
		run(s, config, walk, 90);
		const face = CZ + 2 - 0.5 - PLAYER_RADIUS;
		expect(s.player.z).toBeLessThanOrEqual(face + 1e-9);
		expect(s.player.z).toBeGreaterThan(face - 0.05);
		const free = createSimState(1, CX, CZ, world(undefined));
		run(free, world(undefined), walk, 90);
		expect(free.player.z).toBeGreaterThan(CZ + 3);
	});

	it("a plain-moving enemy presses on it (it still sees the player: no line of sight change)", () => {
		const spawns = [{ kind: "test.chaser", x: CX, z: CZ - 3 }];
		const c = PATCH.fl.config;
		const config = world([piece(0, -1)], { encounter: { ...c.encounter!, spawns } });
		const s = createSimState(3, CX, CZ + 1, config);
		const a = s.combat.actors.find((o) => o.alive !== 0)!;
		const z0 = a.z;
		run(s, config, IDLE, 120);
		expect(a.z).toBeGreaterThan(z0); // it walked: it saw the player through the crate
		expect(a.z).toBeLessThanOrEqual(CZ - 1 - 0.5 - a.radius + 1e-9);
	});

	it("steered walks (walkToward STEER: the room enemies' chase) round a lone crate; plain ones press on its face", () => {
		const walk = (steer: boolean, radius: number): number => {
			const c = PATCH.fl.config;
			const config = world([piece(0, 0)], {
				encounter: { ...c.encounter!, spawns: [{ kind: "test.dummy", x: CX - 2, z: CZ }] },
			});
			const s = createSimState(7, CX + 4, CZ + 4, config);
			const a = s.combat.actors.find((o) => o.alive !== 0)!;
			a.radius = radius;
			const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
			for (let t = 0; t < 120; t++) walkToward(ctx, a, CX + 1.5, CZ, 0.1, steer);
			const dx = a.x - (CX + 1.5);
			const dz = a.z - CZ;
			return math.sqrt(dx * dx + dz * dz);
		};
		for (const radius of [0.3, 0.35, 0.5]) {
			expect([radius, walk(true, radius) < 1e-6]).toEqual([radius, true]);
			expect([radius, walk(false, radius) > 1.5]).toEqual([radius, true]);
		}
	});

	it("a swarmer chasing a player behind a crate still reaches them (it sees them over it and goes round)", () => {
		const c = PATCH.fl.config;
		const config = world([piece(0, 0)], {
			encounter: { ...c.encounter!, spawns: [{ kind: "swarmer", x: CX - 2, z: CZ }] },
		});
		const s = createSimState(7, CX + 1.5, CZ, config);
		const a = s.combat.actors.find((o) => o.alive !== 0)!;
		engage(a);
		a.v[SWARMER_LAST_X] = s.player.x;
		a.v[SWARMER_LAST_Z] = s.player.z;
		let best = math.huge;
		let worstInside = 0;
		for (let t = 0; t < 240; t++) {
			step(s, IDLE, config);
			const dx = a.x - s.player.x;
			const dz = a.z - s.player.z;
			best = math.min(best, math.sqrt(dx * dx + dz * dz));
			// Never overlapping the crate's square (closest point of the square to the body's centre).
			const qx = math.clamp(a.x, CX - 0.5, CX + 0.5);
			const qz = math.clamp(a.z, CZ - 0.5, CZ + 0.5);
			const gap = math.sqrt((a.x - qx) * (a.x - qx) + (a.z - qz) * (a.z - qz)) - a.radius;
			if (gap < worstInside) worstInside = gap;
		}
		expect(best).toBeLessThan(1);
		expect(worstInside).toBeGreaterThan(-1e-9);
	});

	it("enemy bullets: consumed by a barrel, 4 of them break it, the 5th flies through", () => {
		const config = world([piece(2, 0, "barrel")]);
		const s = createSimState(1, CX, CZ - 5, config);
		const em = s.combat.enemyBullets.acquireEmitter();
		s.combat.enemyEmitters += 1;
		const b = s.breakables!;
		let hits = 0;
		let brokenAt = -1;
		for (let shot = 1; shot <= 5; shot++) {
			enemyShot(s, em, CX, CZ, 1, 0);
			for (let t = 0; t < 30; t++) {
				step(s, IDLE, config);
				hits += s.events.breakableHits;
				if (s.events.breakablesBroken > 0) brokenAt = shot;
			}
			if (shot < 5) expect(s.combat.enemyBullets.activeCount).toBe(0); // every bullet so far was consumed
		}
		expect([hits, brokenAt]).toEqual([4, 4]);
		expect(b.pieces[0].hp).toBe(0);
		expect(b.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(s.combat.enemyBullets.activeCount).toBe(1); // the 5th: nothing left to stop it
		expect(s.score).toBe(undefined); // (an unscored world: enemy breaks score nothing anyway)
	});

	it("goo (BulletKind.GOO, docs/ENEMY_VARIANTS.md EVD14) neither damages a piece nor is stopped by it", () => {
		const config = world([piece(2, 0, "barrel")]);
		const s = createSimState(1, CX, CZ - 5, config);
		const em = s.combat.enemyBullets.acquireEmitter();
		s.combat.enemyEmitters += 1;
		const goo = packPayload(1, BulletKind.GOO, 1);
		s.combat.enemySpawned += fireBurstRaw(s.combat.enemyBullets, em, CX, CZ, 1, 0, 1, 0, 6, 2, goo);
		let hits = 0;
		for (let t = 0; t < 40; t++) {
			step(s, IDLE, config);
			hits += s.events.breakableHits;
		}
		expect(hits).toBe(0);
		expect(s.breakables!.pieces[0].hp).toBe(BREAKABLE_HP[0]);
		expect(s.combat.enemyBullets.activeCount).toBe(1); // it went through the barrel's cell
		let x = 0;
		s.combat.enemyBullets.forEachActive((_i, pos) => {
			x = pos.x;
			return false;
		});
		expect(x > CX + 3).toBe(true);
	});

	it("a crate shields the player behind it from an enemy bullet", () => {
		const config = world([piece(1, 0)]);
		const s = createSimState(1, CX + 2, CZ, config);
		const em = s.combat.enemyBullets.acquireEmitter();
		enemyShot(s, em, CX - 1, CZ, 1, 0);
		let playerHits = 0;
		for (let t = 0; t < 60; t++) {
			step(s, IDLE, config);
			playerHits += s.events.playerHits;
		}
		expect(playerHits).toBe(0);
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
		expect(s.breakables!.pieces[0].hp).toBe(BREAKABLE_HP[1] - BREAKABLE_ENEMY_BULLET_DAMAGE);
	});
});

describe("breakables: player damage (B3)", () => {
	const scoring = { scoring: { partySize: 1 } };

	it("bow arrows: 2 break a barrel, 4 a crate; the breaks score (x floor), never feed the combo or hit an enemy", () => {
		for (const [kind, arrows] of [
			["barrel", 2],
			["crate", 4],
		] as const) {
			const config = world([piece(0, 3, kind)], { loadout: ["weapon.bow"], ...scoring });
			const s = createSimState(1, CX, CZ, config);
			let hits = 0;
			let enemyHits = 0;
			let comboFed = 0;
			let ticks = 0;
			while (s.breakables!.pieces[0].brokenTick === NOT_BROKEN && ticks < 600) {
				step(s, FIRE, config);
				hits += s.events.breakableHits;
				enemyHits += s.events.enemyHits;
				comboFed += s.score!.events.comboFed;
				ticks++;
			}
			expect([kind, hits]).toEqual([kind, arrows]);
			expect(enemyHits).toBe(0);
			expect(comboFed).toBe(0);
			expect(s.score!.combo).toBe(COMBO_MIN);
			const kindIdx = kind === "barrel" ? BreakableKind.BARREL : BreakableKind.CRATE;
			expect(s.score!.points[ScoreSource.BREAKABLES]).toBe(kindIdx === 0 ? 10 : 20);
			expect(s.score!.counts[ScoreSource.BREAKABLES]).toBe(1);
			expect(s.score!.total).toBe(s.score!.points[ScoreSource.BREAKABLES]);
			expect(s.score!.rooms.every((r) => r.cleared === 0)).toBe(true);
		}
	});

	it("the sword: one swing breaks a barrel, a crate takes two; the guard never hurts them", () => {
		const config = world([piece(0, 1, "crate"), piece(-3, 1, "barrel")], { loadout: ["weapon.sword"], ...scoring });
		const s = createSimState(1, CX, CZ, config);
		const b = s.breakables!;
		step(s, FIRE, config); // swing 1
		expect(b.pieces[0].hp).toBe(BREAKABLE_HP[1] - SWORD_DATA.damage);
		expect(s.events.breakableHits).toBe(1);
		expect(s.events.enemyHits).toBe(0);
		let t = 0;
		while (b.pieces[0].brokenTick === NOT_BROKEN && t < 30) {
			step(s, FIRE, config);
			t++;
		}
		expect(b.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(s.score!.counts[ScoreSource.BREAKABLES]).toBe(1);
		expect(s.score!.combo).toBe(COMBO_MIN);
		// The barrel (out of reach so far): walk next to it, then one swing.
		const g = createSimState(1, CX - 3, CZ, config);
		step(g, FIRE, config);
		expect(g.breakables!.pieces[1].brokenTick).toBe(0);
		// The guard (ALT): a wide arc, no damage.
		const h = createSimState(1, CX, CZ, config);
		run(h, config, ALT, 20);
		expect(h.breakables!.pieces[0].hp).toBe(BREAKABLE_HP[1]);
	});

	it("the heavy arrow breaks a barrel and keeps piercing into the enemy behind it; a piece it does not break stops it", () => {
		const shoot = (tunables: Partial<BreakablesConfig>) => {
			const c = PATCH.fl.config;
			const config = world(
				[piece(0, 2, "barrel")],
				{
					loadout: ["weapon.bow"],
					encounter: { ...c.encounter!, spawns: [{ kind: "test.dummy", x: CX, z: CZ + 4 }] },
				},
				tunables,
			);
			const s = createSimState(1, CX, CZ, config);
			const dummy = s.combat.actors.find((o) => o.alive !== 0)!;
			run(s, config, ALT, BOW_DATA.chargeTicks + 1);
			run(s, config, IDLE, 40);
			return { s, dummy };
		};
		const broke = shoot({});
		expect(broke.s.breakables!.pieces[0].brokenTick).never.toBe(NOT_BROKEN);
		expect(broke.dummy.hp).toBe(10 - BOW_DATA.heavyDamage);
		const tough = shoot({ hp: [BOW_DATA.heavyDamage * 3, BOW_DATA.heavyDamage * 3] });
		expect(tough.s.breakables!.pieces[0].hp).toBe(BOW_DATA.heavyDamage * 2);
		expect(tough.dummy.hp).toBe(10);
		expect(tough.s.combat.playerBullets.activeCount).toBe(0);
	});
});

describe("breakables: Mother Bramble's slam", () => {
	it("slamBreakables breaks every intact piece within BREAKABLE_SLAM_RADIUS of the impact, nothing farther", () => {
		const r = BREAKABLE_SLAM_RADIUS;
		const pieces = [piece(0, 0), piece(r, 0, "barrel"), piece(r + 1, 0), piece(0, -2)];
		const config = world(pieces, { scoring: { partySize: 1 } });
		const s = createSimState(1, CX, CZ - 5, config);
		expect(slamBreakables(s, CX, CZ)).toBe(3);
		expect(s.breakables!.pieces.map((p) => p.brokenTick !== NOT_BROKEN)).toEqual([true, true, false, true]);
		expect(s.events.breakablesBroken).toBe(3);
		expect(s.score!.counts[ScoreSource.BREAKABLES]).toBe(0); // not a player's break
	});

	it("in a real fight the slam's impact breaks the pieces round the boss", () => {
		const boss = endlessRunFloor(7919, 5);
		const c = boss.config;
		const room = c.encounter!.rooms[boss.dungeon.boss];
		const px = room.cx + 2;
		const pz = room.cz;
		// A ring of pieces two tiles round the player (who just stands there): the slams aim at the player.
		const pieces: BreakablePlacement[] = [];
		for (const [ox, oy] of [
			[2, 0],
			[-2, 2],
			[0, -2],
			[0, 2],
		] as const) {
			const gx = worldToGrid(px) + ox;
			const gy = worldToGrid(pz) + oy;
			if (tileAt(boss.dungeon, gx, gy) === TileType.FLOOR) pieces.push({ x: gx, y: gy, kind: "crate" });
		}
		// Bullets do no damage here, so only the slam can break them.
		const config: SimConfig = { ...c, breakables: { ...BREAKABLES_CONFIG, enemyBulletDamage: 0, pieces } };
		const s = createSimState(11, px, pz, config);
		const a = s.combat.actors.find((o) => o.alive !== 0 && o.radius > 1)!;
		let impacts = 0;
		let slamBroken = 0;
		for (let t = 0; t < 3600 && a.alive !== 0 && slamBroken === 0; t++) {
			s.player.hearts = START_HALF_HEARTS;
			const press = a.phase > 0 && a.phase < 3 && t % 20 === 10;
			const charging = a.aiState === BossState.ACTIVE && a.attack === BossAttack.SLAM && a.v[V_MARK] === 0;
			step(s, press ? { ...EMPTY_INPUT, buttons: Button.DEBUG_BOSS } : EMPTY_INPUT, config);
			const impact = charging && a.v[V_MARK] !== 0;
			if (!impact) {
				expect(s.events.breakablesBroken).toBe(0);
				continue;
			}
			impacts++;
			slamBroken += s.events.breakablesBroken;
			for (const p of s.breakables!.pieces) {
				const dx = gridToWorld(p.x) - a.x;
				const dz = gridToWorld(p.y) - a.z;
				const inside = dx * dx + dz * dz <= BREAKABLE_SLAM_RADIUS * BREAKABLE_SLAM_RADIUS;
				expect(p.brokenTick === s.tick - 1).toBe(inside);
			}
		}
		expect(impacts).toBeGreaterThan(0);
		expect(pieces.size()).toBeGreaterThan(0);
		expect(slamBroken).toBeGreaterThan(0);
	});
});

describe("breakables: endless runs, co-op, replays", () => {
	it("every endless run has them: floor 1's pieces at the start, the next floor's after a floor change", () => {
		const setup = buildEndlessRunConfig(1337);
		const spawn = setup.spawn!;
		const s = createSimState(1337, spawn.x, spawn.z, setup.config);
		const f1 = setup.endlessFloor(1).breakables!;
		expect(f1.size()).toBeGreaterThan(0);
		expect(s.breakables!.pieces.map((p) => [p.x, p.y])).toEqual(f1.map((p) => [p.x, p.y]));
		s.breakables!.pieces[0].hp = 0.5; // damaged on floor 1
		step(s, frame({ buttons: DEBUG_FLOOR_BUTTON }), setup.config);
		const f2 = setup.endlessFloor(2).breakables!;
		expect(s.endless!.floor).toBe(2);
		expect(s.breakables!.pieces.size()).toBe(f2.size());
		expect(s.breakables!.pieces.every((p) => p.brokenTick === NOT_BROKEN)).toBe(true);
		expect(s.breakables!.intact).toBe(f2.size());
		// Breakables come last but for drops (docs/BOOSTS.md B4: endless runs drop boosts too), elite affixes
		// (docs/ENEMY_VARIANTS.md EV7), builds (docs/BUILDS.md BU1) and pellets (docs/PELLETS.md PL5).
		const groups = hashLayout(s).groups.map((g) => g.name);
		expect(groups[groups.size() - 5]).toBe(BREAKABLES_SUBSYSTEM);
		expect(groups[groups.size() - 4]).toBe(DROPS_SUBSYSTEM);
		expect(groups[groups.size() - 3]).toBe(AFFIXES_SUBSYSTEM);
		expect(groups[groups.size() - 2]).toBe(BUILDS_SUBSYSTEM);
		expect(groups[groups.size() - 1]).toBe(PELLETS_SUBSYSTEM);
	});

	it("co-op: every player's bullets and swings break them, deterministically (stepParty twice, same hashes)", () => {
		const play = () => {
			const config = world([piece(0, 3, "barrel"), piece(3, 3, "crate")], {
				loadout: ["weapon.bow"],
				scoring: { partySize: 2 },
				party: { size: 2 },
			});
			const s = createSimState(5, CX, CZ, config);
			const p1 = s.party!.players[1];
			p1.x = CX + 3;
			p1.prevX = CX + 3;
			const hashes: string[] = [];
			for (let t = 0; t < 120; t++) {
				stepParty(s, [FIRE, FIRE], config);
				if (t % 10 === 0) hashes.push(hashState(s));
			}
			return { s, hashes };
		};
		const a = play();
		const b = play();
		expect(a.hashes).toEqual(b.hashes);
		expect(a.s.breakables!.pieces.map((p) => p.brokenTick !== NOT_BROKEN)).toEqual([true, true]);
		expect(a.s.score!.counts[ScoreSource.BREAKABLES]).toBe(2);
	});

	it("a recorded run with breaks replays to the same hash", () => {
		const config = world([piece(0, 3, "barrel"), piece(0, 6, "crate"), piece(2, 1)], {
			loadout: ["weapon.bow", "weapon.sword"],
			scoring: { partySize: 1 },
		});
		const s = createSimState(9, CX, CZ, config);
		const rec = new Recorder(9, CX, CZ);
		for (let t = 0; t < 300; t++) {
			const input = t < 150 ? FIRE : frame({ moveX: t % 2 === 0 ? AXIS_MAX : 0, buttons: Button.FIRE });
			rec.record(input);
			step(s, input, config);
		}
		expect(
			s.events.breakablesBroken + s.breakables!.pieces.filter((p) => p.brokenTick !== NOT_BROKEN).size(),
		).toBeGreaterThan(0);
		const replayed = runReplay(rec.getRecording(), config);
		expect(hashState(replayed)).toBe(hashState(s));
	});
});
