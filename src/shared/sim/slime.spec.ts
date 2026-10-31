// docs/ENEMY_VARIANTS.md EV3: the Ooze (`slime`) and its split (`slime.small`).
//   - registry: band PORT_BAND_ENEMIES, `slime.small` right after `slime`, both after `boss.demonlord` (10 / 11 once
//     the imp of EV2 is registered too: ids sort imp < slime < slime.small < summoner);
//   - the goo trail: stationary BulletKind.GOO puddles behind the slime, only while it moves; at most trailMax (6) of
//     its own alive, a COUNT (EVD14), so long-lived puddles (the Hourglass boon stretches bullet life) stop the trail;
//   - goo hurts the player, an ordinary swing leaves it, a guard erases it;
//   - the split: 2 smalls (1 or 0 with a full pool, actorsDropped counts the rest), pushed out sideways, engaged,
//     homed where they land; smalls never split; pushed into a pillar they stop outside it (EV0 item 14);
//   - a scored endless room does not CLEAR until both smalls are down (adoptScoreRoomMember);
//   - determinism: two identical runs, identical hashes.
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, gridToWorld, isBulletBlockingTile, tileAt, worldToGrid, type Dungeon } from "shared/dungeon";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";
import {
	BOSS_DEMONLORD_ID,
	BulletKind,
	BulletPayload,
	Button,
	EMPTY_INPUT,
	MAX_ACTORS,
	NO_KIND,
	PORT_BAND_ENEMIES,
	SLIME,
	SLIME_CRAWL,
	SLIME_ID,
	SLIME_LAST_X,
	SLIME_LAST_Z,
	SLIME_SMALL,
	SLIME_SMALL_ID,
	START_HALF_HEARTS,
	SimCtx,
	V_AGGRO,
	V_HOME_X,
	V_HOME_Z,
	archetypeAt,
	archetypeIndex,
	countOwnGoo,
	createSimState,
	engage,
	hashState,
	scoreRoomDown,
	step,
	type ActorSpawn,
	type ActorState,
	type EndlessFloorWorld,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const IDLE: InputFrame = { ...EMPTY_INPUT };
const GUARD: InputFrame = { ...EMPTY_INPUT, buttons: Button.ALT };
const SWING: InputFrame = { ...EMPTY_INPUT, buttons: Button.FIRE };
const D = SLIME.data;
/** A full InputFrame move axis. */
const MOVE_FULL = 1000;

/** An open, unbounded floor (no world, no greybox bounds: nothing blocks or clamps) with the given spawns. */
function openConfig(spawns: ActorSpawn[]): SimConfig {
	return { encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 } };
}

function actorsOf(s: SimState, id: string): ActorState[] {
	const out: ActorState[] = [];
	for (const a of s.combat.actors) if (a.kind !== NO_KIND && archetypeAt(a.kind).id === id) out.push(a);
	return out;
}

function liveOf(s: SimState, id: string): ActorState[] {
	return actorsOf(s, id).filter((a) => a.alive !== 0);
}

/** Every live enemy bullet: [x, z, kind, emitter, speed^2]. */
function bullets(s: SimState): Array<[number, number, number, number, number]> {
	const out: Array<[number, number, number, number, number]> = [];
	const sim = s.combat.enemyBullets;
	sim.forEachActive((i, pos, payload, emitter) => {
		const v = sim.velocityAt(i);
		out.push([pos.x, pos.z, BulletPayload.get(payload, "kind"), emitter, v.x * v.x + v.z * v.z]);
		return false;
	});
	return out;
}

/** Keeps the player `lead` units ahead of the slime along -X (the slime crawls after them; its trail lies behind). */
function lure(s: SimState, slime: ActorState, lead: number): void {
	const p = s.player;
	p.x = slime.x - lead;
	p.z = slime.z;
	p.prevX = p.x;
	p.prevZ = p.z;
}

