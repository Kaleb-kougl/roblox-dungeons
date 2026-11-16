// The Mortar (docs/NEW_ENEMIES_3.md NT2): keep range 6-9 without sight inside its own room, the lob (one cooldown draw
// at the draw's start, the init draw), the room test (NTD3: a doorway or corridor cell is outside; the encounter
// rectangle without config.roomIdAt), the landing point (the target's last tick of motion x leadTicks, clamped to
// maxLead; a wall / pillar / crate / pool point falls back to the target), the flight and the impact (one STRIKE that
// a guard never erases, events.shells; 6 shrapnel from the point that a guard does erase), the too-close back-off,
// NTD5 (a Mortar killed mid-flight lands its shell on the planned tick through stepCorpse, then its slot is freed), and
// determinism on real endless floors (solo and a party of two, every tick hashed twice).
import { describe, expect, it } from "@rbxts/jest-globals";
import { TileType, cellKey, tileAt, worldToGrid } from "shared/dungeon";
import { endlessRunFloor, type EndlessRunFloor } from "shared/run";
import {
	AXIS_MAX,
	AiState,
	BREAKABLES_CONFIG,
	BulletKind,
	BulletPayload,
	Button,
	EMPTY_INPUT,
	HIT_NORMAL,
	MORTAR,
	MORTAR_ATTACK_LOB,
	MORTAR_FLIGHT,
	MORTAR_FLIGHT_TICKS,
	MORTAR_KEEP,
	MORTAR_LAND_X,
	MORTAR_LAND_Z,
	NO_KIND,
	Rng,
	START_HALF_HEARTS,
	SimCtx,
	V_HOME_X,
	V_HOME_Z,
	archetypeAt,
	archetypeIds,
	archetypeIndex,
	createSimState,
	engage,
	hashState,
	nearestLivingPlayer,
	partySize,
	playerAt,
	solidCells,
	step,
	stepParty,
	type ActorSpawn,
	type ActorState,
	type EncounterRoom,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const D = MORTAR.data;
const KIND = archetypeIndex(MORTAR.id);
const enc = (spawns: ActorSpawn[], rooms: EncounterRoom[] = []) => ({ spawns, rooms, entranceRoom: -1, bossRoom: -1 });
const IDLE: InputFrame = { ...EMPTY_INPUT };
const walk = (x: number, z: number): InputFrame => ({ ...EMPTY_INPUT, moveX: x, moveZ: z });

function ghost(s: SimState): void {
	for (let i = 0; i < partySize(s); i++) playerAt(s, i).hurtTicks = 1e6;
}
function put(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
	p.prevX = x;
	p.prevZ = z;
}
function mortarOf(s: SimState): ActorState {
	for (const a of s.combat.actors) if (a.kind === KIND) return a;
	return error("no mortar", 0);
}
const drawing = (a: Readonly<ActorState>): boolean =>
	a.alive === 1 && a.aiState === AiState.TELEGRAPH && a.attack === MORTAR_ATTACK_LOB;
const dist = (a: Readonly<ActorState>, x: number, z: number): number =>
	math.sqrt((a.x - x) * (a.x - x) + (a.z - z) * (a.z - z));
/** The rng word after exactly `n` draws from `from`. */
function after(from: number, n: number): number {
	const r = new Rng(0);
	r.setState(from);
	for (let i = 0; i < n; i++) r.next();
	return r.getState();
}

interface Live {
	readonly x: number;
	readonly z: number;
	readonly kind: number;
	readonly source: number;
}
function liveBullets(s: SimState): Live[] {
	const out: Live[] = [];
	s.combat.enemyBullets.forEachActive((_slot, pos, payload) => {
		out.push({
			x: pos.x,
			z: pos.z,
			kind: BulletPayload.get(payload, "kind"),
			source: BulletPayload.get(payload, "source"),
		});
		return false;
	});
	return out;
}

/** A fresh state with one Mortar at (mx, mz), engaged, its cooldown out; the player at the origin. */
function armed(config: SimConfig, seed = 3): { s: SimState; a: ActorState } {
	const s = createSimState(seed, 0, 0, config);
	const a = mortarOf(s);
	engage(a);
	a.cooldown = 0;
	return { s, a };
}

/** Steps until the draw's release tick (the step that ends the draw) runs with `release` as the player's input. */
function toRelease(s: SimState, a: ActorState, config: SimConfig, release: InputFrame): void {
	for (let t = 0; t < 400 && !drawing(a); t++) step(s, IDLE, config);
	expect(drawing(a)).toBe(true);
	while (a.aiTicks > 1) step(s, IDLE, config);
	step(s, release, config);
}

// ---------------------------------------------------------------------------------------------

describe("mortar: stepCorpse is the Mortar's alone", () => {
	it("no other archetype defines stepCorpse, and the Mortar is no reviver (no stepDead)", () => {
		const ids = archetypeIds();
		for (let k = 0; k < ids.size(); k++) {
			const def = archetypeAt(k);
			expect([def.id, def.stepCorpse !== undefined]).toEqual([def.id, def.id === MORTAR.id]);
		}
		expect(archetypeAt(KIND).stepDead === undefined).toBe(true);
	});
});

describe("mortar: draws", () => {
	it("init draws exactly once (the first lob's cooldown, in range)", () => {
		const none = createSimState(7, 0, 0, { encounter: enc([]) });
		const one = createSimState(7, 0, 0, { encounter: enc([{ kind: MORTAR.id, x: 0, z: 7 }]) });
		expect(one.rngState).toBe(after(none.rngState, 1));
		const a = mortarOf(one);
		expect(a.cooldown >= D.lobCooldownMin && a.cooldown <= D.lobCooldownMax).toBe(true);
	});

	it("exactly one draw per lob, at the draw's start; none anywhere else; every lob lands flightTicks after its release", () => {
		const config: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: 7 }]) };
		const s = createSimState(11, 0, 0, config);
		ghost(s);
		const a = mortarOf(s);
		const wander = [walk(AXIS_MAX, 0), walk(0, AXIS_MAX), walk(-AXIS_MAX, 0), walk(0, -AXIS_MAX), IDLE];
		let lobs = 0;
		let shells = 0;
		let release = -1;
		for (let t = 0; t < 2400; t++) {
			const rng0 = s.rngState;
			const was = drawing(a);
			step(s, wander[math.floor(t / 30) % wander.size()], config);
			if (!was && drawing(a)) {
				lobs++;
				expect(s.rngState).toBe(after(rng0, 1));
				expect(a.cooldown >= D.lobCooldownMin && a.cooldown <= D.lobCooldownMax).toBe(true);
				const d = dist(a, s.player.x, s.player.z);
				expect(d >= D.tooClose && d <= D.lobRange).toBe(true);
			} else {
				expect(s.rngState).toBe(rng0);
			}
			if (was && a.aiState === MORTAR_FLIGHT) {
				release = t;
				expect([a.v[MORTAR_FLIGHT_TICKS], a.aiTicks, a.attack]).toEqual([
					D.flightTicks,
					D.flightTicks,
					MORTAR_ATTACK_LOB,
				]);
			}
			if (s.events.shells > 0) {
				shells += s.events.shells;
				expect([s.events.shells, s.events.strikes, t - release]).toEqual([1, 1, D.flightTicks]);
				expect([a.aiState, a.attack, a.v[MORTAR_FLIGHT_TICKS]]).toEqual([MORTAR_KEEP, 0, 0]);
			} else {
				expect(s.events.strikes).toBe(0);
			}
		}
		expect(lobs).toBeGreaterThanOrEqual(6);
		expect(shells >= lobs - 1).toBe(true);
	});
});

