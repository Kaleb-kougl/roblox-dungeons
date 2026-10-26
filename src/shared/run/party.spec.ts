// M4 co-op endless runs: scripted 2- and 8-player runs replay deterministically (hash and score), through the party
// codec too; the floor / death / revive / stairwell / leave rules; party size scaling of enemy hp and room budgets
// (exact); scoring with the party's size; a party run cut into segments validates through SegmentedValidator to
// the same final hash and score, and a tampered frame rejects at its segment.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	Button,
	COMBO_MIN,
	DEBUG_FLOOR_BUTTON,
	EMPTY_INPUT,
	NO_KIND,
	PARTY_HP_MULTIPLIERS,
	PARTY_LEFT_BUTTON,
	PARTY_REVIVE_HALF_HEARTS,
	archetypeAt,
	createSimState,
	cutCombo,
	decodeRecording,
	encodeRecording,
	endlessActorHp,
	hashState,
	isPartyWiped,
	playerAt,
	runReplay,
	stepParty,
	type InputFrame,
	type Recording,
	type SimState,
} from "shared/sim";
import {
	ENCOUNTER_BUDGET_BASE,
	ENCOUNTER_BUDGET_PER_FLOOR,
	ENDLESS_ROOM_ACTOR_CAP,
	ELITE_BUDGET_MULTIPLIER,
	PARTY_BUDGET_MULTIPLIERS,
	bossKindFor,
	endlessRoomSpawns,
	floorSeed,
	roomEncounterBudget,
} from "shared/dungeon";
import {
	DEFAULT_SEGMENT_LIMITS,
	SegmentedValidator,
	buildEndlessRunConfig,
	buildWorldSetup,
	checkpointCount,
	readRunScore,
	summarizeRun,
	RunTelemetry,
	type RunSegment,
	type SegmentLimits,
	type SegmentVerdict,
	type SegmentedRunResult,
} from "shared/run";
import { dismissDraft, recordPartyRun } from "shared/run/testing";

const LATE = 1e9;
const LIMITS = { maxTicks: 1000000, maxRecordingBytes: 100000000 };

function idle(n: number): InputFrame[] {
	const f: InputFrame[] = [];
	for (let i = 0; i < n; i++) f.push({ ...EMPTY_INPUT });
	return f;
}

function withFrame(n: number, who: number, buttons: number): InputFrame[] {
	const f = idle(n);
	f[who] = { ...EMPTY_INPUT, buttons };
	return f;
}

function place(s: SimState, i: number, x: number, z: number): void {
	const p = playerAt(s, i);
	p.x = x;
	p.z = z;
}

describe("scripted co-op endless runs replay deterministically", () => {
	for (const n of [2, 8]) {
		const run = recordPartyRun(1337, n, n === 8 ? { walkTicks: 1500, boss: false } : {});
		const N = run.recording.frames.size();
		it(`${n} players: the log, the live hash and score`, () => {
			for (const line of run.log) print(`[party ${n}] ${line}`);
			print(
				`[party ${n}] ${N} ticks, floors at ${run.drv.floorTicks.join(",")}, deaths at ${run.drv.deaths.join(
					",",
				)}, score ${run.drv.state.score!.total}, max actors ${run.drv.maxActors}`,
			);
			expect(run.recording.others!.size()).toBe(n - 1);
			expect(run.drv.state.party!.size).toBe(n);
			expect(run.drv.floorTicks.size() >= 1).toBe(true);
			expect(run.drv.state.score!.partySize).toBe(n);
		});

		it(`${n} players: replays twice to the same hash and score`, () => {
			const a = runReplay(run.recording, buildEndlessRunConfig(1337, n).config);
			const b = runReplay(run.recording, buildEndlessRunConfig(1337, n).config);
			expect(hashState(a)).toBe(run.finalHash);
			expect(hashState(b)).toBe(run.finalHash);
			expect(a.score!.total).toBe(run.drv.state.score!.total);
			expect(b.score!.total).toBe(run.drv.state.score!.total);
			expect(a.score!.points).toEqual(run.drv.state.score!.points);
		});

		it(`${n} players: through the party codec`, () => {
			const buf = encodeRecording(run.recording);
			print(
				`[party ${n}] party recording ${buffer.len(buf)} bytes, ${string.format(
					"%.2f",
					buffer.len(buf) / N,
				)} B/tick`,
			);
			const decoded = decodeRecording(buf, LIMITS);
			expect(decoded.ok).toBe(true);
			if (!decoded.ok) return;
			expect(hashState(runReplay(decoded.recording, buildEndlessRunConfig(1337, n).config))).toBe(run.finalHash);
		});
	}

	it("the 2-player run differs from the 8-player one and from solo (scaling and party state are hashed)", () => {
		const two = buildEndlessRunConfig(1337, 2);
		const solo = buildEndlessRunConfig(1337);
		const s2 = createSimState(1337, two.spawn!.x, two.spawn!.z, two.config);
		const s1 = createSimState(1337, solo.spawn!.x, solo.spawn!.z, solo.config);
		expect(hashState(s2)).never.toBe(hashState(s1));
		expect(solo.config.party).toBe(undefined);
		expect(two.config.party?.size).toBe(2);
		expect(two.config.scoring?.partySize).toBe(2);
	});
});

