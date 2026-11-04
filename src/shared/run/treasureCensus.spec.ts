// Treasure census (docs/TREASURE.md TR5): the endless bot (shared/run/testing Driver.openVault) plays floors 1-FLOORS
// of SEEDS run seeds in the game's endless world (buildEndlessRunConfig: vaults and SimConfig.treasure on), and on
// every floor with a vault detours into the vault room, fights it with the sword and walks onto the unlocked chest.
// Floors end by the debug skip, the draft answered like a player (the centre card). It logs per floor band the vaults
// seen and opened, the kept share per lock and the mean tier opened (and started). A log with sanity bounds, not a
// tuning tool (TR11 tunes in play). Test-only shortcut (the census only, no replay path): hearts topped up every tick.
//
// Then an HONEST run (no state surgery: a flask when hurt, recorded frames, drafts picked with the stick and a FIRE
// press) of the first seed whose floor 2 holds a vault the bot opens: floor 1 walked to its stairwell, then floor 2's
// vault room fought and the chest opened, then floor 2's stairwell walked so the next draft deals any bonus round. The recording
// replays to the live hash and validates through the server's SegmentedValidator segment by segment.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultLock, VaultTier } from "shared/dungeon";
import {
	ENDLESS_TREASURE_CONFIG,
	SIM_DT,
	ScoreSource,
	VaultStatus,
	hashState,
	runReplay,
	treasureRunSummary,
	type SimState,
} from "shared/sim";
import { LiveRun, RANKED_WORLD_KIND } from "shared/play";
import {
	DEFAULT_SEGMENT_LIMITS,
	SegmentedValidator,
	buildEndlessRunConfig,
	buildWorldSetup,
	type RunSegment,
	type SegmentVerdict,
	type SegmentedRunResult,
} from "shared/run";
import { Driver, type VaultVisit } from "shared/run/testing";

const SEEDS = 12;
const FLOORS = 12;
/** Floor bands of VAULT.chanceByBand (from floors 2 / 5 / 10). */
const BANDS: ReadonlyArray<readonly [number, number]> = [
	[2, 4],
	[5, 9],
	[10, FLOORS],
];

function pct(a: number, b: number): string {
	return b > 0 ? string.format("%.1f%%", (100 * a) / b) : "-";
}

function mean(list: ReadonlyArray<number>): string {
	if (list.size() === 0) return "-";
	let n = 0;
	for (const v of list) n += v;
	return string.format("%.2f", n / list.size());
}

interface Band {
	floors: number;
	visits: VaultVisit[];
}

function describeVisits(label: string, floors: number, visits: ReadonlyArray<VaultVisit>): string {
	const opened = visits.filter((v) => v.opened);
	const lockLine = (lock: number, name: string): string => {
		const all = visits.filter((v) => v.lock === lock && v.cleared);
		const kept = all.filter((v) => v.kept).size();
		return `${name} kept ${kept}/${all.size()} (${pct(kept, all.size())})`;
	};
	const swift = visits.filter((v) => v.lock === VaultLock.SWIFT && v.clearTicks >= 0 && v.parTicks > 0);
	return (
		`${label}: ${floors} floors, ${visits.size()} vaults seen (${pct(visits.size(), floors)}), ` +
		`${opened.size()} opened (${pct(opened.size(), visits.size())}), ` +
		`${visits.filter((v) => v.cleared).size()} cleared; ${lockLine(VaultLock.UNTOUCHED, "UNTOUCHED")}, ` +
		`${lockLine(VaultLock.SWIFT, "SWIFT")}; mean tier opened ${mean(opened.map((v) => v.tier))} ` +
		`(started ${mean(opened.map((v) => v.startTier))}; 0 Common, 1 Rare, 2 Legendary), Legendary opened ` +
		`${opened.filter((v) => v.tier === VaultTier.LEGENDARY).size()}; SWIFT clear / par ${mean(
			swift.map((v) => v.clearTicks / v.parTicks),
		)}`
	);
}

