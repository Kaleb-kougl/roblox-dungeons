// Developer mode (docs/DEV_MODE.md): the `dev` world (shared/run dev.ts) on top of the sim's opt-in start floor
// (EndlessConfig.startFloor / startDepth) and god mode (SimConfig.dev, shared/sim dev/dev.ts, the appended `dev` hash
// group), and the server-side access rule (shared/devmode).
import { describe, expect, it } from "@rbxts/jest-globals";
import { DEV_MODE } from "shared/config";
import { devModeAllowed, type DevAccessPolicy } from "shared/devmode";
import { BOSS_FLOOR_EVERY, ENDLESS_FIRST_FLOOR, floorSeed, isBossFloor } from "shared/dungeon";
import { LEADERBOARD_ELIGIBLE_WORLDS } from "shared/leaderboard";
import { unsubmittedReason } from "shared/play";
import {
	DEFAULT_DEV_RUN,
	DEV_WORLD_KIND,
	SERVER_REFUSED_WORLDS,
	buildDevRunConfig,
	buildEndlessRunConfig,
	buildWorldSetup,
	clampDevFloor,
	devStartDepth,
	isRunWorldKind,
	isServerRunWorld,
} from "shared/run";
import {
	ALL_BUTTONS,
	AFFIXES_SUBSYSTEM,
	Button,
	DEV_GOD_BUTTON,
	DEV_SUBSYSTEM,
	EMPTY_INPUT,
	ENDLESS_FIRST_DEPTH,
	PORT_BUTTONS,
	SIM_BUTTONS,
	createSimState,
	damagePlayer,
	hashLayout,
	hashState,
	step,
	writeHashFields,
	type InputFrame,
	type SimState,
} from "shared/sim";

const SEED = 1337;

function devState(startFloor: number, invulnerable: boolean): SimState {
	const setup = buildDevRunConfig(SEED, { startFloor, invulnerable });
	const spawn = setup.spawn ?? { x: 0, z: 0 };
	return createSimState(SEED, spawn.x, spawn.z, setup.config);
}

function withButtons(buttons: number): InputFrame {
	return { ...EMPTY_INPUT, buttons };
}

/** Steps `state` once with `buttons` held, then once with nothing (one press edge). */
function press(state: SimState, buttons: number): void {
	const config = buildDevRunConfig(SEED, DEFAULT_DEV_RUN).config;
	step(state, withButtons(buttons), config);
	step(state, EMPTY_INPUT, config);
}

