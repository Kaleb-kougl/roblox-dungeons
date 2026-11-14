// E1.6 combat (E1.8 structure; ported from src/sim/combat.test.ts): payload layout, the Ember clear, enemy bullets
// through damagePlayer (and through i-frames), wall culling (a synthetic blocker and the real seed-1337 dungeon), the
// fallback bounds cube, player bullets vs the sandbox turret archetypes (kill, silence, respawn), the placeholder gun,
// hashing (every CombatState / ActorState / weapon field), cloneSimState, stress mode.
// Extra (port): the Ember clear is also checked with the stress emitter feeding the pool, besides the source's sprayer.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	KALEB_VALE_MVP_PARAMS,
	bulletBlocker,
	circleMover,
	entranceSpawn,
	generateDungeon,
	isBulletBlocked,
} from "shared/dungeon";
import {
	PLAYER_BULLET_DAMAGE,
	TURRET_DIR_X,
	TURRET_DIR_Z,
	TURRET_HP,
	TURRET_RESPAWN_TICKS,
	TURRET_SNIPER,
	archetypeIndex,
	BULLET_Y,
	BulletKind,
	BulletPayload,
	Button,
	EMPTY_INPUT,
	ENEMY_BULLET_LIFE,
	ENEMY_BULLET_RADIUS,
	FALLBACK_BULLET_BOUNDS,
	HIT_NORMAL,
	PLAYER_FIRE_TICKS,
	PLAYER_RADIUS,
	PLAYER_SHOT_COUNT,
	ROLL_IFRAME_TICKS,
	SIM_DT,
	START_HALF_HEARTS,
	acquireSpawnData,
	cloneSimState,
	compose,
	createSimState,
	gen,
	hashState,
	mod,
	step,
	type ActorSpawn,
	type ActorState,
	type EncounterConfig,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

/** An encounter with just these spawns (no rooms). */
const enc = (spawns: ActorSpawn[]): EncounterConfig => ({ spawns, rooms: [], entranceRoom: -1, bossRoom: -1 });

const frame = (over: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...over });
/** The E1.6 placeholder gun in hand (the default loadout is the sword and bow since E1.8). */
const GUN: SimConfig = { loadout: ["weapon.test", "weapon.test.melee"] };
const IDLE = frame();
const FIRE = frame({ buttons: Button.FIRE });

/**
 * One enemy bullet at (x, z) moving at `speed` toward heading `angle` (radians, 0 = +Z). Heading 0 goes through the
 * ported gen.arc (the table); other headings build the spawn directly with math.sin / cos (test code may use trig).
 */
function shoot(s: SimState, x: number, z: number, speed: number, angle = 0, damage = HIT_NORMAL): number {
	const payload = BulletPayload.pack({ damage, kind: BulletKind.SNIPER });
	const origin = { x, y: BULLET_Y, z };
	if (angle === 0) {
		return s.combat.enemyBullets.fireAt(origin, () => compose(gen.arc(1, 0, speed, 0), mod.payload(payload)), 0);
	}
	return s.combat.enemyBullets.fireAt(
		origin,
		() => {
			const p = acquireSpawnData();
			p.velocity.x = math.sin(angle) * speed;
			p.velocity.z = math.cos(angle) * speed;
			p.payload = payload;
			return [p];
		},
		0,
	);
}

function run(s: SimState, input: InputFrame, ticks: number, config: SimConfig): void {
	for (let i = 0; i < ticks; i++) step(s, input, config);
}

