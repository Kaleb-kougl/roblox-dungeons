// docs/SILVER.md SV6: Armory upgrades on the session. In endless and the Daily (upgradesApply), solo and co-op, the
// server reads each member's levels at the start (StartContext.upgrades), stores them on the RunSession and builds the
// validator's setup with them; a client building its run from the start's levels (StartRunReply.upgrades /
// PartyRunStart.upgrades) builds the identical config, for every level set. The tutorial and M1's worlds ignore them;
// the dev world takes its panel's none / mine / max; an unknown wallet plays neutral and is listed; a client that lies
// about its levels fails its first segment.
import { describe, expect, it } from "@rbxts/jest-globals";
import { Button, EMPTY_INPUT, SIM_DT, createSimState, hashState, quantizeInput, type InputFrame } from "shared/sim";
import {
	NO_UPGRADES,
	UPGRADE_MAX_LEVELS,
	characterTraits,
	upgradeTraits,
	type CharacterId,
	type UpgradeLevels,
} from "shared/characters";
import { bytesOfHex } from "shared/crypto";
import { DAILY_WORLD_KIND, dailySeedFrom } from "shared/daily";
import { LiveRun } from "shared/play";
import {
	DEFAULT_DEV_RUN,
	DEFAULT_SEGMENT_LIMITS,
	DEV_UPGRADE_MODES,
	OPEN_SILVER_ACCESS,
	RunSessionRegistry,
	accessOwnsCharacter,
	accessUpgrades,
	buildWorldSetup,
	devUpgradeLevels,
	isDevUpgradesMode,
	partyUpgrades,
	runWorldKinds,
	sessionUpgrades,
	upgradesApply,
	type RunSession,
	type RunSetup,
	type SegmentedRunResult,
	type StartContext,
	type StartRunRequest,
} from "shared/run";

const OWNER = 101;
const FRIEND = 202;
const LATE = 1e9;
/** 2026-10-31T12:00:00Z. */
const OCT_31_NOON = 1793404800 + 43200;
const TEST_KEY = bytesOfHex("000102030405060708090a0b0c0d0e0f");

function registry(seeds: number[] = [1337]) {
	let picked = 0;
	let ids = 0;
	return new RunSessionRegistry({
		newRunId: () => `run-${++ids}`,
		pickSeed: () => seeds[picked++ % seeds.size()],
		dailySeed: (day) => dailySeedFrom(day, TEST_KEY),
	});
}

function ctx(levels: ReadonlyMap<number, UpgradeLevels | undefined>, over: Partial<StartContext> = {}): StartContext {
	return {
		now: 0,
		unixNow: OCT_31_NOON,
		isInServer: (id) => id === OWNER || id === FRIEND,
		allowBossDoorSpawn: false,
		allowDebugInput: false,
		upgrades: (id) => levels.get(id),
		...over,
	};
}

function started(reg: RunSessionRegistry, req: StartRunRequest, c: StartContext): RunSession {
	const r = reg.start(OWNER, req, c);
	if (!r.ok) error(`start refused: ${r.code} ${r.reason}`);
	return r.session;
}

/** Every level set of the catalogue (3 x 3 x 2). */
function everyLevelSet(): UpgradeLevels[] {
	const out: UpgradeLevels[] = [];
	for (let vigor = 0; vigor <= UPGRADE_MAX_LEVELS.vigor; vigor++)
		for (let deepFlask = 0; deepFlask <= UPGRADE_MAX_LEVELS.deepFlask; deepFlask++)
			for (let plating = 0; plating <= UPGRADE_MAX_LEVELS.plating; plating++)
				out.push({ vigor, deepFlask, plating });
	return out;
}

/** The hash of a run's first state, built from `setup` (what a client steps from tick 0). */
function firstHash(seed: number, setup: RunSetup): string {
	const spawn = setup.spawn!;
	return hashState(createSimState(seed, spawn.x, spawn.z, setup.config));
}