describe("dev world", () => {
	it("starts on the chosen floor of the endless run on the same seed, at the Depth of every earlier boss killed", () => {
		const floor = BOSS_FLOOR_EVERY + 2;
		const setup = buildDevRunConfig(SEED, { startFloor: floor, invulnerable: false });
		const endless = buildEndlessRunConfig(SEED);
		const world = endless.endlessFloor(floor);
		expect(setup.spawn).toEqual({ x: world.spawnX, z: world.spawnZ });
		expect(setup.dungeon?.name).toBe(world.dungeon.name);
		expect(setup.endlessFloor?.(floor).layout.seed).toBe(floorSeed(SEED, floor));
		const state = devState(floor, false);
		expect(state.endless?.floor).toBe(floor);
		expect(state.endless?.depth).toBe(ENDLESS_FIRST_DEPTH + 1);
		expect(state.endless?.stairsOpen).toBe(isBossFloor(floor) ? 0 : 1);
		expect(state.player.x).toBe(world.spawnX);
		expect(state.run).never.toBe(undefined); // boons / relics / curses as on any endless floor (none taken yet)
		expect(state.score).never.toBe(undefined);
	});

	it("starts a boss floor with its stairwell closed", () => {
		const state = devState(BOSS_FLOOR_EVERY, true);
		expect(state.endless?.floor).toBe(BOSS_FLOOR_EVERY);
		expect(state.endless?.stairsOpen).toBe(0);
		expect(state.endless?.depth).toBe(ENDLESS_FIRST_DEPTH);
	});

	it("floor 1 is the endless run's floor 1 (same world, same spawn)", () => {
		const setup = buildDevRunConfig(SEED, { startFloor: ENDLESS_FIRST_FLOOR, invulnerable: false });
		expect(setup.spawn).toEqual(buildEndlessRunConfig(SEED).spawn);
		expect(devState(ENDLESS_FIRST_FLOOR, false).endless?.floor).toBe(ENDLESS_FIRST_FLOOR);
	});

	it("Depth = 1 + boss floors below the start floor", () => {
		expect(devStartDepth(1)).toBe(1);
		expect(devStartDepth(BOSS_FLOOR_EVERY)).toBe(1);
		expect(devStartDepth(BOSS_FLOOR_EVERY + 1)).toBe(2);
		expect(devStartDepth(2 * BOSS_FLOOR_EVERY + 1)).toBe(3);
	});

	it("clamps the floor to the panel's range", () => {
		expect(clampDevFloor(0)).toBe(DEV_MODE.minFloor);
		expect(clampDevFloor(-3)).toBe(DEV_MODE.minFloor);
		expect(clampDevFloor(DEV_MODE.maxFloor + 10)).toBe(DEV_MODE.maxFloor);
		expect(clampDevFloor(7.9)).toBe(7);
		expect(clampDevFloor(0 / 0)).toBe(DEV_MODE.minFloor);
		expect(buildDevRunConfig(SEED, { startFloor: 0, invulnerable: false }).config.endless?.startFloor).toBe(
			DEV_MODE.minFloor,
		);
	});

	it("is registered for the client, refused by the server, never on a leaderboard, solo only", () => {
		expect(isRunWorldKind(DEV_WORLD_KIND)).toBe(true);
		expect(SERVER_REFUSED_WORLDS.has(DEV_WORLD_KIND)).toBe(true);
		expect(isServerRunWorld(DEV_WORLD_KIND)).toBe(false);
		expect(LEADERBOARD_ELIGIBLE_WORLDS.includes(DEV_WORLD_KIND)).toBe(false);
		expect(() => buildWorldSetup(DEV_WORLD_KIND, SEED, { atBossDoor: false, partySize: 2 })).toThrow("solo only");
		const viaRegistry = buildWorldSetup(DEV_WORLD_KIND, SEED, {
			atBossDoor: false,
			dev: { startFloor: 3, invulnerable: true },
		});
		expect(viaRegistry.config.endless?.startFloor).toBe(3);
		expect(viaRegistry.config.dev?.invulnerable).toBe(true);
		// No options: DEV_MODE's defaults.
		expect(buildWorldSetup(DEV_WORLD_KIND, SEED, { atBossDoor: false }).config.endless?.startFloor).toBe(
			clampDevFloor(DEV_MODE.defaultFloor),
		);
		// A dev run is never submitted.
		expect(unsubmittedReason({ tutorial: false, dev: true, stress: 0, scoring: false })).toBe("dev");
	});

	it("leaves the endless world and every other config untouched (no start floor, no dev state)", () => {
		const endless = buildEndlessRunConfig(SEED);
		expect(endless.config.endless?.startFloor).toBe(undefined);
		expect(endless.config.dev).toBe(undefined);
		const spawn = endless.spawn ?? { x: 0, z: 0 };
		const state = createSimState(SEED, spawn.x, spawn.z, endless.config);
		expect(state.dev).toBe(undefined);
		expect(state.endless?.floor).toBe(ENDLESS_FIRST_FLOOR);
		const names = hashLayout(state).groups.map((g) => g.name);
		expect(names.includes(DEV_SUBSYSTEM)).toBe(false);
	});
});

