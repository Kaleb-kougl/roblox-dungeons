// The Codex on the wire (claude/codex-plan.md CX3): the codexStatus payload and its round trip, and the pure rules of
// the remotes CodexService wraps: a claim or view before the load (or after a failed one) is ignored, then the rate,
// then the payload; claims only raise and mark unread; the one-time seed adds no NEW dots and always marks the doc.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CODEX,
	CODEX_CODEC,
	CodexTier,
	applyClaims,
	codexClaimUpdate,
	codexDocOfStatus,
	codexReceivedDoc,
	codexStatusOf,
	codexViewedUpdate,
	emptyCodexDoc,
	sameCodexDoc,
	seedCodexDoc,
	type CodexDoc,
} from "shared/codex";

const DAY = 20404;

function docWith(entries: ReadonlyArray<[string, number, number, number]>, unread?: string[]): CodexDoc {
	const doc = emptyCodexDoc();
	for (const [id, tier, day, floor] of entries) doc.e.set(id, [tier, day, floor]);
	if (unread !== undefined) doc.unread = unread;
	return doc;
}

describe("codexStatusOf", () => {
	it("is { loaded: false } alone when not loaded or without a doc", () => {
		const doc = docWith([["enemy:imp", 1, 0, 0]], ["enemy:imp"]);
		doc.seeded = true;
		expect(codexStatusOf(doc, false)).toEqual({ loaded: false });
		expect(codexStatusOf(undefined, true)).toEqual({ loaded: false });
	});

	it("an empty loaded doc carries only loaded", () => {
		expect(codexStatusOf(emptyCodexDoc(), true)).toEqual({ loaded: true });
	});

	it("lists entries sorted by id with their marks, unread and seeded", () => {
		const doc = docWith(
			[
				["enemy:imp", 1, 0, 0],
				["boon:volatile", 2, DAY, 7],
			],
			["boon:volatile"],
		);
		doc.seeded = true;
		expect(codexStatusOf(doc, true)).toEqual({
			loaded: true,
			entries: [
				{ id: "boon:volatile", tier: 2, day: DAY, floor: 7 },
				{ id: "enemy:imp", tier: 1, day: 0, floor: 0 },
			],
			unread: ["boon:volatile"],
			seeded: true,
		});
	});

	it("never shares the doc's unread list", () => {
		const doc = docWith([["enemy:imp", 1, 0, 0]], ["enemy:imp"]);
		const status = codexStatusOf(doc, true);
		status.unread!.push("boss:act1");
		expect(doc.unread).toEqual(["enemy:imp"]);
	});
});

describe("codexDocOfStatus", () => {
	it("round trips a doc through its status", () => {
		const doc = docWith(
			[
				["enemy:imp", 1, 0, 0],
				["duo:fireArrows", 2, DAY, CODEX.floorMax],
				["boss:act1", 2, DAY - 3, 5],
			],
			["boss:act1", "enemy:imp"],
		);
		doc.seeded = true;
		const back = codexDocOfStatus(codexStatusOf(doc, true));
		expect(back).toBeDefined();
		expect(sameCodexDoc(back!, CODEX_CODEC.decode(CODEX_CODEC.encode(doc)))).toBe(true);
		expect(back!.seeded).toBe(true);
	});

	it("is undefined for a not-loaded status or junk, and never throws", () => {
		expect(codexDocOfStatus({ loaded: false })).toBeUndefined();
		expect(codexDocOfStatus(undefined)).toBeUndefined();
		expect(codexDocOfStatus("x")).toBeUndefined();
		expect(codexDocOfStatus({ loaded: 1 })).toBeUndefined();
	});

	it("drops unknown ids, bad items and unread ids without a mark", () => {
		const back = codexDocOfStatus({
			loaded: true,
			entries: [
				{ id: "enemy:imp", tier: 2, day: DAY, floor: 3 },
				{ id: "enemy:nobody", tier: 1, day: 0, floor: 0 },
				{ id: 5, tier: 1 },
				"junk",
				{ id: "boss:act1", tier: "x" },
			],
			unread: ["enemy:imp", "boss:act1", "enemy:nobody"],
		});
		expect(back!.e.size()).toBe(1);
		expect(back!.e.get("enemy:imp")).toEqual([2, DAY, 3]);
		expect(back!.unread).toEqual(["enemy:imp"]);
		expect(back!.seeded).toBeUndefined();
	});
});