describe("payload layout", () => {
	it("packs damage (6 bits), kind (4 bits), source (8 bits), pierce (3) and lastHit (7), lowest bits first", () => {
		expect([...BulletPayload.fields]).toEqual(["damage", "kind", "source", "pierce", "lastHit"]);
		expect(BulletPayload.bits).toBe(28);
		expect(BulletPayload.pack({ pierce: 2, lastHit: 64 })).toBe(
			bit32.bor(bit32.lshift(2, 18), bit32.lshift(64, 21)),
		);
		const p = BulletPayload.pack({ damage: 3, kind: BulletKind.CASTER, source: 5 });
		expect(p).toBe(bit32.bor(3, bit32.lshift(BulletKind.CASTER, 6), bit32.lshift(5, 10)));
		expect(BulletPayload.get(p, "damage")).toBe(3);
		expect(BulletPayload.get(p, "kind")).toBe(BulletKind.CASTER);
		expect(BulletPayload.get(p, "source")).toBe(5);
	});

	it("rejects out-of-range values like the library's dev build", () => {
		expect(() => BulletPayload.pack({ damage: 64 })).toThrow("holds integers 0");
		expect(() => BulletPayload.with(0, "pierce", 8)).toThrow('payload field "pierce" holds integers 0');
		expect(() => BulletPayload.pack({ kind: 1.5 })).toThrow("got 1.5");
	});
});

describe("Ember bullet clear", () => {
	it("clears every enemy bullet on the tick the Ember fires; player bullets stay", () => {
		const config: SimConfig = { stress: { bullets: 100, x: 0, z: 5 } };
		const s = createSimState(1, 0, 0, { ...config, ...GUN });
		for (let i = 0; i < 10; i++) shoot(s, -5 + i, -5, 0.5, math.pi); // drifting away from the player
		run(s, IDLE, 120, config); // the stress emitter fires rings
		step(s, FIRE, config); // a player volley in flight
		const before = s.combat.enemyBullets.activeCount;
		const playerBefore = s.combat.playerBullets.activeCount;
		expect(before).toBeGreaterThan(10);
		expect(playerBefore).toBe(PLAYER_SHOT_COUNT);
		const spawnedBefore = s.combat.enemySpawned;
		step(s, frame({ buttons: Button.EMBER }), config);
		expect(s.events.emberUsed).toBe(1);
		expect(s.events.bulletsCleared).toBe(before);
		// Only a ring fired after the clear in the same tick (phase 3) can be alive.
		expect(s.combat.enemyBullets.activeCount).toBe(s.combat.enemySpawned - spawnedBefore);
		expect(s.combat.enemyBullets.activeCount).toBeGreaterThan(0);
		expect(s.combat.playerBullets.activeCount).toBe(playerBefore);
	});

	it("clears a sprayer turret's rings the same way (the source's version)", () => {
		const config: SimConfig = { encounter: enc([{ kind: "turret.sprayer", x: 0, z: 3 }]) };
		const s = createSimState(1, 0, 0, { ...config, ...GUN });
		for (let i = 0; i < 10; i++) shoot(s, -5 + i, -5, 0.5, math.pi); // drifting away from the player
		run(s, IDLE, 120, config); // the sprayer fires rings (the player is in range)
		step(s, FIRE, config); // a player volley in flight
		const before = s.combat.enemyBullets.activeCount;
		const playerBefore = s.combat.playerBullets.activeCount;
		expect(before).toBeGreaterThan(10);
		const spawnedBefore = s.combat.enemySpawned;
		step(s, frame({ buttons: Button.EMBER }), config);
		expect(s.events.emberUsed).toBe(1);
		expect(s.events.bulletsCleared).toBe(before);
		// Only a burst fired after the clear in the same tick (phase 2) can be alive.
		expect(s.combat.enemyBullets.activeCount).toBe(s.combat.enemySpawned - spawnedBefore);
		expect(s.combat.playerBullets.activeCount).toBe(playerBefore);
	});

	it("does nothing without an Ember left", () => {
		const s = createSimState(1, 0, 0);
		s.player.embers = 0;
		shoot(s, 5, 5, 0);
		step(s, frame({ buttons: Button.EMBER }), {});
		expect(s.events.emberUsed).toBe(0);
		expect(s.combat.enemyBullets.activeCount).toBe(1);
	});
});

