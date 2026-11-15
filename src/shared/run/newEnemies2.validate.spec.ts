// docs/NEW_ENEMIES_2.md NX11: a recorded endless run with each of the four new room enemies validates on the server
// (shared/run validateRun, the endless world, debug input allowed for the floor skip). Per kind: the first solo run seed
// (from 1) whose floors 2-6 hold a room planning it; a Knight run debug-skips to that floor, walks into the room (it
// spawns), keeps 3-5 from the kind for 8 s without attacking or rolling (so the kind acts), then fights
// (walk in, hold FIRE) to 20 s. The run is honest whatever happens (a
// death ends it). Checked: the kind spawned and engaged (its blocks / latches / steals / lights printed), the recording
// replays to the same hash, and the server accepts it.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	Button,
	CHAINHOOK_THROWN,
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
const KINDS = ["bulwark", "chainhook", "snatcher", "pyrekeeper"] as const;
const FIGHT_SECONDS = 20;
const PASSIVE_SECONDS = 8;

/** The first (seed, floor, room) from seed 1 whose floors 2-6 plan `kind` in a room. */
function find(kind: string): [number, number, number] {
	for (let seed = 1; seed <= 200; seed++) {
		const setup = buildEndlessRunConfig(seed, 1, { characters: ["knight"] });
		for (let floor = 2; floor <= 6; floor++) {
			const w = setup.endlessFloor(floor);
			if (w.bossFloor) continue;
			for (let id = 0; id < w.roomSpawns.size(); id++)
				if (w.roomSpawns[id].some((sp) => sp.kind === kind)) return [seed, floor, id];
		}
	}
	error(`no room plans ${kind}`, 0);
}

describe("NX11: recorded runs with each new kind validate on the server", () => {
	for (const kind of KINDS) {
		it(`${kind}: spawned, replayed to the same hash, accepted`, () => {
			const [seed, floor, room] = find(kind);
			const setup = buildEndlessRunConfig(seed, 1, { characters: ["knight"] });
			const drv = new Driver(setup, seed);
			while (drv.floor() < floor && drv.state.player.dead === 0) drv.skipFloor();
			const s = drv.state;
			const k = archetypeIndex(kind);
			const present = () => s.combat.actors.some((a) => a.kind === k);
			const r = drv.world().config.encounter!.rooms[room];
			drv.walkTo(r.cx, r.cz, present, 3000);
			let spawned = present();
			let didAct = false;
			let blocks = 0;
			let engagedTicks = 0;
			let throws = 0;
			let latches = 0;
			let lights = 0;
			let steals = 0;
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
				spawned = spawned || present();
				for (const a of s.combat.actors) if (a.kind === k && a.alive !== 0 && a.aiState !== 0) engagedTicks++;
				if (own !== undefined && kind === "chainhook" && own.aiState === CHAINHOOK_THROWN && own.aiTicks === 1)
					throws++;
				if (!didAct && s.combat.actors.some((a) => a.kind === k && a.alive !== 0 && a.aiState !== 0))
					didAct = true;
				const e = s.events;
				blocks += e.shieldBlocks + e.guardBreaks;
				latches += e.hookLatched;
				lights += e.pyresLanded;
				steals += s.pellets?.events.stolen.size() ?? 0;
			}
			const recording = drv.recorder.getRecording();
			const finalHash = hashState(s);
			print(
				`[nx11 validate] ${kind}: run ${seed} floor ${floor} room ${room}, ${recording.frames.size()} ticks, ` +
					`dead ${s.player.dead}, engaged ${didAct} for ${engagedTicks} ticks; blocks ${blocks} throws ${throws} latches ${latches} ` +
					`steals ${steals} pyres ${lights}`,
			);
			expect([kind, spawned, didAct]).toEqual([kind, true, true]);
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