describe("codexClaimUpdate", () => {
	const claim = [{ id: "enemy:imp", tier: CodexTier.FOUND, floor: 4 }];

	it("ignores a claim before the load or after a failed one, before anything else", () => {
		expect(codexClaimUpdate(undefined, claim, DAY, true)).toEqual({ refused: "notReady" });
		expect(codexClaimUpdate(undefined, "junk", DAY, false)).toEqual({ refused: "notReady" });
	});

	it("refuses over the rate, then a bad payload", () => {
		const doc = emptyCodexDoc();
		expect(codexClaimUpdate(doc, claim, DAY, false)).toEqual({ refused: "rateLimited" });
		expect(codexClaimUpdate(doc, "junk", DAY, true)).toEqual({ refused: "badPayload" });
		const big: { id: string; tier: number; floor: number }[] = [];
		for (let i = 0; i <= CODEX.claimMaxItems; i++) big.push(claim[0]);
		expect(codexClaimUpdate(doc, big, DAY, true)).toEqual({ refused: "badPayload" });
	});

	it("applies claims on the server's day and marks the rise unread", () => {
		const r = codexClaimUpdate(emptyCodexDoc(), claim, DAY, true);
		expect(r.refused).toBeUndefined();
		if (r.refused !== undefined) return;
		expect(r.changed).toBe(true);
		expect(r.doc.e.get("enemy:imp")).toEqual([CodexTier.FOUND, DAY, 4]);
		expect(r.doc.unread).toEqual(["enemy:imp"]);
	});

	it("is idempotent and a lower tier never wins", () => {
		const doc = applyClaims(emptyCodexDoc(), claim, DAY);
		const again = codexClaimUpdate(doc, claim, DAY + 1, true);
		const lower = codexClaimUpdate(doc, [{ id: "enemy:imp", tier: CodexTier.SEEN, floor: 0 }], DAY + 2, true);
		for (const r of [again, lower]) {
			expect(r.refused).toBeUndefined();
			if (r.refused !== undefined) continue;
			expect(r.changed).toBe(false);
			expect(r.doc).toBe(doc);
		}
	});

	it("skips unknown ids within a valid call", () => {
		const r = codexClaimUpdate(emptyCodexDoc(), [{ id: "enemy:nobody", tier: 2, floor: 1 }], DAY, true);
		expect(r.refused).toBeUndefined();
		if (r.refused === undefined) expect(r.changed).toBe(false);
	});
});

describe("codexViewedUpdate", () => {
	it("follows the same refusal order", () => {
		const doc = docWith([["enemy:imp", 1, 0, 0]], ["enemy:imp"]);
		expect(codexViewedUpdate(undefined, ["enemy:imp"], true)).toEqual({ refused: "notReady" });
		expect(codexViewedUpdate(doc, ["enemy:imp"], false)).toEqual({ refused: "rateLimited" });
		expect(codexViewedUpdate(doc, 7, true)).toEqual({ refused: "badPayload" });
		const many: string[] = [];
		for (let i = 0; i <= CODEX.viewedMaxIds; i++) many.push("enemy:imp");
		expect(codexViewedUpdate(doc, many, true)).toEqual({ refused: "badPayload" });
	});

	it("clears the named ids from unread, and changes nothing when none was unread", () => {
		const doc = docWith(
			[
				["enemy:imp", 1, 0, 0],
				["boss:act1", 2, DAY, 5],
			],
			["boss:act1", "enemy:imp"],
		);
		const r = codexViewedUpdate(doc, ["enemy:imp", "enemy:nobody"], true);
		expect(r.refused).toBeUndefined();
		if (r.refused !== undefined) return;
		expect(r.changed).toBe(true);
		expect(r.doc.unread).toEqual(["boss:act1"]);
		expect(r.doc.e.size()).toBe(2);
		const none = codexViewedUpdate(r.doc, ["enemy:imp"], true);
		if (none.refused === undefined) expect(none.changed).toBe(false);
	});
});

