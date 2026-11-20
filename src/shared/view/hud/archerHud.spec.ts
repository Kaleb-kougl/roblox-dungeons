// docs/ARCHER.md AR9 / AR10: the characters on the HUD.
//   - weaponSets: hasSwapTarget / shownWeaponSets (a Knight's or an Archer's one slot, no swap; two weapons as before)
//   - touch: the Swap button shows only with a swap target, and hiding it keeps every other button's box (every test
//     viewport, both hands, the usual and the compact cluster)
//   - characterText: the per-character overrides (the Archer's Bastion card reads the archer line, the Knight's the base
//     line; a missing override, no character or an unknown one read the base key) on draft cards, tooltips (varKeys
//     too) and the Build list
//   - characterIcon: art or the class colour square, nothing for a non-character; contribution rows carry characters
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOW_WEAPON_ID,
	Boon,
	CardKind,
	Duo,
	SWORD_WEAPON_ID,
	boonMaxLevel,
	duoCard,
	type CardKindId,
} from "shared/sim";
import { PLACEHOLDER_MANIFEST, ThemePack } from "shared/theme";
import { NO_RECAP_TALLY, RECAP_ALIVE_TICK } from "shared/view/fx";
import {
	TOUCH_TEST_VIEWPORTS,
	buildListSections,
	characterBuildRow,
	characterBuildSections,
	characterDraftCard,
	characterHudText,
	characterIcon,
	characterIconSize,
	characterOfEntry,
	characterStringKey,
	characterTooltip,
	contributionOf,
	draftCardModel,
	hasSwapTarget,
	itemTooltip,
	shownTouchButtons,
	shownWeaponSets,
	textOf,
	touchButtonShown,
	touchLayout,
	type HudText,
	type TooltipFacts,
} from ".";

const SWORD = SWORD_WEAPON_ID;
const BOW = BOW_WEAPON_ID;

const pack = new ThemePack(PLACEHOLDER_MANIFEST, { warn: () => undefined });
const has = (key: string) => pack.hasString(key);
const none = () => false;

/** A HudText as the client shows it (hudText: varKeys looked up first). */
function shown(t: HudText): string {
	const vars: Record<string, string | number> = {};
	if (t.vars !== undefined) for (const [k, v] of pairs(t.vars as unknown as ReadonlyMap<string, string>)) vars[k] = v;
	if (t.varKeys !== undefined)
		for (const [k, v] of pairs(t.varKeys as unknown as ReadonlyMap<string, string>)) vars[k] = pack.str(v);
	return pack.str(t.key, vars);
}

function card(c: number, kind: CardKindId = CardKind.NEW) {
	return draftCardModel(c, kind)!;
}

function facts(boons: number[], levels: number[], duos: number[] = []): TooltipFacts {
	return { boons, boonLevels: levels, duos, relics: [], curses: [], boosts: [] };
}

describe("weapon sets (docs/ARCHER.md AR9)", () => {
	it("hasSwapTarget: only with two sets that hold a weapon", () => {
		expect(hasSwapTarget([SWORD, BOW])).toBe(true);
		expect(hasSwapTarget([BOW, SWORD])).toBe(true);
		expect(hasSwapTarget([SWORD, ""])).toBe(false);
		expect(hasSwapTarget([BOW, ""])).toBe(false);
		expect(hasSwapTarget(["", BOW])).toBe(false);
		expect(hasSwapTarget([SWORD])).toBe(false);
		expect(hasSwapTarget(["", ""])).toBe(false);
		expect(hasSwapTarget([])).toBe(false);
	});

	it("shownWeaponSets: a one-weapon player's set alone; two weapons (or none) every set, as before", () => {
		expect(shownWeaponSets([SWORD, BOW])).toEqual([0, 1]);
		expect(shownWeaponSets([SWORD, ""])).toEqual([0]);
		expect(shownWeaponSets([BOW, ""])).toEqual([0]);
		expect(shownWeaponSets(["", BOW])).toEqual([1]);
		expect(shownWeaponSets(["", ""])).toEqual([0, 1]);
		expect(shownWeaponSets([])).toEqual([]);
	});
});

