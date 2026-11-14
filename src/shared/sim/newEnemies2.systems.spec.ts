// docs/NEW_ENEMIES_2.md NX11: the four new room enemies against the game's other systems, one case per interaction that
// has a rule (the notes for the ones that have none are in the doc's "NX11 / NX12 systems and tuning" subsection).
//   builds    Chain Spark and Overkill strike a guarding Shieldwall through its front (they call damageActor, which
//             knows no origin); Soul Shards' shards are bullets: one from a corpse in front stops on the shield, one from
//             a corpse behind lands (NXD21); Executioner never executes through the shield (a blocked hit never reaches
//             damageActor); Siege Bolt pins a Shieldwall from behind and a pinned one guards nothing; Siege Bolt's
//             pinning hit on a dragging Chainhook frees the player (>= breakDamage), and a Shielded Chainhook's absorbed
//             damage does not count toward breakDamage (as built: an owner call, NX11 OC).
//   treasure  a latch and a drag land no hit (UNTOUCHED counts nothing: score.hitsTaken); the yank fan's hit counts.
//   horde     wave 2 copies a Pyre-keeper, a Chainhook and a Shieldwall; only the Snatcher is skipped (NXD9).
//   co-op     a teammate behind a Shieldwall lands its arrows while the shield faces the target.
//   secrets   a heavy arrow stopped by a guarding Shieldwall in front of a crack never opens it (the shield breaks
//             instead); the next heavy arrow pierces the staggered Shieldwall and opens it.
//   affixes   a Shielded Shieldwall's guard blocks before the affix shield; a Swift / aura'd Chainhook throws sooner but
//             pulls at the literal pullSpeed, and a Swift / aura'd Shieldwall turns at the literal 2.5 degrees a tick.
//   pellets   the power pellet (Feast) erases a flying hook (no latch) and a pyre's fireball.
//   pacts     a frozen draft (Greed's mid-floor deal) leaves the new kinds' state alone: every timer is aiTicks / v[] /
//             cooldown, stepped only by stepActors.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, encounterCost, gridToWorld, type ActorSpawn } from "shared/dungeon";
import {
	BOW_DATA,
	BULWARK,
	BULWARK_GUARDING,
	BULWARK_STAGGER,
	BULWARK_TURN_COS,
	Boon,
	BulletKind,
	CHAINHOOK,
	CHAINHOOK_DRAG,
	CHAINHOOK_KEEP,
	CHAINHOOK_THROWN,
	EMPTY_INPUT,
	HORDE_WAVE_PENDING,
	HookEnd,
	NO_KIND,
	PELLETS_CONFIG,
	PactKind,
	ROOM_PAR_TICKS_PER_COST,
	SECRETS_CONFIG,
	SNATCHER_KIND,
	SecretHow,
	SecretStatus,
	SimCtx,
	archetypeIndex,
	chainhookHolderOf,
	createPelletsState,
	createSimState,
	fireBurstRaw,
	grantCard,
	hordePhase,
	HordePhase,
	holdAbsoluteTimers,
	packPayload,
	pelletsPower,
	playerAt,
	simWorldConfig,
	spawnActor,
	step,
	stepParty,
	weaponIndex,
	weaponsAt,
	BUILDS_CONFIG,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { ARENA, arenaConfig as secretArenaConfig } from "shared/sim/testing";
import type { EndlessRunFloor, EndlessRunSetup } from "shared/run";
import {
	altarFloor,
	arenaConfig,
	pactsSetup,
	pressPact,
	skipToFloorAny,
	teleport,
	type TuneFight,
} from "shared/run/testing";

const SEED = 77;
const BOW_SOURCE = (): number => weaponIndex("weapon.bow") + 1;
const ARROW_SPEED = 16;
const D = BULWARK.data;
const C = CHAINHOOK.data;

interface World {
	s: SimState;
	config: SimConfig;
}

/** An open endless arena (shared/run/testing arenaConfig: scoring, affixes and builds on, no grid), floor 1 hp. */
function arena(weapon: "weapon.bow" | "weapon.sword" = "weapon.bow", party = 1, half = 20): World {
	const fight: TuneFight = { label: "nx11", spawns: [], half, startX: 0, startZ: 0, boss: false, maxSeconds: 60 };
	const base = arenaConfig(SEED, weapon, fight);
	const config: SimConfig = party > 1 ? { ...base, party: { size: party } } : base;
	return { s: createSimState(SEED, 0, 0, config), config };
}

function ctxOf(w: World): SimCtx {
	return new SimCtx().bind(w.s, simWorldConfig(w.s, w.config), EMPTY_INPUT);
}

function spawn(w: World, kind: string, x: number, z: number, affix: number = AffixKind.NONE): ActorState {
	const a = spawnActor(ctxOf(w), archetypeIndex(kind), x, z, affix);
	if (a === undefined) error(`spawn ${kind}`, 0);
	a.spawnTick = -1;
	return a;
}

/** A Shieldwall at (x, z) facing (fx, fz), its bash held off. */
function shieldwall(
	w: World,
	x: number,
	z: number,
	fx: number,
	fz: number,
	affix: number = AffixKind.NONE,
): ActorState {
	const a = spawn(w, "bulwark", x, z, affix);
	a.faceX = fx;
	a.faceZ = fz;
	a.cooldown = 1e6;
	return a;
}

function dummy(w: World, x: number, z: number, hp: number): ActorState {
	const a = ctxOf(w).spawnActor("test.dummy", x, z)!;
	a.spawnTick = -1;
	a.hp = hp;
	a.hpMax = hp;
	return a;
}

function shoot(s: SimState, x: number, z: number, dx: number, dz: number, heavy = false, owner = 0): void {
	const c = s.combat;
	c.playerSpawned += fireBurstRaw(
		c.playerBullets,
		weaponsAt(s, owner).emitterId,
		x,
		z,
		dx,
		dz,
		1,
		0,
		heavy ? BOW_DATA.heavySpeed : ARROW_SPEED,
		heavy ? BOW_DATA.heavyLife : 1,
		packPayload(
			heavy ? BOW_DATA.heavyDamage : 1,
			BulletKind.PLAYER,
			BOW_SOURCE(),
			heavy ? BOW_DATA.heavyPierce : 0,
		),
	);
}

interface Seen {
	blocks: number;
	breaks: number;
	hits: number;
}

function run(w: World, ticks: number, seen: Seen = { blocks: 0, breaks: 0, hits: 0 }, input = EMPTY_INPUT): Seen {
	for (let k = 0; k < ticks; k++) {
		if (w.s.party !== undefined) stepParty(w.s, [input, EMPTY_INPUT], w.config);
		else step(w.s, input, w.config);
		seen.blocks += w.s.events.shieldBlocks;
		seen.breaks += w.s.events.guardBreaks;
		seen.hits += w.s.events.playerHits;
		for (let i = 0; i < (w.s.party?.size ?? 1); i++) playerAt(w.s, i).hearts = playerAt(w.s, i).heartsMax;
	}
	return seen;
}

function runUntil(w: World, pred: () => boolean, max: number, seen?: Seen): number {
	for (let k = 1; k <= max; k++) {
		run(w, 1, seen);
		if (pred()) return k;
	}
	error("until: never", 0);
}

// ---------------------------------------------------------------------------------------------

describe("NX11 builds and the Shieldwall's shield", () => {
	it("Chain Spark and Overkill strike a guarding Shieldwall through its front (damageActor knows no origin)", () => {
		for (const boon of [Boon.CHAIN_SPARK, Boon.OVERKILL]) {
			const w = arena();
			grantCard(w.s, 0, boon);
			const a = shieldwall(w, 0, 5, 0, -1);
			dummy(w, 0, 2.5, 1);
			shoot(w.s, 0, 0.5, 0, 1);
			const seen = run(w, 20);
			expect([boon, seen.blocks, a.v[BULWARK_GUARDING], a.hp < D.hp]).toEqual([boon, 0, 1, true]);
		}
	});

	it("Soul Shards: a shard from a corpse in front stops on the shield; one from a corpse behind it lands (NXD21)", () => {
		const front = arena();
		grantCard(front.s, 0, Boon.SOUL_SHARDS);
		const a = shieldwall(front, 0, 5, 0, -1);
		dummy(front, 0, 2.5, 1);
		shoot(front.s, 0, 0.5, 0, 1);
		const f = run(front, 40);
		expect([f.blocks >= 1, a.hp]).toEqual([true, D.hp]);

		const back = arena();
		grantCard(back.s, 0, Boon.SOUL_SHARDS);
		const b = shieldwall(back, 0, 5, 0, -1);
		// The corpse stands behind its front cone, off the shield's cover; the arrow passes wide of it.
		dummy(back, 3, 7, 1);
		shoot(back.s, 3, 0.5, 0, 1);
		const k = run(back, 40);
		expect([k.blocks, b.hp < D.hp]).toEqual([0, true]);
	});

	it("Executioner never executes through the shield: a front arrow at 1 hp is blocked, a back arrow executes", () => {
		for (const fromBack of [false, true]) {
			const w = arena();
			for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.SHARPENED);
			const a = shieldwall(w, 0, 5, 0, -1);
			a.hp = 1.5; // 15 % of 10: inside Executioner's 20 %
			if (fromBack) shoot(w.s, 0, 9, 0, -1);
			else shoot(w.s, 0, 0.5, 0, 1);
			const seen = run(w, 20);
			expect([fromBack, seen.blocks, a.alive]).toEqual([fromBack, fromBack ? 0 : 1, fromBack ? 0 : 1]);
		}
	});

	it("Siege Bolt pins a Shieldwall from behind; a pinned Shieldwall guards nothing (its front takes arrows)", () => {
		const pinned = (ballista: boolean): { seen: Seen; a: ActorState; pins: number } => {
			const w = arena();
			if (ballista) for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.BALLISTA);
			const a = shieldwall(w, 0, 10, 0, -1);
			a.hp = 100;
			a.hpMax = 100;
			shoot(w.s, 0, 13, 0, -1, true); // from behind
			const seen = run(w, 2);
			let pins = 0;
			for (let k = 0; k < 18; k++) {
				// a stream arrow at its front every 3 ticks while it is carried
				if (k % 3 === 0) shoot(w.s, 0, a.z - 4, 0, 1);
				run(w, 1, seen);
				if (w.s.builds!.pins.size() > 0) pins++;
			}
			return { seen, a, pins };
		};
		const plain = pinned(false);
		expect([plain.pins, plain.seen.blocks > 0]).toEqual([0, true]);
		const siege = pinned(true);
		expect(siege.pins > 0).toBe(true);
		expect(siege.seen.blocks).toBe(0);
		expect(siege.a.hp < plain.a.hp).toBe(true);
	});

	it("Siege Bolt's pinning hit on a dragging Chainhook frees the player (>= breakDamage), who is never pulled again", () => {
		const w = arena();
		for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.BALLISTA);
		const a = spawn(w, "chainhook", 0, 6);
		a.cooldown = 0;
		runUntil(w, () => a.aiState === CHAINHOOK_DRAG, 120);
		const s = w.s;
		shoot(s, -6, a.z, 1, 0, true);
		let ended = -1;
		for (let k = 0; k < 20 && ended < 0; k++) {
			run(w, 1);
			const e = s.combat.hookEvents;
			if (e.endReason.size() > 0) ended = e.endReason[0];
		}
		expect(ended).toBe(HookEnd.DAMAGE);
		expect(chainhookHolderOf(s, 0)).toBe(-1);
		const z0 = s.player.z;
		run(w, 20);
		expect(s.player.z).toBe(z0);
	});

	it("a Shielded Chainhook: damage its affix shield absorbs does not count toward breakDamage (as built, NX11 OC)", () => {
		const w = arena();
		const a = spawn(w, "chainhook", 0, 6, AffixKind.SHIELDED);
		a.cooldown = 0;
		const slot = w.s.combat.actors.indexOf(a);
		const shield = w.s.affixes!.slots[slot].shield;
		expect(shield > C.breakDamage).toBe(true);
		runUntil(w, () => a.aiState === CHAINHOOK_DRAG, 120);
		const ctx = ctxOf(w);
		ctx.damageActor(a, C.breakDamage); // all of it into the affix shield
		expect([a.aiState, chainhookHolderOf(w.s, 0) >= 0]).toEqual([CHAINHOOK_DRAG, true]);
		const rest = shield - C.breakDamage; // what is left of the affix shield
		ctx.damageActor(a, rest + C.breakDamage); // the rest of the shield, then breakDamage on hp: freed
		expect(chainhookHolderOf(w.s, 0)).toBe(-1);
	});
});

