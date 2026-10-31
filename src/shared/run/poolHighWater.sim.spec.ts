// Actor-pool high-water, simulated (docs/ENEMY_VARIANTS.md EV13): a real party-4 endless run debug-skipped to a deep
// floor (each boon draft dismissed), Depth set to what a run that killed every boss has there (test-only, as
// replay.bench.spec.ts does), all four players teleported into the floor's densest room (by poolHighWater.ts's slot
// estimate), then SIM_SECONDS of combat, god mode. Two bots: "passive" (strafe, aim, roll, never attack: every
// summoner fills up its summons, nothing splits) and "sword" (each player walks at the nearest enemy and swings: the
// Oozes split, the summoners recast). Measured per tick: combat.actors present (alive + corpses: the pool's slots)
// and alive, and combat.actorsDropped (a spawn the full pool refused). Target: under 48 of MAX_ACTORS 64, none dropped.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AXIS_MAX,
	Button,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	MAX_ACTORS,
	NO_KIND,
	SIM_HZ,
	SWORD_DATA,
	archetypeAt,
	countActors,
	createSimState,
	partySize,
	playerAt,
	step,
	stepParty,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { buildEndlessRunConfig } from "shared/run";
import { POOL_ROOM_TARGET, dismissDraft, frame, roomLoad } from "shared/run/testing";

const PARTY = 4;
const SIM_SECONDS = 40;
/**
 * (run seed, floor): floor 20 (the deepest the analytic table covers: every party-4 room there is 16 bruisers, the
 * spender's saturated fallback), and one of the analytic table's worst rooms (43 slots: run 17 floor 14 room 10, 11
 * Oozes + a summoner; poolHighWater.deep.spec.ts, party 4, run seeds 1-20).
 */
const SCENARIOS: ReadonlyArray<readonly [number, number]> = [
	[1, 20],
	[17, 14],
];
/** Depth after every boss on the way (boss floors 5, 10, 15, ...). */
const depthAt = (floor: number) => 1 + math.floor((floor - 1) / 5);

function tickAll(s: SimState, config: Readonly<SimConfig>, frames: InputFrame[]): void {
	if (frames.size() === 1) step(s, frames[0], config);
	else stepParty(s, frames, config);
}

function same(n: number, f: InputFrame): InputFrame[] {
	const out: InputFrame[] = [];
	for (let i = 0; i < n; i++) out.push({ ...f });
	return out;
}

function skipTo(s: SimState, config: Readonly<SimConfig>, floor: number): void {
	const n = partySize(s);
	while (s.endless!.floor < floor) {
		tickAll(s, config, same(n, { ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON }));
		dismissDraft(s);
		tickAll(s, config, same(n, EMPTY_INPUT));
	}
}

/** Player i's frame: aim at the nearest living enemy; passive strafes and rolls, sword walks in and swings. */
function botFrame(s: SimState, i: number, sword: boolean): InputFrame {
	const p = playerAt(s, i);
	let best = math.huge;
	let ax = 0;
	let az = 0;
	let reach = 0;
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND || a.alive === 0 || archetypeAt(a.kind).data.boss === true) continue;
		const dx = a.x - p.x;
		const dz = a.z - p.z;
		const d2 = dx * dx + dz * dz;
		if (d2 < best) {
			best = d2;
			ax = dx;
			az = dz;
			reach = SWORD_DATA.reach + a.radius;
		}
	}
	const len = math.sqrt(ax * ax + az * az);
	const ux = len > 0 ? ax / len : 1;
	const uz = len > 0 ? az / len : 0;
	if (sword) {
		const walk = len > 1.4 ? 1 : 0;
		return frame(ux * walk, uz * walk, len > 0 && len <= reach ? Button.FIRE : 0, ux, uz);
	}
	const t = s.tick + i * 17;
	return {
		moveX: math.floor(t / 30) % 2 === 0 ? 400 : -400,
		moveZ: 0,
		aimX: math.round(ux * AXIS_MAX),
		aimZ: math.round(uz * AXIS_MAX),
		buttons: t % 90 === 0 ? Button.ROLL : 0,
	};
}