describe("mortar: the impact", () => {
	it("one STRIKE at the point (the Mortar's payload source) and 6 shrapnel from it; a standing target is hit at its feet", () => {
		const config: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: 7 }]) };
		const { s, a } = armed(config);
		put(s, 0, 0.5, -0.25);
		toRelease(s, a, config, IDLE);
		expect(a.aiState).toBe(MORTAR_FLIGHT);
		// Standing: the lead is zero, the ring on its feet.
		expect([a.v[MORTAR_LAND_X], a.v[MORTAR_LAND_Z]]).toEqual([0.5, -0.25]);
		for (let t = 1; t < D.flightTicks; t++) {
			step(s, IDLE, config);
			expect(s.events.shells).toBe(0);
		}
		expect(s.player.hearts).toBe(START_HALF_HEARTS);
		const spawned = s.combat.enemySpawned;
		step(s, IDLE, config);
		expect([s.events.shells, s.events.strikes, s.combat.enemySpawned - spawned]).toEqual([1, 1, 7]);
		// The standing target is hit at once, by exactly one of the seven (the landed hit consumes it; the i-frames let
		// the rest pass).
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
		const live = liveBullets(s);
		expect(live.size()).toBe(6);
		const shrapnel = live.filter((b) => b.kind === BulletKind.ENEMY);
		expect(shrapnel.size() >= 5).toBe(true);
		for (const b of live) expect(b.source).toBe(KIND + 1);
		for (const b of live) {
			const r = math.sqrt((b.x - 0.5) * (b.x - 0.5) + (b.z + 0.25) * (b.z + 0.25));
			expect(r < 0.2).toBe(true); // at the point, or just left it
		}
		for (let t = 0; t < 3; t++) step(s, IDLE, config);
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL); // once
	});

	it("the shrapnel is erased by a guard; the strike is not", () => {
		const config: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: -7 }]) };
		const run = (guard: boolean) => {
			const { s, a } = armed(config);
			ghost(s);
			toRelease(s, a, config, IDLE);
			// The point 1 ahead of the player (facing +Z): every shrapnel bullet starts inside the guard's reach and cone.
			a.v[MORTAR_LAND_X] = 0;
			a.v[MORTAR_LAND_Z] = 1;
			const face: InputFrame = { ...EMPTY_INPUT, aimZ: AXIS_MAX };
			for (let t = 1; t < D.flightTicks; t++) step(s, face, config);
			step(s, guard ? { ...face, buttons: Button.ALT } : face, config);
			expect(s.events.shells).toBe(1);
			return { s, kinds: liveBullets(s).map((b) => b.kind) };
		};
		const open = run(false);
		expect(open.kinds.filter((k) => k === BulletKind.ENEMY).size()).toBe(6);
		expect(open.kinds.filter((k) => k === BulletKind.STRIKE).size()).toBe(1);
		const guarded = run(true);
		expect(guarded.kinds).toEqual([BulletKind.STRIKE]);
		expect(guarded.s.events.bulletsDeleted).toBe(6);
	});
});