describe("NX11 treasure locks: UNTOUCHED counts hits", () => {
	it("a latch and a drag land no hit (score.hitsTaken unchanged); the yank fan's hit counts", () => {
		const w = arena();
		const a = spawn(w, "chainhook", 0, 5);
		a.cooldown = 0;
		const seen: Seen = { blocks: 0, breaks: 0, hits: 0 };
		runUntil(w, () => a.aiState === CHAINHOOK_DRAG, 120, seen);
		runUntil(w, () => a.aiState !== CHAINHOOK_DRAG, 60, seen);
		expect([seen.hits, w.s.score!.hitsTaken]).toEqual([0, 0]);
		run(w, C.yankTelegraphTicks + 30, seen);
		expect(seen.hits >= 1).toBe(true);
		expect(w.s.score!.hitsTaken).toBe(seen.hits);
	});
});

describe("NX11 co-op and the Shieldwall", () => {
	it("a teammate behind it lands arrows while the shield faces its target; the target's arrows are blocked", () => {
		const w = arena("weapon.bow", 2);
		const p1 = playerAt(w.s, 1);
		p1.x = 0;
		p1.z = 9;
		p1.prevX = 0;
		p1.prevZ = 9;
		const a = shieldwall(w, 0, 4, 0, -1);
		shoot(w.s, 0, 0.5, 0, 1, false, 0);
		const hp = a.hpMax; // party-scaled
		const front = run(w, 15);
		expect([front.blocks, a.hp]).toEqual([1, hp]);
		shoot(w.s, 0, 8.5, 0, -1, false, 1);
		const back = run(w, 30);
		expect([back.blocks, a.hp]).toEqual([0, hp - 1]);
	});
});