/** A slime at (8, 0) in the open, engaged, with the player 5 units ahead. */
function crawling(): { s: SimState; config: SimConfig; slime: ActorState } {
	const config = openConfig([{ kind: SLIME_ID, x: 8, z: 0 }]);
	const s = createSimState(3, 3, 0, config);
	const slime = actorsOf(s, SLIME_ID)[0];
	engage(slime);
	return { s, config, slime };
}

describe("slime: registry", () => {
	it("two band-3 room enemies; slime.small right after slime, both after the Demon Lord", () => {
		expect([SLIME.id, SLIME_SMALL.id]).toEqual([SLIME_ID, SLIME_SMALL_ID]);
		expect([SLIME.band, SLIME_SMALL.band]).toEqual([PORT_BAND_ENEMIES, PORT_BAND_ENEMIES]);
		const big = archetypeIndex(SLIME_ID);
		expect(archetypeIndex(SLIME_SMALL_ID)).toBe(big + 1);
		expect(big > archetypeIndex(BOSS_DEMONLORD_ID)).toBe(true);
		// 10 / 11 once the imp (EV2) is registered; 9 / 10 without it.
		const imp = archetypeIndex(BOSS_DEMONLORD_ID) + 1 < big;
		expect(big).toBe(imp ? 10 : 9);
	});

	it("bodies: 8 hp r 0.55 1.6 u/s and 3 hp r 0.35 2.6 u/s, both contact HIT_NORMAL, both enemy.slime (small 0.6x)", () => {
		const b = SLIME.data;
		const m = SLIME_SMALL.data;
		expect([b.hp, b.radius, b.speed, b.contactDamage, b.spriteId]).toEqual([8, 0.55, 1.6, 1, "enemy.slime"]);
		expect([m.hp, m.radius, m.speed, m.contactDamage, m.spriteId, m.spriteScale]).toEqual([
			3,
			0.35,
			2.6,
			1,
			"enemy.slime",
			0.6,
		]);
		expect([b.roomEnemy, m.roomEnemy]).toEqual([true, true]);
		expect([b.goo.count, b.goo.spread, b.goo.speed, b.goo.life, b.goo.kind]).toEqual([1, 0, 0, 3, BulletKind.GOO]);
		expect([b.trailTicks, b.trailMax, b.splitCount, b.splitKind]).toEqual([30, 6, 2, SLIME_SMALL_ID]);
	});
});

