// docs/NEW_ENEMIES_3.md NT11: the Mortar, the Mender and the Jackal against the game's other systems, one case per
// interaction that has a rule (the notes for the ones that have none are in the doc's "NT11 systems pass (as built)").
//   builds    Siege Bolt pins a channelling Mender (the pinning hit cuts the beam, DAMAGE; no heal while it is carried)
//             and a winding-up Jackal (it keeps its target's token while carried: no packmate winds up at that player);
//             a pinned Mortar's flight waits while it is carried (the shell lands that many ticks later, the ring holds);
//             a guard that only stops a Jackal's lunge erases nothing, so Riposte sends no wave (NTD9); a counter-wave
//             strikes each Jackal of a pack once; an Overkill streak into a channelling Mender cuts the beam.
//   score     a shell on a standing target is ONE hit (score.hitsTaken + 1: strike and shrapnel together), what
//             treasure's UNTOUCHED lock counts; a guard-stopped lunge is none; a posthumous shell landing after its room
//             cleared leaves the clear and its PERFECT standing (it only adds to hitsTaken).
//   shield    a guarding Shieldwall covers a Mender behind it: its blocked hit cuts nothing; the beam passes through
//             the Shieldwall's body (actors never cut sight); a hit from behind cuts it.
//   chainhook the Mortar's lead reads a hooked player's drag (prevX: the Chainhook in a lower slot steps first), so the
//             ring leads along the pull, clamped to maxLead.
//   aura      the Warbanner's aura is on all three (cooldowns x 80 %, walks x 125 %); the literal timers are not: the
//             flight 60, the wind-up 21, the link 24 and the 30-tick pulses.
//   co-op     one pack on two players: at most one Jackal attacks each target, both are lunged at; the Mortar holds
//             fire while its NEAREST player stands outside its room, a teammate inside included (NTD3 per target).
//   affixes   a Vengeful Mortar killed mid-flight: the corpse fires the Vengeful ring and still lands its shell on the
//             planned tick; a Shielded Mender's beam is cut by a hit its affix shield absorbs whole; a Swift Jackal
//             circles faster but lunges the literal distance a tick.
//   pellets   the power pellet erases the shrapnel and the Mender's bolt but never a shell (a strike).
//   pacts     a frozen draft tick leaves the three's state alone (aiTicks / v[] / cooldown only).
//   horde     wave 2 copies a Mender and the Jackals; a pack at the hordeMaxWave cut is copied in part (each priced 1).
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, encounterCost, type ActorSpawn } from "shared/dungeon";
import {
	AiState,
	BOW_DATA,
	BUILDS_CONFIG,
	Boon,
	BulletKind,
	BulletPayload,
	Button,
	COUNTERSTRIKE_RING_HALF_ANGLE_COS,
	EMPTY_INPUT,
	HORDE_WAVE_PENDING,
	HealEnd,
	JACKAL,
	JACKAL_ATTACK_LUNGE,
	JACKAL_LUNGE,
	JACKAL_STAGGER,
	JACKAL_TARGET,
	MENDER,
	MENDER_ALLY,
	MENDER_CHANNEL,
	MORTAR,
	MORTAR_ATTACK_LOB,
	MORTAR_FLIGHT,
	MORTAR_FLIGHT_TICKS,
	MORTAR_LAND_X,
	MORTAR_LAND_Z,
	NO_KIND,
	PELLETS_CONFIG,
	PactKind,
	ROOM_PAR_TICKS_PER_COST,
	ScoreSource,
	SimCtx,
	WaveKind,
	actorCooldownPercent,
	actorWalkPercent,
	archetypeIndex,
	chainhookHolderOf,
	createPelletsState,
	createSimState,
	engage,
	fireBurstRaw,
	grantCard,
	hordePhase,
	HordePhase,
	holdAbsoluteTimers,
	jackalHoldsToken,
	packPayload,
	pelletsPower,
	playerAt,
	simWorldConfig,
	spawnActor,
	spawnWave,
	step,
	stepParty,
	weaponIndex,
	weaponsAt,
	type ActorState,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import type { EndlessRunFloor, EndlessRunSetup } from "shared/run";
import {
	altarFloor,
	arenaConfig,
	frame,
	pactsSetup,
	pressPact,
	skipToFloorAny,
	teleport,
	type TuneFight,
} from "shared/run/testing";

const SEED = 77;
const BOW_SOURCE = (): number => weaponIndex("weapon.bow") + 1;
const ARROW_SPEED = 16;
const MO = MORTAR.data;
const ME = MENDER.data;
const JA = JACKAL.data;
const MORTAR_KIND = archetypeIndex(MORTAR.id);
const JACKAL_KIND = archetypeIndex(JACKAL.id);

interface World {
	s: SimState;
	config: SimConfig;
}

/** An open endless arena (shared/run/testing arenaConfig: scoring, affixes and builds on, no grid), floor 1 hp. */
function arena(weapon: "weapon.bow" | "weapon.sword" = "weapon.bow", party = 1, half = 20): World {
	const fight: TuneFight = { label: "nt11", spawns: [], half, startX: 0, startZ: 0, boss: false, maxSeconds: 60 };
	const base = arenaConfig(SEED, weapon, fight);
	const config: SimConfig = party > 1 ? { ...base, party: { size: party } } : base;
	return { s: createSimState(SEED, 0, 0, config), config };
}

function ctxOf(w: World): SimCtx {
	return new SimCtx().bind(w.s, simWorldConfig(w.s, w.config), EMPTY_INPUT);
}

/** An engaged actor of `kind` at (x, z), hp / hpMax set when given. */
function spawn(w: World, kind: string, x: number, z: number, affix: number = AffixKind.NONE, hp?: number): ActorState {
	const a = spawnActor(ctxOf(w), archetypeIndex(kind), x, z, affix);
	if (a === undefined) error(`spawn ${kind}`, 0);
	a.spawnTick = -1;
	engage(a);
	if (hp !== undefined) {
		a.hp = hp;
		a.hpMax = hp;
	}
	return a;
}

function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
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

/** What a run of ticks saw (per tick feeds summed). */
interface Seen {
	hits: number;
	shells: number;
	heals: number;
	ends: number[];
	lunges: number;
	spooks: number;
}

function seen0(): Seen {
	return { hits: 0, shells: 0, heals: 0, ends: [], lunges: 0, spooks: 0 };
}

/** `ticks` ticks of `input` (player 0; teammates idle); hearts refilled after each (the run never ends). */
function run(w: World, ticks: number, seen: Seen = seen0(), input: InputFrame = EMPTY_INPUT): Seen {
	for (let k = 0; k < ticks; k++) {
		const n = w.s.party?.size ?? 1;
		if (n > 1) {
			const all: InputFrame[] = [input];
			for (let i = 1; i < n; i++) all.push(EMPTY_INPUT);
			stepParty(w.s, all, w.config);
		} else step(w.s, input, w.config);
		const e = w.s.events;
		seen.hits += e.playerHits;
		seen.shells += e.shells;
		seen.heals += e.heals;
		seen.lunges += e.lunges;
		seen.spooks += e.spooks;
		for (const r of w.s.combat.healEvents.endReason) seen.ends.push(r);
		for (let i = 0; i < n; i++) {
			const p = playerAt(w.s, i);
			p.hearts = p.heartsMax;
		}
	}
	return seen;
}

function runUntil(w: World, pred: () => boolean, max: number, seen?: Seen, input: InputFrame = EMPTY_INPUT): number {
	for (let k = 1; k <= max; k++) {
		run(w, 1, seen, input);
		if (pred()) return k;
	}
	error("until: never", 0);
}

/** A Mender with its cooldown out and a wounded Mortar ally beside it that never lobs (a heal target, NTD8). */
function menderPair(w: World, mx: number, mz: number, ax: number, az: number): { m: ActorState; ally: ActorState } {
	const m = spawn(w, "mender", mx, mz, AffixKind.NONE, 100);
	m.cooldown = 0;
	const ally = spawn(w, "mortar", ax, az, AffixKind.NONE, 200);
	ally.hp = 100;
	ally.cooldown = 1e6;
	return { m, ally };
}

const channelling = (m: Readonly<ActorState>): boolean => m.alive !== 0 && m.aiState === MENDER_CHANNEL;
const lobDrawing = (a: Readonly<ActorState>): boolean =>
	a.alive !== 0 && a.aiState === AiState.TELEGRAPH && a.attack === MORTAR_ATTACK_LOB;

// ---------------------------------------------------------------------------------------------

describe("NT11 builds", () => {
	it("Siege Bolt pins a channelling Mender: the pinning hit cuts the beam (DAMAGE), no heal while it is carried", () => {
		const w = arena();
		for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.BALLISTA);
		const { m } = menderPair(w, 0, 8, 2.5, 8);
		const seen = seen0();
		runUntil(w, () => channelling(m), 240, seen);
		expect(seen.ends).toEqual([]);
		// A heavy arrow across the Mender (from its left, clear of the ally on its right).
		shoot(w.s, m.x - 2, m.z, 1, 0, true);
		let pinned = 0;
		let healsWhilePinned = 0;
		for (let k = 0; k < 40; k++) {
			const s = run(w, 1);
			for (const r of s.ends) seen.ends.push(r);
			if (w.s.builds!.pins.some((p) => p.slot >= 0 && p.id === m.id)) {
				pinned++;
				healsWhilePinned += s.heals;
				expect(m.aiState).never.toBe(MENDER_CHANNEL);
			}
		}
		expect(pinned > 0).toBe(true);
		expect(seen.ends[0]).toBe(HealEnd.DAMAGE);
		expect(healsWhilePinned).toBe(0);
	});

	it("Siege Bolt pins a winding-up Jackal: it keeps its target's token while carried (no packmate winds up)", () => {
		const w = arena();
		for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.BALLISTA);
		// The player faces +Z; both Jackals stand behind it (outside the front cone, never spooked).
		const me = playerAt(w.s, 0);
		me.faceX = 0;
		me.faceZ = 1;
		const held = spawn(w, "jackal", 0, -3.2, AffixKind.NONE, 100);
		const mate = spawn(w, "jackal", 2.4, -2.2, AffixKind.NONE, 100);
		held.cooldown = 0;
		mate.cooldown = 1e6;
		runUntil(w, () => jackalHoldsToken(held), 120);
		mate.cooldown = 0; // free to wind up from here on, if the token were free
		shoot(w.s, held.x - 1.2, held.z, 1, 0, true);
		let carried = 0;
		for (let k = 0; k < 40; k++) {
			run(w, 1);
			me.faceX = 0;
			me.faceZ = 1;
			const isHeld = w.s.builds!.pins.some((p) => p.slot >= 0 && p.id === held.id);
			if (!isHeld) continue;
			carried++;
			expect(jackalHoldsToken(held)).toBe(true);
			expect(jackalHoldsToken(mate)).toBe(false);
		}
		expect(carried > 0).toBe(true);
	});

	it("Siege Bolt pins a Mortar mid-flight: its flight waits while it is carried, the shell lands that much later", () => {
		const w = arena();
		for (let k = 0; k < 3; k++) grantCard(w.s, 0, Boon.BALLISTA);
		const a = spawn(w, "mortar", 0, 8, AffixKind.NONE, 100);
		a.cooldown = 0;
		runUntil(w, () => a.aiState === MORTAR_FLIGHT, 300);
		const t0 = w.s.tick;
		const left = a.v[MORTAR_FLIGHT_TICKS];
		shoot(w.s, a.x - 1.2, a.z, 1, 0, true);
		let carried = 0;
		let landed = -1;
		for (let k = 0; k < 240 && landed < 0; k++) {
			const seen = run(w, 1);
			if (w.s.builds!.pins.some((p) => p.slot >= 0 && p.id === a.id)) carried++;
			if (seen.shells > 0) landed = w.s.tick;
		}
		expect(carried > 0).toBe(true);
		expect(landed - t0).toBe(left + carried);
	});

	it("Riposte: a guard that only stops a lunge erases nothing, so no counter-wave (NTD9); the Jackal staggers", () => {
		const w = arena("weapon.sword");
		grantCard(w.s, 0, Boon.RIPOSTE);
		const a = spawn(w, "jackal", 0, -3.3, AffixKind.NONE, 100);
		a.cooldown = 0;
		// The player faces +X (across the Jackal: outside the front cone, inside the guard's sweep).
		const across = frame(0, 0, 0, 1, 0);
		const guard = frame(0, 0, Button.ALT, 1, 0);
		runUntil(w, () => a.aiState === JACKAL_LUNGE, 240, undefined, across);
		run(w, 1, undefined, guard);
		let staggered = false;
		for (let k = 0; k < 40; k++) {
			run(w, 1, undefined, across);
			if (a.aiState === JACKAL_STAGGER) staggered = true;
			expect(w.s.builds!.waves.size()).toBe(0);
		}
		expect(staggered).toBe(true);
		expect(w.s.builds!.players[0].riposteCount).toBe(0);
		expect(w.s.score!.hitsTaken).toBe(0);
	});

	it("a counter-wave (a Counterstrike ring) strikes each Jackal of a pack once", () => {
		const w = arena("weapon.sword");
		grantCard(w.s, 0, Boon.RIPOSTE);
		const pack = [spawn(w, "jackal", 2, 0), spawn(w, "jackal", -1, 1.8), spawn(w, "jackal", -1, -1.8)];
		for (const a of pack) {
			a.hp = 100;
			a.hpMax = 100;
			a.cooldown = 1e6;
		}
		expect(spawnWave(w.s.builds!, 0, 0, 0, 0, 1, COUNTERSTRIKE_RING_HALF_ANGLE_COS, 3, WaveKind.RING, 3)).toBe(
			true,
		);
		const ids: number[] = [];
		for (let k = 0; k < 90 && w.s.builds!.waves.size() > 0; k++) {
			run(w, 1);
			for (const wave of w.s.builds!.waves) for (const id of wave.hits) if (!ids.includes(id)) ids.push(id);
		}
		expect(w.s.builds!.waves.size()).toBe(0);
		for (const a of pack) expect([a.id, ids.includes(a.id)]).toEqual([a.id, true]);
		const lost = pack.map((a) => 100 - a.hp);
		expect(lost[0] > 0).toBe(true);
		expect(lost).toEqual([lost[0], lost[0], lost[0]]);
	});

	it("Overkill: a kill's carry streaks into a channelling Mender and cuts the beam (DAMAGE)", () => {
		const w = arena();
		grantCard(w.s, 0, Boon.OVERKILL);
		const { m } = menderPair(w, 0, 8, 2.5, 8.5);
		const seen = seen0();
		runUntil(w, () => channelling(m), 240, seen);
		// A 1 hp swarmer beside the Mender (nearer it than the ally), shot dead: the carry streaks to the Mender.
		const victim = spawn(w, "swarmer", m.x - 1.2, m.z);
		victim.cooldown = 1e6;
		const hp0 = m.hp;
		shoot(w.s, victim.x, victim.z - 3, 0, 1);
		runUntil(w, () => seen.ends.size() > 0, 30, seen);
		expect(victim.alive).toBe(0);
		expect(seen.ends[0]).toBe(HealEnd.DAMAGE);
		expect(m.hp < hp0).toBe(true);
	});
});