describe("NX11 affixes and the aura on the new kinds", () => {
	it("a Shielded Shieldwall: the guard blocks before the affix shield; from behind the affix shield absorbs first", () => {
		const w = arena();
		const a = shieldwall(w, 0, 5, 0, -1, AffixKind.SHIELDED);
		const slot = w.s.combat.actors.indexOf(a);
		const x = w.s.affixes!.slots[slot];
		const shield0 = x.shield;
		expect(shield0 > 0).toBe(true);
		shoot(w.s, 0, 0.5, 0, 1);
		const f = run(w, 15);
		expect([f.blocks, x.shield, a.hp]).toEqual([1, shield0, D.hp]);
		shoot(w.s, 0, 9, 0, -1);
		run(w, 30);
		expect([x.shield, a.hp]).toEqual([shield0 - 1, D.hp]);
	});

	it("Swift and the Warbanner's aura: a Chainhook throws sooner but pulls at the literal pullSpeed", () => {
		const pull = (affix: number, banner: boolean): { cooldown: number; step: number } => {
			const w = arena();
			const a = spawn(w, "chainhook", 0, 7, affix);
			if (banner) spawn(w, "warbanner", 2, 7);
			const cd = a.cooldown;
			a.cooldown = 0;
			runUntil(w, () => a.aiState === CHAINHOOK_DRAG, 120);
			const z0 = w.s.player.z;
			run(w, 1);
			return { cooldown: cd, step: w.s.player.z - z0 };
		};
		const plain = pull(AffixKind.NONE, false);
		const swift = pull(AffixKind.SWIFT, false);
		const aura = pull(AffixKind.NONE, true);
		expect(swift.cooldown < plain.cooldown).toBe(true);
		expect(plain.step).toBeCloseTo((C.pullSpeed * 1) / 60, 9);
		expect([swift.step, aura.step]).toEqual([plain.step, plain.step]);
	});

	it("Swift and the Warbanner's aura: a Shieldwall turns at the literal 2.5 degrees a tick (NXD20)", () => {
		for (const [affix, banner] of [
			[AffixKind.SWIFT, false],
			[AffixKind.NONE, true],
		] as const) {
			const w = arena();
			const a = shieldwall(w, 0, 4, 0, 1, affix); // its back to the player at the origin
			if (banner) spawn(w, "warbanner", 2, 4);
			run(w, 2); // engage
			const fx = a.faceX;
			const fz = a.faceZ;
			run(w, 1);
			// one turn step: the cosine between consecutive facings is the literal's (2.5 degrees)
			expect(fx * a.faceX + fz * a.faceZ).toBeCloseTo(BULWARK_TURN_COS, 9);
		}
	});
});

