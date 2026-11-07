// docs/LEGENDARIES.md LG3 (Bastion): the pip on the pick, the guard through runMods (full ring, 27 ticks; SWORD_DATA's
// numbers without it), the brace (BASTION_BRACE_BULLETS (8) bullets in one guard or roll restore a pip, once per room, not spent at full armor),
// the count's resets (guard start, roll start, a swap mid-guard), the roll brace (any weapon, each bullet once by the
// payload's lastHit mark, never through post-hit invulnerability, Phantom Step's erasures count, goo and strikes never),
// the re-arm (a room's spawn, a floor's start), co-op (own armor only, a marked bullet never counts for a second
// roller), and determinism with Bastion rolling through fans in co-op.
import "shared/sim/testing";
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BASTION_BRACE_BULLETS,
	BASTION_GUARD_HALF_ANGLE_COS,
	BASTION_GUARD_TICKS,
	BUILDS_CONFIG,
	Boon,
	BraceKind,
	BulletKind,
	BulletPayload,
	Button,
	DEBUG_FLOOR_BUTTON,
	DEFAULT_BOUNDS,
	EMPTY_INPUT,
	SWORD_DATA,
	SWORD_V_GUARD,
	createSimState,
	fireBurstRaw,
	grantCard,
	hashState,
	packPayload,
	playerAt,
	runMods,
	step,
	stepParty,
	swordGuard,
	swordGuardHalfAngleCos,
	swordGuardRing,
	swordGuardTicks,
	weaponsAt,
	type ActorSpawn,
	type EncounterRoom,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { frame } from "shared/run/testing";

const SEED = 42;
const IDLE = EMPTY_INPUT;
const GUARD = frame(0, 0, Button.ALT, 0, 1);
const ROLL = frame(0, 0, Button.ROLL, 0, 1);
const SWAP = frame(0, 0, Button.SWAP, 0, 1);

// An open endless arena with one combat room around (0, 8) whose swarmer spawns on first entry (the brace re-arm).
const ROOM: EncounterRoom = {
	id: 0,
	type: "combat",
	depth: 1,
	cx: 0,
	cz: 8,
	minX: -1,
	maxX: 1,
	minZ: 7,
	maxZ: 9,
	floorTiles: 9,
};
const ROOM_SPAWNS: ActorSpawn[][] = [[{ kind: "swarmer", x: 0, z: 8.5 }]];

function arena(loadout?: ReadonlyArray<string>): (floor: number) => EndlessFloorWorld {
	const cache = new Map<number, EndlessFloorWorld>();
	return (floor) => {
		let w = cache.get(floor);
		if (w === undefined) {
			w = {
				floor,
				config: {
					bounds: DEFAULT_BOUNDS,
					loadout,
					encounter: { spawns: [], rooms: [ROOM], entranceRoom: -1, bossRoom: -1 },
				},
				bossFloor: false,
				spawnX: 0,
				spawnZ: 0,
				stairX: 1000,
				stairZ: 1000,
				roomSpawns: ROOM_SPAWNS,
				roomIdAt: (x, z) => (x >= ROOM.minX && x <= ROOM.maxX && z >= ROOM.minZ && z <= ROOM.maxZ ? 0 : -1),
			};
			cache.set(floor, w);
		}
		return w;
	};
}

function configOf(loadout?: ReadonlyArray<string>, extra: Partial<SimConfig> = {}): SimConfig {
	return { endless: { runSeed: SEED, worldForFloor: arena(loadout) }, scoring: {}, builds: BUILDS_CONFIG, ...extra };
}

const ARENA = configOf();
const BOW_ARENA = configOf(["weapon.bow"]);
const PARTY2 = configOf(undefined, { scoring: { partySize: 2 }, party: { size: 2 } });

function fresh(config: SimConfig = ARENA, bastion = true): SimState {
	const s = createSimState(SEED, 0, 0, config);
	if (bastion) for (let i = 0; i < (config.party?.size ?? 1); i++) grantCard(s, i, Boon.BASTION);
	return s;
}