describe("NT11 score: what UNTOUCHED counts", () => {
	it("a shell on a standing target is one hit (strike and shrapnel together); hitsTaken counts it", () => {
		const w = arena();
		const a = spawn(w, "mortar", 0, 8);
		a.cooldown = 0;
		const seen = seen0();
		run(w, 1200, seen);
		expect(seen.shells >= 3).toBe(true);
		// Every shell lands on the player's feet (a standing target: no lead); each is exactly one hit.
		expect(seen.hits).toBe(seen.shells);
		expect(w.s.score!.hitsTaken).toBe(seen.shells);
	});

	it("a lunge from behind is one hit; a guard-stopped lunge is none", () => {
		for (const guarded of [false, true]) {
			const w = arena("weapon.sword");
			const a = spawn(w, "jackal", 0, -3.3);
			a.cooldown = 0;
			const across = frame(0, 0, 0, 1, 0);
			runUntil(w, () => a.aiState === JACKAL_LUNGE, 240, undefined, across);
			if (guarded) run(w, 1, undefined, frame(0, 0, Button.ALT, 1, 0));
			runUntil(w, () => a.aiState !== JACKAL_LUNGE, 30, undefined, across);
			expect([guarded, w.s.score!.hitsTaken]).toEqual([guarded, guarded ? 0 : 1]);
		}
	});

	it("a posthumous shell after its room cleared: the clear and its PERFECT stand; it only adds to hitsTaken", () => {
		const room = { id: 0, type: "combat", depth: 1, cx: 0, cz: 4, minX: -8, maxX: 8, minZ: -4, maxZ: 12 };
		const config: SimConfig = {
			bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
			scoring: {},
			encounter: {
				spawns: [{ kind: MORTAR.id, x: 0, z: 8 }],
				rooms: [{ ...room, floorTiles: 16 * 16 } as never],
				entranceRoom: -1,
				bossRoom: -1,
			},
		};
		const s = createSimState(SEED, 0, 0, config);
		const w: World = { s, config };
		const a = s.combat.actors.find((o) => o.kind === MORTAR_KIND)!;
		engage(a);
		a.cooldown = 0;
		runUntil(w, () => a.aiState === MORTAR_FLIGHT, 300);
		const left = a.v[MORTAR_FLIGHT_TICKS];
		ctxOf(w).killActor(a);
		const seen = seen0();
		run(w, 1, seen);
		const rec = s.score!.rooms[0];
		expect([rec.cleared, s.score!.counts[ScoreSource.PERFECT], s.score!.hitsTaken]).toEqual([1, 1, 0]);
		const perfect = s.score!.points[ScoreSource.PERFECT];
		run(w, left + 5, seen);
		expect([seen.shells, s.score!.hitsTaken]).toEqual([1, 1]);
		expect([rec.cleared, s.score!.counts[ScoreSource.PERFECT], s.score!.points[ScoreSource.PERFECT]]).toEqual([
			1,
			1,
			perfect,
		]);
	});
});

