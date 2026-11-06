// Bastion's brace feedback (docs/LEGENDARIES.md LG6): what each BraceKind shows beyond its ring (floor shout, armor
// pulse, sound, toast), the armor row pulse's timeline (thickness eased out, fading, reduced motion), the strings and
// the shout's priority in the floor shout slot.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BraceKind } from "shared/sim";
import { BUILD_STRING_KEYS, PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { FLOOR_SHOUT_PRIORITY } from "../hud/dailyRankConfig";
import { BUILD_FX_VIEW } from "./buildFxConfig";
import { braceFeedbackOf, bracePulseLook } from "./braceFx";
import { BRACE_VIEW } from "./braceFxConfig";

describe("brace feedback (LG6)", () => {
	it("PIP: shout, pulse, sound, the brace toast; HEAL: shout, sound, the heal toast, no pulse; SPENT and unknown: nothing", () => {
		const row = (kind: number) => {
			const f = braceFeedbackOf(kind);
			return [f.shout, f.pulse, f.sound, f.toastKey];
		};
		expect(row(BraceKind.PIP)).toEqual([true, true, true, "hud.toast.brace"]);
		expect(row(BraceKind.HEAL)).toEqual([true, false, true, "hud.toast.braceHeal"]);
		expect(row(BraceKind.SPENT)).toEqual([false, false, false, undefined]);
		expect(row(99)).toEqual([false, false, false, undefined]);
	});

	it("the strings are the theme's build keys and the placeholder pack has them (BRACED already in capitals)", () => {
		const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
		for (const key of [BRACE_VIEW.strings.shout, BRACE_VIEW.strings.toastPip, BRACE_VIEW.strings.toastHeal]) {
			expect([key, BUILD_STRING_KEYS.includes(key), pack.hasString(key)]).toEqual([key, true, true]);
		}
		expect(pack.str(BRACE_VIEW.strings.shout)).toBe("BRACED");
	});

	it("BRACED is the lowest floor shout request: every other priority shout outranks or ties it", () => {
		for (const [name, p] of pairs(FLOOR_SHOUT_PRIORITY))
			expect([name, p >= FLOOR_SHOUT_PRIORITY.brace]).toEqual([name, true]);
		expect(FLOOR_SHOUT_PRIORITY.brace).toBe(FLOOR_SHOUT_PRIORITY.comboTier);
		expect(FLOOR_SHOUT_PRIORITY.brace < FLOOR_SHOUT_PRIORITY.rankThreshold).toBe(true);
	});

	it("the armor pulse: t0Px -> t1Px eased out while fading over pulse.sec; reduced motion holds t1Px; off outside its life", () => {
		const p = BRACE_VIEW.pulse;
		expect(bracePulseLook(0, false)).toEqual({ active: true, thicknessPx: p.t0Px, transparency: 0 });
		const half = bracePulseLook(p.sec / 2, false);
		expect(half.active).toBe(true);
		expect(half.transparency).toBeCloseTo(0.5, 9);
		expect(half.thicknessPx).toBeCloseTo(p.t0Px + (p.t1Px - p.t0Px) * 0.75, 9);
		expect(bracePulseLook(p.sec / 2, true).thicknessPx).toBe(p.t1Px);
		expect(bracePulseLook(p.sec, false).active).toBe(false);
		expect(bracePulseLook(-0.01, false).active).toBe(false);
		// The pulse outlasts the floor ring a little (the eye goes to the HUD after the knight).
		expect(p.sec > BUILD_FX_VIEW.brace.sec).toBe(true);
	});
});