/** A stationary enemy bullet at (x, z) (or moving along +Z / dir). */
function enemyBullet(s: SimState, x: number, z: number, kind: number = BulletKind.ENEMY, speed = 0): void {
	const c = s.combat;
	c.enemySpawned += fireBurstRaw(c.enemyBullets, 1, x, z, 0, 1, 1, 0, speed, 3, packPayload(1, kind, 1));
}

function enemyBulletCount(s: SimState): number {
	let n = 0;
	s.combat.enemyBullets.forEachActive(() => {
		n++;
		return false;
	});
	return n;
}

/** The lastHit field of every live enemy bullet. */
function marks(s: SimState): number[] {
	const out: number[] = [];
	s.combat.enemyBullets.forEachActive((_i, _pos, payload) => {
		out.push(BulletPayload.get(payload, "lastHit"));
		return false;
	});
	return out;
}

/**
 * `n` stationary bullets (BASTION_BRACE_BULLETS by default) in front of a knight at the origin facing +Z, on a grid of
 * 4 per row (x -0.6..0.6, z from 0.9 by 0.2: inside the guard's reach for up to 16), starting at grid cell `from`.
 */
function volleyInFront(s: SimState, n = BASTION_BRACE_BULLETS, from = 0): void {
	for (let k = from; k < from + n; k++) enemyBullet(s, -0.6 + 0.4 * (k % 4), 0.9 + 0.2 * math.floor(k / 4));
}

/** `n` copies of `v`. */
function filled(n: number, v: number): number[] {
	const out: number[] = [];
	for (let k = 0; k < n; k++) out.push(v);
	return out;
}

function bp(s: SimState, i = 0) {
	return s.builds!.players[i];
}

/** Steps solo `n` idle ticks. */
function idle(s: SimState, n: number, config: SimConfig = ARENA): void {
	for (let t = 0; t < n; t++) step(s, IDLE, config);
}

/** Starts a roll that stays in place (roll direction zeroed), i-frames running. */
function rollInPlace(s: SimState, config: SimConfig = ARENA): void {
	step(s, ROLL, config);
	s.player.rollDirX = 0;
	s.player.rollDirZ = 0;
}

describe("Bastion: the pick and the guard (LG3)", () => {
	it("the pick adds BASTION_ARMOR_PIPS (1) to armorMax and armor and arms the brace", () => {
		const s = fresh(ARENA, false);
		const p = s.player;
		const before = [p.armor, p.armorMax];
		grantCard(s, 0, Boon.BASTION);
		expect([p.armor, p.armorMax]).toEqual([before[0] + 1, before[1] + 1]);
		expect([bp(s).braceReady, bp(s).braceCount]).toEqual([1, 0]);
		expect(runMods(s, 0).bastion).toBe(true);
	});

	it("27 ticks with Bastion, 18 without; the ring's numbers for the view", () => {
		const plain = fresh(ARENA, false);
		const s = fresh();
		expect([swordGuardTicks(plain, 0), swordGuardTicks(s, 0)]).toEqual([
			SWORD_DATA.guardTicks,
			BASTION_GUARD_TICKS,
		]);
		expect([SWORD_DATA.guardTicks, BASTION_GUARD_TICKS]).toEqual([18, 27]);
		expect([swordGuardHalfAngleCos(plain, 0), swordGuardHalfAngleCos(s, 0)]).toEqual([
			SWORD_DATA.guardHalfAngleCos,
			BASTION_GUARD_HALF_ANGLE_COS,
		]);
		expect([swordGuardRing(plain, 0), swordGuardRing(s, 0)]).toEqual([false, true]);
		for (const st of [plain, s]) {
			const len = swordGuardTicks(st, 0);
			step(st, GUARD, ARENA);
			const slot = weaponsAt(st, 0).sets[0];
			expect(slot.v[SWORD_V_GUARD]).toBe(len - 1);
			let up = 1;
			while (slot.v[SWORD_V_GUARD] > 0) {
				step(st, IDLE, ARENA);
				up++;
			}
			expect(up).toBe(len);
		}
		// The view's progress stays within 0..1 with the player's own length (and clamps with the default one).
		const slot = weaponsAt(s, 0).sets[0];
		slot.v[SWORD_V_GUARD] = BASTION_GUARD_TICKS;
		expect([swordGuard(slot, BASTION_GUARD_TICKS), swordGuard(slot)]).toEqual([1, 1]);
	});

	it("the guard erases a bullet straight behind the knight only with Bastion", () => {
		for (const bastion of [false, true]) {
			const s = fresh(ARENA, bastion);
			enemyBullet(s, 0, -1.2);
			enemyBullet(s, 0, 1.2);
			step(s, GUARD, ARENA);
			expect(enemyBulletCount(s)).toBe(bastion ? 0 : 1);
		}
	});
});

