// The Pact of Greed (docs/FORTUNE.md PS3, FD3-FD6): once per player per shrine, the curse the altar shows
// (greedCurseFor, no draw) applied with its +0.25, then the Legendary deal (drawLegendaryOffers on the main rng: the
// legendary pool first, ordinary upgrades after it) opened mid-floor as the player's draft (draftKind GREED, one deal).
// Dim cases (taken, no curse, no legendary, a dead player) take nothing and draw nothing. The world freezes like every
// draft and resumes on the pick; the floor draft that follows on the next floor change opens exactly as without Greed
// (one deal, two after a boss floor; never swallowed, never doubled; draftKind back to NO_PACT). Co-op 2-4: each player
// their own curse and deal, the world frozen until everyone picked. Without builds the deal draws the unowned legendary
// classic boons.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOON_COUNT,
	BOON_MAX_LEVEL,
	BOONS,
	Boon,
	CURSE_COUNT,
	DEBUG_FLOOR_BUTTON,
	DRAFT_CONFIRM_BUTTON,
	DRAFT_MIN_OPEN_TICKS,
	DRAFT_SCREEN_RIGHT_X,
	DRAFT_SCREEN_RIGHT_Z,
	DUO_COUNT,
	Duo,
	NO_KIND,
	NO_PACT,
	PactDim,
	PactKind,
	Rarity,
	Rng,
	SHRINE_BUTTON,
	acceptCurse,
	atShrine,
	boonCard,
	cardBoon,
	cardDuo,
	createSimState,
	drawLegendaryOffers,
	duoCard,
	greedCurseFor,
	isDraftOpen,
	legendaryPool,
	pactAltarAt,
	pactAvailability,
	pactDraftKind,
	playerAt,
	rngInt,
	step,
	stepParty,
	type InputFrame,
	type SimState,
} from "shared/sim";
import { isBossFloor } from "shared/dungeon";
import { altarFloor, floorAltars, frame, pactsSetup, pressPact, skipToFloor, teleport } from "shared/run/testing";
import type { EndlessRunSetup } from "shared/run";

const SEED = 1337;

function onAltarFloor(seed = SEED, party = 1, on = true) {
	const setup = pactsSetup(seed, party, on);
	const f = altarFloor(setup);
	expect(f > 0).toBe(true);
	const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
	if (party === 1) skipToFloor(s, setup.config, f);
	else partySkipToFloor(s, setup, f);
	return { setup, s, f };
}

function idle(n: number, buttons: (i: number) => number = () => 0): InputFrame[] {
	const out: InputFrame[] = [];
	for (let i = 0; i < n; i++) out.push(frame(0, 0, buttons(i)));
	return out;
}

/** Co-op: player 0's debug skip to `floor`, every draft closed without a pick (test surgery, as skipToFloor). */
function partySkipToFloor(s: SimState, setup: EndlessRunSetup, floor: number): void {
	const n = s.party!.size;
	while (s.endless!.floor < floor) {
		stepParty(
			s,
			idle(n, (i) => (i === 0 ? DEBUG_FLOOR_BUTTON : 0)),
			setup.config,
		);
		for (const p of s.run!.players) {
			p.draftOpen = 0;
			p.draftOffers = [];
			p.draftTicks = 0;
		}
		for (const b of s.builds!.players) b.draftsLeft = 0;
		stepParty(s, idle(n), setup.config);
	}
}