describe("NT11 the Shieldwall and the Mender", () => {
	it("covers a Mender behind it: the blocked hit cuts nothing, the beam crosses the Shieldwall; a back hit cuts", () => {
		const w = arena();
		const { m, ally } = menderPair(w, 0, 8, 3, 8);
		const sw = spawn(w, "bulwark", 1.5, 8);
		sw.cooldown = 1e6;
		const seen = seen0();
		runUntil(w, () => channelling(m), 240, seen);
		// Surgery: the Mender, the Shieldwall and the ally on one line along X (the beam through the Shieldwall's body),
		// the Shieldwall facing the player at the origin; then an arrow from the player at the Mender, through the shield.
		const place = (o: ActorState, x: number, z: number) => {
			o.x = x;
			o.z = z;
			o.prevX = x;
			o.prevZ = z;
		};
		place(m, 0, 8);
		place(ally, 3, 8);
		place(sw, 0, 5.5);
		sw.faceX = 0;
		sw.faceZ = -1;
		shoot(w.s, 0, 0.5, 0, 1);
		let blocks = 0;
		for (let k = 0; k < 20; k++) {
			run(w, 1, seen);
			blocks += w.s.events.shieldBlocks;
		}
		expect(blocks >= 1).toBe(true);
		expect(seen.ends).toEqual([]);
		expect(m.v[MENDER_ALLY]).toBe(ally.id);
		expect(m.hp).toBe(100);
		// From behind the Mender: a hit, the beam cut.
		shoot(w.s, m.x, m.z + 4, 0, -1);
		runUntil(w, () => seen.ends.size() > 0, 30, seen);
		expect(seen.ends[0]).toBe(HealEnd.DAMAGE);
	});
});