describe("co-op floor rules", () => {
	function party(n: number) {
		const setup = buildEndlessRunConfig(4242, n);
		const s = createSimState(4242, setup.spawn!.x, setup.spawn!.z, setup.config);
		return { setup, s, step: (f: InputFrame[]) => stepParty(s, f, setup.config) };
	}

	function kill(r: ReturnType<typeof party>, who: number): void {
		const p = playerAt(r.s, who);
		p.armor = 0;
		p.hearts = 1;
		p.hurtTicks = 0;
		p.iframeTicks = 0;
		r.step(withFrame(r.s.party!.size, who, Button.DEBUG_HIT));
		r.step(idle(r.s.party!.size));
		expect(p.dead).toBe(1);
	}

	it("a dead player stays dead for the floor and returns at the next entrance with 1 heart; everyone refills", () => {
		const r = party(3);
		kill(r, 1);
		for (let t = 0; t < 120; t++) r.step(idle(3));
		expect(playerAt(r.s, 1).dead).toBe(1); // no mid-floor revive
		playerAt(r.s, 0).armor = 0;
		playerAt(r.s, 2).flask = 0;
		r.step(withFrame(3, 2, DEBUG_FLOOR_BUTTON)); // any player's debug skip ends the floor
		expect(r.s.endless!.floor).toBe(2);
		const w = r.setup.endlessFloor(2);
		for (let i = 0; i < 3; i++) {
			const p = playerAt(r.s, i);
			expect([p.x, p.z]).toEqual([w.spawnX, w.spawnZ]);
			expect(p.dead).toBe(0);
			expect(p.armor).toBe(p.armorMax);
			expect(p.flask).toBe(p.flaskMax);
		}
		expect(playerAt(r.s, 1).hearts).toBe(PARTY_REVIVE_HALF_HEARTS);
		expect(playerAt(r.s, 0).hearts).toBe(playerAt(r.s, 0).heartsMax);
	});

	it("the floor ends only when every LIVING player is in the stairwell", () => {
		const r = party(3);
		const w = r.setup.endlessFloor(1);
		expect(r.s.endless!.stairsOpen).toBe(1);
		place(r.s, 0, w.stairX, w.stairZ);
		place(r.s, 1, w.stairX, w.stairZ);
		r.step(idle(3));
		expect(r.s.endless!.floor).toBe(1); // player 2 is still at the entrance
		place(r.s, 0, w.spawnX, w.spawnZ);
		kill(r, 2);
		place(r.s, 0, w.stairX, w.stairZ);
		r.step(idle(3));
		expect(r.s.endless!.floor).toBe(2); // the dead player does not hold the living back
		expect(playerAt(r.s, 2).dead).toBe(0);
	});

	it("the run is over when everyone is dead at once: no floor change, no revive", () => {
		const r = party(2);
		kill(r, 0);
		expect(isPartyWiped(r.s)).toBe(false);
		kill(r, 1);
		expect(isPartyWiped(r.s)).toBe(true);
		r.step(withFrame(2, 0, DEBUG_FLOOR_BUTTON));
		expect(r.s.endless!.floor).toBe(1);
		const t = new RunTelemetry(6);
		expect(summarizeRun(r.s, t.finish()).died).toBe(true);
	});

	it("a player who left is never revived", () => {
		const r = party(2);
		r.step(withFrame(2, 1, PARTY_LEFT_BUTTON));
		expect(r.s.party!.left[1]).toBe(1);
		const left = [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT, buttons: PARTY_LEFT_BUTTON }];
		r.step([{ ...EMPTY_INPUT, buttons: DEBUG_FLOOR_BUTTON }, left[1]]);
		expect(r.s.endless!.floor).toBe(2);
		expect(playerAt(r.s, 1).dead).toBe(1);
		expect(playerAt(r.s, 0).dead).toBe(0);
	});
});

