// The Codex tracker (claude/codex-plan.md CX4): each category's seen / found rule on hand-built frames (sightings follow
// the frame's view lists, finds are the local player's), party kills while present, slimelets, a leaver, the baseline
// (the loaded doc plus earlier rises), the per-floor toast budget with its always-pass kinds, the toast routes (chip /
// card / codex), M1 / debug / tutorial eligibility, nothing before the doc loads (held, resolved silently), the run
// summary's order and freeze, codexNewThisRun.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	CODEX,
	CodexTier,
	applyClaims,
	catalogTotal,
	codexEligibility,
	codexEntry,
	emptyCodexDoc,
	type CodexDoc,
	type CodexEligibility,
	type CodexRunContext,
} from "shared/codex";
import { AffixKind } from "shared/dungeon";
import { Boon, Boost, CardKind, Curse, Duo, Relic, boonCard, duoCard } from "shared/sim";
import {
	CodexTracker,
	codexSightingId,
	codexSummaryRank,
	codexToastRoute,
	newCodexFrame,
	type CodexFrameBuffer,
	type CodexTrackerOutput,
} from ".";

const ENDLESS: CodexRunContext = { world: "endless", debug: false, dev: false, stress: 0, studio: false };
const FULL = codexEligibility(ENDLESS);

function docOf(claims: ReadonlyArray<[string, number]>): CodexDoc {
	return applyClaims(
		emptyCodexDoc(),
		claims.map(([id, tier]) => ({ id, tier, floor: 1 })),
		1,
	);
}

/** A tracker with a loaded doc (empty by default) and a started run. */
function tracker(doc: CodexDoc = emptyCodexDoc(), eligibility: CodexEligibility = FULL): CodexTracker {
	const t = new CodexTracker();
	t.receive(doc);
	t.startRun(eligibility);
	return t;
}

/** A frame on `floor` (nothing in it). */
function frame(floor = 1): CodexFrameBuffer {
	const f = newCodexFrame();
	f.floor = floor;
	return f;
}

/** The output's rises as [id, tier] pairs, plus copies of the toast lists (the output is reused). */
function read(out: CodexTrackerOutput): { rises: [string, number][]; codex: string[]; chips: string[] } {
	return {
		rises: out.rises.map((r) => [r.id, r.tier] as [string, number]),
		codex: [...out.codexToasts],
		chips: [...out.chips],
	};
}

const S = CodexTier.SEEN;
const F = CodexTier.FOUND;

describe("CodexTracker: boons, evolutions and duos", () => {
	it("a dealt card is seen (NEW / UPGRADE name the boon, EVOLUTION the evolution, a duo card the duo); no toast", () => {
		const t = tracker(docOf([["boon:hearty", F]]));
		const f = frame();
		f.draftOffers.push(
			boonCard(Boon.SHARPENED),
			boonCard(Boon.HEARTY),
			boonCard(Boon.BOUNTY),
			duoCard(Duo.GOLD_RUSH),
		);
		f.draftKinds.push(CardKind.NEW, CardKind.UPGRADE, CardKind.EVOLUTION, CardKind.DUO);
		expect(read(t.update(f))).toEqual({
			rises: [
				["boon:sharpened", S],
				["evo:bounty", S],
				["duo:goldRush", S],
			],
			codex: [],
			chips: [],
		});
		// The same deal next frame: nothing new (each rise once)
		expect(t.update(f).rises.size()).toBe(0);
		// Unfound cards wear the NEW tag (seen still counts as not found); a found one does not
		expect([t.showsNewTag("boon:sharpened"), t.showsNewTag("boon:hearty"), t.showsNewTag("evo:bounty")]).toEqual([
			true,
			false,
			true,
		]);
		expect([t.showsNewTag(undefined), t.showsNewTag("boon:nope")]).toEqual([false, false]);
	});

	it("taken: a boon owned is found (chip), level III finds the evolution, a duo owned the duo (chips that always pass)", () => {
		const t = tracker();
		const f = frame(3);
		f.boons.push(Boon.SWIFT_STRIKES);
		expect(read(t.update(f))).toEqual({
			rises: [["boon:swiftStrikes", F]],
			codex: [],
			chips: ["boon:swiftStrikes"],
		});
		const rise = t.update(frame()).rises; // reused output: cleared
		expect(rise.size()).toBe(0);
		f.levels[Boon.SWIFT_STRIKES] = 2;
		expect(t.update(f).rises.size()).toBe(0);
		f.levels[Boon.SWIFT_STRIKES] = 3;
		f.duos.push(Duo.STORM_BLADE);
		const out = read(t.update(f));
		expect(out.rises).toEqual([
			["evo:swiftStrikes", F],
			["duo:stormBlade", F],
		]);
		expect(out.chips).toEqual(["evo:swiftStrikes", "duo:stormBlade"]);
		// found order; the duo before the evolution on their shared frame (rarest first)
		expect(t.codexRunSummary().newIds).toEqual(["boon:swiftStrikes", "duo:stormBlade", "evo:swiftStrikes"]);
	});

	it("a legendary's level 1 is its only level: no evolution", () => {
		const t = tracker();
		const f = frame();
		f.boons.push(Boon.COMPOSURE);
		f.levels[Boon.COMPOSURE] = 1;
		expect(read(t.update(f)).rises).toEqual([["boon:composure", F]]);
	});
});