describe("NT11 the Chainhook's drag and the Mortar's lead", () => {
	it("the lead reads a hooked player's drag (prevX): the ring leads along the pull, clamped to maxLead", () => {
		const w = arena();
		const hook = spawn(w, "chainhook", 0, 7);
		hook.cooldown = 0;
		const mortar = spawn(w, "mortar", 6, 6);
		mortar.cooldown = 1e6;
		runUntil(w, () => chainhookHolderOf(w.s, 0) >= 0 && w.s.player.z > w.s.player.prevZ, 240);
		// Surgery: the Mortar on its draw's last tick (it releases on the next).
		mortar.aiState = AiState.TELEGRAPH;
		mortar.attack = MORTAR_ATTACK_LOB;
		mortar.aiTicks = 1;
		run(w, 1);
		expect(mortar.aiState).toBe(MORTAR_FLIGHT);
		const p = w.s.player;
		const dragX = p.x - p.prevX;
		const dragZ = p.z - p.prevZ;
		const drag = math.sqrt(dragX * dragX + dragZ * dragZ);
		expect(chainhookHolderOf(w.s, 0) >= 0).toBe(true);
		expect(drag * MO.leadTicks > MO.maxLead).toBe(true);
		const lx = mortar.v[MORTAR_LAND_X] - p.x;
		const lz = mortar.v[MORTAR_LAND_Z] - p.z;
		expect(math.sqrt(lx * lx + lz * lz)).toBeCloseTo(MO.maxLead, 9);
		// Along the pull (toward the Chainhook).
		expect((lx * dragX + lz * dragZ) / (MO.maxLead * drag)).toBeCloseTo(1, 9);
	});
});