describe("upgradesApply (SV6)", () => {
	it("endless and the Daily apply upgrades; the tutorial, dev and M1's worlds do not", () => {
		const applying = runWorldKinds().filter((k) => upgradesApply(k));
		expect(applying).toEqual(["endless", DAILY_WORLD_KIND]);
	});

	it("partyUpgrades fills NO_UPGRADES and refuses junk", () => {
		expect(partyUpgrades(undefined, 2)).toEqual([NO_UPGRADES, NO_UPGRADES]);
		expect(partyUpgrades([{ vigor: 1, deepFlask: 0, plating: 0 }], 2)).toEqual([
			{ vigor: 1, deepFlask: 0, plating: 0 },
			NO_UPGRADES,
		]);
		const [ok] = pcall(() => partyUpgrades([{ vigor: 7, deepFlask: 0, plating: 0 }], 1));
		expect(ok).toBe(false);
	});
});

describe("client and server build the same config for every level set (SV6)", () => {
	const sets = everyLevelSet();
	for (const world of ["endless", DAILY_WORLD_KIND]) {
		it(`${world}, solo: the session's setup equals the client's from the start's levels`, () => {
			const reg = registry();
			const hashes = new Set<string>();
			for (const levels of sets) {
				for (const character of ["knight", "archer"] as const) {
					const s = started(
						reg,
						{ requestId: 1, worldKind: world, characterId: character },
						ctx(new Map([[OWNER, levels]])),
					);
					expect(s.upgrades).toEqual([levels]);
					expect(s.upgradesUnknown).toEqual([]);
					expect(s.setup.config.traits).toEqual(upgradeTraits(character, levels));
					// The client: StartRunReply.upgrades = s.upgrades[0], characterId = s.characters[0].
					const client = buildWorldSetup(world, s.seed, {
						atBossDoor: false,
						characters: [s.characters![0]],
						upgrades: [s.upgrades![0]],
					});
					expect(client.config.traits).toEqual(s.setup.config.traits);
					expect(client.upgrades).toEqual(s.upgrades);
					const h = firstHash(s.seed, s.setup);
					expect(firstHash(s.seed, client)).toBe(h);
					hashes.add(`${character}:${h}`);
				}
			}
			// Every level set is a different start (hearts / flask / armor are hashed).
			expect(hashes.size()).toBe(sets.size() * 2);
		});

		it(`${world}, party: each member's own levels, equal on every client`, () => {
			const party = { requestId: 1, worldKind: world, party: [FRIEND] };
			for (let i = 0; i < sets.size(); i++) {
				// A fresh registry each time: the last party run is unconcluded, so its members are busy.
				const reg = registry();
				const mine = sets[i];
				const theirs = sets[(i * 7 + 3) % sets.size()];
				const s = started(
					reg,
					party,
					ctx(
						new Map([
							[OWNER, mine],
							[FRIEND, theirs],
						]),
						{
							partyConsent: [OWNER, FRIEND],
							partyCharacters: ["archer", "knight"],
						},
					),
				);
				expect(s.upgrades).toEqual([mine, theirs]);
				expect(s.setup.config.party!.traits).toEqual([
					upgradeTraits("archer", mine),
					upgradeTraits("knight", theirs),
				]);
				// Every client: buildWorldSetup(kind, seed, { partySize, characters, upgrades }) from PartyRunStart.
				const client = buildWorldSetup(world, s.seed, {
					atBossDoor: false,
					partySize: 2,
					characters: [...s.characters!],
					upgrades: [...s.upgrades!],
				});
				expect(firstHash(s.seed, client)).toBe(firstHash(s.seed, s.setup));
			}
		});
	}

	it("no upgrades (or no lookup) builds exactly the config built before upgrades existed", () => {
		const noLookup: StartContext = {
			now: 0,
			unixNow: OCT_31_NOON,
			isInServer: () => true,
			allowBossDoorSpawn: false,
			allowDebugInput: false,
		};
		const s = started(registry(), { requestId: 1, worldKind: "endless" }, noLookup);
		expect([s.upgrades, s.upgradesUnknown]).toEqual([[NO_UPGRADES], []]);
		expect(s.setup.config.traits).toBe(characterTraits("knight"));
		const before = buildWorldSetup("endless", s.seed, { atBossDoor: false, characters: ["knight"] });
		expect(firstHash(s.seed, before)).toBe(firstHash(s.seed, s.setup));
	});
});