describe("slime: goo trail", () => {
	it("drops stationary GOO puddles behind itself every 0.5 s of movement; never more than 6 of its own alive", () => {
		const { s, config, slime } = crawling();
		let dropped = 0;
		let most = 0;
		const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
		// 8 s: 12.8 units, inside its leash range (15 from home).
		for (let t = 0; t < 480; t++) {
			lure(s, slime, 5);
			step(s, IDLE, config);
			dropped += s.events.gooSpawned;
			if (s.events.gooSpawned > 0) {
				// The newest puddle (the slime walks along -X: the smallest x) lies trailBack behind it, at +X.
				const b = bullets(s);
				const newest = b.reduce((m, x) => (x[0] < m[0] ? x : m), b[0]);
				expect(newest[0]).toBeCloseTo(slime.x + D.trailBack, 9);
				expect(newest[1]).toBeCloseTo(slime.z, 9);
			}
			ctx.bind(s, config, EMPTY_INPUT);
			most = math.max(most, countOwnGoo(ctx, slime));
		}
		expect(slime.aiState).toBe(SLIME_CRAWL);
		expect(dropped).toBeGreaterThan(D.trailMax * 2); // puddles expire and the trail goes on
		expect(most).toBe(D.trailMax);
		for (const [, , kind, emitter, speed2] of bullets(s)) {
			expect(kind).toBe(BulletKind.GOO);
			expect(emitter).toBe(slime.emitterId);
			expect(speed2).toBe(0);
		}
		expect(s.player.hearts).toBe(START_HALF_HEARTS); // the trail is behind it
	});

	it("long-lived puddles (the Hourglass stretches bullet life) cap the trail by count", () => {
		const { s, config, slime } = crawling();
		const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
		const lasting = { ...D.goo, life: 1000 };
		for (let k = 0; k < D.trailMax; k++) ctx.fireEnemy(slime, 1, 0, lasting, -20 - k, 20);
		expect(countOwnGoo(ctx, slime)).toBe(D.trailMax);
		let dropped = 0;
		const x0 = slime.x;
		for (let t = 0; t < 300; t++) {
			lure(s, slime, 5);
			step(s, IDLE, config);
			dropped += s.events.gooSpawned;
		}
		expect(slime.x < x0 - 5).toBe(true); // it crawled all along
		expect(dropped).toBe(0);
		expect(bullets(s).size()).toBe(D.trailMax);
		// Another emitter's goo never counts toward its cap.
		const other = createSimState(3, 3, 0, config);
		const otherSlime = actorsOf(other, SLIME_ID)[0];
		const octx = new SimCtx().bind(other, config, EMPTY_INPUT);
		expect(countOwnGoo(octx, otherSlime)).toBe(0);
	});

	it("no movement, no trail: a slime holding inside contact range or idle drops nothing", () => {
		const { s, config, slime } = crawling();
		let dropped = 0;
		for (let t = 0; t < 240; t++) {
			step(s, IDLE, config); // the player stands still: it crawls up and holds
			dropped += s.events.gooSpawned;
		}
		const settled = dropped;
		for (let t = 0; t < 240; t++) {
			step(s, IDLE, config);
			dropped += s.events.gooSpawned;
		}
		expect(dropped).toBe(settled);
		const calm = createSimState(3, -20, 0, config); // out of aggro range: stays idle
		for (let t = 0; t < 240; t++) step(calm, IDLE, config);
		expect(actorsOf(calm, SLIME_ID)[0].v[V_AGGRO]).toBe(0);
		expect(calm.combat.enemyBullets.activeCount).toBe(0);
	});

	it("draws no rng: the trail leaves the sim rng where a still slime leaves it", () => {
		const { s, config, slime } = crawling();
		const before = s.rngState;
		for (let t = 0; t < 120; t++) {
			lure(s, slime, 5);
			step(s, IDLE, config);
		}
		expect(s.combat.enemyBullets.activeCount).toBeGreaterThan(0);
		expect(s.rngState).toBe(before);
	});
});

/** A slime's puddles left behind, the slime freed (no split), the player placed relative to the newest puddle. */
function puddleInFront(): { s: SimState; config: SimConfig; gx: number; gz: number } {
	const { s, config, slime } = crawling();
	for (let t = 0; t < 40; t++) {
		lure(s, slime, 5);
		step(s, IDLE, config);
	}
	expect(bullets(s).size()).toBe(1);
	new SimCtx().bind(s, config, EMPTY_INPUT).freeActor(slime);
	const [gx, gz] = bullets(s)[0];
	return { s, config, gx, gz };
}

describe("slime: goo vs the player", () => {
	it("a puddle under the player hurts them (HIT_NORMAL) and is consumed", () => {
		const { s, config, gx, gz } = puddleInFront();
		s.player.x = gx;
		s.player.z = gz;
		step(s, IDLE, config);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - D.goo.damage);
		expect(s.combat.enemyBullets.activeCount).toBe(0);
	});

	it("an ordinary swing leaves the puddle; a guard erases it", () => {
		// The player at the origin faces +X +Z by default: the puddle 1 unit along that diagonal is inside both reaches.
		const place = (s: SimState, gx: number, gz: number) => {
			s.player.x = gx - 0.7;
			s.player.z = gz - 0.7;
		};
		const a = puddleInFront();
		place(a.s, a.gx, a.gz);
		step(a.s, SWING, a.config);
		expect(bullets(a.s).map((b) => b[2])).toEqual([BulletKind.GOO]);
		const b = puddleInFront();
		place(b.s, b.gx, b.gz);
		step(b.s, GUARD, b.config);
		expect(b.s.combat.enemyBullets.activeCount).toBe(0);
		expect(b.s.player.hearts).toBe(START_HALF_HEARTS);
	});
});

