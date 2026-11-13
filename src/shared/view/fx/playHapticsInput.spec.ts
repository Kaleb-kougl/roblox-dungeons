// In-run haptics' input builder (docs/HAPTICS.md HP4, HP6): the device choice (pad / touch / none per setting), the
// quiet gates, spectating, the kill feed (scored: the view player's pops, heavy only when every credited kill is
// theirs; unscored solo: every tracker kill; unscored co-op: none), the tracker event scan (heavy kills by the freeze
// rule, the phase break and boss death edges), the view player's parry only (a teammate's ignored), the hurt edge, and
// the KV_HapticDebug value.
import { describe, expect, it } from "@rbxts/jest-globals";
import type { HurtKind } from "../watch";
import { FxEventBuffer, type FxEventType } from "./events";
import { HEAVY_KILL_HP } from "./freezeRules";
import { HAPTIC_DEBUG, PLAY_HAPTICS_RULES } from "./hapticsConfig";
import type { NearMissFrame } from "./nearMissRules";
import { PlayHapticsDirector } from "./playHaptics";
import {
	PlayHapticsInputBuilder,
	hapticDebugOf,
	hapticDeviceOf,
	isHeavyKill,
	localParryCount,
	newPlayHapticsFacts,
	playHapticsQuiet,
	scanHapticEvents,
	viewKillsOf,
	type PlayHapticsFacts,
} from "./playHapticsInput";

/** Facts of a running solo run on a vibrating pad, nothing happened. */
function running(): PlayHapticsFacts {
	const f = newPlayHapticsFacts();
	f.inputDevice = "gamepad";
	f.padVibration = true;
	f.touchVibration = true;
	f.inRun = true;
	return f;
}

interface EventSpec {
	type: FxEventType;
	boss?: boolean;
	elite?: boolean;
	hpMax?: number;
	phase?: number;
}

function buffer(specs: ReadonlyArray<EventSpec>): FxEventBuffer {
	const b = new FxEventBuffer(16);
	b.clear();
	for (const s of specs) {
		const e = b.emit(s.type, 0)!;
		e.boss = s.boss ?? false;
		e.elite = s.elite ?? false;
		e.hpMax = s.hpMax ?? 1;
		e.phase = s.phase ?? 0;
	}
	return b;
}

interface CueSpec {
	player: number;
	local: boolean;
	speed?: number;
	flash?: number;
}

/** A near-miss frame with these parry cues (and a new flash per cue that names a count). */
function nearMiss(cues: ReadonlyArray<CueSpec>): NearMissFrame {
	const parryCues = new Array<{ player: number; local: boolean; speed: number }>();
	const flashes = new Array<NearMissFrame["flashes"][number]>();
	for (const c of cues) {
		parryCues.push({ player: c.player, local: c.local, speed: c.speed ?? 1 });
		if (c.flash !== undefined) {
			flashes.push({
				player: c.player,
				count: c.flash,
				isNew: true,
				grew: true,
				ageSec: 0,
				scale: 1,
				pop: 1,
				fade: 1,
				showCount: false,
				x: 0,
				z: 0,
			});
		}
	}
	return {
		grazeSparks: [],
		parryBursts: [],
		grazeCue: undefined,
		parryCues,
		flashes,
		freezeMs: 0,
		parryGroups: [],
	};
}

describe("hapticDeviceOf", () => {
	it("the pad with Gamepad vibration On, the phone with Touch vibration On, else none", () => {
		expect(hapticDeviceOf("gamepad", true, false)).toBe("pad");
		expect(hapticDeviceOf("gamepad", false, true)).toBe(undefined);
		expect(hapticDeviceOf("touch", false, true)).toBe("touch");
		expect(hapticDeviceOf("touch", true, false)).toBe(undefined);
		expect(hapticDeviceOf("keyboard", true, true)).toBe(undefined);
	});
});