describe("worlds that ignore upgrades (SV6)", () => {
	const MAX: UpgradeLevels = UPGRADE_MAX_LEVELS;

	it("the tutorial and M1's worlds build the same config with or without upgrades", () => {
		for (const world of ["tutorial", "game", "dungeonNoEncounter", "greybox"]) {
			const plain = buildWorldSetup(world, 1337, { atBossDoor: false, characters: ["knight"] });
			const upgraded = buildWorldSetup(world, 1337, {
				atBossDoor: false,
				characters: ["knight"],
				upgrades: [MAX],
			});
			expect(upgraded.config.traits).toBe(plain.config.traits);
			expect(upgraded.upgrades).toBe(undefined);
			if (plain.spawn !== undefined) expect(firstHash(1337, upgraded)).toBe(firstHash(1337, plain));
		}
	});

	it("an M1 session never reads the wallet and carries no upgrades", () => {
		let asked = 0;
		const s = started(
			registry(),
			{ requestId: 1, worldKind: "game" },
			ctx(new Map(), {
				upgrades: () => {
					asked++;
					return MAX;
				},
			}),
		);
		expect([s.upgrades, s.upgradesUnknown.size(), asked]).toEqual([undefined, 0, 0]);
	});

	it("dev: the panel's none / mine / max (absent: none)", () => {
		expect([...DEV_UPGRADE_MODES]).toEqual(["none", "mine", "max"]);
		expect(isDevUpgradesMode("max")).toBe(true);
		expect(isDevUpgradesMode("all")).toBe(false);
		const mine: UpgradeLevels = { vigor: 1, deepFlask: 2, plating: 0 };
		expect(devUpgradeLevels(undefined, mine)).toEqual(NO_UPGRADES);
		expect(devUpgradeLevels("none", mine)).toEqual(NO_UPGRADES);
		expect(devUpgradeLevels("mine", mine)).toEqual(mine);
		expect(devUpgradeLevels("mine", undefined)).toEqual(NO_UPGRADES);
		expect(devUpgradeLevels("max", mine)).toEqual(MAX);
		const traitsFor = (upgrades: "none" | "mine" | "max" | undefined) =>
			buildWorldSetup("dev", 9, {
				atBossDoor: false,
				dev: { ...DEFAULT_DEV_RUN, upgrades },
				characters: ["archer"],
				upgrades: [mine],
			}).config.traits;
		expect(traitsFor(undefined)).toBe(characterTraits("archer"));
		expect(traitsFor("none")).toBe(characterTraits("archer"));
		expect(traitsFor("mine")).toEqual(upgradeTraits("archer", mine));
		expect(traitsFor("max")).toEqual(upgradeTraits("archer", MAX));
	});
});