describe("Bastion's brace (LG3)", () => {
	it("BASTION_BRACE_BULLETS (8) cancels in one guard restore a pip once per room; a second guard does nothing", () => {
		const s = fresh();
		const p = s.player;
		p.armor = 0;
		volleyInFront(s);
		step(s, GUARD, ARENA);
		expect(BASTION_BRACE_BULLETS).toBe(8);
		expect([p.armor, bp(s).braceReady, bp(s).braceCount]).toEqual([1, 0, BASTION_BRACE_BULLETS]);
		expect([s.builds!.events.bracePlayer, s.builds!.events.braceKind]).toEqual([[0], [BraceKind.PIP]]);
		idle(s, SWORD_DATA.guardCooldownTicks);
		p.armor = 0;
		volleyInFront(s);
		step(s, GUARD, ARENA);
		expect([enemyBulletCount(s), p.armor, s.builds!.events.bracePlayer.size()]).toEqual([0, 0, 0]);
	});

	it("one short does nothing; the count builds over a guard's ticks and restarts with the next guard", () => {
		const s = fresh();
		const p = s.player;
		p.armor = 0;
		const short = BASTION_BRACE_BULLETS - 1;
		volleyInFront(s, short);
		step(s, GUARD, ARENA);
		expect([bp(s).braceCount, p.armor]).toEqual([short, 0]);
		volleyInFront(s, 1, short);
		step(s, IDLE, ARENA); // still guarding: the last bullet of the same guard braces
		expect([bp(s).braceCount, p.armor]).toEqual([BASTION_BRACE_BULLETS, 1]);
		const t = SWORD_DATA.guardCooldownTicks - 1;
		idle(s, t);
		enemyBullet(s, 0, 1.2);
		step(s, GUARD, ARENA);
		expect(bp(s).braceCount).toBe(1);
	});

	it("at full armor the brace is not spent (LGD6 revised): a later one restores the pip a hit took", () => {
		const s = fresh();
		const p = s.player;
		volleyInFront(s);
		step(s, GUARD, ARENA);
		// Nothing to restore: braceReady stays set, nothing pushed (BraceKind.SPENT never fires).
		expect([p.armor, p.armorMax, bp(s).braceReady, bp(s).braceCount]).toEqual([
			p.armorMax,
			p.armorMax,
			1,
			BASTION_BRACE_BULLETS,
		]);
		expect(s.builds!.events.bracePlayer.size()).toBe(0);
		idle(s, SWORD_DATA.guardCooldownTicks);
		// A hit takes a pip (an enemy bullet on the knight, no i-frames).
		const hearts = p.hearts;
		enemyBullet(s, p.x, p.z);
		step(s, IDLE, ARENA);
		expect([p.armor, p.hearts]).toEqual([p.armorMax - 1, hearts]);
		p.iframeTicks = 0;
		volleyInFront(s);
		step(s, GUARD, ARENA);
		expect([p.armor, bp(s).braceReady]).toEqual([p.armorMax, 0]);
		expect(s.builds!.events.braceKind).toEqual([BraceKind.PIP]);
	});

	it("a swap or a roll mid-guard resets the count", () => {
		const s = fresh();
		enemyBullet(s, 0, 1.2);
		enemyBullet(s, 0.4, 1.2);
		step(s, GUARD, ARENA);
		expect(bp(s).braceCount).toBe(2);
		step(s, SWAP, ARENA);
		expect([bp(s).braceCount, weaponsAt(s, 0).activeSet]).toEqual([0, 1]);
		const r = fresh();
		enemyBullet(r, 0, 1.2);
		enemyBullet(r, 0.4, 1.2);
		step(r, GUARD, ARENA);
		expect(bp(r).braceCount).toBe(2);
		step(r, ROLL, ARENA);
		expect(bp(r).braceCount).toBe(0);
	});

	it("re-arms when a room's enemies spawn and at a floor's start", () => {
		const s = fresh();
		s.player.armor = 0;
		volleyInFront(s);
		step(s, GUARD, ARENA);
		expect(bp(s).braceReady).toBe(0);
		s.player.x = ROOM.cx;
		s.player.z = ROOM.cz;
		step(s, IDLE, ARENA);
		expect(s.events.roomEntered).toBe(ROOM.id + 1);
		expect(bp(s).braceReady).toBe(1);
		bp(s).braceReady = 0;
		step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), ARENA);
		expect(s.events.floorChanged).toBe(2);
		expect(bp(s).braceReady).toBe(1);
	});
});