describe("mortar: the landing point", () => {
	const config: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: -7 }]) };

	it("leads a walking target by exactly leadTicks of its last tick's motion", () => {
		for (const [mx, mz] of [
			[300, 0],
			[0, -250],
			[200, 200],
		]) {
			const { s, a } = armed(config);
			ghost(s);
			toRelease(s, a, config, walk(mx, mz));
			const p = s.player;
			expect(p.x !== p.prevX || p.z !== p.prevZ).toBe(true);
			expect([a.v[MORTAR_LAND_X], a.v[MORTAR_LAND_Z]]).toEqual([
				p.x + (p.x - p.prevX) * D.leadTicks,
				p.z + (p.z - p.prevZ) * D.leadTicks,
			]);
			const lx = a.v[MORTAR_LAND_X] - p.x;
			const lz = a.v[MORTAR_LAND_Z] - p.z;
			expect(math.sqrt(lx * lx + lz * lz) < D.maxLead).toBe(true);
		}
	});

	it("never leads more than maxLead: a full-speed walk or a roll is clamped to maxLead along its motion", () => {
		for (const input of [
			walk(AXIS_MAX, 0),
			walk(AXIS_MAX, AXIS_MAX),
			{ ...walk(0, AXIS_MAX), buttons: Button.ROLL },
		]) {
			const { s, a } = armed(config);
			ghost(s);
			toRelease(s, a, config, input);
			const p = s.player;
			const mx = p.x - p.prevX;
			const mz = p.z - p.prevZ;
			const lx = a.v[MORTAR_LAND_X] - p.x;
			const lz = a.v[MORTAR_LAND_Z] - p.z;
			const len = math.sqrt(lx * lx + lz * lz);
			expect(len).toBeCloseTo(D.maxLead, 12);
			// Along the motion: parallel and the same way.
			expect(math.abs(lx * mz - lz * mx)).toBeLessThan(1e-9);
			expect(lx * mx + lz * mz > 0).toBe(true);
		}
	});

	// A hand-built floor around the player at the origin: a wall at x >= 2.5 (gx >= 3), a pillar at cell (0, 3), a pool at
	// cell (0, -3) (body-blocked only: bullets cross it), a crate at cell (-3, 0); the Mortar at (-5, -6).
	const blocked = (x: number, z: number): boolean => {
		const gx = worldToGrid(x);
		const gz = worldToGrid(z);
		return gx >= 3 || (gx === 0 && gz === 3);
	};
	const HAND: SimConfig = {
		encounter: enc([{ kind: MORTAR.id, x: -5, z: -6 }]),
		isBulletBlocked: blocked,
		isBodyBlocked: (x, z) => blocked(x, z) || (worldToGrid(x) === 0 && worldToGrid(z) === -3),
		breakables: { ...BREAKABLES_CONFIG, pieces: [{ x: -3, y: 0, kind: "crate" }] },
	};

	it("a point on a wall, a pillar, a crate or a pool falls back to the target's own position; an open point stays", () => {
		const cases: Array<readonly [string, InputFrame, boolean]> = [
			["wall", walk(AXIS_MAX, 0), false],
			["pillar", walk(0, AXIS_MAX), false],
			["crate", walk(-AXIS_MAX, 0), false],
			["pool", walk(0, -AXIS_MAX), false],
			["open", walk(-AXIS_MAX, AXIS_MAX), true],
		];
		for (const [label, input, open] of cases) {
			const { s, a } = armed(HAND);
			ghost(s);
			toRelease(s, a, HAND, input);
			const p = s.player;
			const lx = (p.x - p.prevX) * D.leadTicks;
			const lz = (p.z - p.prevZ) * D.leadTicks;
			const k = D.maxLead / math.sqrt(lx * lx + lz * lz);
			const want = open ? [p.x + lx * k, p.z + lz * k] : [p.x, p.z];
			expect([label, a.v[MORTAR_LAND_X], a.v[MORTAR_LAND_Z]]).toEqual([label, want[0], want[1]]);
			if (!open) {
				// The lead point itself was the blocked cell.
				const gx = worldToGrid(p.x + lx * k);
				const gz = worldToGrid(p.z + lz * k);
				const solid = solidCells(s);
				const isCrate = solid !== undefined && solid.has(cellKey(gx, gz));
				expect([label, HAND.isBodyBlocked!(p.x + lx * k, p.z + lz * k) || isCrate]).toEqual([label, true]);
			}
		}
	});
});

