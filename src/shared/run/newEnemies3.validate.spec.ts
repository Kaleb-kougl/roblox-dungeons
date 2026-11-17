// docs/NEW_ENEMIES_3.md NT11 (NX11's shape): a recorded endless run with each of the three new room enemies validates
// on the server (shared/run validateRun, the endless world, debug input allowed for the floor skip). Per kind: the first
// solo run seed (from 1) whose floors 2-6 hold a room planning it; a Knight run debug-skips to that floor, walks into the
// room (it spawns), keeps 3-5 from the kind for 8 s without attacking or rolling (so the kind acts), then fights (walk
// in, hold FIRE, a roll now and then) to 20 s. The run is honest whatever happens (a death ends it). Checked: the kind
// spawned and engaged (its shells / bolts, links, heals and cuts / lunges and spooks printed), the recording replays to the same
// hash, and the server accepts it. A kind must show its own action in the run (a shell landed, a heal, a lunge): the
// first of up to TRIES planning rooms whose run does is the one validated (the 2-heart Knight can die early). The
// Mender's action is a bolt or a link started (a heal needs a wounded ally, rare where its room is swarmers that die
// in one hit: NT12's real-floor heal count).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	AiState,
	Button,
	MENDER,
	MENDER_ATTACK_BOLT,
	MENDER_ATTACK_HEAL,
	SIM_HZ,
	archetypeIndex,
	encodeRecording,
	hashState,
	runReplay,
	type SimState,
} from "shared/sim";
import { DEFAULT_RUN_LIMITS, buildEndlessRunConfig, validateRun, type RunLimits, type RunSubmission } from "shared/run";
import { Driver, frame, nearestLiving } from "shared/run/testing";

const LIMITS: RunLimits = { ...DEFAULT_RUN_LIMITS, world: "endless", allowDebugInput: true };
const KINDS = ["mortar", "mender", "jackal"] as const;
const FIGHT_SECONDS = 20;
const PASSIVE_SECONDS = 8;

/** Every (seed, floor, room) from seed 1 whose floors 2-6 plan `kind` in a room, in order, up to `max`. */
function candidates(kind: string, max: number): Array<[number, number, number]> {
	const out: Array<[number, number, number]> = [];
	for (let seed = 1; seed <= 200 && out.size() < max; seed++) {
		const setup = buildEndlessRunConfig(seed, 1, { characters: ["knight"] });
		for (let floor = 2; floor <= 6 && out.size() < max; floor++) {
			const w = setup.endlessFloor(floor);
			if (w.bossFloor) continue;
			for (let id = 0; id < w.roomSpawns.size() && out.size() < max; id++)
				if (w.roomSpawns[id].some((sp) => sp.kind === kind)) out.push([seed, floor, id]);
		}
	}
	if (out.size() === 0) error(`no room plans ${kind}`, 0);
	return out;
}

/** The candidates tried per kind until a run shows the kind's own action (a shell, a heal, a lunge). */
const TRIES = 12;

interface Recorded {
	seed: number;
	floor: number;
	room: number;
	drv: Driver;
	spawned: boolean;
	didAct: boolean;
	engagedTicks: number;
	shells: number;
	heals: number;
	cuts: number;
	casts: number;
	lunges: number;
	spooks: number;
}

