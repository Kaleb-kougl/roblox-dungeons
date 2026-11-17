// The Codex document (claude/codex-plan.md CX2): the codec (round trip, junk, unknown ids), the merges (tier only up,
// earliest found day, unread union minus viewed, commutative / associative / idempotent), claims, the remote payload
// decoders, the store transform and the one-time seed from the onboarding sightings.
import { describe, expect, it } from "@rbxts/jest-globals";
import { SIGHTING_IDS } from "shared/onboarding";
import {
	CODEX,
	CODEX_CATALOG,
	CODEX_CODEC,
	CODEX_DOC_VERSION,
	CodexTier,
	applyClaims,
	codexDay,
	codexFoundCount,
	codexIds,
	codexTier,
	decodeCodexClaims,
	decodeCodexDoc,
	decodeCodexViewed,
	emptyCodexDoc,
	encodeCodexDoc,
	markViewed,
	mergeCodex,
	mergeStoredCodex,
	sameCodexDoc,
	seedFromSightings,
	type CodexDoc,
	type CodexMark,
} from "shared/codex";

function docOf(entries: ReadonlyArray<[string, CodexMark]>, unread?: string[], seeded?: true): CodexDoc {
	const doc = emptyCodexDoc();
	for (const [id, mark] of entries) doc.e.set(id, mark);
	if (unread !== undefined) doc.unread = unread;
	if (seeded) doc.seeded = seeded;
	return doc;
}

/** The doc as plain sorted rows, for toEqual. */
function rows(doc: CodexDoc): unknown[] {
	const out: defined[] = [];
	for (const id of codexIds(doc)) out.push([id, doc.e.get(id)]);
	return [out, doc.unread ?? [], doc.seeded === true];
}

function sample(): CodexDoc {
	return docOf(
		[
			["boon:volatile", [2, 20400, 7]],
			["enemy:imp", [1, 0, 0]],
			["duo:fireArrows", [2, 20401, 12]],
			["boss:act1", [2, 20402, 5]],
		],
		["boon:volatile", "duo:fireArrows"],
		true,
	);
}

describe("codex doc codec", () => {
	it("round-trips a doc and names its store", () => {
		const doc = sample();
		const back = decodeCodexDoc(encodeCodexDoc(doc));
		expect(rows(back)).toEqual(rows(doc));
		expect(sameCodexDoc(back, doc)).toBe(true);
		expect(CODEX_CODEC.equals(CODEX_CODEC.decode(CODEX_CODEC.encode(doc)), doc)).toBe(true);
		expect(CODEX_CODEC.empty().e.size()).toBe(0);
		expect(CODEX.dataStore).toBe("KV_Codex_v1");
		expect(encodeCodexDoc(doc).v).toBe(CODEX_DOC_VERSION);
	});

	it("reads missing, garbage and other versions as empty, never throwing", () => {
		const bad: unknown[] = [
			undefined,
			"codex",
			5,
			true,
			[],
			{},
			{ v: 2, e: { "boon:volatile": [2, 1, 1] } },
			{ v: "1", e: {} },
			{ v: 1, e: "entries" },
			{ v: 1, e: [1, 2, 3] },
			{ v: 1, e: {}, unread: "boon:volatile" },
		];
		for (const raw of bad) {
			const doc = decodeCodexDoc(raw);
			expect([doc.e.size(), doc.unread, doc.seeded]).toEqual([0, undefined, undefined]);
		}
		expect(decodeCodexDoc({ v: 1, seeded: true }).seeded).toBe(true);
		expect(decodeCodexDoc({ v: 1, seeded: "yes", e: {} }).seeded).toBeUndefined();
	});

	it("drops unknown ids and bad marks one by one, clamping tiers and floors", () => {
		const e = new Map<string, unknown>([
			["boon:volatile", [2, 20400, 7]],
			["boon:nope", [2, 1, 1]],
			["Boon:volatile", [2, 1, 1]],
			["enemy:imp", "seen"],
			["enemy:sniper", [0 / 0, 1, 1]],
			["duo:fireArrows", [9, -3, 5000]],
			["relic:hourglass", [0, 5, 5]],
			["curse:haste", [2.7, 3.9, 12.2]],
			["boost:fury", ["a"]],
			["affix:swift", [1, 300, 4]],
			["boss:act1", [2, "day", -2]],
		]);
		const doc = decodeCodexDoc({
			v: 1,
			e,
			unread: ["boon:volatile", "boon:volatile", "boon:nope", "curse:frailty", 5, "relic:hourglass"],
		});
		expect(rows(doc)).toEqual([
			[
				["affix:swift", [1, 0, 0]],
				["boon:volatile", [2, 20400, 7]],
				["boss:act1", [2, 0, 0]],
				["curse:haste", [2, 3, 12]],
				["duo:fireArrows", [2, 0, CODEX.floorMax]],
				["relic:hourglass", [1, 0, 0]],
			],
			["boon:volatile", "relic:hourglass"],
			false,
		]);
	});

	it("encodes a normalized copy (unknown ids, unread without a mark and duplicates dropped)", () => {
		const doc = docOf(
			[
				["boon:volatile", [2, 1, 3]],
				["nope:nope", [2, 1, 3]],
			],
			["enemy:imp", "boon:volatile", "boon:volatile"],
		);
		const out = encodeCodexDoc(doc);
		expect(rows(out)).toEqual([[["boon:volatile", [2, 1, 3]]], ["boon:volatile"], false]);
		expect(out).never.toBe(doc);
	});
});