describe("CodexTracker: relics, curses, boosts", () => {
	it("a relic is found when owned (R1): a pedestal's decorates its toast, a vault chest's gets a codex toast", () => {
		const t = tracker();
		const f = frame();
		f.relics.push(Relic.HOURGLASS);
		f.pedestalRelics.push(Relic.HOURGLASS);
		expect(read(t.update(f))).toEqual({ rises: [["relic:hourglass", F]], codex: [], chips: ["relic:hourglass"] });
		f.pedestalRelics.clear();
		f.relics.push(Relic.SECOND_WIND); // from a chest: no relic toast this frame
		expect(read(t.update(f))).toEqual({
			rises: [["relic:secondWind", F]],
			codex: ["relic:secondWind"],
			chips: [],
		});
	});

	it("a curse is seen on the Greed card shown to the view player (no toast), found when accepted (chip)", () => {
		const t = tracker();
		const f = frame();
		f.greedCurse = Curse.THIRST;
		expect(read(t.update(f))).toEqual({ rises: [["curse:thirst", S]], codex: [], chips: [] });
		f.greedCurse = -1;
		f.curses.push(Curse.THIRST);
		expect(read(t.update(f))).toEqual({ rises: [["curse:thirst", F]], codex: [], chips: ["curse:thirst"] });
		// the tutorial's classic shrine: seen = found on one frame (one found rise)
		f.curses.push(Curse.FRAILTY);
		f.greedCurse = Curse.FRAILTY;
		expect(read(t.update(f)).rises).toEqual([["curse:frailty", F]]);
	});

	it("a boost drop near the view player is seen (silent); running on you finds it (a codex toast)", () => {
		const t = tracker();
		const f = frame();
		f.drops.push(Boost.FRENZY, Boost.FRENZY);
		expect(read(t.update(f))).toEqual({ rises: [["boost:frenzy", S]], codex: [], chips: [] });
		f.drops.clear();
		f.boosts.push(Boost.FRENZY);
		expect(read(t.update(f))).toEqual({ rises: [["boost:frenzy", F]], codex: ["boost:frenzy"], chips: [] });
	});
});