describe("enemy bullets vs the player", () => {
	it("a hit goes through damagePlayer and consumes the bullet", () => {
		const s = createSimState(1, 0, 0);
		shoot(s, 0, -3, 6); // heading +Z, straight at the player
		let hitTick = -1;
		for (let t = 0; t < 60 && hitTick < 0; t++) {
			step(s, IDLE, {});
			if (s.events.playerHits > 0) hitTick = t;
		}
		expect(hitTick).toBeGreaterThan(0);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
		expect(s.player.hurtTicks).toBeGreaterThan(0); // damagePlayer's post-hit invulnerability
		expect(s.events.lastHitSource).toBe(-1); // a test bullet: no source in its payload
		expect(s.combat.enemyBullets.activeCount).toBe(0);
		// It landed on the first tick its center came within PLAYER_RADIUS + ENEMY_BULLET_RADIUS.
		const reach = 3 - (hitTick + 1) * 6 * SIM_DT;
		expect(reach).toBeLessThan(PLAYER_RADIUS + ENEMY_BULLET_RADIUS);
		expect(reach + 6 * SIM_DT).toBeGreaterThanOrEqual(PLAYER_RADIUS + ENEMY_BULLET_RADIUS);
	});

	it("passes through during dodge-roll i-frames (not consumed), and lands once they end", () => {
		const s = createSimState(1, 0, 0);
		step(s, frame({ buttons: Button.ROLL }), {}); // roll toward the facing vector, i-frames start
		let spawned = 0;
		for (let t = 1; t < ROLL_IFRAME_TICKS; t++) {
			spawned += shoot(s, s.player.x, s.player.z, 0);
			step(s, IDLE, {});
			expect(s.player.iframeTicks).toBeGreaterThan(0);
			expect(s.events.playerHits).toBe(0);
			expect(s.combat.enemyBullets.activeCount).toBe(spawned);
		}
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
		shoot(s, s.player.x, s.player.z, 0);
		step(s, IDLE, {});
		expect(s.player.iframeTicks).toBe(0);
		expect(s.events.playerHits).toBe(1);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
		expect(s.combat.enemyBullets.activeCount).toBe(spawned);
	});

	it("passes through during post-hit invulnerability, and 0-damage (stress) bullets never land", () => {
		const s = createSimState(1, 0, 0);
		shoot(s, 0, 0, 0);
		step(s, IDLE, {});
		expect(s.events.playerHits).toBe(1);
		shoot(s, 0, 0, 0);
		step(s, IDLE, {});
		expect(s.events.playerHits).toBe(0);
		expect(s.combat.enemyBullets.activeCount).toBe(1);
		const t = createSimState(1, 0, 0);
		shoot(t, 0, 0, 0, 0, 0);
		run(t, IDLE, 5, {});
		expect(t.player.hearts).toBe(START_HALF_HEARTS);
		expect(t.combat.enemyBullets.activeCount).toBe(1);
	});
});