describe("god mode", () => {
	it("blocks every hit while on: no armor, hearts, hit event or i-frames; counted in dev.blockedHits", () => {
		const state = devState(2, true);
		const p = state.player;
		const before = { hearts: p.hearts, armor: p.armor };
		expect(damagePlayer(state, 2)).toBe(false);
		expect(damagePlayer(state, 99)).toBe(false);
		expect({ hearts: p.hearts, armor: p.armor }).toEqual(before);
		expect(p.hurtTicks).toBe(0);
		expect(state.events.playerHits).toBe(0);
		expect(state.dev?.blockedHits).toBe(2);
	});

	it("DEV_GOD_BUTTON press edges toggle it (held: once); debug hits then land", () => {
		const state = devState(2, true);
		for (let i = 0; i < 4; i++) press(state, Button.DEBUG_HIT);
		expect(state.player.dead).toBe(0);
		expect(state.dev?.blockedHits).toBe(4);
		const config = buildDevRunConfig(SEED, DEFAULT_DEV_RUN).config;
		// Held for three ticks: one toggle.
		for (let i = 0; i < 3; i++) step(state, withButtons(DEV_GOD_BUTTON), config);
		step(state, EMPTY_INPUT, config);
		expect(state.dev?.invulnerable).toBe(0);
		expect(state.dev?.toggles).toBe(1);
		const p = state.player;
		const armorHearts = p.armor + p.hearts;
		press(state, Button.DEBUG_HIT);
		expect(p.armor + p.hearts).toBeLessThan(armorHearts);
		expect(state.dev?.blockedHits).toBe(4);
		press(state, DEV_GOD_BUTTON);
		expect(state.dev?.invulnerable).toBe(1);
	});

	it("off at start when the option is off", () => {
		const state = devState(2, false);
		expect(state.dev?.invulnerable).toBe(0);
		const armorHearts = state.player.armor + state.player.hearts;
		expect(damagePlayer(state, 2)).toBe(true);
		expect(state.player.armor + state.player.hearts).toBeLessThan(armorHearts);
	});

	it("is hashed as the last group, `dev`, after affixes, and replays bit for bit", () => {
		const a = devState(3, true);
		const layout = hashLayout(a, true);
		const names = layout.groups.map((g) => g.name);
		expect(names[names.size() - 1]).toBe(DEV_SUBSYSTEM);
		expect(names[names.size() - 2]).toBe(AFFIXES_SUBSYSTEM);
		expect(layout.values).toEqual(writeHashFields(a, []));
		expect(layout.names[layout.names.size() - 1]).toBe("dev.toggles");
		const b = devState(3, true);
		const run = (s: SimState) => {
			press(s, Button.DEBUG_HIT);
			press(s, DEV_GOD_BUTTON);
			press(s, Button.DEBUG_HIT);
		};
		run(a);
		run(b);
		expect(hashState(a)).toBe(hashState(b));
		expect(hashState(a)).never.toBe(hashState(devState(3, true)));
	});

	it("its bit is a port bit beyond the web table, accepted by the codec", () => {
		expect(bit32.band(ALL_BUTTONS, DEV_GOD_BUTTON)).toBe(0);
		expect(bit32.band(PORT_BUTTONS, DEV_GOD_BUTTON)).toBe(DEV_GOD_BUTTON);
		expect(bit32.band(SIM_BUTTONS, DEV_GOD_BUTTON)).toBe(DEV_GOD_BUTTON);
	});
});

describe("devModeAllowed", () => {
	const POLICY: DevAccessPolicy = { enabled: true, allowedUserIds: [42], allowPlaceCreator: true };
	const live = { studio: false, creatorId: 7, creatorIsUser: true };

	it("lets in Studio, a listed UserId and a user-owned place's creator", () => {
		expect(devModeAllowed({ ...live, studio: true, userId: 1 }, POLICY)).toBe(true);
		expect(devModeAllowed({ ...live, userId: 42 }, POLICY)).toBe(true);
		expect(devModeAllowed({ ...live, userId: 7 }, POLICY)).toBe(true);
	});

	it("keeps everyone else out, and everyone when switched off", () => {
		expect(devModeAllowed({ ...live, userId: 8 }, POLICY)).toBe(false);
		expect(devModeAllowed({ ...live, creatorIsUser: false, userId: 7 }, POLICY)).toBe(false); // group-owned
		expect(devModeAllowed({ ...live, userId: 7 }, { ...POLICY, allowPlaceCreator: false })).toBe(false);
		expect(devModeAllowed({ ...live, creatorId: 0, userId: 0 }, POLICY)).toBe(false); // guest / no id
		const off = { ...POLICY, enabled: false };
		expect(devModeAllowed({ ...live, studio: true, userId: 42 }, off)).toBe(false);
		expect(devModeAllowed({ ...live, userId: 42 }, off)).toBe(false);
	});
});
