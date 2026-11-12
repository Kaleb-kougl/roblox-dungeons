// The menu's Codex counts (claude/codex-plan.md CX6): the NEW-dot badge count and found / total per tab and overall.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CODEX_TABS,
	CodexTier,
	applyClaims,
	catalogTotal,
	codexProgressOf,
	codexUnreadCount,
	emptyCodexDoc,
	markViewed,
} from "shared/codex";

describe("codex progress", () => {
	it("counts NEW dots (0 without a doc or unread)", () => {
		expect(codexUnreadCount(undefined)).toBe(0);
		expect(codexUnreadCount(emptyCodexDoc())).toBe(0);
		const doc = applyClaims(
			emptyCodexDoc(),
			[
				{ id: "enemy:imp", tier: CodexTier.SEEN, floor: 0 },
				{ id: "boon:volatile", tier: CodexTier.FOUND, floor: 2 },
			],
			1,
		);
		expect(codexUnreadCount(doc)).toBe(2);
		expect(codexUnreadCount(markViewed(doc, ["enemy:imp"]))).toBe(1);
		expect(codexUnreadCount(applyClaims(emptyCodexDoc(), [{ id: "enemy:imp", tier: 1, floor: 0 }], 1, false))).toBe(
			0,
		);
	});

	it("found / total per tab in CODEX_TABS order and overall; seen entries do not count", () => {
		const none = codexProgressOf(undefined);
		expect(none.all).toEqual({ found: 0, total: catalogTotal() });
		expect(none.tabs.map((t) => t.tab)).toEqual([...CODEX_TABS]);
		for (const t of none.tabs) expect([t.tab, t.found, t.total]).toEqual([t.tab, 0, catalogTotal(t.tab)]);
		const doc = applyClaims(
			emptyCodexDoc(),
			[
				{ id: "boon:volatile", tier: CodexTier.FOUND, floor: 2 },
				{ id: "boon:hearty", tier: CodexTier.FOUND, floor: 2 },
				{ id: "enemy:imp", tier: CodexTier.SEEN, floor: 0 },
				{ id: "boss:act1", tier: CodexTier.FOUND, floor: 5 },
			],
			1,
		);
		const p = codexProgressOf(doc);
		expect(p.all.found).toBe(3);
		const found = new Map<string, number>();
		for (const t of p.tabs) found.set(t.tab, t.found);
		expect([found.get("boons"), found.get("bestiary"), found.get("duos")]).toEqual([2, 1, 0]);
	});
});