describe("NT11 the Warbanner's aura", () => {
	it("is on all three (cooldowns 80 %, walks 125 %); the literal timers stay: flight 60, wind-up 21, link 24, pulse 30", () => {
		const w = arena();
		const me = playerAt(w.s, 0);
		me.faceX = 0;
		me.faceZ = 1;
		const mortar = spawn(w, "mortar", -3, 7);
		const { m: mender } = menderPair(w, 0, 7, 1, 8);
		const jackal = spawn(w, "jackal", 0, -3.2);
		// Two banners: one by the Mortar and the Mender, one by the Jackal behind the player (an actor takes one aura).
		spawn(w, "warbanner", 0, 6);
		spawn(w, "warbanner", 0, -5);
		mortar.cooldown = 0;
		jackal.cooldown = 0;
		run(w, 1);
		const ctx = ctxOf(w);
		ctx.rebuildAura();
		for (const a of [mortar, mender, jackal]) {
			expect([a.kind, actorCooldownPercent(ctx, a), actorWalkPercent(ctx, a)]).toEqual([a.kind, 80, 125]);
		}
		// The timers, counted tick by tick: each phase's observed ticks (after each step), only for phases seen from
		// their first tick (the aiTicks the phase starts with).
		const phases = new Map<string, number[]>();
		const open = new Map<string, number>();
		const track = (name: string, on: boolean, first: number, aiTicks: number) => {
			const n = open.get(name);
			if (on) {
				if (n !== undefined) open.set(name, n + 1);
				else if (aiTicks === first) open.set(name, 1);
				return;
			}
			if (n === undefined) return;
			open.delete(name);
			const list = phases.get(name) ?? [];
			list.push(n);
			phases.set(name, list);
		};
		let lastPulse = -1;
		const pulseGaps: number[] = [];
		for (let t = 0; t < 900; t++) {
			const seen = run(w, 1);
			me.faceX = 0;
			me.faceZ = 1;
			track("flight", mortar.aiState === MORTAR_FLIGHT, MO.flightTicks, mortar.aiTicks);
			const winding = jackal.aiState === AiState.TELEGRAPH && jackal.attack === JACKAL_ATTACK_LUNGE;
			track("windup", winding, JA.windupTicks, jackal.aiTicks);
			const linking = mender.aiState === AiState.TELEGRAPH && mender.attack === 1;
			track("link", linking, ME.linkTicks, mender.aiTicks);
			if (seen.heals > 0) {
				if (lastPulse >= 0 && w.s.tick - lastPulse < ME.channelTicks) pulseGaps.push(w.s.tick - lastPulse);
				lastPulse = w.s.tick;
			}
		}
		// The flight: the release tick (aiTicks 60) to the tick before the landing; the wind-up and the link likewise.
		for (const [name, ticks] of [
			["flight", MO.flightTicks],
			["windup", JA.windupTicks],
			["link", ME.linkTicks],
		] as const) {
			const list = phases.get(name) ?? [];
			expect([name, list.size() > 0]).toEqual([name, true]);
			for (const n of list) expect([name, n]).toEqual([name, ticks]);
		}
		expect(pulseGaps.size() > 0).toBe(true);
		for (const g of pulseGaps) expect(g).toBe(ME.pulseTicks);
	});
});