describe("PlayHapticsInputBuilder: gates", () => {
	it("a running, unmenued, unspectated run is open", () => {
		const input = new PlayHapticsInputBuilder().build(running());
		expect(input.device).toBe("pad");
		expect(input.quiet).toBe(false);
		expect(input.spectating).toBe(false);
	});

	const gates: ReadonlyArray<[string, (f: PlayHapticsFacts) => void]> = [
		["no run", (f) => (f.inRun = false)],
		["a menu shown", (f) => (f.menuShown = true)],
		["paused", (f) => (f.paused = true)],
		["the boon draft open", (f) => (f.draftOpen = true)],
		["the stage cover up", (f) => (f.stageCovered = true)],
		["run over", (f) => (f.runOver = true)],
	];
	for (const [name, set] of gates) {
		it(`is quiet with ${name}, and the director plays nothing`, () => {
			const f = running();
			set(f);
			f.events.kills = 1;
			f.hurt = "heart";
			expect(playHapticsQuiet(f)).toBe(true);
			const input = new PlayHapticsInputBuilder().build(f);
			expect(input.quiet).toBe(true);
			expect(new PlayHapticsDirector().frame(input, 0).cue).toBe(undefined);
		});
	}

	it("spectating a teammate is silent even for a phase break", () => {
		const f = running();
		f.partySize = 2;
		f.localIndex = 0;
		f.viewIndex = 1;
		f.events.bossPhaseBreak = true;
		f.hurt = "lethal";
		const input = new PlayHapticsInputBuilder().build(f);
		expect(input.spectating).toBe(true);
		expect(new PlayHapticsDirector().frame(input, 0).cue).toBe(undefined);
	});

	it("touch with Touch vibration Off has no device", () => {
		const f = running();
		f.inputDevice = "touch";
		f.touchVibration = false;
		f.events.bossDeath = true;
		const input = new PlayHapticsInputBuilder().build(f);
		expect(input.device).toBe(undefined);
		expect(new PlayHapticsDirector().frame(input, 0).cue).toBe(undefined);
		f.touchVibration = true;
		expect(new PlayHapticsInputBuilder().build(f).device).toBe("touch");
	});
});

describe("viewKillsOf: the kill feed", () => {
	it("scored runs count the view player's score pops, solo and co-op", () => {
		const f = running();
		f.scored = true;
		f.events.kills = 5;
		f.viewPops = 2;
		f.teamPops = 2;
		expect(viewKillsOf(f).kills).toBe(2);
		f.partySize = 2;
		f.viewPops = 0;
		f.teamPops = 3;
		expect(viewKillsOf(f).kills).toBe(0);
	});

	it("a heavy kill is the view player's only while every credited kill of the frame is theirs", () => {
		const f = running();
		f.scored = true;
		f.partySize = 2;
		f.events.kills = 2;
		f.events.heavyKill = true;
		f.viewPops = 1;
		f.teamPops = 2;
		expect(viewKillsOf(f)).toEqual({ kills: 1, heavy: false });
		f.teamPops = 1;
		expect(viewKillsOf(f)).toEqual({ kills: 1, heavy: true });
		f.viewPops = 0;
		f.teamPops = 0;
		expect(viewKillsOf(f)).toEqual({ kills: 0, heavy: false });
	});

	it("an unscored solo run credits every tracker kill to the player; unscored co-op has no feed", () => {
		const f = running();
		f.events.kills = 3;
		f.events.heavyKill = true;
		expect(viewKillsOf(f)).toEqual({ kills: 3, heavy: true });
		f.partySize = 2;
		expect(viewKillsOf(f)).toEqual({ kills: 0, heavy: false });
	});

	it("a teammate's kill never ticks your pad", () => {
		const f = running();
		f.scored = true;
		f.partySize = 2;
		f.events.kills = 1;
		f.viewPops = 0;
		f.teamPops = 1;
		const input = new PlayHapticsInputBuilder().build(f);
		expect(input.viewKills).toBe(0);
		expect(new PlayHapticsDirector().frame(input, 0).cue).toBe(undefined);
	});
});

describe("scanHapticEvents", () => {
	it("counts non-boss kills, flags heavy ones by the freeze rule, and reads the boss edges", () => {
		const scan = scanHapticEvents(
			buffer([
				{ type: "hit" },
				{ type: "killed", hpMax: 1 },
				{ type: "killed", hpMax: HEAVY_KILL_HP },
				{ type: "killed", boss: true, hpMax: 270 },
				{ type: "bossDefeated", boss: true },
			]),
			{ kills: 9, heavyKill: false, bossPhaseBreak: true, bossDeath: false },
		);
		expect(scan).toEqual({ kills: 2, heavyKill: true, bossPhaseBreak: false, bossDeath: true });
	});

	it("an elite kill is heavy, a plain one is not", () => {
		expect(
			isHeavyKill({ type: "killed", boss: false, elite: true, hpMax: 1, phase: 0, heavy: false, capped: false }),
		).toBe(true);
		expect(
			isHeavyKill({ type: "killed", boss: false, elite: false, hpMax: 1, phase: 0, heavy: false, capped: false }),
		).toBe(false);
		expect(
			isHeavyKill({ type: "hit", boss: false, elite: true, hpMax: 9, phase: 0, heavy: true, capped: false }),
		).toBe(false);
	});

	it("a phase break is phase 2 or 3, never the fight start", () => {
		const scan = { kills: 0, heavyKill: false, bossPhaseBreak: false, bossDeath: false };
		expect(scanHapticEvents(buffer([{ type: "bossPhase", boss: true, phase: 1 }]), scan).bossPhaseBreak).toBe(
			false,
		);
		expect(scanHapticEvents(buffer([{ type: "bossPhase", boss: true, phase: 2 }]), scan).bossPhaseBreak).toBe(true);
		expect(scanHapticEvents(buffer([{ type: "bossPhase", boss: true, phase: 3 }]), scan).bossPhaseBreak).toBe(true);
	});
});

