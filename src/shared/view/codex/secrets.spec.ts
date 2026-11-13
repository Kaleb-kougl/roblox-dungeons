// The Codex's secret rooms entry in a run (docs/SECRET_ROOMS.md SR9, SRD12): `secret:room` is seen at the local
// player's knock on a crack (the first-time card's moment: route `card`, the card wears the NEW! chip) and found at an
// open while the local player is in the run (a codex toast outside the budget); readCodexSecrets reads both from the
// run view's events (a teammate's or an enemy's knock is not yours); never in dev / debug runs or M1; the run's last
// frame still counts an open; the tile art is the entry's name; the summary ranks it with the bosses.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CODEX,
	CODEX_SECRET_ID,
	CodexTier,
	codexEligibility,
	codexEntry,
	emptyCodexDoc,
	type CodexEligibility,
	type CodexEntry,
} from "shared/codex";
import { SECRET_DUST_ROLE } from "shared/theme";
import { SecretFrameEvents } from "../secrets";
import {
	CODEX_SUMMARY_RANK,
	CodexTracker,
	clearCodexFrameEvents,
	codexSummaryRank,
	codexTileArt,
	codexToastRoute,
	newCodexFrame,
	readCodexSecrets,
	type CodexArtPack,
} from ".";

const S = CodexTier.SEEN;
const F = CodexTier.FOUND;

function tracker(eligibility: CodexEligibility): CodexTracker {
	const t = new CodexTracker();
	t.receive(emptyCodexDoc());
	t.startRun(eligibility);
	return t;
}

const ENDLESS = codexEligibility({ world: "endless", debug: false, dev: false, stress: 0, studio: false });

function knock(ev: SecretFrameEvents, player: number): void {
	ev.knocks.push({ tick: 10, slot: 4, x: 1, z: 2, source: 0, player });
}

function open(ev: SecretFrameEvents): void {
	ev.opened.push({
		tick: 20,
		how: 0,
		player: 1,
		finder: 1,
		slot: 4,
		x: 1,
		z: 2,
		fx: 0,
		fz: 1,
		room: 0,
		tier: 1,
		chestX: 1,
		chestZ: -2,
		points: 600,
	});
}

describe("the Codex's secret rooms entry (docs/SECRET_ROOMS.md SRD12)", () => {
	it("readCodexSecrets: the local player's knock, any open; cleared with the frame's events", () => {
		const f = newCodexFrame();
		const ev = new SecretFrameEvents();
		knock(ev, 1);
		knock(ev, -1);
		readCodexSecrets(f, ev, 0);
		expect([f.secretKnocked, f.secretOpened]).toEqual([false, false]);
		knock(ev, 0);
		open(ev);
		readCodexSecrets(f, ev, 0);
		expect([f.secretKnocked, f.secretOpened]).toEqual([true, true]);
		clearCodexFrameEvents(f);
		expect([f.secretKnocked, f.secretOpened]).toEqual([false, false]);
	});

	it("seen at the knock (the card's moment, its chip), found at an open (a codex toast past the budget)", () => {
		const t = tracker(ENDLESS);
		const f = newCodexFrame();
		f.secretKnocked = true;
		const seen = t.update(f);
		expect(seen.rises.map((r) => [r.id, r.tier])).toEqual([[CODEX_SECRET_ID, S]]);
		expect([seen.codexToasts.size(), seen.chips.size()]).toEqual([0, 0]);
		expect(t.sightingChip("secret.crack")).toBe(true);
		// The next knocks raise nothing.
		expect(t.update(f).rises.size()).toBe(0);
		clearCodexFrameEvents(f);
		f.secretOpened = true;
		f.floor = 3;
		const found = t.update(f);
		expect(found.rises.map((r) => [r.id, r.tier, r.floor])).toEqual([[CODEX_SECRET_ID, F, 3]]);
		expect([...found.codexToasts]).toEqual([CODEX_SECRET_ID]);
		expect(t.codexRunSummary().newIds).toEqual([CODEX_SECRET_ID]);
		expect(CODEX.toastsPerFloor >= 1).toBe(true);
	});

	it("an open on the run's last frame counts; nothing in dev, debug or M1 runs", () => {
		const t = tracker(ENDLESS);
		const f = newCodexFrame();
		f.secretOpened = true;
		f.runOver = true;
		expect(t.update(f).rises.map((r) => [r.id, r.tier])).toEqual([[CODEX_SECRET_ID, F]]);
		for (const ctx of [
			{ world: "dev", debug: false, dev: true, stress: 0, studio: false },
			{ world: "endless", debug: true, dev: false, stress: 0, studio: false },
			{ world: "game", debug: false, dev: false, stress: 0, studio: false },
		]) {
			const e = codexEligibility(ctx);
			expect(e.claims).toBe(false);
			const u = tracker(e);
			const g = newCodexFrame();
			g.secretKnocked = true;
			g.secretOpened = true;
			expect(u.update(g).rises.size()).toBe(0);
		}
	});

	it("routes, summary rank and tile art of the entry", () => {
		const entry = codexEntry(CODEX_SECRET_ID) as CodexEntry;
		expect(entry.group).toBe("secrets");
		expect(codexToastRoute(entry, S, false)).toEqual({ route: "card", always: true });
		expect(codexToastRoute(entry, F, false)).toEqual({ route: "codex", always: true });
		expect(codexSummaryRank(entry)).toBe(CODEX_SUMMARY_RANK.boss);
		const pack: CodexArtPack = {
			has() {
				return false;
			},
			sprites() {
				return undefined;
			},
		};
		expect(codexTileArt(pack, CODEX_SECRET_ID)).toEqual({ kind: "label", key: entry.nameKey, role: SECRET_DUST_ROLE });
		expect(codexTileArt(pack, CODEX_SECRET_ID, "unknown").kind).toBe("unknown");
	});
});