/** Confirms player `i`'s open draft on its first card (solo: step; co-op: everyone else idle). */
function pickFirst(s: SimState, setup: EndlessRunSetup, i = 0): number {
	const me = s.run!.players[i];
	const n = s.party?.size ?? 1;
	const card = me.draftOffers[0];
	// the left column is card 0 for 2 and 3 cards (and the only card for 1)
	const lx = -DRAFT_SCREEN_RIGHT_X;
	const lz = -DRAFT_SCREEN_RIGHT_Z;
	const left = (k: number) => (k === i ? frame(lx, lz) : frame(0, 0));
	const press = (k: number) => (k === i ? frame(lx, lz, DRAFT_CONFIRM_BUTTON) : frame(0, 0));
	const tick = (f: (k: number) => InputFrame) => {
		if (n === 1) step(s, f(0), setup.config);
		else {
			const inputs: InputFrame[] = [];
			for (let k = 0; k < n; k++) inputs.push(f(k));
			stepParty(s, inputs, setup.config);
		}
	};
	while (me.draftTicks + 1 < DRAFT_MIN_OPEN_TICKS) tick(left);
	tick(press);
	tick(() => frame(0, 0));
	return card;
}

describe("Pact of Greed (PS3)", () => {
	it("takes the shown curse (+0.25), opens the Legendary deal as the player's one-deal draft, draftKind GREED", () => {
		const { setup, s } = onAltarFloor();
		expect(pactAvailability(s, setup.config, 0, PactKind.GREED)).toBe(PactDim.NONE);
		const shown = greedCurseFor(s, 0);
		expect(shown >= 0 && shown < CURSE_COUNT).toBe(true);
		const cursesBefore = s.score!.curses;
		const altar = floorAltars(setup, s)!.altars[PactKind.GREED];
		teleport(s, 0, altar.x, altar.z);
		expect(pactAltarAt(s, 0)).toBe(PactKind.GREED);
		expect(atShrine(s, setup.config, 0)).toBe(false); // the classic hint is off on an altar floor
		// The deal the sim will draw: drawLegendaryOffers on the rng state at the press (nothing else draws that tick
		// from the main rng on an empty shrine floor's first ticks).
		const twin = new Rng(0);
		twin.rngState = s.rngState;
		const bp = s.builds!.players[0];
		step(s, frame(0, 0, SHRINE_BUTTON), setup.config);
		const me = s.run!.players[0];
		expect(me.curses).toEqual([shown]);
		expect(s.run!.events.curseAccepted).toBe(shown + 1);
		expect(me.events.curseAccepted).toBe(shown + 1);
		expect(s.score!.curses).toBe(cursesBefore + 1);
		expect(me.draftOpen).toBe(1);
		expect(me.draftTicks).toBe(0);
		expect(bp.draftsLeft).toBe(1);
		expect(me.draftOffers).toEqual(drawLegendaryOffers(twin, bp.levels, bp.duos, 3));
		expect(s.rngState).toBe(twin.rngState);
		const pk = s.pacts!;
		expect(pk.players[0].greedTaken).toBe(1);
		expect(pk.players[0].draftKind).toBe(PactKind.GREED);
		expect(pactDraftKind(s, 0)).toBe(PactKind.GREED);
		expect(pk.taken[PactKind.GREED]).toBe(1);
		expect(pk.events.greedPlayer).toEqual([0]);
		expect(pk.events.greedCurse).toEqual([shown]);
		expect(pk.events.greedCards).toEqual([me.draftOffers.size()]);
		expect(s.run!.events.draftOpened).toBe(me.draftOffers.size());
		// A fresh build: the two legendary boons (nothing upgradable to fill with).
		expect(me.draftOffers.size()).toBe(2);
		for (const c of me.draftOffers) expect(BOONS[cardBoon(c)].rarity).toBe(Rarity.LEGENDARY);
	});

	it("freezes the world, resumes on the pick (the card granted, no re-deal), once per player", () => {
		const { setup, s } = onAltarFloor();
		pressPact(setup, s, PactKind.GREED);
		expect(isDraftOpen(s)).toBe(true);
		const tick0 = s.tick;
		const rng0 = s.rngState;
		const pos = s.combat.actors.map((a) => (a.kind !== NO_KIND ? a.x : 0));
		for (let k = 0; k < 10; k++) step(s, frame(1, 0), setup.config);
		expect(s.tick).toBe(tick0 + 10);
		expect(s.rngState).toBe(rng0);
		expect(s.combat.actors.map((a) => (a.kind !== NO_KIND ? a.x : 0))).toEqual(pos);
		const px = s.player.x;
		const card = pickFirst(s, setup);
		const me = s.run!.players[0];
		expect(me.draftOpen).toBe(0);
		expect(s.builds!.players[0].draftsLeft).toBe(0);
		expect(s.builds!.players[0].levels[cardBoon(card)]).toBe(1);
		expect(me.boons.includes(cardBoon(card))).toBe(true);
		expect(pactDraftKind(s, 0)).toBe(NO_PACT); // no draft open
		// the world runs again
		for (let k = 0; k < 10; k++) step(s, frame(1, 0), setup.config);
		expect(s.player.x).never.toBe(px);
		// once per player per shrine: a second press takes nothing and draws nothing
		expect(pactAvailability(s, setup.config, 0, PactKind.GREED)).toBe(PactDim.TAKEN);
		const rng1 = s.rngState;
		const curses = me.curses.size();
		pressPact(setup, s, PactKind.GREED);
		expect(me.curses.size()).toBe(curses);
		expect(isDraftOpen(s)).toBe(false);
		expect(s.rngState).toBe(rng1);
		expect(s.pacts!.taken[PactKind.GREED]).toBe(1);
	});

	it("the floor draft after it opens exactly as always (one deal; two after a boss floor), draftKind NO_PACT", () => {
		for (const seed of [SEED, 4242, 90210]) {
			const { setup, s, f } = onAltarFloor(seed);
			pressPact(setup, s, PactKind.GREED);
			pickFirst(s, setup);
			expect(isDraftOpen(s)).toBe(false);
			// The floor change: exactly one floor draft, as many deals as without Greed.
			step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), setup.config);
			const me = s.run!.players[0];
			expect(me.draftOpen).toBe(1);
			expect(s.builds!.players[0].draftsLeft).toBe(isBossFloor(f) ? 2 : 1);
			expect(s.pacts!.players[0].draftKind).toBe(NO_PACT);
			expect(pactDraftKind(s, 0)).toBe(NO_PACT);
			step(s, frame(0, 0), setup.config);
			let picks = 0;
			while (me.draftOpen !== 0 && picks < 4) {
				pickFirst(s, setup);
				picks++;
			}
			expect(picks).toBe(isBossFloor(f) ? 2 : 1);
		}
	});

	it("after a boss floor: the Greed deal is one deal (no re-deal) and the boss floor's own double draft is untouched", () => {
		// a run whose floor right after a boss floor has altars
		let found = false;
		for (let seed = 1; seed <= 40 && !found; seed++) {
			const setup = pactsSetup(seed);
			const f = altarFloor(setup, 6, 6);
			if (f !== 6) continue;
			found = true;
			const s = createSimState(seed, setup.spawn!.x, setup.spawn!.z, setup.config);
			skipToFloor(s, setup.config, 5);
			// the boss floor's change: the double draft
			step(s, frame(0, 0, DEBUG_FLOOR_BUTTON), setup.config);
			expect(s.builds!.players[0].draftsLeft).toBe(2);
			step(s, frame(0, 0), setup.config);
			let picks = 0;
			while (s.run!.players[0].draftOpen !== 0) {
				pickFirst(s, setup);
				picks++;
			}
			expect(picks).toBe(2);
			pressPact(setup, s, PactKind.GREED);
			expect(s.builds!.players[0].draftsLeft).toBe(1);
			pickFirst(s, setup);
			expect(s.run!.players[0].draftOpen).toBe(0); // closed on the first pick: no "pick again"
		}
		expect(found).toBe(true);
	});

	it("dim cases take nothing and draw nothing: no curse left, no legendary, a dead player, off the altar", () => {
		// no curse left
		{
			const { setup, s } = onAltarFloor();
			for (let c = 0; c < CURSE_COUNT; c++) acceptCurse(s, 0, c);
			expect(pactAvailability(s, setup.config, 0, PactKind.GREED)).toBe(PactDim.NO_CURSE);
			expect(greedCurseFor(s, 0)).toBe(-1);
			const rng = s.rngState;
			pressPact(setup, s, PactKind.GREED);
			expect(isDraftOpen(s)).toBe(false);
			expect(s.pacts!.players[0].greedTaken).toBe(0);
			expect(s.rngState).toBe(rng);
		}
		// no legendary: both legendaries owned, every duo taken, no level-II boon
		{
			const { setup, s } = onAltarFloor();
			const bp = s.builds!.players[0];
			bp.levels[Boon.EMBER_WAKE] = 1;
			bp.levels[Boon.COMPOSURE] = 1;
			for (let d = 0; d < DUO_COUNT; d++) bp.duos.push(d);
			expect(legendaryPool(bp.levels, bp.duos)).toEqual([]);
			expect(pactAvailability(s, setup.config, 0, PactKind.GREED)).toBe(PactDim.NO_LEGENDARY);
			const rng = s.rngState;
			const curses = s.run!.players[0].curses.size();
			pressPact(setup, s, PactKind.GREED);
			expect(isDraftOpen(s)).toBe(false);
			expect(s.run!.players[0].curses.size()).toBe(curses);
			expect(s.rngState).toBe(rng);
		}
		// a dead player; a press off the altars
		{
			const { setup, s } = onAltarFloor();
			const altar = floorAltars(setup, s)!.altars[PactKind.GREED];
			teleport(s, 0, altar.x + 3, altar.z + 3);
			expect(pactAltarAt(s, 0)).toBe(-1);
			step(s, frame(0, 0, SHRINE_BUTTON), setup.config);
			expect(s.pacts!.players[0].greedTaken).toBe(0);
			playerAt(s, 0).dead = 1;
			expect(pactAvailability(s, setup.config, 0, PactKind.GREED)).toBe(PactDim.UNABLE);
			teleport(s, 0, altar.x, altar.z);
			expect(pactAltarAt(s, 0)).toBe(-1);
		}
	});

	it("co-op 2-4: each player their own curse and deal, everyone frozen until all picked, once each", () => {
		for (let n = 2; n <= 4; n++) {
			const { setup, s } = onAltarFloor(SEED, n);
			const altar = floorAltars(setup, s)!.altars[PactKind.GREED];
			const shown: number[] = [];
			for (let i = 0; i < n; i++) {
				teleport(s, i, altar.x, altar.z);
				shown.push(greedCurseFor(s, i));
			}
			// every player presses on the same tick
			stepParty(
				s,
				idle(n, () => SHRINE_BUTTON),
				setup.config,
			);
			stepParty(s, idle(n), setup.config);
			for (let i = 0; i < n; i++) {
				expect(s.run!.players[i].curses).toEqual([shown[i]]);
				expect(s.run!.players[i].draftOpen).toBe(1);
				expect(s.pacts!.players[i].draftKind).toBe(PactKind.GREED);
			}
			expect(s.score!.curses).toBe(n);
			expect(s.pacts!.taken[PactKind.GREED]).toBe(n);
			// picks one by one: frozen until the last
			for (let i = 0; i < n; i++) {
				expect(isDraftOpen(s)).toBe(true);
				pickFirst(s, setup, i);
			}
			expect(isDraftOpen(s)).toBe(false);
			for (let i = 0; i < n; i++)
				expect(pactAvailability(s, setup.config, i, PactKind.GREED)).toBe(PactDim.TAKEN);
		}
	});

	it("without builds: the deal is the unowned legendary classic boons, granted as boons", () => {
		const setup0 = pactsSetup(SEED);
		const setup: EndlessRunSetup = { ...setup0, config: { ...setup0.config, builds: undefined } };
		const f = altarFloor(setup);
		const s = createSimState(SEED, setup.spawn!.x, setup.spawn!.z, setup.config);
		skipToFloor(s, setup.config, f);
		const twin = new Rng(0);
		const altar = floorAltars(setup, s)!.altars[PactKind.GREED];
		teleport(s, 0, altar.x, altar.z);
		twin.rngState = s.rngState;
		step(s, frame(0, 0, SHRINE_BUTTON), setup.config);
		const pool = [Boon.EMBER_WAKE, Boon.COMPOSURE];
		const want: number[] = [];
		while (pool.size() > 0) want.push(pool.remove(rngInt(twin, 0, pool.size() - 1))!);
		expect(s.run!.players[0].draftOffers).toEqual(want);
		step(s, frame(0, 0), setup.config);
		const card = pickFirst(s, setup);
		expect(s.run!.players[0].boons).toEqual([card]);
	});
});