describe("party size scaling", () => {
	it("room budgets: base x the M4 multiplier, exactly; spends stay within the room cap", () => {
		const want = [1, 1.35, 1.7, 2.05, 2.25, 2.45, 2.65, 2.85];
		expect([...PARTY_BUDGET_MULTIPLIERS]).toEqual(want);
		for (let n = 1; n <= 8; n++) {
			for (const floor of [1, 4, 13]) {
				const base = ENCOUNTER_BUDGET_BASE + ENCOUNTER_BUDGET_PER_FLOOR * (floor - 1);
				expect(roomEncounterBudget(floor, "combat", n)).toBe(n === 1 ? base : base * want[n - 1]);
				const elite = base * ELITE_BUDGET_MULTIPLIER;
				expect(roomEncounterBudget(floor, "elite", n)).toBe(n === 1 ? elite : elite * want[n - 1]);
				expect(roomEncounterBudget(floor, "treasure", n)).toBe(0);
			}
		}
		const d = buildEndlessRunConfig(77, 8).endlessFloor(3).dungeon;
		const solo = endlessRoomSpawns(d, 3, 1);
		const eight = endlessRoomSpawns(d, 3, 8);
		let more = 0;
		for (let id = 0; id < solo.size(); id++) {
			expect(eight[id].size() <= ENDLESS_ROOM_ACTOR_CAP).toBe(true);
			if (eight[id].size() > solo[id].size()) more++;
		}
		expect(more > 0).toBe(true);
		// Dungeons are shared: the layout does not depend on the party.
		expect(buildEndlessRunConfig(77, 1).endlessFloor(3).dungeon).toBe(d);
	});

	it("enemy and boss hp at spawn: endless hp x the M4 multiplier, exactly", () => {
		for (const n of [2, 5, 8]) {
			const setup = buildEndlessRunConfig(1337, n);
			const s = createSimState(1337, setup.spawn!.x, setup.spawn!.z, setup.config);
			// Floor 1: walk into the first room with deferred spawns (placed there by state edit), then floors to 5.
			const w = setup.endlessFloor(1);
			let room = -1;
			for (let id = 0; id < w.roomSpawns.size() && room < 0; id++) if (w.roomSpawns[id].size() > 0) room = id;
			const sp = w.roomSpawns[room][0];
			place(s, 0, sp.x, sp.z);
			stepParty(s, idle(n), setup.config);
			let checked = 0;
			for (const a of s.combat.actors) {
				if (a.kind === NO_KIND) continue;
				const d = archetypeAt(a.kind).data;
				expect(a.hpMax).toBe(endlessActorHp(d.hp, d.boss === true, 1, 1) * PARTY_HP_MULTIPLIERS[n - 1]);
				checked++;
			}
			expect(checked > 0).toBe(true);
			for (let f = 1; f < 5; f++) {
				stepParty(s, withFrame(n, 0, DEBUG_FLOOR_BUTTON), setup.config);
				dismissDraft(s); // M2: every floor change opens the party's boon drafts (frozen world)
				stepParty(s, idle(n), setup.config);
			}
			// Floor 5's boss is the seeded pick (docs/BOSS_DEMONLORD.md D5): the Demon Lord on run 1337.
			const boss = s.combat.actors.find((a) => a.kind !== NO_KIND && archetypeAt(a.kind).data.boss === true)!;
			expect(archetypeAt(boss.kind).id).toBe(bossKindFor(floorSeed(1337, 5)));
			const bd = archetypeAt(boss.kind).data;
			expect(boss.hpMax).toBe(endlessActorHp(bd.hp, true, 5, 1) * PARTY_HP_MULTIPLIERS[n - 1]);
		}
	});

	it("solo endless worlds are unchanged by the party code (same config objects, scoring and budgets)", () => {
		const a = buildWorldSetup("endless", 99, { atBossDoor: false });
		const b = buildWorldSetup("endless", 99, { atBossDoor: false, partySize: 1 });
		expect(a.config.party).toBe(undefined);
		expect(b.config.party).toBe(undefined);
		expect(a.config.scoring).toBe(b.config.scoring);
		// The M1 worlds can host a party too (no scaling there: that is endless-only).
		expect(buildWorldSetup("greybox", 99, { atBossDoor: false, partySize: 2 }).config.party?.size).toBe(2);
		expect(() => buildWorldSetup("greybox", 99, { atBossDoor: false, partySize: 9 })).toThrow();
	});

	it("scoring: the combo cut is 1 / partySize for parties of 3+", () => {
		const setup = buildEndlessRunConfig(5, 4);
		const s = createSimState(5, setup.spawn!.x, setup.spawn!.z, setup.config);
		const sc = s.score!;
		sc.combo = 40;
		cutCombo(sc);
		expect(sc.combo).toBe(30);
		sc.combo = COMBO_MIN;
		cutCombo(sc);
		expect(sc.combo).toBe(COMBO_MIN);
	});
});