describe("mortar: no line of sight needed", () => {
	// A bullet-blocking wall row at gz = 3 for gx in [-4, 4]: the Mortar above it, the player below; no sight.
	const wall = (x: number, z: number): boolean => worldToGrid(z) === 3 && math.abs(worldToGrid(x)) <= 4;
	const config: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: 12 }]), isBulletBlocked: wall };

	it("keeps 6-9 and lobs over the wall; a standing target behind it is hit at its feet", () => {
		const s = createSimState(5, 0, 0, config);
		const a = mortarOf(s);
		engage(a); // no sight: it would never engage on its own
		let hitAt = -1;
		let inBand = false;
		for (let t = 0; t < 900 && hitAt < 0; t++) {
			step(s, IDLE, config);
			const d = dist(a, 0, 0);
			if (d >= D.keepMin - 0.05 && d <= D.keepMax + 0.05) inBand = true;
			if (s.events.shells > 0) {
				expect([a.v[MORTAR_LAND_X], a.v[MORTAR_LAND_Z]]).toEqual([0, 0]);
				hitAt = t;
			}
		}
		expect(inBand).toBe(true);
		expect(hitAt).toBeGreaterThan(0);
		expect(a.v[0]).toBe(1); // never leashed for lost sight
		expect(s.player.hearts).toBe(START_HALF_HEARTS - HIT_NORMAL);
	});
});