describe("seedCodexDoc", () => {
	it("maps the sightings to seen entries without NEW dots and marks the doc seeded", () => {
		const out = seedCodexDoc(emptyCodexDoc(), ["imp", "golden", "affix.swift", "pellet.power", 3], DAY);
		expect(out.seeded).toBe(true);
		expect(out.unread).toBeUndefined();
		expect(out.e.get("enemy:imp")).toEqual([CodexTier.SEEN, 0, 0]);
		expect(out.e.get("enemy:golden")).toEqual([CodexTier.SEEN, 0, 0]);
		expect(out.e.get("affix:swift")).toEqual([CodexTier.SEEN, 0, 0]);
		expect(out.e.size()).toBe(3);
	});

	it("is always a new doc (an empty seen list still marks it) and never lowers an entry", () => {
		const doc = docWith([["enemy:imp", 2, DAY - 9, 3]], ["enemy:imp"]);
		const out = seedCodexDoc(doc, ["imp"], DAY);
		expect(out).never.toBe(doc);
		expect(doc.seeded).toBeUndefined();
		expect(out.e.get("enemy:imp")).toEqual([2, DAY - 9, 3]);
		expect(out.unread).toEqual(["enemy:imp"]);
		const empty = seedCodexDoc(emptyCodexDoc(), [], DAY);
		expect(empty.seeded).toBe(true);
		expect(CODEX_CODEC.equals(empty, emptyCodexDoc())).toBe(false);
	});
});

describe("codexReceivedDoc (the client's copy after a status)", () => {
	it("takes the server's dots minus the views still queued, not a union with the local copy", () => {
		// local: imp / swarmer dotted; the server cleared imp (viewed on another server) and still dots swarmer,
		// which this session viewed (its codexViewed not sent yet); the server dots the hourglass
		const mine = docWith(
			[
				["enemy:imp", 2, DAY, 3],
				["enemy:swarmer", 1, 0, 0],
			],
			["enemy:imp", "enemy:swarmer"],
		);
		const server = docWith(
			[
				["enemy:imp", 2, DAY, 3],
				["enemy:swarmer", 1, 0, 0],
				["relic:hourglass", 2, DAY, 2],
			],
			["enemy:swarmer", "relic:hourglass"],
		);
		const out = codexReceivedDoc(mine, server, ["enemy:swarmer"]);
		expect(out.unread).toEqual(["relic:hourglass"]);
		expect(out.e.size()).toBe(3);
		// nothing queued: the server's list as it is
		expect(codexReceivedDoc(mine, server, []).unread).toEqual(["enemy:swarmer", "relic:hourglass"]);
		// the first status: the server's doc
		expect(codexReceivedDoc(undefined, server, []).unread).toEqual(["enemy:swarmer", "relic:hourglass"]);
	});

	it("keeps this session's rises the server has not stored yet (tier and dot)", () => {
		const mine = docWith([["boss:act1", 2, DAY, 5]], ["boss:act1"]);
		const server = docWith([["boss:act1", 1, 0, 0]]);
		const out = codexReceivedDoc(mine, server, []);
		expect([out.e.get("boss:act1"), out.unread]).toEqual([[2, DAY, 5], ["boss:act1"]]);
		// once the server has it at that tier, its list decides
		expect(codexReceivedDoc(mine, docWith([["boss:act1", 2, DAY, 5]]), []).unread).toBeUndefined();
	});
});