describe("drawLegendaryOffers (PS3, FD4)", () => {
	function zeros(): number[] {
		const out: number[] = [];
		for (let b = 0; b < BOON_COUNT; b++) out.push(0);
		return out;
	}

	it("the pool: unowned legendaries, available duos, level-II boons (their evolution); in pool order", () => {
		const levels = zeros();
		levels[Boon.BOUNTY] = 1;
		levels[Boon.LINGERING] = 1;
		levels[Boon.HEARTY] = 2;
		levels[Boon.SHARPENED] = 1;
		levels[Boon.EMBER_WAKE] = 1;
		expect(legendaryPool(levels, [])).toEqual([
			boonCard(Boon.COMPOSURE),
			duoCard(Duo.GOLD_RUSH),
			boonCard(Boon.HEARTY),
		]);
		expect(legendaryPool(levels, [Duo.GOLD_RUSH])).toEqual([boonCard(Boon.COMPOSURE), boonCard(Boon.HEARTY)]);
		levels[Boon.HEARTY] = BOON_MAX_LEVEL;
		expect(legendaryPool(levels, [Duo.GOLD_RUSH])).toEqual([boonCard(Boon.COMPOSURE)]);
	});

	it("deals the pool first (no repeats, one rngInt each), then fills with ordinary upgrades", () => {
		for (let seed = 1; seed <= 200; seed++) {
			const rng = new Rng(seed);
			const levels = zeros();
			// a random build: some boons at I or II, a duo maybe
			for (let b = 0; b < BOON_COUNT; b++) levels[b] = rngInt(rng, 0, 5) === 0 ? rngInt(rng, 1, 2) : 0;
			for (let b = 0; b < BOON_COUNT; b++)
				if (BOONS[b].rarity === Rarity.LEGENDARY && levels[b] > 1) levels[b] = 1;
			const pool = legendaryPool(levels, []);
			const fill: number[] = [];
			for (let b = 0; b < BOON_COUNT; b++)
				if (BOONS[b].rarity !== Rarity.LEGENDARY && levels[b] === 1) fill.push(boonCard(b));
			const twin = new Rng(seed * 31);
			const deal = drawLegendaryOffers(new Rng(seed * 31), levels, [], 3);
			// the same draws by hand
			const want: number[] = [];
			const p = [...pool];
			const fl = [...fill];
			while (want.size() < 3) {
				const from = p.size() > 0 ? p : fl;
				if (from.size() === 0) break;
				want.push(from.remove(rngInt(twin, 0, from.size() - 1))!);
			}
			expect(deal).toEqual(want);
			expect(deal.size()).toBe(math.min(3, pool.size() + fill.size()));
			const seen = new Set<number>();
			for (let k = 0; k < deal.size(); k++) {
				expect(seen.has(deal[k])).toBe(false);
				seen.add(deal[k]);
				// legendary cards first, then fill
				if (k < math.min(3, pool.size())) expect(pool.includes(deal[k])).toBe(true);
				else expect(fill.includes(deal[k])).toBe(true);
			}
			for (const c of deal) if (cardDuo(c) < 0) expect(levels[cardBoon(c)] < BOON_MAX_LEVEL).toBe(true);
		}
	});
});