describe("CodexTracker: the bestiary", () => {
	it("enemies near the view player are seen: a kind with a bestiary line goes to its card, the rest to a codex toast", () => {
		const t = tracker();
		const f = frame();
		f.actors.push({ archetype: "imp", affix: AffixKind.NONE }, { archetype: "swarmer", affix: AffixKind.NONE });
		f.actors.push({ archetype: "turret.sprayer", affix: AffixKind.NONE }, { archetype: "dummy", affix: 0 });
		expect(read(t.update(f))).toEqual({
			rises: [
				["enemy:swarmer", S],
				["enemy:imp", S],
			],
			codex: ["enemy:swarmer"],
			chips: [],
		});
		// The SightingCard for the imp wears the chip; one with no rise this run does not
		expect([t.sightingChip("imp"), t.sightingChip("slime"), t.sightingChip("pellet.power")]).toEqual([
			true,
			false,
			false,
		]);
	});

	it("a death while present finds it (any party kill): a codex toast; a slimelet counts for the Ooze", () => {
		const t = tracker();
		const f = frame();
		f.deaths.push({ archetype: "slime.small", affix: AffixKind.NONE });
		expect(read(t.update(f))).toEqual({ rises: [["enemy:slime", F]], codex: ["enemy:slime"], chips: [] });
		const g = frame();
		g.deaths.push({ archetype: "dummy", affix: AffixKind.NONE }, { archetype: "turret.sprayer", affix: 0 });
		expect(t.update(g).rises.size()).toBe(0);
	});

	it("one codex toast per entry per run: a swarmer seen then killed toasts once; an imp's card, then its kill toasts", () => {
		const t = tracker();
		const seen = frame();
		seen.actors.push({ archetype: "swarmer", affix: AffixKind.NONE }, { archetype: "imp", affix: AffixKind.NONE });
		expect(read(t.update(seen)).codex).toEqual(["enemy:swarmer"]);
		const kill = frame(2);
		kill.deaths.push({ archetype: "swarmer", affix: AffixKind.NONE }, { archetype: "imp", affix: AffixKind.NONE });
		expect(read(t.update(kill))).toEqual({
			rises: [
				["enemy:swarmer", F],
				["enemy:imp", F],
			],
			codex: ["enemy:imp"],
			chips: [],
		});
	});

	it("affixes: an affixed enemy in view is seen (its card), its death finds the affix (codex toast) and the enemy", () => {
		const t = tracker();
		const f = frame();
		f.actors.push({ archetype: "bruiser", affix: AffixKind.SHIELDED });
		expect(read(t.update(f))).toEqual({
			rises: [
				["enemy:bruiser", S],
				["affix:shielded", S],
			],
			codex: ["enemy:bruiser"],
			chips: [],
		});
		expect(t.sightingChip("affix.shielded")).toBe(true);
		const g = frame();
		g.deaths.push({ archetype: "bruiser", affix: AffixKind.SHIELDED });
		expect(read(t.update(g))).toEqual({
			rises: [
				["enemy:bruiser", F],
				["affix:shielded", F],
			],
			codex: ["affix:shielded"], // the bruiser had its codex toast this run already
			chips: [],
		});
	});

	it("a boss is seen when it engages (silent), found when it dies (a codex toast that always passes)", () => {
		const t = tracker();
		const f = frame(5);
		f.bossEngaged = "boss.demonlord";
		f.actors.push({ archetype: "boss.demonlord", affix: AffixKind.NONE }); // being near a boss is not engaging
		expect(read(t.update(f))).toEqual({ rises: [["boss:demonlord", S]], codex: [], chips: [] });
		const g = frame(5);
		g.bossDefeated = "boss.demonlord";
		expect(read(t.update(g))).toEqual({ rises: [["boss:demonlord", F]], codex: ["boss:demonlord"], chips: [] });
		// a boss archetype among the deaths counts too
		const h = frame(10);
		h.deaths.push({ archetype: "boss.act1", affix: AffixKind.NONE });
		expect(read(t.update(h)).rises).toEqual([["boss:act1", F]]);
	});
});

describe("CodexTracker: who counts", () => {
	it("spectating: the view lists (a teammate's sightings, their Greed card) count; finds stay the local player's", () => {
		// readCodexFrame fills `actors` / `drops` / `greedCurse` from the VIEW player and the finds from the local one
		// (frame.spec.ts); the tracker counts whatever the frame holds, whoever is watched
		const t = tracker();
		const f = frame();
		f.localIndex = 0;
		f.viewIndex = 1;
		f.actors.push({ archetype: "charger", affix: AffixKind.NONE });
		f.greedCurse = Curse.HASTE;
		expect(read(t.update(f)).rises).toEqual([
			["curse:haste", S],
			["enemy:charger", S],
		]);
	});

	it("a leaver claims nothing from the frame they left on (deaths included), for the rest of the run", () => {
		const t = tracker();
		const f = frame();
		f.deaths.push({ archetype: "sniper", affix: AffixKind.NONE });
		f.left = true;
		expect(t.update(f).rises.size()).toBe(0);
		f.left = false;
		expect(t.update(f).rises.size()).toBe(0);
		// the next run counts again
		t.startRun(FULL);
		expect(read(t.update(f)).rises).toEqual([["enemy:sniper", F]]);
	});

	it("nothing after run over (the summary freezes), nothing before startRun or after endRun", () => {
		const t = new CodexTracker();
		t.receive(emptyCodexDoc());
		const f = frame();
		f.boons.push(Boon.BOUNTY);
		expect(t.update(f).rises.size()).toBe(0); // no run yet
		t.startRun(FULL);
		expect(t.update(f).rises.size()).toBe(1);
		const over = frame();
		over.runOver = true;
		over.boons.push(Boon.DAREDEVIL);
		expect(t.update(over).rises.size()).toBe(0);
		over.runOver = false;
		expect(t.update(over).rises.size()).toBe(0);
		expect(t.codexRunSummary().newIds).toEqual(["boon:bounty"]);
		t.startRun(FULL);
		t.endRun();
		expect(t.update(over).rises.size()).toBe(0);
	});
});