describe("bullets vs walls (isBulletBlocked)", () => {
	// A synthetic 6x6 room (the dungeon version of this test needs shared/dungeon): solid outside |x|, |z| <= 3.
	const blocked = (x: number, z: number): boolean => math.abs(x) > 3 || math.abs(z) > 3;
	const config: SimConfig = { isBulletBlocked: blocked };

	it("turns bounds culling off and consumes a bullet on the first tick it is inside a wall", () => {
		const s = createSimState(1337, 0, 0, config);
		expect(s.combat.boundsLimit).toBe(math.huge);
		expect(s.combat.enemyBullets.boundsLimit).toBe(math.huge);
		for (let k = 0; k < 8; k++) shoot(s, 0, 0, 5, (k * math.pi) / 4);
		s.player.iframeTicks = 1000; // so they pass through the player (test-only state poke)
		let ticks = 0;
		while (s.combat.enemyBullets.activeCount > 0 && ticks < 600) {
			step(s, IDLE, config);
			ticks++;
			s.combat.enemyBullets.forEachActive((_i, pos) => {
				expect(blocked(pos.x, pos.z)).toBe(false);
			});
		}
		expect(s.combat.enemyBullets.activeCount).toBe(0);
		expect(ticks * SIM_DT).toBeLessThan(ENEMY_BULLET_LIFE / 2); // walls, not lifetime
	});

	it("also stops player bullets", () => {
		const s = createSimState(1337, 0, 0, { ...config, ...GUN });
		run(s, frame({ aimX: 1000, buttons: Button.FIRE }), 1, config);
		expect(s.combat.playerBullets.activeCount).toBe(PLAYER_SHOT_COUNT);
		let ticks = 1;
		while (s.combat.playerBullets.activeCount > 0 && ticks < 120) {
			step(s, IDLE, config);
			ticks++;
			s.combat.playerBullets.forEachActive((_i, pos) => {
				expect(blocked(pos.x, pos.z)).toBe(false);
			});
		}
		expect(s.combat.playerBullets.activeCount).toBe(0);
		expect(ticks).toBeLessThan(60); // the 1 s lifetime would take 60
	});

	it("without a blocker, the fallback bounds cube culls instead", () => {
		const s = createSimState(1, 0, 0);
		expect(s.combat.boundsLimit).toBe(FALLBACK_BULLET_BOUNDS);
		shoot(s, 0, 2, 12); // +Z, away from the player
		let ticks = 0;
		while (s.combat.enemyBullets.activeCount > 0) {
			step(s, IDLE, {});
			ticks++;
		}
		const traveled = 2 + ticks * 12 * SIM_DT;
		expect(traveled).toBeGreaterThan(FALLBACK_BULLET_BOUNDS - 1e-9); // culled on the step it left the cube
		expect(traveled).toBeLessThan(FALLBACK_BULLET_BOUNDS + 12 * SIM_DT * 1.0001);
	});
});

describe("bullets vs dungeon walls (seed 1337)", () => {
	const d = generateDungeon({ ...KALEB_VALE_MVP_PARAMS, seed: 1337 });
	const spawn = entranceSpawn(d);
	const config: SimConfig = { moveResolver: circleMover(d, PLAYER_RADIUS), isBulletBlocked: bulletBlocker(d) };

	it("turns bounds culling off and consumes a bullet on the first tick it is inside a WALL / VOID tile", () => {
		const s = createSimState(1337, spawn.x, spawn.z, config);
		expect(s.combat.boundsLimit).toBe(math.huge);
		// Eight bullets from the entrance center (where the player stands) in every direction.
		const speed = 5;
		for (let k = 0; k < 8; k++) shoot(s, spawn.x, spawn.z, speed, (k * math.pi) / 4);
		s.player.iframeTicks = 1000; // so they pass through the player (test-only state poke)
		let ticks = 0;
		while (s.combat.enemyBullets.activeCount > 0 && ticks < 600) {
			step(s, IDLE, config);
			ticks++;
			s.combat.enemyBullets.forEachActive((_i, pos) => {
				expect(isBulletBlocked(d, pos.x, pos.z)).toBe(false);
			});
		}
		expect(s.combat.enemyBullets.activeCount).toBe(0);
		// Walls, not lifetime: every bullet died long before ENEMY_BULLET_LIFE.
		expect(ticks * SIM_DT).toBeLessThan(ENEMY_BULLET_LIFE / 2);
	});

	it("also stops player bullets", () => {
		const s = createSimState(1337, spawn.x, spawn.z, { ...config, ...GUN });
		run(s, frame({ aimX: 1000, buttons: Button.FIRE }), 1, config);
		expect(s.combat.playerBullets.activeCount).toBe(PLAYER_SHOT_COUNT);
		let ticks = 1;
		while (s.combat.playerBullets.activeCount > 0 && ticks < 120) {
			step(s, IDLE, config);
			ticks++;
			s.combat.playerBullets.forEachActive((_i, pos) => {
				expect(isBulletBlocked(d, pos.x, pos.z)).toBe(false);
			});
		}
		expect(s.combat.playerBullets.activeCount).toBe(0);
		expect(ticks).toBeLessThan(60); // the 1 s lifetime would take 60
	});
});