describe("codex doc merges", () => {
	const a = docOf(
		[
			["boon:volatile", [1, 0, 0]],
			["enemy:imp", [2, 100, 3]],
			["duo:fireArrows", [2, 90, 9]],
		],
		["boon:volatile"],
	);
	const b = docOf(
		[
			["boon:volatile", [2, 120, 4]],
			["enemy:imp", [2, 80, 6]],
			["duo:fireArrows", [2, 90, 2]],
			["boss:act1", [1, 0, 0]],
		],
		["enemy:imp", "boss:act1"],
		true,
	);
	const c = docOf(
		[
			["enemy:imp", [1, 0, 0]],
			["relic:hourglass", [2, 70, 1]],
		],
		["relic:hourglass"],
	);

	it("raises tiers, keeps the earliest found day with its floor and unions unread", () => {
		expect(rows(mergeCodex(a, b))).toEqual([
			[
				["boon:volatile", [2, 120, 4]],
				["boss:act1", [1, 0, 0]],
				["duo:fireArrows", [2, 90, 2]],
				["enemy:imp", [2, 80, 6]],
			],
			["boon:volatile", "boss:act1", "enemy:imp"],
			true,
		]);
		// a found never drops back to seen
		expect(codexTier(mergeCodex(c, b), "enemy:imp")).toBe(CodexTier.FOUND);
	});

	it("commutes, associates and is idempotent", () => {
		const docs = [a, b, c, emptyCodexDoc(), sample()];
		for (const x of docs) {
			expect(sameCodexDoc(mergeCodex(x, x), encodeCodexDoc(x))).toBe(true);
			for (const y of docs) {
				expect(sameCodexDoc(mergeCodex(x, y), mergeCodex(y, x))).toBe(true);
				for (const z of docs) {
					expect(sameCodexDoc(mergeCodex(mergeCodex(x, y), z), mergeCodex(x, mergeCodex(y, z)))).toBe(true);
				}
			}
		}
	});

	it("unread is the union minus the ids marked viewed", () => {
		const merged = markViewed(mergeCodex(a, b), ["enemy:imp", "boon:volatile", "relic:secondWind"]);
		expect(merged.unread).toEqual(["boss:act1"]);
		const cleared = markViewed(merged, ["boss:act1"]);
		expect(cleared.unread).toBeUndefined();
		expect(cleared.e.size()).toBe(merged.e.size());
		// nothing unread among the ids: the same doc
		expect(markViewed(merged, ["enemy:imp"])).toBe(merged);
		expect(markViewed(cleared, ["boss:act1"])).toBe(cleared);
	});
});