describe("treasure census (endless, ENDLESS_TREASURE_CONFIG)", () => {
	it(`run seeds 1-${SEEDS}, floors 1-${FLOORS}: the bot detours into every vault, fights and opens (spec log)`, () => {
		const bands: Band[] = BANDS.map(() => ({ floors: 0, visits: [] }));
		const all: VaultVisit[] = [];
		let floors = 0;
		for (let seed = 1; seed <= SEEDS; seed++) {
			const setup = buildEndlessRunConfig(seed);
			expect(setup.config.treasure).toBe(ENDLESS_TREASURE_CONFIG);
			const drv = new Driver(setup, seed, true);
			const s: SimState = drv.state;
			let openedHere = 0;
			while (drv.floor() <= FLOORS) {
				const floor = drv.floor();
				const band = BANDS.findIndex(([a, b]) => floor >= a && floor <= b);
				if (band >= 0) bands[band].floors++;
				if (floor >= BANDS[0][0]) floors++;
				const v = drv.openVault();
				if (v !== undefined) {
					expect(floor >= BANDS[0][0]).toBe(true);
					all.push(v);
					if (band >= 0) bands[band].visits.push(v);
					print(
						`[treasure census] seed ${seed} floor ${floor}: lock ${v.lock} tier ${v.startTier} -> ${v.tier}, ` +
							`engaged ${v.engaged} cleared ${v.cleared} opened ${v.opened} kept ${v.kept} clear ${v.clearTicks} / par ${v.parTicks}`,
					);
					if (v.opened) {
						expect(s.treasure!.status).toBe(VaultStatus.OPENED);
						openedHere++;
					}
				}
				drv.skipFloor();
				expect(drv.floor()).toBe(floor + 1);
			}
			expect(treasureRunSummary(s).opened).toBe(openedHere);
		}
		for (let b = 0; b < BANDS.size(); b++)
			print(
				`[treasure census] ${describeVisits(
					`floors ${BANDS[b][0]}-${BANDS[b][1]}`,
					bands[b].floors,
					bands[b].visits,
				)}`,
			);
		print(`[treasure census] ${describeVisits(`total floors ${BANDS[0][0]}-${FLOORS}`, floors, all)}`);
		// Sanity: vaults on roughly 1 floor in 2; the bot opens most of them; UNTOUCHED is kept sometimes and missed
		// sometimes, SWIFT kept at least sometimes (at 100 % par this bot keeps nearly every one: TR11 tunes it); Common
		// only from a crack.
		expect(all.size() / floors > 0.3 && all.size() / floors < 0.7).toBe(true);
		const opened = all.filter((v) => v.opened);
		expect(opened.size() / all.size() >= 0.6).toBe(true);
		for (const lock of [VaultLock.UNTOUCHED, VaultLock.SWIFT]) {
			const done = all.filter((v) => v.lock === lock && v.cleared);
			expect(done.some((v) => v.kept)).toBe(true);
			if (lock === VaultLock.UNTOUCHED) expect(done.some((v) => !v.kept)).toBe(true);
		}
		for (const v of opened) if (v.tier === VaultTier.COMMON) expect(v.kept).toBe(false);
	});
});

// ---------------------------------------------------------------------------------------------
// An honest run that opens a chest: replay and segmented validation

const HONEST_SEGMENT_TICKS = 1200;
const HONEST_SEEDS = 40;
const FLOOR1_WALK_TICKS = 4000;

interface Honest {
	readonly seed: number;
	readonly drv: Driver;
	readonly visit: VaultVisit;
}

/** The first run seed whose floor 2 holds a vault that an honest bot (floor 1 walked) opens. */
function honestRun(): Honest {
	for (let seed = 1; seed <= HONEST_SEEDS; seed++) {
		const setup = buildEndlessRunConfig(seed);
		if (setup.endlessFloor(2).vault === undefined) continue;
		const drv = new Driver(setup, seed);
		const w1 = drv.world();
		drv.walkTo(w1.stairX, w1.stairZ, () => false, FLOOR1_WALK_TICKS);
		drv.resolveDraft();
		if (drv.floor() !== 2 || drv.state.player.dead !== 0) continue;
		const visit = drv.openVault();
		if (visit === undefined || !visit.opened || drv.state.player.dead !== 0) continue;
		// Then the stairwell on foot (ranked runs refuse the debug skip) and the draft (any bonus round a Legendary gave).
		const w2 = drv.world();
		drv.walkTo(w2.stairX, w2.stairZ, () => false, FLOOR1_WALK_TICKS);
		drv.resolveDraft();
		if (drv.floor() !== 3 || drv.state.player.dead !== 0) continue;
		return { seed, drv, visit };
	}
	error(`no run seed in 1-${HONEST_SEEDS} gave an honest open on floor 2 and reached floor 3`, 0);
}

