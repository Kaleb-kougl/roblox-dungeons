/**
 * The sword spacing brake in every world's config (docs/SWORD_SPACING.md SP3, Design 6, SPD6): SWORD_SPACING by
 * default in M1, endless, the Daily, dev, co-op and the tutorial; `SwordSpacing.WEB` none, read when the config is
 * built, and a run built under it steps exactly like the default config without the field (recorded runs).
 */
import { afterAll, describe, expect, it } from "@rbxts/jest-globals";
import runFull from "shared/fixtures-generated/run-full-1337";
import {
	SWORD_SPACING,
	WEB_BOSS_HP,
	WEB_SWARMER_HP,
	WEB_SWORD_TIMINGS,
	deserializeRecording,
	hashState,
	runReplay,
	setBossHp,
	setSwarmerHp,
	setSwordTimings,
	type SimConfig,
} from "shared/sim";
import {
	PlayerMover,
	SwordSpacing,
	buildDevRunConfig,
	buildEndlessRunConfig,
	buildRunConfig,
	buildTutorialRunConfig,
	buildWorldSetup,
	runWorldKinds,
	setPlayerMover,
	setSwordSpacing,
	swordSpacing,
	swordSpacingKind,
	type SwordSpacingKind,
} from "shared/run";
import { recordEndlessRun, playTutorial } from "shared/run/testing";

const SEED = 1337;
const restore: SwordSpacingKind = swordSpacingKind();
afterAll(() => {
	setSwordSpacing(restore);
});

/** Every config a world kind builds (solo; co-op where the world hosts a party). */
function worldConfigs(): Array<[string, SimConfig | undefined]> {
	const out: Array<[string, SimConfig | undefined]> = [];
	for (const kind of runWorldKinds()) {
		out.push([kind, buildWorldSetup(kind, SEED, { atBossDoor: false }).config]);
		if (kind === "game" || kind === "endless" || kind === "daily")
			out.push([`${kind} co-op`, buildWorldSetup(kind, SEED, { atBossDoor: false, partySize: 2 }).config]);
	}
	out.push(["game scored", buildRunConfig(SEED, { scoring: {} }).config]);
	out.push(["endless archer", buildEndlessRunConfig(SEED, 1, { characters: ["archer"] }).config]);
	out.push(["dev", buildDevRunConfig(SEED).config]);
	out.push(["tutorial", buildTutorialRunConfig().config]);
	return out;
}

/** `config` without its brake (the field stripped). */
const unbraked = (config: Readonly<SimConfig>): SimConfig => ({ ...config, spacing: undefined });

describe("swordSpacing in every world (SPD6)", () => {
	it("the default config carries SWORD_SPACING in M1, endless, the Daily, dev, co-op and the tutorial", () => {
		expect(swordSpacingKind()).toBe(SwordSpacing.ON);
		expect(swordSpacing()).toBe(SWORD_SPACING);
		for (const [label, config] of worldConfigs()) {
			// The greybox world (DEFAULT_SIM_CONFIG: no encounter, no enemies) carries none.
			const want = label === "greybox" ? undefined : SWORD_SPACING;
			expect([label, config?.spacing]).toEqual([label, want]);
		}
	});

	it("SwordSpacing.WEB: no world carries a brake; setSwordSpacing returns the previous kind", () => {
		const previous = setSwordSpacing(SwordSpacing.WEB);
		try {
			expect(previous).toBe(SwordSpacing.ON);
			expect(swordSpacing()).toBe(undefined);
			for (const [label, config] of worldConfigs()) expect([label, config?.spacing]).toEqual([label, undefined]);
		} finally {
			expect(setSwordSpacing(previous)).toBe(SwordSpacing.WEB);
		}
		expect(swordSpacing(SwordSpacing.WEB)).toBe(undefined);
		expect(swordSpacing(SwordSpacing.ON)).toBe(SWORD_SPACING);
	});

	it("an endless run's floors are captured when built: a later switch changes nothing in that run", () => {
		const setup = buildEndlessRunConfig(SEED);
		const previous = setSwordSpacing(SwordSpacing.WEB);
		try {
			expect(setup.config.spacing).toBe(SWORD_SPACING);
			expect(setup.endlessFloor(3).config.spacing).toBe(undefined); // a floor's world never carries it
		} finally {
			setSwordSpacing(previous);
		}
	});
});

describe("SwordSpacing.WEB steps exactly as before (recorded runs)", () => {
	it("M1 (the golden run-full recording, web sword): the WEB build equals the default without its brake", () => {
		const recording = deserializeRecording(runFull.recording);
		const portMover = setPlayerMover(PlayerMover.WEB);
		const portSword = setSwordTimings(WEB_SWORD_TIMINGS);
		const portSwarmerHp = setSwarmerHp(WEB_SWARMER_HP);
		const portBossHp = setBossHp(WEB_BOSS_HP);
		try {
			const on = buildRunConfig(recording.seed).config;
			const previous = setSwordSpacing(SwordSpacing.WEB);
			const web = buildRunConfig(recording.seed).config;
			setSwordSpacing(previous);
			const n = recording.frames.size();
			for (const t of [n / 4, n / 2, n])
				expect(hashState(runReplay(recording, web, math.floor(t)))).toBe(
					hashState(runReplay(recording, unbraked(on), math.floor(t))),
				);
		} finally {
			setSwordTimings(portSword);
			setSwarmerHp(portSwarmerHp);
			setBossHp(portBossHp);
			setPlayerMover(portMover);
		}
	});

	it("endless (the recorded endless run): the WEB build equals the default without its brake", () => {
		const { seed, recording, finalHash } = recordEndlessRun(SEED);
		const on = buildEndlessRunConfig(seed).config;
		const previous = setSwordSpacing(SwordSpacing.WEB);
		const web = buildEndlessRunConfig(seed).config;
		setSwordSpacing(previous);
		const webHash = hashState(runReplay(recording, web));
		expect(webHash).toBe(hashState(runReplay(recording, unbraked(on))));
		expect(hashState(runReplay(recording, on))).toBe(finalHash);
	});

	it("the tutorial (the scripted bot's run): the WEB build equals the default without its brake", () => {
		const result = playTutorial();
		const recording = result.run.recorder.getRecording();
		const on = buildTutorialRunConfig().config;
		const previous = setSwordSpacing(SwordSpacing.WEB);
		const web = buildTutorialRunConfig().config;
		setSwordSpacing(previous);
		expect(hashState(runReplay(recording, web))).toBe(hashState(runReplay(recording, unbraked(on))));
		expect(hashState(runReplay(recording, on))).toBe(hashState(result.run.state));
	});
});