describe("codex claims", () => {
	const DAY = 20410;

	it("adds seen and found entries, stamping the day and marking them unread", () => {
		const doc = applyClaims(
			emptyCodexDoc(),
			[
				{ id: "enemy:imp", tier: 1, floor: 4 },
				{ id: "boon:volatile", tier: 2, floor: 3 },
				{ id: "boss:demonlord", tier: 2, floor: 5000 },
			],
			DAY,
		);
		expect(rows(doc)).toEqual([
			[
				["boon:volatile", [2, DAY, 3]],
				["boss:demonlord", [2, DAY, CODEX.floorMax]],
				["enemy:imp", [1, 0, 0]],
			],
			["boon:volatile", "boss:demonlord", "enemy:imp"],
			false,
		]);
	});

	it("only ever raises an entry; a seen -> found rise stamps the day and re-marks it", () => {
		const base = docOf(
			[
				["boon:volatile", [2, 100, 3]],
				["enemy:imp", [1, 0, 0]],
			],
			undefined,
			true,
		);
		// at or below the tier: nothing changes, the same doc comes back
		expect(applyClaims(base, [{ id: "boon:volatile", tier: 2, floor: 9 }], DAY)).toBe(base);
		expect(applyClaims(base, [{ id: "boon:volatile", tier: 1, floor: 9 }], DAY)).toBe(base);
		expect(applyClaims(base, [{ id: "enemy:imp", tier: 1, floor: 2 }], DAY)).toBe(base);
		expect(applyClaims(base, [{ id: "boon:nope", tier: 2, floor: 2 }], DAY)).toBe(base);
		expect(applyClaims(base, [{ id: "enemy:imp", tier: 0 / 0, floor: 2 }], DAY)).toBe(base);
		expect(applyClaims(base, [], DAY)).toBe(base);
		const rose = applyClaims(base, [{ id: "enemy:imp", tier: 2, floor: 6 }], DAY);
		expect(rows(rose)).toEqual([
			[
				["boon:volatile", [2, 100, 3]],
				["enemy:imp", [2, DAY, 6]],
			],
			["enemy:imp"],
			true,
		]);
		// the input doc is untouched
		expect(rows(base)).toEqual([
			[
				["boon:volatile", [2, 100, 3]],
				["enemy:imp", [1, 0, 0]],
			],
			[],
			true,
		]);
	});

	it("merges several claims for one entry whatever their order, clamps tiers, and can skip the NEW dot", () => {
		const claims = [
			{ id: "duo:skewer", tier: 1, floor: 2 },
			{ id: "duo:skewer", tier: 2, floor: 8 },
			{ id: "duo:skewer", tier: 2, floor: 5 },
			{ id: "relic:hourglass", tier: 7, floor: 1 },
		];
		const reversed = [claims[3], claims[2], claims[1], claims[0]];
		const x = applyClaims(emptyCodexDoc(), claims, DAY);
		expect(sameCodexDoc(x, applyClaims(emptyCodexDoc(), reversed, DAY))).toBe(true);
		expect(x.e.get("duo:skewer")).toEqual([2, DAY, 5]);
		expect(x.e.get("relic:hourglass")).toEqual([2, DAY, 1]);
		const quiet = applyClaims(emptyCodexDoc(), claims, DAY, false);
		expect(quiet.unread).toBeUndefined();
		expect(quiet.e.size()).toBe(2);
	});

	it("decodes untrusted claim and viewed payloads", () => {
		expect(decodeCodexClaims("x")).toBeUndefined();
		expect(decodeCodexClaims(undefined)).toBeUndefined();
		const big: defined[] = [];
		for (let i = 0; i <= CODEX.claimMaxItems; i++) big.push({ id: "enemy:imp", tier: 1, floor: 1 });
		expect(decodeCodexClaims(big)).toBeUndefined();
		big.pop();
		expect(decodeCodexClaims(big)!.size()).toBe(CODEX.claimMaxItems);
		expect(
			decodeCodexClaims([
				{ id: "enemy:imp", tier: 1, floor: 3 },
				{ id: "enemy:nope", tier: 1, floor: 3 },
				{ id: "boon:volatile", tier: 1.5, floor: 3 },
				{ id: "boon:volatile", tier: 3, floor: 3 },
				{ id: "boon:volatile", tier: "2", floor: 3 },
				"boon:volatile",
				{ id: "boss:act1", tier: 2, floor: 2000.7 },
				{ id: "boss:demonlord", tier: 2, floor: "deep" },
				{ id: "affix:swift", tier: 2, floor: -4 },
			]),
		).toEqual([
			{ id: "enemy:imp", tier: 1, floor: 3 },
			{ id: "boss:act1", tier: 2, floor: CODEX.floorMax },
			{ id: "boss:demonlord", tier: 2, floor: 0 },
			{ id: "affix:swift", tier: 2, floor: 0 },
		]);
		expect(decodeCodexViewed(5)).toBeUndefined();
		const many: string[] = [];
		for (let i = 0; i <= CODEX.viewedMaxIds; i++) many.push("enemy:imp");
		expect(decodeCodexViewed(many)).toBeUndefined();
		expect(decodeCodexViewed(["enemy:imp", "nope", 3, "boon:volatile", "enemy:imp"])).toEqual([
			"boon:volatile",
			"enemy:imp",
		]);
	});
});

