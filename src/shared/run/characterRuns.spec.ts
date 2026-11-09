// docs/ARCHER.md AR4: characters in run configs. The world registry's endless / daily / dev builders give every player
// their character's loadout and roll traits (solo SimConfig.loadout / traits, co-op party.loadouts / traits; the Knight
// for a missing pick), the tutorial is always the Knight, the M1 worlds ignore characters (both weapons, no traits:
// golden runs unchanged), the dev world's "Both weapons" keeps the character's traits, RunSetup.characters echoes the
// picks, and a run replayed from a fresh setup hashes the same every tick for a Knight, an Archer and a mixed party.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOW_WEAPON_ID,
	Button,
	DEFAULT_LOADOUT,
	EMPTY_INPUT,
	NEUTRAL_TRAITS,
	NO_WEAPON,
	SWORD_WEAPON_ID,
	createSimState,
	hashState,
	runReplay,
	step,
	stepParty,
	weaponIndex,
	weaponsAt,
	type InputFrame,
	type Recording,
	type SimState,
} from "shared/sim";
import { characterLoadout, characterOfWeapons, characterTraits, type CharacterId } from "shared/characters";
import { DAILY_WORLD_KIND } from "shared/daily";
import {
	DEV_WORLD_KIND,
	ENDLESS_WORLD_KIND,
	TUTORIAL_CHARACTER,
	TUTORIAL_WORLD_KIND,
	buildEndlessRunConfig,
	buildRunConfig,
	buildWorldSetup,
	partyCharacters,
	withCharacters,
	type RunSetup,
	type WorldBuildOptions,
} from "shared/run";

const SEED = 4242;

function setupOf(kind: string, o: Partial<WorldBuildOptions> = {}): RunSetup {
	return buildWorldSetup(kind, SEED, { atBossDoor: false, ...o });
}

function stateOf(setup: RunSetup): SimState {
	const sp = setup.spawn ?? { x: 0, z: 0 };
	return createSimState(SEED, sp.x, sp.z, setup.config);
}

/** Player i's weapon ids, set order ("" = empty). */
function weaponIdsOf(s: SimState, i: number): string[] {
	const out: string[] = [];
	for (const set of weaponsAt(s, i).sets) out.push(set.weapon !== NO_WEAPON ? tostring(set.weapon) : "");
	return out;
}

function idsOf(loadout: ReadonlyArray<string | undefined>): string[] {
	const out: string[] = [];
	for (let k = 0; k < 2; k++) {
		const id = loadout[k];
		out.push(id !== undefined && id !== "" ? tostring(weaponIndex(id)) : "");
	}
	return out;
}