interface PoolRun {
	readonly room: number;
	readonly kinds: string;
	readonly estimate: number;
	readonly maxPresent: number;
	readonly maxAlive: number;
	readonly dropped: number;
	readonly kills: number;
	readonly peakKinds: string;
}

function kindList(s: SimState): string {
	const counts = new Map<string, number>();
	const order: string[] = [];
	for (const a of s.combat.actors) {
		if (a.kind === NO_KIND) continue;
		const id = archetypeAt(a.kind).id + (a.alive === 0 ? " (corpse)" : "");
		if (!counts.has(id)) order.push(id);
		counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return order.map((k) => `${counts.get(k)} ${k}`).join(", ");
}

function poolRun(seed: number, floor: number, sword: boolean): PoolRun {
	const setup = buildEndlessRunConfig(seed, PARTY);
	const spawn = setup.spawn!;
	const s = createSimState(seed, spawn.x, spawn.z, setup.config);
	skipTo(s, setup.config, floor);
	expect(s.endless!.floor).toBe(floor);
	s.endless!.depth = depthAt(floor);
	const world = setup.endlessFloor(floor);
	let room = -1;
	let estimate = -1;
	for (let id = 0; id < world.roomSpawns.size(); id++) {
		const load = roomLoad(world.roomSpawns[id]);
		if (world.roomSpawns[id].size() > 0 && load.slots > estimate) {
			estimate = load.slots;
			room = id;
		}
	}
	const counts = new Map<string, number>();
	for (const sp of world.roomSpawns[room]) counts.set(sp.kind, (counts.get(sp.kind) ?? 0) + 1);
	const kinds: string[] = [];
	for (const [k, n] of counts) kinds.push(`${n} ${k}`);
	kinds.sort();
	const first = world.roomSpawns[room][0];
	for (let i = 0; i < PARTY; i++) {
		const p = playerAt(s, i);
		p.x = first.x;
		p.z = first.z;
		p.prevX = first.x;
		p.prevZ = first.z;
	}
	const droppedBefore = s.combat.actorsDropped;
	let maxPresent = 0;
	let maxAlive = 0;
	let peakKinds = "";
	let kills = 0;
	for (let k = 0; k < SIM_SECONDS * SIM_HZ; k++) {
		for (let i = 0; i < PARTY; i++) {
			const p = playerAt(s, i);
			p.hearts = p.heartsMax;
		}
		const frames: InputFrame[] = [];
		for (let i = 0; i < PARTY; i++) frames.push(botFrame(s, i, sword));
		tickAll(s, setup.config, frames);
		kills += s.events.enemiesKilled;
		const c = countActors(s.combat);
		if (c.present > maxPresent) {
			maxPresent = c.present;
			peakKinds = kindList(s);
		}
		maxAlive = math.max(maxAlive, c.alive);
	}
	expect(s.endless!.roomsEntered[room]).toBe(1);
	return {
		room,
		kinds: kinds.join(", "),
		estimate,
		maxPresent,
		maxAlive,
		dropped: s.combat.actorsDropped - droppedBefore,
		kills,
		peakKinds,
	};
}

describe(`actor-pool high-water, simulated (party ${PARTY}, ${SIM_SECONDS} s, god mode)`, () => {
	for (const [seed, floor] of SCENARIOS) {
		for (const sword of [false, true]) {
			const bot = sword ? "sword" : "passive";
			it(`run ${seed} floor ${floor}, densest room, ${bot} bot: under ${POOL_ROOM_TARGET} of ${MAX_ACTORS}, none dropped (printed)`, () => {
				const r = poolRun(seed, floor, sword);
				print(
					`[pool sim] run ${seed} floor ${floor} (depth ${depthAt(floor)}) room ${r.room} [${
						r.kinds
					}], ${bot}: ` +
						`estimate ${r.estimate} slots; measured max ${r.maxPresent} present / ${r.maxAlive} alive, ` +
						`${r.dropped} dropped, ${r.kills} kills; at the peak: ${r.peakKinds}`,
				);
				expect(r.maxPresent).toBeLessThan(POOL_ROOM_TARGET);
				expect(r.dropped).toBe(0);
			});
		}
	}
});