describe("NX11 the power pellet (Feast) and the new bullets", () => {
	it("erases a flying hook (the Chainhook latches nothing) and a pyre's fireball", () => {
		const w = arena();
		w.s.pellets = createPelletsState(PELLETS_CONFIG); // test surgery: the power pellet's erase reads no floor
		const a = spawn(w, "chainhook", 0, 6);
		a.cooldown = 0;
		runUntil(w, () => a.aiState === CHAINHOOK_THROWN, 120);
		expect(w.s.combat.enemyBullets.activeCountFor(a.emitterId)).toBe(1);
		expect(pelletsPower(w.s, 0)).toBe(1);
		run(w, 2);
		expect([a.aiState, w.s.events.hookLatched, chainhookHolderOf(w.s, 0)]).toEqual([CHAINHOOK_KEEP, 0, -1]);

		const p = spawn(w, "pyre", 4, 4);
		a.cooldown = 1e6;
		runUntil(w, () => w.s.combat.enemyBullets.activeCountFor(p.emitterId) > 0, 200);
		expect(pelletsPower(w.s, 0) >= 1).toBe(true);
		expect(w.s.combat.enemyBullets.activeCountFor(p.emitterId)).toBe(0);
	});
});

describe("NX11 pacts' freeze (holdAbsoluteTimers)", () => {
	it("a frozen draft tick moves nothing of the new kinds: their timers are aiTicks / v[] / cooldown", () => {
		const w = arena();
		const kinds = ["bulwark", "chainhook", "snatcher", "pyrekeeper", "pyre"];
		const actors = kinds.map((k, i) => spawn(w, k, -6 + 3 * i, 5));
		run(w, 90);
		const snap = actors.map((a) => [a.aiState, a.aiTicks, a.cooldown, ...a.v].join(","));
		w.s.pacts = { horde: { room: -1 } } as never; // holdAbsoluteTimers' guard; nothing of it applies here
		holdAbsoluteTimers(w.s);
		expect(actors.map((a) => [a.aiState, a.aiTicks, a.cooldown, ...a.v].join(","))).toEqual(snap);
	});
});