describe("player weapon (placeholder, FIRE)", () => {
	it("fires a volley on the press tick, then every PLAYER_FIRE_TICKS while held", () => {
		const s = createSimState(1, 0, 0, GUN);
		const shots: number[] = [];
		for (let t = 0; t < 40; t++) {
			step(s, FIRE, {});
			if (s.events.shotsFired !== 0) shots.push(t);
		}
		expect(PLAYER_FIRE_TICKS).toBe(9);
		expect(shots).toEqual([0, 9, 18, 27, 36]);
		expect(s.combat.playerSpawned).toBe(shots.size() * PLAYER_SHOT_COUNT);
	});

	it("keeps the cooldown across a quick release, and is ready again once it has run out", () => {
		const s = createSimState(1, 0, 0, GUN);
		step(s, FIRE, {});
		run(s, IDLE, 3, {});
		step(s, FIRE, {}); // 4 ticks after the shot: still cooling down
		expect(s.events.shotsFired).toBe(0);
		run(s, IDLE, 10, {});
		step(s, FIRE, {});
		expect(s.events.shotsFired).toBe(1);
	});

	it("shoots down the facing vector from in front of the player, the middle bullet exactly on it", () => {
		const s = createSimState(1, 0, 0, GUN);
		step(s, frame({ aimX: 600, aimZ: -800, buttons: Button.FIRE }), {});
		const dirs: [number, number][] = [];
		s.combat.playerBullets.forEachActive((i) => {
			const v = s.combat.playerBullets.velocityAt(i);
			const len = math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
			dirs.push([v.x / len, v.z / len]);
		});
		expect(dirs.size()).toBe(PLAYER_SHOT_COUNT);
		expect(dirs.some(([x, z]) => math.abs(x - 0.6) < 1e-12 && math.abs(z + 0.8) < 1e-12)).toBe(true);
		for (const [x, z] of dirs) expect(x * 0.6 + z * -0.8).toBeGreaterThan(math.cos(0.1));
	});

	it("does not fire while rolling or dead", () => {
		const s = createSimState(1, 0, 0, GUN);
		step(s, frame({ buttons: Button.ROLL + Button.FIRE }), {});
		expect(s.events.shotsFired).toBe(0);
		const d = createSimState(1, 0, 0, GUN);
		d.player.dead = 1;
		step(d, FIRE, {});
		expect(d.events.shotsFired).toBe(0);
		expect(d.combat.playerBullets.activeCount).toBe(0);
	});
});