describe("mortar: the too-close back-off", () => {
	it("within tooClose it never lobs and backs straight off at its walk speed; then lobs", () => {
		const config: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: 1.5 }]) };
		const { s, a } = armed(config);
		ghost(s);
		const step0 = D.speed / 60;
		let lobbed = -1;
		for (let t = 0; t < 120 && lobbed < 0; t++) {
			const z0 = a.z;
			const d0 = dist(a, 0, 0);
			step(s, IDLE, config);
			if (drawing(a)) {
				expect(d0 >= D.tooClose).toBe(true);
				lobbed = t;
			} else if (d0 < D.tooClose) {
				expect(math.abs(a.x) < 1e-12).toBe(true); // no strafe
				expect(a.z - z0).toBeCloseTo(step0, 12);
			}
		}
		expect(lobbed).toBeGreaterThan(30);
	});
});

// The room test: room 0 is the cells |gx| <= 8, |gz| <= 8; the corridor runs up from the doorway cell (0, 9) to (0, 20)
// (FLOOR in no room: -1); everything else is -1 too.
const roomIdAt = (x: number, z: number): number =>
	math.abs(worldToGrid(x)) <= 8 && math.abs(worldToGrid(z)) <= 8 ? 0 : -1;
const ROOMED: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: 2 }]), roomIdAt };

describe("mortar: fires only while its target is in its own room (NTD3)", () => {
	it("a target in the doorway or the corridor gets no lob and no draw; back inside, it lobs", () => {
		for (const [px, pz] of [
			[0, 9],
			[0, 11.5],
		]) {
			const s = createSimState(4, px, pz, ROOMED);
			ghost(s);
			const a = mortarOf(s);
			engage(a);
			a.cooldown = 0;
			const rng0 = s.rngState;
			for (let t = 0; t < 600; t++) {
				step(s, IDLE, ROOMED);
				expect(a.aiState === AiState.TELEGRAPH || a.aiState === MORTAR_FLIGHT).toBe(false);
				expect(roomIdAt(a.x, a.z)).toBe(0); // stays in its room
			}
			expect([s.rngState, s.events.telegraphs]).toEqual([rng0, 0]);
			put(s, 0, 0, 8); // the room's last row
			let lobbed = false;
			for (let t = 0; t < 30 && !lobbed; t++) {
				step(s, IDLE, ROOMED);
				lobbed = drawing(a);
			}
			expect(lobbed).toBe(true);
			expect(s.rngState).toBe(after(rng0, 1));
		}
	});

	it("a target that steps into the doorway during the draw is not fired at (the cooldown stays spent)", () => {
		const s = createSimState(4, 0, 8.45, ROOMED);
		ghost(s);
		const a = mortarOf(s);
		engage(a);
		a.cooldown = 0;
		expect(roomIdAt(0, 8.45)).toBe(0);
		toRelease(s, a, ROOMED, walk(0, AXIS_MAX)); // the release step takes the player from z 8.45 into the doorway
		expect(roomIdAt(s.player.x, s.player.z)).toBe(-1);
		expect([a.aiState, a.attack, a.v[MORTAR_FLIGHT_TICKS]]).toEqual([MORTAR_KEEP, 0, 0]);
		expect(a.cooldown >= D.lobCooldownMin - 1).toBe(true);
		for (let t = 0; t < 90; t++) {
			step(s, IDLE, ROOMED);
			expect(s.events.shells).toBe(0);
		}
	});

	it("a target at the corridor mouth walking out: the lead point in the corridor stays (it is floor)", () => {
		const s = createSimState(4, 0, 7.5, ROOMED);
		ghost(s);
		const a = mortarOf(s);
		engage(a);
		a.cooldown = 0;
		toRelease(s, a, ROOMED, walk(0, 300));
		expect(roomIdAt(s.player.x, s.player.z)).toBe(0);
		expect(a.aiState).toBe(MORTAR_FLIGHT);
		expect(roomIdAt(a.v[MORTAR_LAND_X], a.v[MORTAR_LAND_Z])).toBe(-1);
		expect(a.v[MORTAR_LAND_Z]).toBe(s.player.z + (s.player.z - s.player.prevZ) * D.leadTicks);
	});

	it("never leaves its room, even toward a far target it keeps chasing", () => {
		const s = createSimState(4, 0, 30, ROOMED);
		ghost(s);
		const a = mortarOf(s);
		engage(a);
		for (let t = 0; t < 600; t++) {
			step(s, IDLE, ROOMED);
			expect(roomIdAt(a.x, a.z)).toBe(0);
		}
		expect(a.z > 7).toBe(true); // it walked to the room's edge
		expect(s.events.telegraphs).toBe(0);
	});

	it("without config.roomIdAt: the encounter room's rectangle", () => {
		const room: EncounterRoom = {
			id: 0,
			type: "combat",
			depth: 1,
			cx: 0,
			cz: 0,
			minX: -8,
			maxX: 8,
			minZ: -8,
			maxZ: 8,
			floorTiles: 289,
		};
		const RECT: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: 2 }], [room]) };
		const outside = createSimState(4, 0, 9.5, RECT);
		ghost(outside);
		const a = mortarOf(outside);
		engage(a);
		a.cooldown = 0;
		const rng0 = outside.rngState;
		for (let t = 0; t < 300; t++) step(outside, IDLE, RECT);
		expect([outside.rngState, outside.events.telegraphs]).toEqual([rng0, 0]);
		expect(a.z <= 8).toBe(true);
		put(outside, 0, 0, 7.5);
		let lobbed = false;
		for (let t = 0; t < 30 && !lobbed; t++) {
			step(outside, IDLE, RECT);
			lobbed = drawing(a);
		}
		expect(lobbed).toBe(true);
	});
});