describe("run configs: characters per world (AR4)", () => {
	for (const kind of [ENDLESS_WORLD_KIND, DAILY_WORLD_KIND, DEV_WORLD_KIND]) {
		it(`${kind} solo: each character's loadout and traits on SimConfig; no pick is the Knight`, () => {
			for (const id of ["knight", "archer"] as const) {
				const setup = setupOf(kind, { characters: [id] });
				expect(setup.config.loadout).toEqual(characterLoadout(id));
				expect(setup.config.traits).toEqual(characterTraits(id));
				expect(setup.config.party).toBe(undefined);
				expect(setup.characters).toEqual([id]);
				const s = stateOf(setup);
				expect(characterOfWeapons(weaponsAt(s, 0))).toBe(id);
			}
			const none = setupOf(kind);
			expect([none.config.loadout, none.config.traits, none.characters]).toEqual([
				characterLoadout("knight"),
				NEUTRAL_TRAITS,
				["knight"],
			]);
		});
	}

	for (const kind of [ENDLESS_WORLD_KIND, DAILY_WORLD_KIND]) {
		it(`${kind} co-op: party.loadouts / traits per player, index order; a missing pick is the Knight`, () => {
			const setup = setupOf(kind, { partySize: 3, characters: ["archer", "knight"] });
			const party = setup.config.party!;
			expect(party.size).toBe(3);
			expect(party.loadouts).toEqual([
				characterLoadout("archer"),
				characterLoadout("knight"),
				characterLoadout("knight"),
			]);
			expect(party.traits).toEqual([
				characterTraits("archer"),
				characterTraits("knight"),
				characterTraits("knight"),
			]);
			expect([setup.config.loadout, setup.config.traits]).toEqual([undefined, undefined]);
			expect(setup.characters).toEqual(["archer", "knight", "knight"]);
			const s = stateOf(setup);
			expect([0, 1, 2].map((i) => characterOfWeapons(weaponsAt(s, i)))).toEqual(["archer", "knight", "knight"]);
		});
	}

	it("dev: Both weapons is DEFAULT_LOADOUT with the picked character's traits", () => {
		const dev = { startFloor: 1, invulnerable: false, bothWeapons: true };
		const setup = setupOf(DEV_WORLD_KIND, { dev, characters: ["archer"] });
		expect([setup.config.loadout, setup.config.traits, setup.characters]).toEqual([
			DEFAULT_LOADOUT,
			characterTraits("archer"),
			["archer"],
		]);
		expect(weaponIdsOf(stateOf(setup), 0)).toEqual(idsOf(DEFAULT_LOADOUT));
		const off = setupOf(DEV_WORLD_KIND, { dev: { ...dev, bothWeapons: false }, characters: ["archer"] });
		expect(off.config.loadout).toEqual(characterLoadout("archer"));
	});

	it("tutorial: the Knight whatever is passed", () => {
		for (const characters of [undefined, ["archer"] as CharacterId[], ["knight"] as CharacterId[]]) {
			const setup = setupOf(TUTORIAL_WORLD_KIND, { characters });
			expect([setup.config.loadout, setup.config.traits, setup.characters]).toEqual([
				characterLoadout(TUTORIAL_CHARACTER),
				characterTraits(TUTORIAL_CHARACTER),
				[TUTORIAL_CHARACTER],
			]);
		}
		expect(TUTORIAL_CHARACTER).toBe("knight");
	});

	it("game / dungeonNoEncounter / greybox ignore characters: both weapons, no traits, the same state hash", () => {
		for (const kind of ["game", "dungeonNoEncounter", "greybox"]) {
			for (const partySize of [1, 2]) {
				const plain = setupOf(kind, { partySize });
				const picked = setupOf(kind, { partySize, characters: ["archer", "archer"] });
				expect([kind, picked.config.loadout, picked.config.traits, picked.characters]).toEqual([
					kind,
					undefined,
					undefined,
					undefined,
				]);
				expect(picked.config.party?.loadouts).toBe(undefined);
				expect(picked.config.party?.traits).toBe(undefined);
				expect(hashState(stateOf(picked))).toBe(hashState(stateOf(plain)));
				expect(weaponIdsOf(stateOf(picked), 0)).toEqual(idsOf(DEFAULT_LOADOUT));
			}
		}
	});

	it("tools: buildEndlessRunConfig / buildRunConfig('endless') without characters keep both weapons, no traits", () => {
		for (const setup of [
			buildEndlessRunConfig(SEED),
			buildEndlessRunConfig(SEED, 2),
			buildRunConfig(SEED, { world: "endless" }),
		]) {
			expect([setup.config.loadout, setup.config.traits, setup.characters]).toEqual([
				undefined,
				undefined,
				undefined,
			]);
			expect(setup.config.party?.loadouts).toBe(undefined);
			expect(weaponIdsOf(stateOf(setup), 0)).toEqual(idsOf(DEFAULT_LOADOUT));
		}
		const viaLegacy = buildRunConfig(SEED, { world: "endless", characters: ["archer"] });
		expect(viaLegacy.config.loadout).toEqual(characterLoadout("archer"));
		// The M1 world of buildRunConfig ignores them.
		expect(buildRunConfig(SEED, { world: "game", characters: ["archer"] }).config.loadout).toBe(undefined);
	});

	it("partyCharacters / withCharacters: defaults filled, extra entries ignored, an unknown id throws", () => {
		expect(partyCharacters(undefined, 2)).toEqual(["knight", "knight"]);
		expect(partyCharacters(["archer", "archer", "archer"], 2)).toEqual(["archer", "archer"]);
		expect(partyCharacters([], 1)).toEqual(["knight"]);
		expect(pcall(() => partyCharacters(["wizard" as CharacterId], 1))[0]).toBe(false);
		expect(pcall(() => setupOf(ENDLESS_WORLD_KIND, { characters: ["wizard" as CharacterId] }))[0]).toBe(false);
		const solo = withCharacters({}, ["archer"]);
		expect([solo.loadout, solo.traits]).toEqual([[BOW_WEAPON_ID], characterTraits("archer")]);
		const both = withCharacters({}, ["knight"], { bothWeapons: true });
		expect([both.loadout, both.traits]).toEqual([DEFAULT_LOADOUT, NEUTRAL_TRAITS]);
		expect(withCharacters({ party: { size: 1 } }, ["knight"]).loadout).toEqual([SWORD_WEAPON_ID]);
	});
});