describe("sandbox turret archetypes", () => {
	const config: SimConfig = { encounter: enc([{ kind: "turret.sniper", x: 0, z: 4 }]) };
	const AIM_AT_TURRET = frame({ aimZ: 1000, buttons: Button.FIRE });

	it("the sniper aims its 5-bullet arc at the player and fires on its cooldown, only while awake", () => {
		const far = createSimState(1, 0, -20, config);
		run(far, IDLE, 200, config);
		expect(far.combat.enemySpawned).toBe(0); // asleep: out of TURRET_WAKE_RADIUS
		const s = createSimState(1, 3, 4, config);
		const pat = TURRET_SNIPER.data;
		const fired: number[] = [];
		for (let t = 0; t < pat.firstTicks + 2 * pat.periodTicks; t++) {
			const before = s.combat.enemySpawned;
			step(s, IDLE, config);
			if (s.combat.enemySpawned > before) fired.push(t);
		}
		expect(fired).toEqual([
			pat.firstTicks - 1,
			pat.firstTicks - 1 + pat.periodTicks,
			pat.firstTicks - 1 + 2 * pat.periodTicks,
		]);
		const t = s.combat.actors[0];
		expect([t.v[TURRET_DIR_X], t.v[TURRET_DIR_Z]]).toEqual([1, 0]); // toward the player at +X
		expect([t.faceX, t.faceZ]).toEqual([1, 0]);
		// Its bullets land, and each hit names it as the source.
		let sniperHits = 0;
		for (let k = 0; k < 240; k++) {
			step(s, IDLE, config);
			if (s.events.playerHits > 0) {
				expect(s.events.lastHitSource).toBe(archetypeIndex("turret.sniper"));
				sniperHits++;
			}
		}
		expect(sniperHits).toBeGreaterThan(0);
	});

	it("player bullets damage and kill it; dead, it stops firing; it respawns after TURRET_RESPAWN_TICKS", () => {
		const s = createSimState(1, 0, 0, { ...config, ...GUN });
		const t: ActorState = s.combat.actors[0];
		let hits = 0;
		let killTick = -1;
		for (let k = 0; k < 300 && killTick < 0; k++) {
			step(s, AIM_AT_TURRET, config);
			hits += s.events.enemyHits;
			if (s.events.enemyHits > 0 && t.hp > 0) expect(t.flashTicks).toBeGreaterThan(0);
			if (s.events.enemiesKilled !== 0) killTick = s.tick;
		}
		expect(killTick).toBeGreaterThan(0);
		expect(hits).toBe(TURRET_HP / PLAYER_BULLET_DAMAGE);
		expect(t.hp).toBe(0);
		expect(t.alive).toBe(0);
		expect(t.deadTicks).toBe(0);

		// Dead: no bullets of its own, and player bullets fly through where it stood.
		const spawned = s.combat.enemySpawned;
		let through = 0;
		for (let k = 0; k < TURRET_RESPAWN_TICKS - 1; k++) {
			step(s, k < 60 ? AIM_AT_TURRET : IDLE, config);
			through += s.events.enemyHits;
		}
		expect(through).toBe(0);
		expect(s.combat.enemySpawned).toBe(spawned);
		expect(t.alive).toBe(0);
		expect(t.deadTicks).toBe(TURRET_RESPAWN_TICKS - 1);

		step(s, IDLE, config);
		expect(t.alive).toBe(1);
		expect(t.hp).toBe(TURRET_HP);
		run(s, IDLE, TURRET_SNIPER.data.firstTicks, config);
		expect(s.combat.enemySpawned).toBeGreaterThan(spawned); // firing again
	});
});