describe("touch Swap (docs/ARCHER.md AR9)", () => {
	it("touchButtonShown: Swap with a swap target, Accept at a shrine, every other button always", () => {
		const off = { atShrine: false, swapTarget: false };
		const on = { atShrine: true, swapTarget: true };
		expect(touchButtonShown("swap", off)).toBe(false);
		expect(touchButtonShown("swap", { atShrine: true, swapTarget: false })).toBe(false);
		expect(touchButtonShown("swap", { atShrine: false, swapTarget: true })).toBe(true);
		expect(touchButtonShown("shrine", off)).toBe(false);
		expect(touchButtonShown("shrine", on)).toBe(true);
		for (const id of ["attack", "alt", "roll", "ember", "flask", "spectateNext", "spectatePrev"] as const) {
			expect([id, touchButtonShown(id, off), touchButtonShown(id, on)]).toEqual([id, true, true]);
		}
	});

	it("hiding Swap keeps every other button's box (every test viewport, both hands, both clusters)", () => {
		const variants = new Set<string>();
		for (const v of TOUCH_TEST_VIEWPORTS) {
			for (const leftHanded of [false, true]) {
				for (const hud of [100, 130]) {
					const layout = touchLayout(v.x, v.y, v.x, v.y, hud, 100, leftHanded, "play");
					variants.add(layout.variant);
					const all = shownTouchButtons(layout, { atShrine: true, swapTarget: true });
					expect(all).toEqual([...layout.buttons]);
					const noSwap = shownTouchButtons(layout, { atShrine: true, swapTarget: false });
					const expected = layout.buttons.filter((b) => b.id !== "swap");
					expect(expected.size()).toBe(layout.buttons.size() - 1);
					expect([v.x, v.y, leftHanded, hud, noSwap]).toEqual([v.x, v.y, leftHanded, hud, expected]);
				}
			}
		}
		expect(variants.has("play")).toBe(true);
	});
});

describe("per-character text (docs/ARCHER.md AR10)", () => {
	it("characterStringKey: the override when the pack has it, else the base key", () => {
		expect(characterStringKey("boon.bastion.desc", "archer", has)).toBe("boon.bastion.desc.archer");
		expect(characterStringKey("boon.bastion.desc", "knight", has)).toBe("boon.bastion.desc");
		expect(characterStringKey("boon.bastion.desc", undefined, has)).toBe("boon.bastion.desc");
		expect(characterStringKey("boon.bastion.desc", "", has)).toBe("boon.bastion.desc");
		// An unknown character, a key without an override, a pack without overrides: the base key (English).
		expect(characterStringKey("boon.bastion.desc", "ranger", has)).toBe("boon.bastion.desc");
		expect(characterStringKey("boon.sharpened.desc", "archer", has)).toBe("boon.sharpened.desc");
		expect(characterStringKey("boon.bastion.desc", "archer", none)).toBe("boon.bastion.desc");
	});

	it("the Archer's Bastion card reads the archer line, the Knight's the base line", () => {
		const bastion = card(Boon.BASTION);
		expect(shown(characterDraftCard(bastion, "archer", has).desc)).toBe(
			"+1 armor pip; roll through 10 bullets in a room: +1 pip",
		);
		expect(shown(characterDraftCard(bastion, "knight", has).desc)).toBe(
			"+1 armor pip; a full-ring guard; stop 10 bullets in a room: +1 pip",
		);
		// No character (M1's two weapons): the model itself.
		expect(characterDraftCard(bastion, undefined, has)).toBe(bastion);
		expect(characterDraftCard(bastion, "archer", none)).toEqual(bastion);
		// The name and banner have no override.
		expect(characterDraftCard(bastion, "archer", has).name).toEqual(bastion.name);
	});

	it("duo cards: Storm Blade and Full Heart per character, Citadel the Archer's roll line", () => {
		const line = (d: number, c: string | undefined) => shown(characterDraftCard(card(duoCard(d)), c, has).desc);
		expect(line(Duo.STORM_BLADE, "knight")).toBe("Finishers spark");
		expect(line(Duo.STORM_BLADE, "archer")).toBe("Every 5th arrow hit sparks");
		expect(line(Duo.STORM_BLADE, undefined)).toBe("Finishers and every 5th arrow hit spark");
		expect(line(Duo.FULL_HEART, "knight")).toBe("At full hearts, finishers fire a beam");
		expect(line(Duo.FULL_HEART, "archer")).toBe("At full hearts, charged arrows fire a beam");
		expect(line(Duo.CITADEL, "knight")).toBe("Every 10 bullets you stop restore a pip");
		expect(line(Duo.CITADEL, "archer")).toBe("Every 10 bullets you roll through restore a pip");
	});

	it("Swift Strikes' evolution: the Evolution card and the level-II tooltip's Evolves line (a varKey)", () => {
		const max = boonMaxLevel(Boon.SWIFT_STRIKES);
		expect(max).toBe(3);
		const evo = card(Boon.SWIFT_STRIKES, CardKind.EVOLUTION);
		expect(shown(characterDraftCard(evo, "archer", has).desc)).toBe("40% faster; arrows fly in threes");
		expect(shown(characterDraftCard(evo, "knight", has).desc)).toBe(
			"40% faster; finishers release a crescent of bolts",
		);
		// A level-II tooltip names the evolution's line in its Evolves line (a varKey).
		const tip = itemTooltip({ kind: "boon", index: Boon.SWIFT_STRIKES }, facts([Boon.SWIFT_STRIKES], [2]))!;
		const archer = characterTooltip(tip, "archer", has)!;
		expect(shown(archer.lines[1].text).find("arrows fly in threes", 1, true)[0]).toBeDefined();
		expect(shown(tip.lines[1].text).find("arrows fly in threes", 1, true)[0]).toBe(undefined);
		expect(archer.lines[1].text.varKeys!.desc).toBe("boon.swiftStrikes.evo.desc.archer");
		expect(archer.lines[1].text.varKeys!.evo).toBe("boon.swiftStrikes.evo.name");
		expect(characterTooltip(tip, "knight", has)!.lines[1].text.varKeys!.desc).toBe("boon.swiftStrikes.evo.desc");
		expect(characterTooltip(tip, undefined, has)).toBe(tip);
		expect(characterTooltip(undefined, "archer", has)).toBe(undefined);
	});

	it("characterHudText leaves a text without overrides as it is (the same object)", () => {
		const t = textOf("hud.draft.level", { level: "II" });
		expect(characterHudText(t, "archer", has)).toBe(t);
	});

	it("Bastion's tooltip and Build list row read the archer line", () => {
		const f = facts([Boon.BASTION], [1], [Duo.CITADEL]);
		const tip = characterTooltip(itemTooltip({ kind: "boon", index: Boon.BASTION }, f), "archer", has)!;
		expect(shown(tip.lines[0].text)).toBe("+1 armor pip; roll through 10 bullets in a room: +1 pip");
		const sections = characterBuildSections(buildListSections(f, false), "archer", has);
		expect(shown(sections[0].rows[0].desc)).toBe("+1 armor pip; roll through 10 bullets in a room: +1 pip");
		expect(shown(sections[1].rows[0].desc)).toBe("Every 10 bullets you roll through restore a pip");
		const knight = characterBuildSections(buildListSections(f, false), "knight", has);
		expect(shown(knight[0].rows[0].desc)).toBe(
			"+1 armor pip; a full-ring guard; stop 10 bullets in a room: +1 pip",
		);
		const row = buildListSections(f, false)[0].rows[0];
		expect(characterBuildRow(row, undefined, has)).toBe(row);
	});
});