// ---------------------------------------------------------------------------------------------
// Determinism: a scripted run (walk, aim, fire, alt, rolls, swaps) replayed from a fresh setup.

const TICKS = 360;

function scripted(t: number, player: number): InputFrame {
	const phase = (t + player * 17) % 120;
	let buttons = 0;
	if (phase % 40 === 0) buttons = bit32.bor(buttons, Button.ROLL);
	if (phase % 50 === 7) buttons = bit32.bor(buttons, Button.SWAP);
	if (phase % 3 !== 0) buttons = bit32.bor(buttons, Button.FIRE);
	if (phase > 90 && phase < 100) buttons = bit32.bor(buttons, Button.ALT);
	const mx = phase < 60 ? 1000 : -700;
	const mz = phase < 30 || phase > 90 ? 600 : -800;
	return { ...EMPTY_INPUT, moveX: mx, moveZ: mz, aimX: -mz, aimZ: mx, buttons };
}

function liveAndReplay(characters: CharacterId[]): [SimState, string[]] {
	const n = characters.size();
	const setup = setupOf(ENDLESS_WORLD_KIND, { partySize: n, characters });
	const s = stateOf(setup);
	const hashes: string[] = [];
	const frames: InputFrame[][] = [];
	for (let i = 0; i < n; i++) frames.push([]);
	for (let t = 0; t < TICKS; t++) {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < n; i++) {
			inputs.push(scripted(t, i));
			frames[i].push(inputs[i]);
		}
		if (n === 1) step(s, inputs[0], setup.config);
		else stepParty(s, inputs, setup.config);
		hashes.push(hashState(s));
	}
	// The replay: a fresh setup, the same frames, compared every tick.
	const fresh = setupOf(ENDLESS_WORLD_KIND, { partySize: n, characters });
	const r = stateOf(fresh);
	for (let t = 0; t < TICKS; t++) {
		const inputs: InputFrame[] = [];
		for (let i = 0; i < n; i++) inputs.push(frames[i][t]);
		if (n === 1) step(r, inputs[0], fresh.config);
		else stepParty(r, inputs, fresh.config);
		expect([t, hashState(r)]).toEqual([t, hashes[t]]);
	}
	const rec: Recording = {
		seed: SEED,
		spawn: fresh.spawn!,
		frames: frames[0],
		others: n > 1 ? frames.filter((_f, i) => i > 0) : undefined,
	};
	expect(hashState(runReplay(rec, setupOf(ENDLESS_WORLD_KIND, { partySize: n, characters }).config))).toBe(
		hashes[TICKS - 1],
	);
	return [s, hashes];
}

describe("run configs: a run replayed from its setup hashes the same every tick (AR4)", () => {
	it("a Knight, an Archer (they differ), and a mixed party of three", () => {
		const [knight, kh] = liveAndReplay(["knight"]);
		const [archer, ah] = liveAndReplay(["archer"]);
		expect(kh[TICKS - 1]).never.toBe(ah[TICKS - 1]);
		expect(knight.player.x).never.toBe(archer.player.x);
		const [party] = liveAndReplay(["archer", "knight", "archer"]);
		expect([0, 1, 2].map((i) => characterOfWeapons(weaponsAt(party, i)))).toEqual(["archer", "knight", "archer"]);
	});
});