describe("combat state hashing and cloning", () => {
	const config: SimConfig = {
		encounter: enc([
			{ kind: "turret.sprayer", x: 2, z: 2 },
			{ kind: "turret.caster", x: -2, z: 2 },
		]),
		stress: { bullets: 100, x: 0, z: 5 },
	};

	/** Bumps every number (and every element of every number array) of `obj` and expects the hash to change. */
	function expectAllHashed(s: SimState, obj: Record<string, unknown>, label: string, base: string): number {
		let n = 0;
		for (const [k, v] of obj as unknown as ReadonlyMap<string, unknown>) {
			if (typeIs(v, "table")) {
				const arr = v as number[];
				for (let i = 0; i < arr.size(); i++) {
					const name = `${label}.${k}[${i}]`;
					expect([name, typeOf(arr[i])]).toEqual([name, "number"]);
					arr[i] += 1;
					expect([name, hashState(s) !== base]).toEqual([name, true]);
					arr[i] -= 1;
					n++;
				}
				continue;
			}
			const name = `${label}.${k}`;
			expect([name, typeOf(v)]).toEqual([name, "number"]);
			obj[k] = (v as number) + 1;
			expect([name, hashState(s) !== base]).toEqual([name, true]);
			obj[k] = v;
			n++;
		}
		return n;
	}

	it("every plain CombatState, ActorState and weapon field is a number covered by the hash", () => {
		const s = createSimState(1, 0, 0, config);
		const base = hashState(s);
		const c = s.combat as unknown as Record<string, unknown>;
		// guardEvents: the Bulwark's unhashed per-tick feed for the view (docs/NEW_ENEMIES_2.md NX2), like ScoreEvents.
		const nested = new Set(["enemyBullets", "playerBullets", "actors", "weapons", "guardEvents"]);
		let plain = 0;
		for (const [k, v] of c as unknown as ReadonlyMap<string, unknown>) {
			if (nested.has(k)) continue;
			expect([k, typeOf(v)]).toEqual([k, "number"]);
			c[k] = (v as number) + 1;
			expect([k, hashState(s) !== base]).toEqual([k, true]);
			c[k] = v;
			plain++;
		}
		expect(plain).toBeGreaterThan(10);
		expect(s.combat.actors.size()).toBe(2);
		expect(
			expectAllHashed(s, s.combat.actors[1] as unknown as Record<string, unknown>, "actor", base),
		).toBeGreaterThan(30);
		const w = s.combat.weapons as unknown as Record<string, unknown>;
		for (const [k, v] of w as unknown as ReadonlyMap<string, unknown>) {
			if (k === "sets") continue;
			w[k] = (v as number) + 1;
			expect([`weapons.${k}`, hashState(s) !== base]).toEqual([`weapons.${k}`, true]);
			w[k] = v;
		}
		for (let i = 0; i < s.combat.weapons.sets.size(); i++) {
			const set = s.combat.weapons.sets[i] as unknown as Record<string, unknown>;
			expectAllHashed(s, set, `weapons.sets[${i}]`, base);
		}
		expect(hashState(s)).toBe(base);
	});

	it("every live bullet is in the hash (position bits, payload, slot)", () => {
		const s = createSimState(1, 0, 0);
		shoot(s, 1, 1, 1);
		const base = hashState(s);
		const t = createSimState(1, 0, 0);
		shoot(t, 1, 1 + 1e-15, 1);
		expect(hashState(t)).never.toBe(base);
		const u = createSimState(1, 0, 0);
		shoot(u, 1, 1, 1, 0, 2);
		expect(hashState(u)).never.toBe(base);
		const v = createSimState(1, 0, 0);
		shoot(v, 5, 5, 0); // slot 0 taken by another bullet, the same one moves to slot 1
		shoot(v, 1, 1, 1);
		v.combat.enemyBullets.forEachActive((i) => i === 0);
		expect(v.combat.enemyBullets.activeCount).toBe(1);
		expect(hashState(v)).never.toBe(base);
	});

	it("cloneSimState is exact while no bullet was ever spawned, and refuses afterwards", () => {
		const s = createSimState(1, 0, 0, config);
		expect(() => cloneSimState(s)).never.toThrow(); // nothing has fired yet
		const pristine = createSimState(1, 0, 0, { encounter: config.encounter });
		pristine.player.x = -50; // far from the turrets: they sleep
		run(pristine, IDLE, 30, {});
		const c = cloneSimState(pristine);
		expect(hashState(c)).toBe(hashState(pristine));
		expect(c.combat.actors).toEqual(pristine.combat.actors);
		expect(c.combat.actors[0]).never.toBe(pristine.combat.actors[0]);
		expect(c.combat.enemyBullets).never.toBe(pristine.combat.enemyBullets);
		expect(c.combat.enemyBullets.stepCount).toBe(30);
		step(s, IDLE, config); // the stress emitter fires on the first tick
		expect(s.combat.enemySpawned).toBeGreaterThan(0);
		expect(() => cloneSimState(s)).toThrow("runReplay");
	});
});

describe("stress mode", () => {
	it("keeps about the target number of enemy bullets alive, harmlessly", () => {
		const config: SimConfig = { stress: { bullets: 1000, x: 0, z: 0 } };
		const s = createSimState(1, 0, 0, config);
		run(s, IDLE, 600, config);
		let min = math.huge;
		let max = 0;
		for (let i = 0; i < 300; i++) {
			step(s, IDLE, config);
			min = math.min(min, s.combat.enemyBullets.activeCount);
			max = math.max(max, s.combat.enemyBullets.activeCount);
		}
		expect(min).toBeGreaterThanOrEqual(950);
		expect(max).toBeLessThan(1000 + 48 + 1);
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
		expect(s.combat.dropped).toBe(0);
	});
});