describe("CodexTracker: eligibility (R8 / R9)", () => {
	const of = (patch: Partial<CodexRunContext>) => codexEligibility({ ...ENDLESS, ...patch });

	it("M1, the dev world, a debug or stress run claim nothing", () => {
		for (const e of [of({ world: "game" }), of({ world: "dev" }), of({ debug: true }), of({ stress: 3 })]) {
			const t = tracker(emptyCodexDoc(), e);
			const f = frame();
			f.boons.push(Boon.HEARTY);
			f.actors.push({ archetype: "swarmer", affix: AffixKind.NONE });
			expect(t.update(f).rises.size()).toBe(0);
			expect([t.showsNewTag("boon:sharpened"), t.codexRunSummary().newIds.size()]).toEqual([false, 0]);
		}
	});

	it("the tutorial claims silently: rises, no codex toasts, chips, card chips or NEW tags", () => {
		const t = tracker(emptyCodexDoc(), of({ world: "tutorial" }));
		const f = frame();
		f.boons.push(Boon.HEARTY);
		f.actors.push({ archetype: "swarmer", affix: AffixKind.NONE }, { archetype: "imp", affix: AffixKind.NONE });
		f.deaths.push({ archetype: "boss.act1", affix: AffixKind.NONE });
		const out = read(t.update(f));
		expect(out.rises).toEqual([
			["boon:hearty", F],
			["enemy:swarmer", S],
			["enemy:imp", S],
			["boss:act1", F],
		]);
		expect([out.codex, out.chips]).toEqual([[], []]);
		expect([t.sightingChip("imp"), t.showsNewTag("boon:sharpened")]).toEqual([false, false]);
		expect(t.codexRunSummary().newIds).toEqual(["boss:act1", "boon:hearty"]);
	});
});