describe("NT11 co-op", () => {
	it("one pack on two players: at most one Jackal attacks each target, and both players are lunged at", () => {
		const w = arena("weapon.sword", 2);
		put(w.s, 1, 6, 0);
		const pack = [spawn(w, "jackal", 3, -3), spawn(w, "jackal", 3, 3), spawn(w, "jackal", 2, 0.5)];
		const targets = [0, 0];
		const was = pack.map(() => false);
		for (let t = 0; t < 1800; t++) {
			// Each player faces away from its nearest Jackal (so it is lunged at, never spooks it).
			for (let i = 0; i < 2; i++) {
				const p = playerAt(w.s, i);
				let best: ActorState | undefined;
				let bd = math.huge;
				for (const a of pack) {
					const d = (a.x - p.x) * (a.x - p.x) + (a.z - p.z) * (a.z - p.z);
					if (a.alive !== 0 && d < bd) {
						bd = d;
						best = a;
					}
				}
				if (best !== undefined && bd > 1e-9) {
					const d = math.sqrt(bd);
					p.faceX = -(best.x - p.x) / d;
					p.faceZ = -(best.z - p.z) / d;
				}
			}
			run(w, 1);
			const holders = [0, 0];
			for (let k = 0; k < pack.size(); k++) {
				const a = pack[k];
				const holds = jackalHoldsToken(a);
				if (holds) holders[a.v[JACKAL_TARGET]]++;
				if (a.aiState === JACKAL_LUNGE && !was[k]) targets[a.v[JACKAL_TARGET]]++;
				was[k] = a.aiState === JACKAL_LUNGE;
			}
			expect(holders[0] <= 1 && holders[1] <= 1).toBe(true);
		}
		expect(targets[0] > 0 && targets[1] > 0).toBe(true);
	});

	it("the Mortar holds fire while its nearest player stands outside its room, a teammate inside or not (NTD3)", () => {
		// Room 0 is every cell with z > 0 (config.roomIdAt); the corridor below it.
		const config: SimConfig = {
			bounds: { minX: -20, maxX: 20, minZ: -20, maxZ: 20 },
			party: { size: 2 },
			roomIdAt: (_x, z) => (z > 0 ? 0 : -1),
		};
		const s = createSimState(SEED, 0, 0, config);
		const w: World = { s, config };
		put(s, 0, 0, -1); // nearest, in the corridor
		put(s, 1, 18, 19); // inside the room, never the nearest (the Mortar keeps 6-9 from player 0)
		const a = spawn(w, "mortar", 0, 4);
		a.cooldown = 0;
		const seen = seen0();
		for (let t = 0; t < 600; t++) {
			run(w, 1, seen);
			expect(lobDrawing(a) || a.aiState === MORTAR_FLIGHT).toBe(false);
		}
		expect(seen.shells).toBe(0);
		// The same player steps into the room: it lobs.
		put(s, 0, 0, 1);
		runUntil(w, () => lobDrawing(a), 400);
	});
});