describe("Bastion's roll brace (LG3)", () => {
	it("a roll through BASTION_BRACE_BULLETS bullets braces with the bow in hand", () => {
		const s = fresh(BOW_ARENA);
		const p = s.player;
		p.armor = 0;
		rollInPlace(s, BOW_ARENA);
		expect(p.rollTicks > 0 && p.iframeTicks > 0).toBe(true);
		for (let k = 0; k < BASTION_BRACE_BULLETS; k++) enemyBullet(s, p.x, p.z);
		const hearts = p.hearts;
		step(s, IDLE, BOW_ARENA);
		expect([bp(s).braceCount, p.armor, p.hearts]).toEqual([BASTION_BRACE_BULLETS, 1, hearts]);
		expect(s.builds!.events.braceKind).toEqual([BraceKind.PIP]);
		expect(marks(s)).toEqual(filled(BASTION_BRACE_BULLETS, 1));
	});

	it("a bullet overlapping the roller for 5 ticks counts once", () => {
		const s = fresh(BOW_ARENA);
		rollInPlace(s, BOW_ARENA);
		enemyBullet(s, s.player.x, s.player.z);
		idle(s, 5, BOW_ARENA);
		expect([bp(s).braceCount, enemyBulletCount(s)]).toEqual([1, 1]);
	});

	it("a roll start restarts the count", () => {
		const s = fresh(BOW_ARENA);
		rollInPlace(s, BOW_ARENA);
		enemyBullet(s, s.player.x, s.player.z);
		step(s, IDLE, BOW_ARENA);
		expect(bp(s).braceCount).toBe(1);
		idle(s, 40, BOW_ARENA);
		rollInPlace(s, BOW_ARENA);
		expect(bp(s).braceCount).toBe(0);
	});

	it("a bullet passing through post-hit invulnerability (no roll) never counts", () => {
		const s = fresh(BOW_ARENA);
		const p = s.player;
		p.iframeTicks = 30;
		enemyBullet(s, p.x, p.z);
		idle(s, 3, BOW_ARENA);
		expect([bp(s).braceCount, marks(s)]).toEqual([0, [0]]);
	});

	it("goo and strikes never count", () => {
		const s = fresh(BOW_ARENA);
		rollInPlace(s, BOW_ARENA);
		enemyBullet(s, s.player.x, s.player.z, BulletKind.GOO);
		enemyBullet(s, s.player.x, s.player.z, BulletKind.GOO);
		enemyBullet(s, s.player.x, s.player.z, BulletKind.GOO);
		step(s, IDLE, BOW_ARENA);
		expect(bp(s).braceCount).toBe(0);
	});

	it("Phantom Step's erasures count", () => {
		const s = fresh(BOW_ARENA);
		for (let k = 0; k < 3; k++) grantCard(s, 0, Boon.SLIPPERY);
		const p = s.player;
		p.armor = 0;
		rollInPlace(s, BOW_ARENA);
		for (let k = 0; k < BASTION_BRACE_BULLETS; k++) enemyBullet(s, p.x, p.z);
		step(s, IDLE, BOW_ARENA);
		expect(enemyBulletCount(s)).toBe(0);
		expect(s.builds!.events.phantomOwner).toEqual(filled(BASTION_BRACE_BULLETS, 0));
		expect([bp(s).braceCount, p.armor]).toEqual([BASTION_BRACE_BULLETS, 1]);
	});

	it("without Bastion a roll counts nothing and marks nothing", () => {
		const s = fresh(BOW_ARENA, false);
		rollInPlace(s, BOW_ARENA);
		enemyBullet(s, s.player.x, s.player.z);
		step(s, IDLE, BOW_ARENA);
		expect([bp(s).braceCount, marks(s)]).toEqual([0, [0]]);
	});
});