// ---------------------------------------------------------------------------------------------
// Secret rooms: shared/sim/testing secretArena.ts (the crack at (18, 7) / (19, 7) facing +z)

describe("NX11 secret rooms and the Shieldwall", () => {
	const CX = gridToWorld(ARENA.crackX) + 0.5;
	const CZ = gridToWorld(ARENA.wallZ);

	it("a heavy arrow stopped by a guarding Shieldwall in front of the crack never opens it; the next one does", () => {
		const config = secretArenaConfig(SEED, {
			loadout: ["weapon.bow"],
			extraConfig: { secrets: SECRETS_CONFIG, scoring: {}, builds: BUILDS_CONFIG },
		});
		const s = createSimState(SEED, ARENA.spawnX, ARENA.spawnZ, config);
		s.player.x = 30;
		s.player.z = 25;
		s.player.hurtTicks = 1e6;
		const w: World = { s, config };
		const a = shieldwall(w, CX - 0.5, CZ + 2.2, 0, 1);
		shoot(s, CX - 0.5, CZ + 5, 0, -1, true);
		const first = run(w, 30);
		expect([first.breaks, s.secrets!.status, a.aiState]).toEqual([1, SecretStatus.HIDDEN, BULWARK_STAGGER]);
		shoot(s, CX - 0.5, CZ + 5, 0, -1, true);
		run(w, 30);
		expect([s.secrets!.status, s.secrets!.openHow]).toEqual([SecretStatus.OPEN, SecretHow.HEAVY]);
		expect(a.hp < D.hp).toBe(true);
	});
});