describe("codex store transform", () => {
	it("cancels over a newer version and when nothing changes", () => {
		const doc = sample();
		expect(mergeStoredCodex({ v: CODEX_DOC_VERSION + 1, e: {} }, doc)).toBeUndefined();
		expect(mergeStoredCodex(encodeCodexDoc(doc), doc)).toBeUndefined();
		// junk with nothing to keep: no write; junk with a doc to keep: replaced
		expect(mergeStoredCodex("junk", emptyCodexDoc())).toBeUndefined();
		expect(rows(mergeStoredCodex("junk", doc)!)).toEqual(rows(doc));
	});

	it("keeps what another server stored without bringing back dots this session cleared", () => {
		const stored = encodeCodexDoc(
			docOf(
				[
					["enemy:imp", [2, 50, 3]],
					["boon:volatile", [1, 0, 0]],
					["relic:hourglass", [2, 60, 2]],
				],
				["enemy:imp", "boon:volatile", "relic:hourglass"],
				true,
			),
		);
		// this session loaded imp / volatile (then viewed both) but not the hourglass another server added; it found
		// volatile and a new boss
		const session = docOf(
			[
				["enemy:imp", [2, 50, 3]],
				["boon:volatile", [2, 70, 4]],
				["boss:act1", [2, 70, 5]],
			],
			["boss:act1"],
			true,
		);
		const out = mergeStoredCodex(stored, session)!;
		expect(rows(out)).toEqual([
			[
				["boon:volatile", [2, 70, 4]],
				["boss:act1", [2, 70, 5]],
				["enemy:imp", [2, 50, 3]],
				["relic:hourglass", [2, 60, 2]],
			],
			["boss:act1", "relic:hourglass"],
			true,
		]);
	});

	it("rollout: keeps a newer server's well-formed unknown entries and their dots untouched (claude/codex-plan.md)", () => {
		const future = [2, 5, 3];
		const stored = {
			v: CODEX_DOC_VERSION,
			e: new Map<string, unknown>([["boon:future", future]]),
			unread: ["boon:future"],
		};
		const incomings = [
			emptyCodexDoc(),
			sample(),
			docOf([["enemy:imp", [2, 9, 1]]], ["enemy:imp"]),
			docOf([], undefined, true),
		];
		for (const incoming of incomings) {
			const out = mergeStoredCodex(stored, incoming);
			if (out === undefined) {
				// nothing to write: the stored value (with the unknown entry) stays as it is
				expect(incoming.e.size()).toBe(0);
				expect(incoming.seeded).toBeUndefined();
				continue;
			}
			expect(out.e.get("boon:future")).toBe(future);
			expect(out.unread?.includes("boon:future")).toBe(true);
			// the session / display doc still drops it
			expect(decodeCodexDoc(out).e.has("boon:future")).toBe(false);
			// and a later write over the result keeps it again
			const again = mergeStoredCodex(out, docOf([["enemy:swarmer", [1, 0, 0]]]))!;
			expect([again.e.get("boon:future"), again.unread?.includes("boon:future")]).toEqual([future, true]);
		}
		// a stored doc of a newer catalog alone: no write
		expect(mergeStoredCodex(stored, emptyCodexDoc())).toBeUndefined();
	});

	it("rollout: malformed unknown ids, bad marks and dots without an entry still drop", () => {
		const stored = {
			v: CODEX_DOC_VERSION,
			e: new Map<string, unknown>([
				["boon:future", [1, 0, 0]],
				["no-colon", [2, 1, 1]],
				["boon:bad key", [2, 1, 1]],
				["boon:badMark", "x"],
				["boon:noTier", ["x", 1, 1]],
			]),
			unread: ["boon:future", "boon:ghost", "no-colon"],
		};
		const out = mergeStoredCodex(stored, sample())!;
		const unknown: string[] = [];
		for (const [id] of out.e) if (codexIds(decodeCodexDoc(out)).includes(id) === false) unknown.push(id);
		unknown.sort();
		expect(unknown).toEqual(["boon:future"]);
		expect(out.unread).toEqual(["boon:future", "boon:volatile", "duo:fireArrows"]);
	});
});