describe("character icons (docs/ARCHER.md AR9)", () => {
	it("the pack's ui.character.<id> art, else the class colour square; nothing for a non-character", () => {
		expect(characterIcon("archer", () => true)).toEqual({
			character: "archer",
			art: "ui.character.archer",
			role: "class.ranger",
		});
		expect(characterIcon("knight", none)).toEqual({ character: "knight", art: undefined, role: "class.vanguard" });
		for (const x of [undefined, "", "ranger", "Knight", 3, {}])
			expect(characterIcon(x, () => true)).toBe(undefined);
		expect(characterIconSize(22)).toBe(13);
		expect(characterIconSize(1)).toBe(1);
	});

	it("a board entry's classId: shown when it is a character id", () => {
		expect(characterOfEntry({ userId: 1, classId: "archer" })).toBe("archer");
		expect(characterOfEntry({ userId: 1, classId: "knight" })).toBe("knight");
		expect(characterOfEntry({ userId: 1 })).toBe(undefined);
		expect(characterOfEntry({ userId: 1, classId: "vanguard" })).toBe(undefined);
		expect(characterOfEntry({ userId: 1, classId: 7 })).toBe(undefined);
	});

	it("contribution rows carry each player's character (index order); none without the input's", () => {
		const n = 3;
		const fill = (v: number) => [v, v, v];
		const t = {
			...NO_RECAP_TALLY,
			parries: fill(0),
			grazes: fill(0),
			kills: fill(1),
			damage: fill(10),
			bossDamage: fill(0),
			hits: fill(0),
			pellets: fill(0),
			boosts: fill(0),
			deathTick: fill(RECAP_ALIVE_TICK),
			deathFloor: fill(0),
			leftFloor: fill(0),
			lastTick: 600,
		};
		const base = { tally: t, partySize: n, localIndex: 1, names: ["A", "B", "C"] };
		const c = contributionOf({ ...base, characters: ["archer", "knight", ""] })!;
		expect(c.rows.map((r) => r.character ?? "-")).toEqual(["archer", "knight", ""]);
		expect(c.local.character).toBe("knight");
		expect(c.rows.map((r) => characterIcon(r.character, none)?.role ?? "-")).toEqual([
			"class.ranger",
			"class.vanguard",
			"-",
		]);
		expect(contributionOf(base)!.rows.map((r) => r.character ?? "-")).toEqual(["-", "-", "-"]);
	});
});
