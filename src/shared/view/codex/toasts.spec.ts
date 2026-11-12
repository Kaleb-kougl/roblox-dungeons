// The Codex on the in-run toasts (claude/codex-plan.md CX6, R11 / R14): a run event's toast maps to its entry (an
// evolution when the pick evolved, a duo card itself, relics, curses, boosts; nothing for Second Wind / the Fang), the
// chip only for this frame's chips, the HUD strings are the theme's, the chip's pop settles (none under Reduced
// motion), and a seeded doc's sightings feed the sighting queue (an unseeded doc none).
import { describe, expect, it } from "@rbxts/jest-globals";
import { CodexTier, applyClaims, emptyCodexDoc } from "shared/codex";
import { Boon, Boost, Curse, Duo, Relic, boonCard, duoCard } from "shared/sim";
import { CODEX_STRING_KEYS } from "shared/theme";
import {
	CODEX_CHIP,
	CODEX_HUD_STRINGS,
	codexChipScale,
	codexSeenSightings,
	codexToastChip,
	codexToastEntryId,
	codexToastNameKey,
} from ".";

describe("codex toasts", () => {
	it("maps a run event's toast to its entry", () => {
		expect([
			codexToastEntryId("boon", boonCard(Boon.VOLATILE)),
			codexToastEntryId("boon", boonCard(Boon.VOLATILE), "evolved"),
			codexToastEntryId("boon", duoCard(Duo.CHAIN_REACTION), "duo"),
			codexToastEntryId("relic", Relic.HOURGLASS),
			codexToastEntryId("curse", Curse.THIRST),
			codexToastEntryId("boost", Boost.AEGIS),
		]).toEqual([
			"boon:volatile",
			"evo:volatile",
			"duo:chainReaction",
			"relic:hourglass",
			"curse:thirst",
			"boost:aegis",
		]);
		expect([
			codexToastEntryId("secondWind", 1),
			codexToastEntryId("fang", 2),
			codexToastEntryId("relic", 99),
		]).toEqual([undefined, undefined, undefined]);
	});

	it("a toast wears the chip only when its entry is in this frame's chips", () => {
		const chips = ["boon:volatile", "boost:fury"];
		expect(codexToastChip(chips, "boon", boonCard(Boon.VOLATILE))).toBe(true);
		expect(codexToastChip(chips, "boon", boonCard(Boon.VOLATILE), "evolved")).toBe(false);
		expect(codexToastChip(chips, "boost", Boost.FURY)).toBe(true);
		expect(codexToastChip(chips, "fang", 2)).toBe(false);
		expect(codexToastChip([], "boon", boonCard(Boon.VOLATILE))).toBe(false);
	});

	it("uses the theme's codex HUD strings and the entry's name", () => {
		for (const [, key] of pairs(CODEX_HUD_STRINGS))
			expect([key, CODEX_STRING_KEYS.includes(key)]).toEqual([key, true]);
		expect(codexToastNameKey("enemy:swarmer")).toBe("enemy.swarmer.name");
		expect(codexToastNameKey("boss:act1")).toBe("boss.act1.name");
		expect(codexToastNameKey("nope")).toBe(undefined);
	});

	it("the chip pops from popScale to 1 over popSeconds; Reduced motion never pops", () => {
		expect(codexChipScale(0, false)).toBe(CODEX_CHIP.popScale);
		const mid = codexChipScale(CODEX_CHIP.popSeconds / 2, false);
		expect(mid > 1 && mid < CODEX_CHIP.popScale).toBe(true);
		expect(codexChipScale(CODEX_CHIP.popSeconds, false)).toBe(1);
		expect(codexChipScale(5, false)).toBe(1);
		for (const t of [0, CODEX_CHIP.popSeconds / 2, 1]) expect(codexChipScale(t, true)).toBe(1);
		// monotone: never grows back
		let last = math.huge;
		for (let i = 0; i <= 10; i++) {
			const s = codexChipScale((CODEX_CHIP.popSeconds * i) / 10, false);
			expect(s <= last).toBe(true);
			last = s;
		}
	});

	it("a seeded doc's seen / found sightings feed the sighting queue; an unseeded doc none", () => {
		const doc = applyClaims(
			emptyCodexDoc(),
			[
				{ id: "enemy:imp", tier: CodexTier.SEEN, floor: 0 },
				{ id: "affix:swift", tier: CodexTier.FOUND, floor: 4 },
				{ id: "enemy:golden", tier: CodexTier.SEEN, floor: 0 },
				{ id: "enemy:swarmer", tier: CodexTier.FOUND, floor: 1 },
			],
			1,
		);
		expect(codexSeenSightings(doc)).toEqual([]);
		expect(codexSeenSightings(undefined)).toEqual([]);
		doc.seeded = true;
		// SIGHTING_IDS order; the swarmer has no first sighting
		expect(codexSeenSightings(doc)).toEqual(["imp", "golden", "affix.swift"]);
	});
});