describe("codex seed and counts", () => {
	it("maps the onboarding sightings to tier-1 claims", () => {
		const claims = seedFromSightings(SIGHTING_IDS);
		const ids: string[] = [];
		for (const c of claims) {
			expect([c.id, c.tier, c.floor]).toEqual([c.id, CodexTier.SEEN, 0]);
			ids.push(c.id);
		}
		expect(ids).toEqual([
			"affix:hulking",
			"affix:shielded",
			"affix:swift",
			"affix:vengeful",
			"enemy:bomber",
			// docs/NEW_ENEMIES_2.md NX9: their first-time cards seed their entries
			"enemy:bulwark",
			"enemy:chainhook",
			"enemy:charger",
			"enemy:golden",
			"enemy:imp",
			// docs/NEW_ENEMIES_3.md NT6: their entries exist now, so their first-time cards seed them
			"enemy:jackal",
			"enemy:mender",
			"enemy:mortar",
			"enemy:pyrekeeper",
			"enemy:reaper",
			"enemy:slime",
			"enemy:snatcher",
			"enemy:stormcaller",
			"enemy:summoner",
			"enemy:warbanner",
			// docs/SECRET_ROOMS.md SRD12: the first knock's card (sighting secret.crack) sees the secret rooms' entry
			"secret:room",
		]);
		expect(seedFromSightings(["secret.crack"])).toEqual([{ id: "secret:room", tier: 1, floor: 0 }]);
		// pellet.power, the rumour card golden.rumour (not the Goldling seen), unknown, junk and duplicates dropped
		expect(
			seedFromSightings([
				"pellet.power",
				"golden.rumour",
				"affix.nope",
				"dragon",
				5,
				"imp",
				"imp",
				"slime.small",
				"pyre",
			]),
		).toEqual([
			{ id: "enemy:imp", tier: 1, floor: 0 },
			// a brazier folds into its keeper (docs/NEW_ENEMIES_2.md NXD15), like a slimelet into the Ooze
			{ id: "enemy:pyrekeeper", tier: 1, floor: 0 },
			{ id: "enemy:slime", tier: 1, floor: 0 },
		]);
		const seeded = applyClaims(emptyCodexDoc(), claims, 20000);
		expect(seeded.e.size()).toBe(21);
		expect(codexFoundCount(seeded)).toBe(0);
	});

	it("counts found entries and tells tiers and days", () => {
		const doc = sample();
		expect(codexFoundCount(doc)).toBe(3);
		expect(codexFoundCount(doc, "boons")).toBe(1);
		expect(codexFoundCount(doc, "bestiary")).toBe(1);
		expect(codexFoundCount(doc, "items")).toBe(0);
		expect(codexFoundCount(undefined)).toBe(0);
		expect(codexTier(doc, "enemy:imp")).toBe(CodexTier.SEEN);
		expect(codexTier(doc, "enemy:sniper")).toBe(CodexTier.NONE);
		expect(codexTier(undefined, "enemy:imp")).toBe(CodexTier.NONE);
		expect(codexDay(0)).toBe(0);
		expect(codexDay(CODEX.secondsPerDay * 20404 + 3600)).toBe(20404);
		expect(codexIds(doc)).toEqual(["boon:volatile", "boss:act1", "duo:fireArrows", "enemy:imp"]);
		expect(CODEX_CATALOG.size()).toBeGreaterThan(0);
	});
});