describe("NT11 affixes", () => {
	it("a Vengeful Mortar killed mid-flight: the corpse fires its ring and still lands the shell on the planned tick", () => {
		const w = arena();
		const a = spawn(w, "mortar", 0, 8, AffixKind.VENGEFUL);
		a.cooldown = 0;
		runUntil(w, () => a.aiState === MORTAR_FLIGHT, 300);
		const left = a.v[MORTAR_FLIGHT_TICKS];
		const id = a.id;
		ctxOf(w).damageActor(a, 1000);
		expect(a.alive).toBe(0);
		let shellTick = -1;
		let vengeful = 0;
		const t0 = w.s.tick;
		for (let k = 0; k < 240; k++) {
			const seen = run(w, 1);
			vengeful += w.s.affixes!.events.vengefulFired.size();
			if (seen.shells > 0) shellTick = w.s.tick;
		}
		expect(shellTick - t0).toBe(left);
		expect(vengeful).toBe(1);
		expect(a.kind === NO_KIND || a.id !== id).toBe(true); // freed once both were done
	});

	it("a Shielded Mender: a hit its affix shield absorbs whole still cuts the beam (any hit that reaches it)", () => {
		const w = arena();
		const m = spawn(w, "mender", 0, 8, AffixKind.SHIELDED, 100);
		m.cooldown = 0;
		const ally = spawn(w, "mortar", 2.5, 8, AffixKind.NONE, 200);
		ally.hp = 100;
		ally.cooldown = 1e6;
		const seen = seen0();
		runUntil(w, () => channelling(m), 240, seen);
		const shield = w.s.affixes!.slots[w.s.combat.actors.indexOf(m)].shield;
		expect(shield >= 1).toBe(true);
		shoot(w.s, m.x, m.z - 3, 0, 1);
		runUntil(w, () => seen.ends.size() > 0, 30, seen);
		expect([seen.ends[0], m.hp]).toEqual([HealEnd.DAMAGE, 100]);
		expect(w.s.affixes!.slots[w.s.combat.actors.indexOf(m)].shield).toBe(shield - 1);
	});

	it("a Swift Jackal circles faster but lunges the literal distance a tick", () => {
		const step = (affix: number): { walk: number; lunge: number } => {
			const w = arena();
			const a = spawn(w, "jackal", 0, -3.3, affix);
			a.cooldown = 0;
			const walk = actorWalkPercent(ctxOf(w), a);
			runUntil(w, () => a.aiState === JACKAL_LUNGE, 240);
			const x0 = a.x;
			const z0 = a.z;
			run(w, 1);
			return { walk, lunge: math.sqrt((a.x - x0) * (a.x - x0) + (a.z - z0) * (a.z - z0)) };
		};
		const plain = step(AffixKind.NONE);
		const swift = step(AffixKind.SWIFT);
		expect([plain.walk, swift.walk]).toEqual([100, 135]);
		expect(plain.lunge).toBeCloseTo(JA.lungeDistance / JA.lungeTicks, 9);
		expect(swift.lunge).toBeCloseTo(JA.lungeDistance / JA.lungeTicks, 9);
	});
});