/** The run of the file comment, recorded (seed, floor, room planning `kind`). */
function record(kind: string, seed: number, floor: number, room: number): Recorded {
	const setup = buildEndlessRunConfig(seed, 1, { characters: ["knight"] });
	const drv = new Driver(setup, seed);
	while (drv.floor() < floor && drv.state.player.dead === 0) drv.skipFloor();
	const s = drv.state;
	const k = archetypeIndex(kind);
	const present = () => s.combat.actors.some((a) => a.kind === k);
	const r = drv.world().config.encounter!.rooms[room];
	drv.walkTo(r.cx, r.cz, present, 3000);
	const out: Recorded = {
		seed,
		floor,
		room,
		drv,
		spawned: present(),
		didAct: false,
		engagedTicks: 0,
		shells: 0,
		heals: 0,
		cuts: 0,
		casts: 0,
		lunges: 0,
		spooks: 0,
	};
	for (let t = 0; t < FIGHT_SECONDS * SIM_HZ && s.player.dead === 0; t++) {
		const p = s.player;
		const passive = t < PASSIVE_SECONDS * SIM_HZ;
		const own = s.combat.actors.find((a) => a.kind === k && a.alive !== 0);
		const target = passive && own !== undefined ? own : nearestLiving(s, p);
		if (target === undefined) {
			drv.tick(frame(0, 0, drv.assisted(0)));
			continue;
		}
		const dx = target.x - p.x;
		const dz = target.z - p.z;
		const d = math.sqrt(dx * dx + dz * dz);
		const ux = d > 1e-9 ? dx / d : 1;
		const uz = d > 1e-9 ? dz / d : 0;
		// The first PASSIVE_SECONDS it keeps 3-5 from its target without attacking (so every kind gets to act),
		// then it walks in and holds FIRE.
		const walk = passive ? (d > 5 ? 1 : d < 3 ? -1 : 0) : d > 1.4 ? 1 : 0;
		const roll = !passive && t % 90 === 45 ? Button.ROLL : 0;
		const fire = passive ? 0 : Button.FIRE;
		drv.tick(frame(ux * walk, uz * walk, drv.assisted(bit32.bor(fire, roll)), ux, uz));
		out.spawned = out.spawned || present();
		for (const a of s.combat.actors) if (a.kind === k && a.alive !== 0 && a.aiState !== 0) out.engagedTicks++;
		if (!out.didAct && s.combat.actors.some((a) => a.kind === k && a.alive !== 0 && a.aiState !== 0))
			out.didAct = true;
		const e = s.events;
		out.shells += e.shells;
		out.heals += e.heals;
		out.cuts += e.healCuts;
		for (const a of s.combat.actors) {
			if (a.kind !== k || a.alive === 0 || a.aiState !== AiState.TELEGRAPH) continue;
			if (kind === "mender" && a.attack === MENDER_ATTACK_BOLT && a.aiTicks === MENDER.data.boltWindupTicks)
				out.casts++;
			if (kind === "mender" && a.attack === MENDER_ATTACK_HEAL && a.aiTicks === MENDER.data.linkTicks)
				out.casts++;
		}
		out.lunges += e.lunges;
		out.spooks += e.spooks;
	}
	return out;
}

/** The kind's own action in a recorded run. */
function acted(kind: string, r: Recorded): boolean {
	if (kind === "mortar") return r.shells > 0;
	if (kind === "mender") return r.casts > 0;
	return r.lunges > 0;
}

describe("NT11: recorded runs with each new kind validate on the server", () => {
	for (const kind of KINDS) {
		it(`${kind}: spawned, replayed to the same hash, accepted`, () => {
			let r: Recorded | undefined;
			for (const [seed, floor, room] of candidates(kind, TRIES)) {
				r = record(kind, seed, floor, room);
				if (acted(kind, r)) break;
			}
			const { seed, floor, room, drv } = r!;
			const s = drv.state;
			const recording = drv.recorder.getRecording();
			const finalHash = hashState(s);
			print(
				`[nt11 validate] ${kind}: run ${seed} floor ${floor} room ${room}, ${recording.frames.size()} ticks, ` +
					`dead ${s.player.dead}, engaged ${r!.didAct} for ${r!.engagedTicks} ticks; shells ${r!.shells} ` +
					`casts ${r!.casts} heals ${r!.heals} cuts ${r!.cuts} lunges ${r!.lunges} spooks ${r!.spooks}`,
			);
			expect([kind, r!.spawned, r!.didAct, acted(kind, r!)]).toEqual([kind, true, true, true]);
			expect(
				hashState(runReplay(recording, buildEndlessRunConfig(seed, 1, { characters: ["knight"] }).config)),
			).toBe(finalHash);
			const submission: RunSubmission = {
				seed,
				atBossDoor: false,
				recording: encodeRecording(recording),
				claimedHash: finalHash,
				claimed: { ticks: s.tick, kills: 0, bossDefeated: false, died: s.player.dead !== 0 },
				characterId: "knight",
			};
			const probe = validateRun(submission, LIMITS);
			expect(probe.serverHash).toBe(finalHash);
			const ok = validateRun({ ...submission, claimed: probe.summary }, LIMITS);
			expect([ok.ok, ok.code]).toEqual([true, undefined]);
		});
	}
});