describe("CodexTracker: the baseline and the load", () => {
	it("only rises against the loaded doc and earlier rises; a seen entry still rises to found; a later doc merges up", () => {
		const t = tracker(
			docOf([
				["enemy:imp", F],
				["enemy:sniper", S],
			]),
		);
		const f = frame();
		f.actors.push({ archetype: "imp", affix: 0 }, { archetype: "sniper", affix: 0 });
		expect(t.update(f).rises.size()).toBe(0);
		f.deaths.push({ archetype: "sniper", affix: 0 }, { archetype: "imp", affix: 0 });
		expect(read(t.update(f)).rises).toEqual([["enemy:sniper", F]]);
		// A later status (another server) raises the baseline; it never lowers it
		t.receive(docOf([["boon:hearty", F]]));
		expect([t.tier("enemy:sniper"), t.tier("boon:hearty"), t.tier("boon:sharpened")]).toEqual([
			F,
			F,
			CodexTier.NONE,
		]);
		const g = frame();
		g.boons.push(Boon.HEARTY);
		expect(t.update(g).rises.size()).toBe(0);
		// The next run of the session: earlier rises are the baseline, so nothing is new again
		t.startRun(FULL);
		expect(t.update(f).rises.size()).toBe(0);
		expect([t.codexNewThisRun("enemy:sniper"), t.codexRunSummary().newIds.size()]).toEqual([false, 0]);
	});

	it("before the doc loads nothing rises and nothing is NEW; the loading receive resolves the held entries silently", () => {
		const t = new CodexTracker();
		t.startRun(FULL);
		const f = frame(4);
		f.boons.push(Boon.WARDING);
		f.actors.push({ archetype: "swarmer", affix: 0 }, { archetype: "imp", affix: 0 });
		expect(read(t.update(f))).toEqual({ rises: [], codex: [], chips: [] });
		expect([t.isLoaded(), t.showsNewTag("boon:sharpened"), t.codexRunSummary().loaded]).toEqual([
			false,
			false,
			false,
		]);
		const g = frame(5);
		g.deaths.push({ archetype: "imp", affix: 0 });
		t.update(g);
		// The doc already has the swarmer seen: only the rest rise, at their held tier and floor, in first-seen order
		const rises = t.receive(docOf([["enemy:swarmer", S]]));
		expect(rises.map((r) => [r.id, r.tier, r.floor])).toEqual([
			["boon:warding", F, 4],
			["enemy:imp", F, 5],
		]);
		expect([t.isLoaded(), t.codexNewThisRun("boon:warding"), t.codexNewThisRun("enemy:imp")]).toEqual([
			true,
			true,
			true,
		]);
		expect(t.codexRunSummary().newIds).toEqual(["boon:warding", "enemy:imp"]);
		// resolved once: the next frames rise nothing for them
		expect(t.update(f).rises.size()).toBe(0);
		expect(t.receive(emptyCodexDoc()).size()).toBe(0);
	});

	it("a failed load (`loaded: false`) drops the held entries and claims nothing for the session", () => {
		const t = new CodexTracker();
		t.startRun(FULL);
		const f = frame();
		f.boons.push(Boon.WARDING);
		t.update(f);
		expect(t.receive(undefined)).toEqual([]);
		expect([t.isUnavailable(), t.isLoaded()]).toEqual([true, false]);
		expect(t.update(f).rises.size()).toBe(0);
		expect(t.codexRunSummary()).toEqual({ newIds: [], foundTotal: 0, catalogTotal: catalogTotal(), loaded: false });
		// a doc that loads after all (a later request) resolves nothing held, then counts as usual
		expect(t.receive(emptyCodexDoc()).size()).toBe(0);
		expect(t.update(f).rises.size()).toBe(1);
		// once loaded, a `loaded: false` is ignored
		t.receive(undefined);
		expect(t.isLoaded()).toBe(true);
	});
});

describe("CodexTracker: the toast budget (CXD8)", () => {
	it("at most CODEX.toastsPerFloor chips and codex toasts per floor, catalog order; a new floor resets it", () => {
		expect(CODEX.toastsPerFloor).toBe(2);
		const t = tracker();
		const f = frame(1);
		f.boons.push(Boon.SHARPENED, Boon.HEARTY);
		f.actors.push({ archetype: "swarmer", affix: 0 }, { archetype: "sniper", affix: 0 });
		const out = read(t.update(f));
		expect(out.rises.size()).toBe(4);
		expect([out.chips, out.codex]).toEqual([["boon:sharpened", "boon:hearty"], []]);
		// spent on floor 1: a later find on the floor is silent (it still rises)
		const g = frame(1);
		g.boosts.push(Boost.AEGIS);
		expect(read(t.update(g))).toEqual({ rises: [["boost:aegis", F]], codex: [], chips: [] });
		// floor 2: a fresh budget
		const h = frame(2);
		h.deaths.push(
			{ archetype: "swarmer", affix: 0 },
			{ archetype: "bruiser", affix: 0 },
			{ archetype: "sniper", affix: 0 },
		);
		expect(read(t.update(h)).codex).toEqual(["enemy:swarmer", "enemy:sniper"]);
	});

	it("boss kills, duo / evolution chips and chest relics always pass and never use the budget", () => {
		const t = tracker();
		const f = frame(5);
		f.boons.push(Boon.SHARPENED, Boon.HEARTY, Boon.BOUNTY);
		f.levels[Boon.LINGERING] = 3;
		f.duos.push(Duo.CHAIN_REACTION);
		f.relics.push(Relic.VAMPIRE_FANG);
		f.bossDefeated = "boss.act1";
		const out = read(t.update(f));
		expect(out.chips).toEqual(["boon:sharpened", "boon:hearty", "evo:lingering", "duo:chainReaction"]);
		expect(out.codex).toEqual(["relic:vampireFang", "boss:act1"]);
	});

	it("routes per kind (codexToastRoute)", () => {
		const route = (id: string, tier: 1 | 2, pedestal = false) => {
			const d = codexToastRoute(codexEntry(id)!, tier, pedestal);
			return `${d.route}${d.always ? "!" : ""}`;
		};
		expect([route("boon:volatile", S), route("boon:volatile", F)]).toEqual(["none", "chip"]);
		expect([route("evo:volatile", S), route("evo:volatile", F)]).toEqual(["none", "chip!"]);
		expect([route("duo:supernova", S), route("duo:supernova", F)]).toEqual(["none", "chip!"]);
		expect([route("relic:hourglass", F, true), route("relic:hourglass", F)]).toEqual(["chip", "codex!"]);
		expect([route("curse:haste", S), route("curse:haste", F)]).toEqual(["none", "chip"]);
		expect([route("boost:fury", S), route("boost:fury", F)]).toEqual(["none", "codex"]);
		expect([route("enemy:reaper", S), route("enemy:bruiser", S), route("enemy:reaper", F)]).toEqual([
			"card!",
			"codex",
			"codex",
		]);
		expect([route("enemy:golden", S), route("affix:swift", S), route("affix:swift", F)]).toEqual([
			"card!",
			"card!",
			"codex",
		]);
		expect([route("boss:act1", S), route("boss:act1", F)]).toEqual(["none", "codex!"]);
	});
});