function drain(v: SegmentedValidator): { verdicts: SegmentVerdict[]; result?: SegmentedRunResult } {
	const verdicts: SegmentVerdict[] = [];
	let result: SegmentedRunResult | undefined = v.getResult();
	while (v.hasWork()) {
		const r = v.advance(500);
		for (const x of r.verdicts) verdicts.push(x);
		result = r.result ?? result;
	}
	return { verdicts, result: result ?? v.getResult() };
}

describe("an endless run that opens a chest replays and validates segmented", () => {
	const { seed, drv, visit } = honestRun();
	const recording = drv.recorder.getRecording();
	const finalHash = hashState(drv.state);
	const sc = drv.state.score!;
	print(
		`[treasure census] honest seed ${seed}: lock ${visit.lock} tier ${visit.startTier} -> ${visit.tier}, kept ${
			visit.kept
		}, floor ${drv.floor()}, opened ${drv.state.treasure!.opened}, treasure points ${
			sc.points[ScoreSource.TREASURE]
		}, ${drv.state.tick} ticks`,
	);

	it("the run opened floor 2's chest and moved on to floor 3", () => {
		expect([visit.floor, visit.opened, drv.floor()]).toEqual([2, true, 3]);
		expect(treasureRunSummary(drv.state).opened).toBe(1);
	});

	it("replays to the live hash", () => {
		expect(hashState(runReplay(recording, buildEndlessRunConfig(seed).config))).toBe(finalHash);
	});

	it("a ranked LiveRun cutting segments every HONEST_SEGMENT_TICKS validates segment by segment, same hash", () => {
		const world = buildWorldSetup(RANKED_WORLD_KIND, seed, { atBossDoor: false });
		const run = new LiveRun({
			seed,
			spawnX: world.spawn!.x,
			spawnZ: world.spawn!.z,
			config: world.config,
			atBossDoor: false,
			runId: "treasure-run",
			segmentCutAfterTick: (s) => s.tick % HONEST_SEGMENT_TICKS === 0,
		});
		const v = new SegmentedValidator({
			runId: "treasure-run",
			seed,
			worldKind: RANKED_WORLD_KIND,
			setup: buildWorldSetup(RANKED_WORLD_KIND, seed, { atBossDoor: false }),
			createdAt: 0,
			limits: DEFAULT_SEGMENT_LIMITS,
		});
		const sent: RunSegment[] = [];
		const verdicts: SegmentVerdict[] = [];
		const late = 1e9;
		const pump = () => {
			for (const seg of run.takeSegments()) {
				sent.push(seg);
				const o = v.offer(seg, late);
				if (!o.ok)
					print(
						`[treasure census] segment ${sent.size() - 1} refused: ${o.verdict.code} ${
							o.verdict.reason ?? ""
						}`,
					);
				expect(o.ok).toBe(true);
			}
			for (const x of drain(v).verdicts) {
				verdicts.push(x);
				if (!x.ok) print(`[treasure census] segment ${x.index} rejected: ${x.code} ${x.reason ?? ""}`);
				if (x.ok) run.releaseVerifiedFrames(x.endTick);
			}
		};
		for (const f of recording.frames) {
			run.frame(SIM_DT, f);
			pump();
		}
		expect(hashState(run.state)).toBe(finalHash);
		const final = run.final()!;
		pump();
		const result = v.finish(final, late) ?? drain(v).result;
		expect(sent.size() > 1).toBe(true);
		for (const x of verdicts) expect([x.index, x.ok, x.code]).toEqual([x.index, true, undefined]);
		expect(result?.reason).toBe(undefined);
		expect(result?.ok).toBe(true);
		expect(result?.serverHash).toBe(finalHash);
		expect(result?.score?.score).toBe(sc.total);
	});
});