// ---------------------------------------------------------------------------------------------
// Horde (docs/FORTUNE.md, NXD9): snatcher.spec's harness

function withSpawns(
	base: EndlessRunSetup,
	floor: number,
	room: number,
	spawns: ReadonlyArray<ActorSpawn>,
): { setup: EndlessRunSetup; world: EndlessRunFloor } {
	const w = base.endlessFloor(floor);
	const roomSpawns = w.roomSpawns.map((l, id) => (id === room ? spawns : l));
	const roomAffixes = w.roomAffixes?.map((l, id) => (id === room ? spawns.map(() => AffixKind.NONE) : l));
	const world: EndlessRunFloor = { ...w, roomSpawns, roomAffixes };
	const endlessFloor = (f: number) => (f === floor ? world : base.endlessFloor(f));
	const setup: EndlessRunSetup = {
		...base,
		config: { ...base.config, endless: { ...base.config.endless!, worldForFloor: endlessFloor } },
		endlessFloor,
	};
	return { setup, world };
}

describe("NX11 Horde's second wave", () => {
	it("copies a Pyre-keeper, a Chainhook and a Shieldwall; only the Snatcher is skipped", () => {
		const kinds = ["pyrekeeper", SNATCHER_KIND, "chainhook", "swarmer", "bulwark"];
		const base = pactsSetup(1337);
		const floor = altarFloor(base);
		const w0 = base.endlessFloor(floor);
		let room = -1;
		for (let id = 0; id < w0.roomSpawns.size() && room < 0; id++) {
			if (w0.roomSpawns[id].size() === 0 || (w0.roomSpawnTiles?.[id].size() ?? 0) < 12) continue;
			room = id;
		}
		expect(room >= 0).toBe(true);
		const tiles = w0.roomSpawnTiles![room];
		const { setup, world } = withSpawns(
			base,
			floor,
			room,
			kinds.map((kind, k) => ({ kind, x: tiles[k].x, z: tiles[k].z })),
		);
		const s = createSimState(1337, setup.spawn!.x, setup.spawn!.z, setup.config);
		skipToFloorAny(s, setup.config, floor);
		pressPact(setup, s, PactKind.HORDE);
		const r = world.config.encounter!.rooms[room];
		teleport(s, 0, r.cx, r.cz);
		step(s, EMPTY_INPUT, setup.config);
		teleport(s, 0, world.spawnX, world.spawnZ);
		expect(hordePhase(s)).toBe(HordePhase.FIGHT);
		const p = s.pacts!;
		const rec = s.score!.rooms[p.horde.record];
		const ctx = new SimCtx().bind(s, world.config, EMPTY_INPUT);
		for (let m = 0; m < rec.memberSlots.size(); m++) {
			const a = s.combat.actors[rec.memberSlots[m]];
			if (a !== undefined && a.kind !== NO_KIND && a.id === rec.memberIds[m] && a.alive !== 0) ctx.killActor(a);
		}
		step(s, EMPTY_INPUT, setup.config);
		expect(p.horde.spawned).toBe(HORDE_WAVE_PENDING);
		const wave = ["pyrekeeper", "chainhook", "swarmer", "bulwark"];
		expect([...p.horde.waveKinds]).toEqual(wave.map((k) => archetypeIndex(k)));
		const par0 = rec.parTicks;
		for (let t = 0; t < 200 && p.horde.spawned === HORDE_WAVE_PENDING; t++) step(s, EMPTY_INPUT, setup.config);
		expect(p.horde.spawned).toBe(wave.size());
		let cost = 0;
		for (const k of wave) cost += encounterCost(k);
		expect(rec.parTicks).toBe(par0 + p.config.waveTelegraphTicks + ROOM_PAR_TICKS_PER_COST * cost);
		const members: number[] = [];
		for (let m = kinds.size(); m < rec.memberSlots.size(); m++)
			members.push(s.combat.actors[rec.memberSlots[m]].kind);
		expect(members).toEqual(wave.map((k) => archetypeIndex(k)));
	});
});

export {};