describe("CodexTracker: the run summary", () => {
	it("found order across frames; on one frame rarest first (legendary, duo, evolution, boss, rare, the rest)", () => {
		const t = tracker(docOf([["boon:bounty", F]]));
		const a = frame(1);
		a.actors.push({ archetype: "swarmer", affix: 0 }); // seen only: not in the summary
		a.deaths.push({ archetype: "sniper", affix: 0 });
		t.update(a);
		const b = frame(5);
		b.boons.push(Boon.WARDING, Boon.SWIFT_STRIKES, Boon.OVERKILL);
		b.levels[Boon.BOUNTY] = 3;
		b.duos.push(Duo.HAPPY_HOUR);
		b.bossDefeated = "boss.act1";
		b.relics.push(Relic.HOURGLASS);
		t.update(b);
		const s = t.codexRunSummary();
		expect(s.newIds).toEqual([
			"enemy:sniper",
			"boon:overkill",
			"duo:happyHour",
			"evo:bounty",
			"boss:act1",
			"boon:warding",
			"boon:swiftStrikes",
			"relic:hourglass",
		]);
		expect([s.foundTotal, s.catalogTotal, s.loaded]).toEqual([9, catalogTotal(), true]);
		expect([t.codexNewThisRun("duo:happyHour"), t.codexNewThisRun("boon:bounty")]).toEqual([true, false]);
		expect([t.codexNewThisRun("enemy:swarmer"), t.risenThisRun("enemy:swarmer")]).toEqual([false, S]);
		// frozen at run over: a later frame, even a new doc, leaves it as it was
		const over = frame(5);
		over.runOver = true;
		t.update(over);
		t.receive(docOf([["boon:hearty", F]]));
		expect(t.codexRunSummary()).toEqual(s);
		// a new run starts a new summary
		t.startRun(FULL);
		expect(t.codexRunSummary().newIds).toEqual([]);
		expect(t.codexRunSummary().foundTotal).toBe(10);
	});

	it("ranks (codexSummaryRank) and sighting ids (codexSightingId)", () => {
		const rank = (id: string) => codexSummaryRank(codexEntry(id)!);
		expect(
			["boon:bastion", "duo:citadel", "evo:hearty", "boss:demonlord", "boon:hearty", "boon:slippery"].map(rank),
		).toEqual([0, 1, 2, 3, 4, 5]);
		expect(["relic:hourglass", "curse:haste", "boost:fury", "enemy:imp", "affix:swift"].map(rank)).toEqual([
			5, 5, 5, 5, 5,
		]);
		expect(["imp", "slime", "golden", "affix.vengeful", "pellet.power", "nope"].map(codexSightingId)).toEqual([
			"enemy:imp",
			"enemy:slime",
			"enemy:golden",
			"affix:vengeful",
			undefined,
			undefined,
		]);
	});
});