describe("unknown wallets (SV6)", () => {
	it("a member whose wallet is unknown (or answers junk) plays with no upgrades and is listed", () => {
		const s = started(
			registry(),
			{ requestId: 1, worldKind: "endless", party: [FRIEND] },
			ctx(new Map([[OWNER, undefined]]), {
				partyConsent: [OWNER, FRIEND],
				upgrades: (id) =>
					id === OWNER ? undefined : ({ vigor: 9, deepFlask: 0, plating: 0 } as unknown as UpgradeLevels),
			}),
		);
		expect(s.upgrades).toEqual([NO_UPGRADES, NO_UPGRADES]);
		expect(s.upgradesUnknown).toEqual([OWNER, FRIEND]);
		expect(sessionUpgrades([1, 2], undefined)).toEqual({ levels: [NO_UPGRADES, NO_UPGRADES], unknown: [] });
	});

	it("the access guards: errors and junk read as unknown; the Knight is always owned", () => {
		expect(accessUpgrades(OPEN_SILVER_ACCESS, OWNER)).toEqual(NO_UPGRADES);
		expect(accessOwnsCharacter(OPEN_SILVER_ACCESS, OWNER, "archer")).toBe(true);
		const broken = {
			upgradesFor: (): UpgradeLevels | undefined => error("datastore down"),
			ownsCharacter: (): boolean => error("datastore down"),
		};
		expect(accessUpgrades(broken, OWNER)).toBe(undefined);
		expect(accessOwnsCharacter(broken, OWNER, "archer")).toBe(false);
		expect(accessOwnsCharacter(broken, OWNER, "knight")).toBe(true);
		const junk = {
			upgradesFor: () => ({ vigor: "2" } as unknown as UpgradeLevels),
			ownsCharacter: () => "yes" as unknown as boolean,
		};
		expect(accessUpgrades(junk, OWNER)).toBe(undefined);
		expect(accessOwnsCharacter(junk, OWNER, "archer")).toBe(false);
	});
});

describe("a client that lies about its levels fails its first segment (SV6)", () => {
	const TICKS = DEFAULT_SEGMENT_LIMITS.checkpointEvery * 2 + 37;
	function botInput(t: number, out: InputFrame): InputFrame {
		const a = t * 0.015;
		const roll = t % 45 === 0 ? Button.ROLL : 0;
		return quantizeInput(math.cos(a), math.sin(a), math.cos(a), math.sin(a), roll, out);
	}
	function drain(s: RunSession): SegmentedRunResult | undefined {
		let result = s.validator.getResult();
		while (s.validator.hasWork()) result = s.validator.advance(97).result ?? result;
		return result;
	}
	/** A solo ranked run built as `character` with `levels`, offered to `session` and drained. */
	function soloRun(
		session: RunSession,
		character: CharacterId,
		levels: UpgradeLevels,
	): SegmentedRunResult | undefined {
		const setup = buildWorldSetup("endless", session.seed, {
			atBossDoor: false,
			characters: [character],
			upgrades: [levels],
		});
		const run = new LiveRun({
			seed: session.seed,
			spawnX: setup.spawn!.x,
			spawnZ: setup.spawn!.z,
			config: setup.config,
			atBossDoor: false,
			runId: session.runId,
			segmentCutAfterTick: (state) => state.events.floorChanged !== 0,
		});
		const input: InputFrame = { ...EMPTY_INPUT };
		for (let t = 0; t < TICKS; t++) run.frame(SIM_DT, botInput(t, input));
		const final = run.final()!;
		for (const seg of run.takeSegments()) session.validator.offer(seg, LATE);
		session.validator.finish(final, LATE);
		return drain(session);
	}

	it("the honest client's run is accepted; one claiming more (or fewer) levels is a hash mismatch in segment 0", () => {
		const owned: UpgradeLevels = { vigor: 1, deepFlask: 1, plating: 0 };
		const reg = registry();
		const at = ctx(new Map([[OWNER, owned]]));
		const honest = soloRun(started(reg, { requestId: 1, worldKind: "endless" }, at), "knight", owned);
		expect([honest?.ok, honest?.reason]).toEqual([true, undefined]);
		for (const lie of [UPGRADE_MAX_LEVELS, NO_UPGRADES, { vigor: 1, deepFlask: 1, plating: 1 }]) {
			const r = soloRun(started(reg, { requestId: 1, worldKind: "endless" }, at), "knight", lie);
			expect([r?.ok, r?.code, r?.failedSegment]).toEqual([false, "hash_mismatch", 0]);
		}
	});
});