describe("mortar: killed mid-flight (NTD5)", () => {
	const config: SimConfig = { encounter: enc([{ kind: MORTAR.id, x: 0, z: 7 }]) };

	/** Releases a shell at the standing player, then kills the Mortar `killAfter` ticks later (-1: never). */
	function flight(killAfter: number): {
		impact: number;
		freed: number;
		point: number[];
		hashes: string[];
		s: SimState;
	} {
		const { s, a } = armed(config);
		ghost(s);
		const slot = s.combat.actors.indexOf(a);
		toRelease(s, a, config, IDLE);
		const point = [a.v[MORTAR_LAND_X], a.v[MORTAR_LAND_Z]];
		let impact = -1;
		let freed = -1;
		const hashes: string[] = [];
		for (let t = 1; t <= 120; t++) {
			if (t === killAfter) new SimCtx().bind(s, config, EMPTY_INPUT).killActor(a);
			const rng0 = s.rngState;
			step(s, IDLE, config);
			hashes.push(hashState(s));
			if (killAfter > 0 && t > killAfter) expect(s.rngState).toBe(rng0); // the corpse draws nothing
			if (s.events.shells > 0) {
				expect(impact).toBe(-1);
				impact = t;
				const strike = liveBullets(s).filter((b) => b.kind === BulletKind.STRIKE);
				expect(strike.size()).toBe(1);
				expect(strike[0].source).toBe(KIND + 1);
				const dx = strike[0].x - point[0];
				const dz = strike[0].z - point[1];
				expect(dx * dx + dz * dz < 1e-18).toBe(true);
			}
			if (freed < 0 && s.combat.actors[slot].kind === NO_KIND) freed = t;
			if (killAfter > 0 && t > killAfter && freed < 0) {
				const c = s.combat.actors[slot];
				expect([c.kind, c.alive]).toEqual([KIND, 0]);
			}
		}
		return { impact, freed, point, hashes, s };
	}

	it("lands on the planned tick at the planned point, then its slot is freed (held past the corpse timer)", () => {
		const alive = flight(-1);
		expect(alive.impact).toBe(D.flightTicks);
		for (const killAfter of [1, 20]) {
			const dead = flight(killAfter);
			expect([killAfter, dead.impact, dead.point]).toEqual([killAfter, D.flightTicks, alive.point]);
			// The corpse timer (30 ticks) ran out before the shell landed: the slot goes on the landing tick.
			expect([killAfter, dead.freed]).toEqual([killAfter, D.flightTicks]);
			expect(dead.s.events.shells === 0).toBe(true);
		}
	});

	it("killed late in the flight: lands on time, then the corpse timer frees the slot as for any corpse", () => {
		const dead = flight(50);
		expect(dead.impact).toBe(D.flightTicks);
		expect(dead.freed).toBe(50 + 29); // the 30th corpse tick (CORPSE_TICKS) after the kill before step 50
	});

	it("killed during the draw: no shell, the corpse frees on its timer", () => {
		const { s, a } = armed(config);
		ghost(s);
		const slot = s.combat.actors.indexOf(a);
		for (let t = 0; t < 400 && !drawing(a); t++) step(s, IDLE, config);
		new SimCtx().bind(s, config, EMPTY_INPUT).killActor(a);
		let freed = -1;
		for (let t = 1; t <= 90; t++) {
			step(s, IDLE, config);
			expect(s.events.shells).toBe(0);
			if (freed < 0 && s.combat.actors[slot].kind === NO_KIND) freed = t;
		}
		expect(freed).toBe(30);
	});

	it("replays bit for bit", () => {
		expect(flight(20).hashes).toEqual(flight(20).hashes);
	});
});