describe("slime: the split", () => {
	it("2 smalls pushed out sideways, engaged, homed where they land, with the slime's last sighting; smalls never split", () => {
		const config = openConfig([{ kind: SLIME_ID, x: 8, z: 0 }]);
		const s = createSimState(3, 3, 0, config);
		const slime = actorsOf(s, SLIME_ID)[0];
		slime.faceX = -1;
		slime.faceZ = 0;
		slime.v[SLIME_LAST_X] = 3;
		slime.v[SLIME_LAST_Z] = 0;
		const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
		const spawned = s.combat.actorsDropped;
		ctx.killActor(slime);
		const smalls = actorsOf(s, SLIME_SMALL_ID);
		expect(smalls.size()).toBe(2);
		// Facing -X: sideways is (faceZ, -faceX) = (0, 1), then (0, -1).
		expect(smalls.map((m) => [m.x, m.z])).toEqual([
			[8, D.splitPush],
			[8, -D.splitPush],
		]);
		for (const m of smalls) {
			expect([m.prevX, m.prevZ]).toEqual([8, 0]); // drawn bursting out of the corpse
			expect([m.v[V_AGGRO], m.aiState]).toEqual([1, SLIME_CRAWL]);
			expect([m.v[V_HOME_X], m.v[V_HOME_Z]]).toEqual([m.x, m.z]);
			expect([m.v[SLIME_LAST_X], m.v[SLIME_LAST_Z]]).toEqual([3, 0]);
		}
		expect(s.combat.actorsDropped).toBe(spawned);
		// Smalls never split.
		const before = s.combat.nextActorId;
		ctx.killActor(smalls[0]);
		ctx.killActor(smalls[1]);
		expect(s.combat.nextActorId).toBe(before);
		expect(liveOf(s, SLIME_SMALL_ID).size()).toBe(0);
	});

	for (const free of [1, 0]) {
		it(`a full pool spawns ${free} (actorsDropped counts the rest), never an error`, () => {
			const config = openConfig([{ kind: SLIME_ID, x: 8, z: 0 }]);
			const s = createSimState(3, 3, 0, config);
			const ctx = new SimCtx().bind(s, config, EMPTY_INPUT);
			// Fill the pool with idle slimes far away until `free` slots are left.
			let filler = 0;
			while (s.combat.actors.size() < MAX_ACTORS - free) {
				ctx.spawnActor(SLIME_SMALL_ID, -30 - filler, 30);
				filler++;
			}
			const small0 = actorsOf(s, SLIME_SMALL_ID).size();
			const dropped = s.combat.actorsDropped;
			ctx.killActor(actorsOf(s, SLIME_ID)[0]);
			expect(actorsOf(s, SLIME_SMALL_ID).size() - small0).toBe(free);
			expect(s.combat.actorsDropped - dropped).toBe(D.splitCount - free);
			for (let t = 0; t < 5; t++) step(s, IDLE, config);
		});
	}
});

// --- An endless floor (solid pillars, the floor's movers)