describe("NT11 the power pellet (Feast)", () => {
	it("erases the shrapnel and the Mender's bolt, never a shell (a strike)", () => {
		const w = arena();
		w.s.pellets = createPelletsState(PELLETS_CONFIG); // test surgery: the power pellet's erase reads no floor
		w.s.player.hurtTicks = 1e6; // every bullet passes the player (none is consumed by a hit)
		const a = spawn(w, "mortar", 0, 8);
		a.cooldown = 0;
		const kinds = (): number[] => {
			const out: number[] = [];
			w.s.combat.enemyBullets.forEachActive((_i, _p, payload) => {
				out.push(BulletPayload.get(payload, "kind"));
				return false;
			});
			return out;
		};
		const seen = seen0();
		runUntil(w, () => seen.shells > 0, 400, seen);
		const live = kinds();
		expect(live.filter((k) => k === BulletKind.STRIKE).size()).toBe(1);
		expect(live.filter((k) => k === BulletKind.ENEMY).size()).toBe(MO.shrapnel.count);
		expect(pelletsPower(w.s, 0)).toBe(MO.shrapnel.count);
		expect(kinds()).toEqual([BulletKind.STRIKE]);
		// The bolt.
		a.cooldown = 1e6;
		const m = spawn(w, "mender", 0, 6);
		m.cooldown = 0;
		runUntil(w, () => w.s.combat.enemyBullets.activeCountFor(m.emitterId) > 0, 300);
		expect(pelletsPower(w.s, 0) >= 1).toBe(true);
		expect(w.s.combat.enemyBullets.activeCountFor(m.emitterId)).toBe(0);
	});
});

describe("NT11 pacts' freeze (holdAbsoluteTimers)", () => {
	it("a frozen draft tick moves nothing of the three: their timers are aiTicks / v[] / cooldown", () => {
		const w = arena();
		const actors = [spawn(w, "mortar", -4, 7), spawn(w, "mender", 0, 7), spawn(w, "jackal", 3, -3)];
		actors[0].cooldown = 0;
		run(w, 90);
		const snap = actors.map((a) => [a.aiState, a.aiTicks, a.cooldown, ...a.v].join(","));
		w.s.pacts = { horde: { room: -1 } } as never; // holdAbsoluteTimers' guard; nothing of it applies here
		holdAbsoluteTimers(w.s);
		expect(actors.map((a) => [a.aiState, a.aiTicks, a.cooldown, ...a.v].join(","))).toEqual(snap);
	});
});

// ---------------------------------------------------------------------------------------------
// Horde (docs/FORTUNE.md): newEnemies2.systems.spec's harness

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

describe("NT11 Horde's second wave", () => {
	it("copies a Mender and the Jackals; a pack at the hordeMaxWave cut is copied in part (each Jackal priced 1)", () => {
		const base = pactsSetup(1337);
		const floor = altarFloor(base);
		const w0 = base.endlessFloor(floor);
		let room = -1;
		for (let id = 0; id < w0.roomSpawns.size() && room < 0; id++) {
			if (w0.roomSpawns[id].size() === 0 || (w0.roomSpawnTiles?.[id].size() ?? 0) < 14) continue;
			room = id;
		}
		expect(room >= 0).toBe(true);
		const max = hordeMaxWaveOf(base);
		// max - 4 others, a Mender, a Mortar, then the pack: the cut keeps two of its three Jackals.
		const kinds: string[] = [];
		for (let k = 0; k < max - 4; k++) kinds.push(k % 2 === 0 ? "swarmer" : "sniper");
		kinds.push("mender", "mortar", JACKAL.id, JACKAL.id, JACKAL.id);
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
		const wave = kinds.filter((_k, i) => i < max);
		expect(wave.filter((k) => k === JACKAL.id).size()).toBe(2);
		expect([...p.horde.waveKinds]).toEqual(wave.map((k) => archetypeIndex(k)));
		const par0 = rec.parTicks;
		for (let t = 0; t < 200 && p.horde.spawned === HORDE_WAVE_PENDING; t++) step(s, EMPTY_INPUT, setup.config);
		expect(p.horde.spawned).toBe(wave.size());
		let cost = 0;
		for (const k of wave) cost += encounterCost(k);
		expect(rec.parTicks).toBe(par0 + p.config.waveTelegraphTicks + ROOM_PAR_TICKS_PER_COST * cost);
	});
});

/** pacts' hordeMaxWave, read from the run's config. */
function hordeMaxWaveOf(setup: EndlessRunSetup): number {
	return setup.config.pacts!.hordeMaxWave;
}

export {};
