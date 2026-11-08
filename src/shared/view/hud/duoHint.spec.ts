// The duo hint (docs/BUILDS_V2.md "Duo hint", BV8; presentation only): duoUnlockedBy lists the duos taking an unowned
// boon would make available (index order); a New card carries the first as its hint (chip and "Unlocks a duo: {duo}");
// Upgrade, Evolution and Duo cards never do, nor a boon whose partner is unowned, nor a taken duo.
import { describe, expect, it } from "@rbxts/jest-globals";
import { BOONS, BOON_COUNT, Boon, CardKind, DUOS, Duo, duoAvailable, duoCard } from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { draftCardModel, draftDuoHint, duoUnlockedBy } from "./draftCards";
import { PROGRESSION_STRINGS, itemIconKey, itemNameKey, progressionStringKeys, rarityColorRole } from "./progression";

function levelsOf(owned: ReadonlyArray<[number, number]>): number[] {
	const out: number[] = [];
	for (let b = 0; b < BOON_COUNT; b++) out.push(0);
	for (const [b, l] of owned) out[b] = l;
	return out;
}

function pack(): ThemePack {
	return new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
}

describe("duoUnlockedBy (BV8)", () => {
	it("an unowned boon whose partner is owned unlocks that duo; an unowned partner or a taken duo unlocks nothing", () => {
		const sharp = levelsOf([[Boon.SHARPENED, 1]]);
		expect(duoUnlockedBy(sharp, [], Boon.HEARTY)).toEqual([Duo.FULL_HEART]);
		expect(duoUnlockedBy(levelsOf([]), [], Boon.HEARTY)).toEqual([]);
		expect(duoUnlockedBy(sharp, [Duo.FULL_HEART], Boon.HEARTY)).toEqual([]);
		// Happy Hour: Deep Flask with Bounty owned (Deep Flask's only duo).
		expect(duoUnlockedBy(levelsOf([[Boon.BOUNTY, 2]]), [], Boon.DEEP_FLASK)).toEqual([Duo.HAPPY_HOUR]);
	});

	it("an owned boon unlocks nothing (an Upgrade or Evolution pick never makes a duo available)", () => {
		const both = levelsOf([
			[Boon.SHARPENED, 1],
			[Boon.HEARTY, 1],
		]);
		expect(duoUnlockedBy(both, [], Boon.HEARTY)).toEqual([]);
		expect(duoUnlockedBy(levelsOf([[Boon.HEARTY, 2]]), [], Boon.HEARTY)).toEqual([]);
	});

	it("several duos come in duo index order, exactly those available after and not before", () => {
		const owned = levelsOf([
			[Boon.CHAIN_SPARK, 1],
			[Boon.COMPOSURE, 1],
			[Boon.BASTION, 1],
		]);
		const out = duoUnlockedBy(owned, [], Boon.RIPOSTE);
		expect(out).toEqual([Duo.THUNDER_GUARD, Duo.STILLWATER, Duo.REBUKE]);
		// The definition, checked over every boon and duo for this build.
		for (let b = 0; b < BOON_COUNT; b++) {
			const after = [...owned];
			after[b] = owned[b] > 0 ? owned[b] : 1;
			const expected: number[] = [];
			for (let d = 0; d < DUOS.size(); d++)
				if (owned[b] === 0 && !duoAvailable(owned, [], d) && duoAvailable(after, [], d)) expected.push(d);
			expect([b, duoUnlockedBy(owned, [], b)]).toEqual([b, expected]);
		}
		// A duo already taken drops out; the rest stay in order.
		expect(duoUnlockedBy(owned, [Duo.THUNDER_GUARD], Boon.RIPOSTE)).toEqual([Duo.STILLWATER, Duo.REBUKE]);
	});
});

describe("the hint on draft cards (BV8)", () => {
	const owned = levelsOf([
		[Boon.CHAIN_SPARK, 1],
		[Boon.COMPOSURE, 1],
	]);

	it("a New card carries the first duo it unlocks: its chip (the duo card's) and the line with the duo's name", () => {
		const m = draftCardModel(Boon.RIPOSTE, CardKind.NEW, owned, [])!;
		const hint = m.hint!;
		expect(hint.duo).toBe(Duo.THUNDER_GUARD); // one hint per card, though Stillwater unlocks too
		const duo = DUOS[Duo.THUNDER_GUARD];
		expect([...hint.chipIcons]).toEqual([itemIconKey(BOONS[duo.a].id), itemIconKey(BOONS[duo.b].id)]);
		expect([...hint.chipRoles]).toEqual([
			rarityColorRole(BOONS[duo.a].rarity),
			rarityColorRole(BOONS[duo.b].rarity),
		]);
		const card = draftCardModel(duoCard(Duo.THUNDER_GUARD), CardKind.DUO)!;
		expect([[...hint.chipIcons], [...hint.chipRoles]]).toEqual([[...card.chipIcons], [...card.chipRoles]]);
		expect(hint.text.key).toBe(PROGRESSION_STRINGS.draftDuoHint);
		expect(hint.text.varKeys).toEqual({ duo: itemNameKey(duo.id) });
		expect(draftDuoHint(owned, [], Boon.RIPOSTE)).toEqual(hint);
		// The card itself is the New card it always was (no chip in its banner row).
		expect([m.kind, m.chipIcons.size(), m.level, m.maxLevel]).toEqual([CardKind.NEW, 0, 0, 0]);
	});

	it("no hint on Upgrade, Evolution or Duo cards, without a build, or for a boon whose partner is unowned", () => {
		const riposte = levelsOf([
			[Boon.CHAIN_SPARK, 1],
			[Boon.RIPOSTE, 1],
		]);
		expect(draftCardModel(Boon.RIPOSTE, CardKind.UPGRADE, riposte, [])!.hint).toBe(undefined);
		expect(draftCardModel(Boon.RIPOSTE, CardKind.EVOLUTION, riposte, [])!.hint).toBe(undefined);
		expect(draftCardModel(duoCard(Duo.THUNDER_GUARD), CardKind.DUO, riposte, [])!.hint).toBe(undefined);
		expect(draftCardModel(Boon.RIPOSTE, CardKind.NEW)!.hint).toBe(undefined);
		expect(draftCardModel(Boon.HEARTY, CardKind.NEW, owned, [])!.hint).toBe(undefined);
		expect(draftCardModel(Boon.WRECKER, CardKind.NEW, levelsOf([]), [])!.hint).toBe(undefined);
	});

	it("the placeholder pack reads 'Unlocks a duo: Thunder Guard' (the key is a progression key)", () => {
		const p = pack();
		const hint = draftDuoHint(owned, [], Boon.RIPOSTE)!;
		expect(p.hasString(hint.text.key)).toBe(true);
		expect(progressionStringKeys().includes(hint.text.key)).toBe(true);
		expect(p.str(hint.text.key, { duo: p.str(hint.text.varKeys!.duo) })).toBe("Unlocks a duo: Thunder Guard");
		for (const k of hint.chipIcons) expect([k, p.hasString(k)]).toEqual([k, true]);
	});
});