/** The first endless floor (runs 1.., floors 1..6) with a pillar that has open floor 2 tiles all around it. */
function floorWithOpenPillar(): { fl: EndlessRunFloor; px: number; pz: number } {
	for (let run = 1; run <= 40; run++)
		for (let floor = 1; floor <= 6; floor++) {
			const fl = endlessRunFloor(run, floor);
			const d: Dungeon = fl.dungeon;
			for (const p of d.props) {
				if (p.kind !== "pillar") continue;
				let open = tileAt(d, p.x, p.y) === TileType.WALL;
				for (let oy = -2; oy <= 2; oy++)
					for (let ox = -2; ox <= 2; ox++)
						if ((ox !== 0 || oy !== 0) && tileAt(d, p.x + ox, p.y + oy) !== TileType.FLOOR) open = false;
				if (open) return { fl, px: gridToWorld(p.x), pz: gridToWorld(p.y) };
			}
		}
	error("no open pillar");
}

/** How deep a circle at (x, z) of radius r reaches into blocking tiles (0: clear of every wall). */
function wallOverlap(d: Dungeon, x: number, z: number, r: number): number {
	let worst = 0;
	const gx0 = worldToGrid(x);
	const gz0 = worldToGrid(z);
	for (let gz = gz0 - 1; gz <= gz0 + 1; gz++)
		for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
			if (!isBulletBlockingTile(tileAt(d, gx, gz))) continue;
			const cx = math.clamp(x, gridToWorld(gx) - 0.5, gridToWorld(gx) + 0.5);
			const cz = math.clamp(z, gridToWorld(gz) - 0.5, gridToWorld(gz) + 0.5);
			const dist = math.sqrt((x - cx) * (x - cx) + (z - cz) * (z - cz));
			worst = math.max(worst, r - dist);
		}
	return worst;
}

describe("slime on an endless floor (EV0 item 14: r 0.55 is wider than half a tile)", () => {
	const { fl, px, pz } = floorWithOpenPillar();
	const d = fl.dungeon;
	const at = (x: number, z: number): SimConfig => {
		const encounter = fl.config.encounter!;
		return { ...fl.config, encounter: { ...encounter, spawns: [{ kind: SLIME_ID, x, z }] } };
	};
	const OVERLAP_EPS = 1e-9;

	it("rounds an open pillar to reach a player hiding behind it, never overlapping a wall", () => {
		const config = at(px - 2, pz);
		const s = createSimState(7, px + 1.5, pz, config);
		const slime = actorsOf(s, SLIME_ID)[0];
		engage(slime);
		slime.v[SLIME_LAST_X] = s.player.x;
		slime.v[SLIME_LAST_Z] = s.player.z;
		let best = math.huge;
		let worst = 0;
		for (let t = 0; t < 360; t++) {
			step(s, IDLE, config);
			if (slime.alive === 0) break;
			const dx = slime.x - s.player.x;
			const dz = slime.z - s.player.z;
			best = math.min(best, math.sqrt(dx * dx + dz * dz));
			worst = math.max(worst, wallOverlap(d, slime.x, slime.z, slime.radius));
		}
		expect(best < D.chaseStop + 0.05).toBe(true);
		expect(worst <= OVERLAP_EPS).toBe(true);
	});

	it("smalls pushed into a pillar stop outside it (walls stop the push)", () => {
		// The slime just west of the pillar, facing +Z: the first child goes (faceZ, -faceX) = (1, 0), into the pillar.
		const config = at(px - 1.1, pz);
		const s = createSimState(7, px - 6, pz, config);
		const slime = actorsOf(s, SLIME_ID)[0];
		slime.faceX = 0;
		slime.faceZ = 1;
		new SimCtx().bind(s, config, EMPTY_INPUT).killActor(slime);
		const smalls = actorsOf(s, SLIME_SMALL_ID);
		expect(smalls.size()).toBe(2);
		const r = SLIME_SMALL.data.radius;
		expect(smalls[0].x).toBeCloseTo(px - 0.5 - r, 9); // stopped on the pillar's face, short of the full push
		expect(smalls[1].x).toBeCloseTo(px - 1.1 - D.splitPush, 9); // the other side is open
		for (const m of smalls) expect(wallOverlap(d, m.x, m.z, m.radius) <= OVERLAP_EPS).toBe(true);
		for (let t = 0; t < 120; t++) {
			step(s, IDLE, config);
			for (const m of smalls)
				if (m.alive !== 0) expect(wallOverlap(d, m.x, m.z, m.radius) <= OVERLAP_EPS).toBe(true);
		}
	});
});