// ---------------------------------------------------------------------------------------------
// Real endless floors (run WITHOUT endless mode, the floor's breakables as config pieces; the floor's own roomIdAt): a
// Mortar in a combat room and wandering ghost players. Every lob is at a target in its room, every shell lands on
// floor, and two runs hash identically every tick.

interface Scene {
	readonly fl: EndlessRunFloor;
	readonly config: SimConfig;
	readonly players: ReadonlyArray<readonly [number, number]>;
}

function scene(runSeed: number, floor: number, party: number): Scene | undefined {
	const fl = endlessRunFloor(runSeed, floor, party);
	const d = fl.dungeon;
	const rooms = fl.config.encounter!.rooms;
	const rng = new Rng(runSeed * 41 + floor);
	expect(fl.config.roomIdAt !== undefined).toBe(true);
	for (let tries = 0; tries < 40; tries++) {
		const r = rooms[rng.int(0, rooms.size() - 1)];
		if (r.type !== "combat" && r.type !== "elite") continue;
		const tiles: Array<readonly [number, number]> = [];
		for (let gy = 0; gy < d.H; gy++)
			for (let gx = 0; gx < d.W; gx++)
				if (d.roomId[gy * d.W + gx] === r.id && tileAt(d, gx, gy) === TileType.FLOOR) tiles.push([gx, gy]);
		if (tiles.size() < 30) continue;
		const me = tiles[rng.int(0, tiles.size() - 1)];
		const players: Array<readonly [number, number]> = [];
		for (let k = 0; k < 20 && players.size() < party; k++) {
			const p = tiles[rng.int(0, tiles.size() - 1)];
			const dd = (p[0] - me[0]) * (p[0] - me[0]) + (p[1] - me[1]) * (p[1] - me[1]);
			if (dd >= 25 && dd <= 81) players.push(p);
		}
		if (players.size() < party) continue;
		const config: SimConfig = {
			...fl.config,
			encounter: { ...fl.config.encounter!, spawns: [{ kind: MORTAR.id, x: me[0], z: me[1] }] },
			breakables: { ...BREAKABLES_CONFIG, pieces: fl.breakables ?? [] },
			party: party > 1 ? { size: party } : undefined,
		};
		return { fl, config, players };
	}
	return undefined;
}