describe("localParryCount", () => {
	const big = PLAY_HAPTICS_RULES.parryBigFrom;

	it("takes the view player's guard with its first frame's erases", () => {
		expect(localParryCount(nearMiss([{ player: 0, local: true, flash: 4 }]), big)).toBe(4);
	});

	it("ignores a teammate's guard", () => {
		expect(localParryCount(nearMiss([{ player: 1, local: false, flash: 5 }]), big)).toBe(undefined);
		expect(
			localParryCount(
				nearMiss([
					{ player: 1, local: false, flash: 5 },
					{ player: 0, local: true, flash: 1 },
				]),
				big,
			),
		).toBe(1);
	});

	it("without a flash falls back to the cue's pitch", () => {
		expect(localParryCount(nearMiss([{ player: 0, local: true }]), big)).toBe(1);
		expect(localParryCount(nearMiss([{ player: 0, local: true, speed: 1.3 }]), big)).toBe(big);
	});

	it("a big guard plays the big parry", () => {
		const f = running();
		f.parryCount = localParryCount(nearMiss([{ player: 0, local: true, flash: big }]), big);
		expect(new PlayHapticsDirector().frame(new PlayHapticsInputBuilder().build(f), 0).cue).toBe("parryBig");
	});
});

describe("PlayHapticsInputBuilder: moments", () => {
	it("passes the hurt edge (none: undefined), the boss edges and the parry", () => {
		const b = new PlayHapticsInputBuilder();
		const f = running();
		const kinds: ReadonlyArray<HurtKind> = ["harmless", "armor", "heart", "lethal"];
		for (const kind of kinds) {
			f.hurt = kind;
			expect(b.build(f).hurt).toBe(kind);
		}
		f.hurt = "none";
		expect(b.build(f).hurt).toBe(undefined);
		f.events.bossPhaseBreak = true;
		f.events.bossDeath = true;
		f.parryCount = 2;
		const input = b.build(f);
		expect(input.bossPhaseBreak).toBe(true);
		expect(input.bossDeath).toBe(true);
		expect(input.parry?.count).toBe(2);
		f.parryCount = undefined;
		expect(b.build(f).parry).toBe(undefined);
	});

	it("reuses one input object", () => {
		const b = new PlayHapticsInputBuilder();
		expect(b.build(running())).toBe(b.build(running()));
	});
});

describe("hapticDebugOf", () => {
	it("absent / false / 0 / empty is off", () => {
		expect(hapticDebugOf(undefined)).toEqual({ print: false, testCue: undefined });
		expect(hapticDebugOf(false).print).toBe(false);
		expect(hapticDebugOf(0).print).toBe(false);
		expect(hapticDebugOf("").print).toBe(false);
	});

	it("true or any other value prints; integers 1..7 name the test cues in order", () => {
		expect(hapticDebugOf(true)).toEqual({ print: true, testCue: undefined });
		expect(hapticDebugOf("yes").print).toBe(true);
		expect(HAPTIC_DEBUG.testCues.size()).toBe(7);
		const expected = ["kill", "parry", "stagger", "bossDeath", "hurtArmor", "hurtHeart", "hurtLethal"];
		for (let n = 1; n <= 7; n++) expect(hapticDebugOf(n)).toEqual({ print: true, testCue: expected[n - 1] });
		expect(hapticDebugOf(8)).toEqual({ print: true, testCue: undefined });
		expect(hapticDebugOf(2.5)).toEqual({ print: true, testCue: undefined });
		expect(hapticDebugOf(-1)).toEqual({ print: true, testCue: undefined });
	});
});
