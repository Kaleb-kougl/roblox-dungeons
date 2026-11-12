// The Codex claim policy (claude/codex-plan.md "Rules", R8 / R9) and the Studio fake parser (KV_FakeCodex).
import { describe, expect, it } from "@rbxts/jest-globals";
import { DAILY_WORLD_KIND } from "shared/daily";
import { DEV_WORLD_KIND, ENDLESS_WORLD_KIND, TUTORIAL_WORLD_KIND } from "shared/run";
import {
	CODEX,
	CODEX_CATALOG,
	CODEX_FAKE_ATTRIBUTE,
	CODEX_POLICY,
	CodexTier,
	codexEligibility,
	codexFoundCount,
	codexWritesAllowed,
	parseFakeCodex,
	type CodexRunContext,
} from "shared/codex";

function ctx(world: string, over: Partial<CodexRunContext> = {}): CodexRunContext {
	return { world, debug: false, dev: false, stress: 0, studio: false, ...over };
}

describe("codex eligibility", () => {
	const FULL = { claims: true, toasts: true };
	const SILENT = { claims: true, toasts: false };
	const NONE = { claims: false, toasts: false };

	it("endless and the daily claim with toasts, the tutorial silently, every other world nothing", () => {
		expect(codexEligibility(ctx(ENDLESS_WORLD_KIND))).toEqual(FULL);
		expect(codexEligibility(ctx(DAILY_WORLD_KIND))).toEqual(FULL);
		expect(codexEligibility(ctx(TUTORIAL_WORLD_KIND))).toEqual(SILENT);
		for (const world of [DEV_WORLD_KIND, "game", "dungeonNoEncounter", "greybox", "nope", ""]) {
			expect([world, codexEligibility(ctx(world))]).toEqual([world, NONE]);
		}
	});

	it("debug, dev and stress runs never claim; Studio does not gate claims", () => {
		for (const world of [ENDLESS_WORLD_KIND, DAILY_WORLD_KIND, TUTORIAL_WORLD_KIND]) {
			expect([world, codexEligibility(ctx(world, { debug: true }))]).toEqual([world, NONE]);
			expect([world, codexEligibility(ctx(world, { dev: true }))]).toEqual([world, NONE]);
			expect([world, codexEligibility(ctx(world, { stress: 200 }))]).toEqual([world, NONE]);
		}
		expect(codexEligibility(ctx(ENDLESS_WORLD_KIND, { studio: true }))).toEqual(FULL);
		expect(codexEligibility(ctx(TUTORIAL_WORLD_KIND, { studio: true }))).toEqual(SILENT);
		expect(
			codexEligibility(ctx(ENDLESS_WORLD_KIND, { debug: true }), { ...CODEX_POLICY, claimDebug: true }),
		).toEqual(FULL);
	});

	it("Studio writes only with writeFromStudio", () => {
		expect(CODEX.writeFromStudio).toBe(false);
		expect(codexWritesAllowed(false)).toBe(true);
		expect(codexWritesAllowed(true)).toBe(false);
		expect(codexWritesAllowed(true, { ...CODEX_POLICY, writeFromStudio: true })).toBe(true);
	});
});

describe("codex Studio fake", () => {
	it("names its attribute and reads the keywords in any case", () => {
		expect(CODEX_FAKE_ATTRIBUTE).toBe("KV_FakeCodex");
		const all = parseFakeCodex(" ALL ")!;
		expect([all.loaded, all.doc.seeded, codexFoundCount(all.doc), all.doc.unread]).toEqual([
			true,
			true,
			CODEX_CATALOG.size(),
			undefined,
		]);
		const seen = parseFakeCodex("seen")!;
		expect([seen.loaded, seen.doc.e.size(), codexFoundCount(seen.doc)]).toEqual([true, CODEX_CATALOG.size(), 0]);
		for (const e of CODEX_CATALOG) expect(seen.doc.e.get(e.id)).toEqual([CodexTier.SEEN, 0, 0]);
		const none = parseFakeCodex("None")!;
		expect([none.loaded, none.doc.e.size(), none.doc.seeded]).toEqual([true, 0, true]);
		const unknown = parseFakeCodex("unknown")!;
		expect([unknown.loaded, unknown.doc.e.size()]).toEqual([false, 0]);
	});

	it("reads an entry list, each unread, the higher tier of a repeat winning", () => {
		const fake = parseFakeCodex("boon:volatile:2, enemy:imp:1 ,boss:act1:1,boss:act1:2,boon:swiftStrikes:1")!;
		expect(fake.loaded).toBe(true);
		expect(fake.doc.e.get("boon:volatile")).toEqual([2, 0, 0]);
		expect(fake.doc.e.get("enemy:imp")).toEqual([1, 0, 0]);
		expect(fake.doc.e.get("boss:act1")).toEqual([2, 0, 0]);
		expect(fake.doc.e.get("boon:swiftStrikes")).toEqual([1, 0, 0]);
		expect(fake.doc.unread).toEqual(["boon:swiftStrikes", "boon:volatile", "boss:act1", "enemy:imp"]);
		expect(fake.doc.seeded).toBe(true);
	});

	it("is no fake for anything else", () => {
		const bad: unknown[] = [
			undefined,
			5,
			"",
			"   ",
			"everything",
			"boon:volatile",
			"boon:volatile:3",
			"boon:volatile:0",
			"boon:nope:2",
			"BOON:volatile:2",
			"boon:swiftstrikes:1",
			"boon:volatile:2,",
			"boon:volatile:2,enemy:imp",
			"boon:volatile:x",
		];
		for (const v of bad) expect([v, parseFakeCodex(v)]).toEqual([v, undefined]);
	});
});