function wanderer(seed: number): () => InputFrame {
	const rng = new Rng(seed);
	let hold = 0;
	let cur: InputFrame = EMPTY_INPUT;
	const axes = [-AXIS_MAX, 0, AXIS_MAX];
	return () => {
		if (hold <= 0) {
			hold = rng.int(10, 40);
			cur = { ...EMPTY_INPUT, moveX: axes[rng.int(0, 2)], moveZ: axes[rng.int(0, 2)] };
		}
		hold--;
		return cur;
	};
}

interface Played {
	readonly shells: number;
	readonly lobs: number;
	readonly hashes: string[];
}

function play(sc: Scene, seed: number, ticks: number): Played {
	const party = sc.players.size();
	const s = createSimState(seed, sc.players[0][0], sc.players[0][1], sc.config);
	for (let i = 0; i < party; i++) put(s, i, sc.players[i][0], sc.players[i][1]);
	ghost(s);
	const walkers: Array<() => InputFrame> = [];
	for (let i = 0; i < party; i++) walkers.push(wanderer(seed * 7 + i));
	const a = mortarOf(s);
	engage(a);
	const roomOf = sc.config.roomIdAt!;
	const home = roomOf(a.v[V_HOME_X], a.v[V_HOME_Z]);
	expect(home >= 0).toBe(true);
	let shells = 0;
	let lobs = 0;
	const hashes: string[] = [];
	for (let t = 0; t < ticks; t++) {
		const was = drawing(a);
		if (party > 1) {
			const inputs: InputFrame[] = [];
			for (let i = 0; i < party; i++) inputs.push(walkers[i]());
			stepParty(s, inputs, sc.config);
		} else step(s, walkers[0](), sc.config);
		hashes.push(hashState(s));
		const target = playerAt(s, nearestLivingPlayer(s, a.x, a.z));
		if (!was && drawing(a)) {
			lobs++;
			expect(roomOf(target.x, target.z)).toBe(home);
		}
		if (was && a.aiState === MORTAR_FLIGHT) expect(roomOf(target.x, target.z)).toBe(home);
		expect(roomOf(a.x, a.z)).toBe(home);
		if (s.events.shells === 0) continue;
		shells += s.events.shells;
		const lx = a.v[MORTAR_LAND_X];
		const lz = a.v[MORTAR_LAND_Z];
		const gx = worldToGrid(lx);
		const gz = worldToGrid(lz);
		const solid = solidCells(s);
		// Floor a body could stand on in the sim's own grid (a secret floor's carved one included).
		expect([gx, gz, sc.config.isBodyBlocked!(lx, lz)]).toEqual([gx, gz, false]);
		expect([gx, gz, solid !== undefined && solid.has(cellKey(gx, gz))]).toEqual([gx, gz, false]);
	}
	return { shells, lobs, hashes };
}

describe("mortar: real endless floors", () => {
	it("solo (8 floors) and co-op (2, 4 floors): lobs only at a target in its room, shells on floor, it stays in", () => {
		let shells = 0;
		let scenes = 0;
		for (let run = 1; run <= 8; run++) {
			const sc = scene(run, 2 + (run % 3), 1);
			if (sc === undefined) continue;
			scenes++;
			shells += play(sc, run, 900).shells;
		}
		for (let run = 21; run <= 24; run++) {
			const sc = scene(run, 3, 2);
			if (sc === undefined) continue;
			scenes++;
			shells += play(sc, run, 900).shells;
		}
		expect(scenes).toBeGreaterThanOrEqual(10);
		expect(shells).toBeGreaterThanOrEqual(10);
	});

	it("is deterministic: two identical runs hash identically every tick (solo and a party of two)", () => {
		for (const [run, party] of [
			[4, 1],
			[23, 2],
		]) {
			const first = play(scene(run, 3, party)!, run, 600);
			const second = play(scene(run, 3, party)!, run, 600);
			expect(first.hashes.size()).toBe(600);
			expect(second.hashes).toEqual(first.hashes);
		}
	});
});