describe("a party run validates through SegmentedValidator", () => {
	const run = recordPartyRun(2024, 3);
	const N = run.recording.frames.size();
	const SEG = 360;
	const limits: SegmentLimits = { ...DEFAULT_SEGMENT_LIMITS, allowDebugInput: true, checkpointEvery: 120 };

	/** The run's segments of SEG ticks (checkpoint hashes from a replay), as the server's log would cut them. */
	function segments(rec: Recording): RunSegment[] {
		const setup = buildEndlessRunConfig(2024, 3);
		const s = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, setup.config);
		const out: RunSegment[] = [];
		let start = 0;
		let cps: string[] = [];
		const merged: InputFrame[] = [];
		for (let t = 0; t < N; t++) {
			merged.clear();
			merged.push(rec.frames[t]);
			for (const o of rec.others!) merged.push(o[t]);
			stepParty(s, merged, setup.config);
			const stop = s.tick;
			if (stop % limits.checkpointEvery === 0 && stop % SEG !== 0 && stop < N) cps.push(hashState(s));
			if (stop % SEG === 0 || stop === N) {
				const frames: InputFrame[] = [];
				const others: InputFrame[][] = rec.others!.map(() => []);
				for (let k = start; k < stop; k++) {
					frames.push(rec.frames[k]);
					for (let o = 0; o < others.size(); o++) others[o].push(rec.others![o][k]);
				}
				expect(cps.size()).toBe(checkpointCount(start, stop, limits.checkpointEvery));
				out.push({
					runId: "party-run",
					index: out.size(),
					startTick: start,
					recording: encodeRecording({ seed: rec.seed, spawn: rec.spawn, frames, others }),
					claimedEndHash: hashState(s),
					checkpointHashes: cps,
				});
				start = stop;
				cps = [];
			}
		}
		return out;
	}

	function validate(segs: RunSegment[]): { verdicts: SegmentVerdict[]; result?: SegmentedRunResult } {
		const setup = buildEndlessRunConfig(2024, 3);
		const v = new SegmentedValidator({
			runId: "party-run",
			seed: 2024,
			worldKind: "endless",
			setup,
			createdAt: 0,
			limits,
		});
		const verdicts: SegmentVerdict[] = [];
		let result: SegmentedRunResult | undefined;
		for (const seg of segs) {
			const offer = v.offer(seg, LATE);
			if (!offer.ok) {
				verdicts.push(offer.verdict);
				return { verdicts, result: v.getResult() };
			}
			for (let guard = 0; guard < 1000 && v.hasWork(); guard++) {
				const r = v.advance(500);
				for (const x of r.verdicts) verdicts.push(x);
				if (r.result !== undefined) return { verdicts, result: r.result };
			}
		}
		const score = readRunScore(run.drv.state);
		const claimed = {
			...summarizeRun(run.drv.state, telemetryOf(run.recording)),
			score: score.score,
			floor: score.floor,
		};
		result = v.finish({ runId: "party-run", finalTick: N, claimedHash: run.finalHash, claimed }, LATE);
		for (let guard = 0; guard < 1000 && result === undefined; guard++) result = v.advance(500).result;
		return { verdicts, result };
	}

	function telemetryOf(rec: Recording) {
		const setup = buildEndlessRunConfig(2024, 3);
		const s = createSimState(rec.seed, rec.spawn.x, rec.spawn.z, setup.config);
		const t = new RunTelemetry(6);
		const merged: InputFrame[] = [];
		for (let k = 0; k < N; k++) {
			merged.clear();
			merged.push(rec.frames[k]);
			for (const o of rec.others!) merged.push(o[k]);
			stepParty(s, merged, setup.config);
			t.observe(s);
		}
		return t.finish();
	}

	const segs = segments(run.recording);

	it("every segment verifies; the final hash and score are the live run's", () => {
		print(`[party 3] ${N} ticks in ${segs.size()} segments`);
		expect(segs.size() >= 3).toBe(true);
		const { verdicts, result } = validate(segs);
		for (const x of verdicts) expect([x.index, x.ok, x.reason]).toEqual([x.index, true, undefined]);
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(run.finalHash);
		expect(result?.score.score).toBe(run.drv.state.score!.total);
	});

	it("a tampered merged-log frame rejects the run at its segment", () => {
		const k = 1;
		const decoded = decodeRecording(segs[k].recording, LIMITS);
		if (!decoded.ok) error(decoded.reason);
		const others = decoded.recording.others!.map((o) => [...o]);
		// Player 2 walks the other way for 30 ticks and takes a debug hit (a lasting difference: position, hearts).
		const at = 100;
		for (let t = at; t < at + 30; t++) {
			const f = others[1][t];
			others[1][t] = { ...f, moveX: f.moveX > 0 ? -1000 : 1000, buttons: t === at ? Button.DEBUG_HIT : 0 };
		}
		const edited = [...segs];
		edited[k] = { ...segs[k], recording: encodeRecording({ ...decoded.recording, others }) };
		const { verdicts, result } = validate(edited);
		expect(result?.ok).toBe(false);
		expect(result?.code).toBe("hash_mismatch");
		expect(result?.failedSegment).toBe(k);
		expect(verdicts.filter((x) => x.ok).size()).toBe(k);
	});

	it("a segment with the wrong number of player streams is refused", () => {
		const decoded = decodeRecording(segs[0].recording, LIMITS);
		if (!decoded.ok) error(decoded.reason);
		const two = { ...decoded.recording, others: [decoded.recording.others![0]] };
		const { result } = validate([{ ...segs[0], recording: encodeRecording(two) }]);
		expect(result?.ok).toBe(false);
		expect(result?.code).toBe("malformed");
	});
});