// --- A scored endless room

const SEED = 42;

/** Floor 1 of SEED with its first room's deferred spawns replaced by one slime; scored. */
function slimeRoomRun(): { s: SimState; config: SimConfig; world: EndlessFloorWorld; room: number } {
	const fl = endlessRunFloor(SEED, 1);
	let room = -1;
	for (let id = 0; id < fl.roomSpawns.size() && room < 0; id++) if (fl.roomSpawns[id].size() > 0) room = id;
	expect(room >= 0).toBe(true);
	const first = fl.roomSpawns[room][0];
	const roomSpawns = fl.roomSpawns.map((list, id) =>
		id === room ? [{ kind: SLIME_ID, x: first.x, z: first.z }] : list,
	);
	const world: EndlessFloorWorld = { ...fl, roomSpawns };
	const config: SimConfig = { endless: { runSeed: SEED, worldForFloor: () => world }, scoring: {} };
	const s = createSimState(SEED, world.spawnX, world.spawnZ, config);
	return { s, config, world, room };
}

/** Walks the player onto the room's first planned tile (the slime moves out of the safe radius) and steps once. */
function enterSlimeRoom(run: ReturnType<typeof slimeRoomRun>): void {
	const first = run.world.roomSpawns[run.room][0];
	run.s.player.x = first.x;
	run.s.player.z = first.z;
	step(run.s, IDLE, run.config);
}

describe("slime: a scored endless room", () => {
	it("does not CLEAR until both smalls are down", () => {
		const run = slimeRoomRun();
		const { s, config, world, room } = run;
		enterSlimeRoom(run);
		const r = s.score!.rooms.find((x) => x.room === room)!;
		expect(r.memberSlots.size()).toBe(1);
		const ctx = new SimCtx().bind(s, world.config, EMPTY_INPUT);
		ctx.killActor(liveOf(s, SLIME_ID)[0]);
		const smalls = liveOf(s, SLIME_SMALL_ID);
		expect(smalls.size()).toBe(2);
		expect(r.memberSlots.size()).toBe(3);
		step(s, IDLE, config);
		expect([r.cleared, scoreRoomDown(s, r)]).toEqual([0, false]);
		ctx.bind(s, world.config, EMPTY_INPUT).killActor(smalls[0]);
		step(s, IDLE, config);
		expect([r.cleared, scoreRoomDown(s, r)]).toEqual([0, false]);
		ctx.bind(s, world.config, EMPTY_INPUT).killActor(smalls[1]);
		step(s, IDLE, config);
		expect(r.cleared).toBe(1);
	});

	it("determinism: two identical runs (crawl, trail, split, smalls) hash the same every tick", () => {
		const play = (): string[] => {
			const run = slimeRoomRun();
			enterSlimeRoom(run);
			const out: string[] = [];
			const ctx = new SimCtx();
			for (let t = 0; t < 420; t++) {
				const s = run.s;
				// Back away from the slime along a fixed pattern so it crawls (and trails) after the player.
				const input: InputFrame = { ...EMPTY_INPUT, moveX: t % 120 < 60 ? -MOVE_FULL : MOVE_FULL };
				if (t === 240) {
					const big = liveOf(s, SLIME_ID)[0];
					if (big !== undefined) ctx.bind(s, run.world.config, EMPTY_INPUT).killActor(big);
				}
				step(s, input, run.config);
				out.push(hashState(s));
			}
			return out;
		};
		const a = play();
		const b = play();
		expect(a.size()).toBe(b.size());
		for (let t = 0; t < a.size(); t++) if (a[t] !== b[t]) expect([t, a[t]]).toEqual([t, b[t]]);
	});
});