describe("Bastion in co-op (LG3)", () => {
	function partyRoll(s: SimState): void {
		stepParty(s, [ROLL, ROLL], PARTY2);
		for (let i = 0; i < 2; i++) {
			const p = playerAt(s, i);
			p.rollDirX = 0;
			p.rollDirZ = 0;
		}
	}

	it("one player's brace never touches another's armor", () => {
		const s = fresh(PARTY2);
		const a = playerAt(s, 0);
		const b = playerAt(s, 1);
		a.armor = 0;
		b.armor = 0;
		partyRoll(s);
		b.x = a.x + 5; // apart: only player 0 overlaps the volley
		b.z = a.z;
		for (let k = 0; k < BASTION_BRACE_BULLETS; k++) enemyBullet(s, a.x, a.z);
		stepParty(s, [IDLE, IDLE], PARTY2);
		expect([a.armor, b.armor]).toEqual([1, 0]);
		expect([bp(s, 0).braceCount, bp(s, 1).braceCount]).toEqual([BASTION_BRACE_BULLETS, 0]);
		expect(s.builds!.events.bracePlayer).toEqual([0]);
	});

	it("a bullet counted by one roller never counts for a second one", () => {
		const s = fresh(PARTY2);
		partyRoll(s);
		const a = playerAt(s, 0);
		const b = playerAt(s, 1);
		b.x = a.x;
		b.z = a.z;
		enemyBullet(s, a.x, a.z);
		stepParty(s, [IDLE, IDLE], PARTY2);
		stepParty(s, [IDLE, IDLE], PARTY2);
		expect([bp(s, 0).braceCount, bp(s, 1).braceCount, marks(s)]).toEqual([1, 0, [1]]);
	});

	it("rolling through fans is deterministic: two runs hash the same every tick", () => {
		function run(): { hashes: string[]; braces: number } {
			const s = fresh(PARTY2);
			for (let i = 0; i < 2; i++) playerAt(s, i).armor = 0;
			const hashes: string[] = [];
			let braces = 0;
			for (let t = 0; t < 160; t++) {
				const phase = t % 40;
				const inputs: InputFrame[] = phase === 0 ? [ROLL, ROLL] : [IDLE, IDLE];
				if (phase === 1) {
					// Two fans of 5 (5 @ 0.7, the imp's port row: 10 >= BASTION_BRACE_BULLETS) burst over each player,
					// heading -Z.
					for (let i = 0; i < 2 * 2; i++) {
						const p = playerAt(s, i % 2);
						const c = s.combat;
						c.enemySpawned += fireBurstRaw(
							c.enemyBullets,
							1,
							p.x,
							p.z + 0.2,
							0,
							-1,
							5,
							0.7,
							2,
							3,
							packPayload(1, BulletKind.ENEMY, 1),
						);
					}
				}
				stepParty(s, inputs, PARTY2);
				if (phase === 20) for (let i = 0; i < 2; i++) bp(s, i).braceReady = 1; // as a new room would
				hashes.push(hashState(s));
				braces += s.builds!.events.bracePlayer.size();
			}
			return { hashes, braces };
		}
		const a = run();
		const b = run();
		expect(a.braces).toBeGreaterThan(0);
		expect(a.braces).toBe(b.braces);
		expect(a.hashes).toEqual(b.hashes);
	});
});
