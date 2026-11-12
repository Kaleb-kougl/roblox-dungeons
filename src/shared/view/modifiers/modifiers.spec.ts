// Floor modifiers on screen (docs/FLOOR_MODIFIERS.md FM5 / FM6): the banner rows per kind, the stamp and its reduced
// motion cut, the card's hold, the chip's pulse, and ModifierPayoff, the once-per-floor payoff latch, with its input
// built from a run view's sources and the Blood Moon state read.
import { describe, expect, it } from "@rbxts/jest-globals";
import { AffixKind, FloorModifier, MODIFIERS, isFloorModifierTwist } from "shared/dungeon";
import {
	AFFIXES_CONFIG,
	NO_KIND,
	affixesOnSpawn,
	archetypeAt,
	createSimState,
	type ActorSpawn,
	type RoomScore,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { THEME_PACKS, floorModifierIconId } from "shared/theme";
import { BoostFrameEvents } from "../boosts";
import { GoldenFrameEvents } from "../golden";
import { PelletFrameEvents } from "../pellets";
import { TreasureFrameEvents, type TreasureArmedEvent } from "../treasure";
import {
	FLOOR_MODIFIER_VIEW,
	ModifierPayoff,
	NO_PAYOFF_FLOOR,
	affixedRoomEngaged,
	chipPulse,
	modifierBannerLook,
	modifierCardHoldSec,
	modifierCardRows,
	modifierPaysOff,
	modifierPayoffInput,
	type ModifierPayoffInput,
} from ".";

const V = FLOOR_MODIFIER_VIEW;
const KINDS = MODIFIERS.kinds;

/** A quiet frame on `floor` with `modifier`, then `over` on top. */
function input(modifier: number, over: Partial<ModifierPayoffInput> = {}, floor = 6): ModifierPayoffInput {
	return {
		floor,
		modifier,
		goldenAppeared: 0,
		vaultArmed: 0,
		powerTaken: 0,
		pieceLoot: 0,
		affixedEngaged: false,
		...over,
	};
}

/** The one input field that pays `kind` off. */
function paying(kind: number): Partial<ModifierPayoffInput> {
	if (kind === FloorModifier.GILDED) return { goldenAppeared: 1 };
	if (kind === FloorModifier.HOARD) return { vaultArmed: 1 };
	if (kind === FloorModifier.FEAST) return { powerTaken: 1 };
	if (kind === FloorModifier.PLUNDER) return { pieceLoot: 1 };
	return { affixedEngaged: true };
}

describe("modifierCardRows", () => {
	it("names every kind's strings, role, icon and class; NONE and unknown ids have no banner", () => {
		for (const k of KINDS) {
			const rows = modifierCardRows(k.id)!;
			expect([k.key, rows]).toEqual([
				k.key,
				{
					kind: k.id,
					key: k.key,
					nameKey: `floormod.${k.key}.name`,
					lineKey: `floormod.${k.key}.line`,
					role: `floorMod.${k.key}`,
					iconId: floorModifierIconId(k.key),
					twist: isFloorModifierTwist(k.id),
				},
			]);
			// every bundled pack has the strings and the role
			for (const p of ["placeholder", "vale"]) {
				const pack = THEME_PACKS[p];
				expect([p, k.key, typeIs(pack.strings[rows.nameKey], "string")]).toEqual([p, k.key, true]);
				expect([p, k.key, typeIs(pack.strings[rows.lineKey], "string")]).toEqual([p, k.key, true]);
				expect([p, k.key, typeIs(pack.colors[rows.role], "string")]).toEqual([p, k.key, true]);
			}
		}
		expect(modifierCardRows(FloorModifier.BLOOD_MOON)!.twist).toBe(true);
		expect(modifierCardRows(FloorModifier.GILDED)!.twist).toBe(false);
		expect(modifierCardRows(FloorModifier.BLOOD_MOON)!.iconId).toBe("ui.floormod.bloodmoon");
		expect([modifierCardRows(FloorModifier.NONE), modifierCardRows(99), modifierCardRows(-1)]).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});
});

describe("modifierBannerLook", () => {
	it("hidden for the delay, then stamps in (big and clear -> rest), then rests", () => {
		expect([V.bannerDelaySec, V.modifierCardSec, V.stamp.durationSec]).toEqual([0.3, 1.8, 0.2]);
		expect(modifierBannerLook(0, false)).toEqual({ visible: false, transparency: 1, scale: 1 });
		expect(modifierBannerLook(0.29, false).visible).toBe(false);
		const start = modifierBannerLook(V.bannerDelaySec, false);
		expect(start).toEqual({ visible: true, transparency: 1, scale: V.stamp.fromScale });
		let prev = start;
		for (let i = 1; i <= 10; i++) {
			const look = modifierBannerLook(V.bannerDelaySec + (V.stamp.durationSec * i) / 10, false);
			expect(look.visible).toBe(true);
			expect([i, look.scale <= prev.scale, look.transparency <= prev.transparency]).toEqual([i, true, true]);
			expect(look.scale >= 1 && look.scale <= V.stamp.fromScale).toBe(true);
			prev = look;
		}
		const rest = { visible: true, transparency: 0, scale: 1 };
		expect(modifierBannerLook(V.bannerDelaySec + V.stamp.durationSec, false)).toEqual(rest);
		expect(modifierBannerLook(V.modifierCardSec, false)).toEqual(rest);
		// eases out: past half the scale has moved more than half way
		const mid = modifierBannerLook(V.bannerDelaySec + V.stamp.durationSec / 2, false);
		expect(mid.scale < (V.stamp.fromScale + 1) / 2).toBe(true);
		expect(mid.transparency).toBeCloseTo(0.5, 6);
	});

	it("reduced motion: no stamp, at rest with the rest of the card from its first frame", () => {
		for (const t of [0, 0.1, V.bannerDelaySec, 0.4, 5])
			expect([t, modifierBannerLook(t, true)]).toEqual([t, { visible: true, transparency: 0, scale: 1 }]);
	});
});

describe("modifierCardHoldSec", () => {
	it("holds modifierCardSec on a modifier floor under a frozen world, never with a live world or on a plain floor", () => {
		for (const k of KINDS) {
			expect([k.key, modifierCardHoldSec(k.id, false)]).toEqual([k.key, V.modifierCardSec]);
			expect([k.key, modifierCardHoldSec(k.id, true)]).toEqual([k.key, 0]);
		}
		expect([modifierCardHoldSec(FloorModifier.NONE, false), modifierCardHoldSec(FloorModifier.NONE, true)]).toEqual(
			[0, 0],
		);
		expect(modifierCardHoldSec(42, false)).toBe(0);
	});
});

describe("chipPulse", () => {
	it("one half-sine pulse: up to 1 + amplitude and back, the highlight to its peak and back; at rest outside it", () => {
		const p = V.chipPulse;
		expect([p.durationSec, p.amplitude]).toEqual([0.6, 0.1]);
		const rest = { scale: 1, transparency: 1 };
		for (const t of [-0.1, p.durationSec, p.durationSec + 1]) expect([t, chipPulse(t, false)]).toEqual([t, rest]);
		expect(chipPulse(0, false)).toEqual(rest);
		const peak = chipPulse(p.durationSec / 2, false);
		expect(peak.scale).toBeCloseTo(1 + p.amplitude, 9);
		expect(peak.transparency).toBeCloseTo(p.peakTransparency, 9);
		const a = chipPulse(p.durationSec * 0.25, false);
		const b = chipPulse(p.durationSec * 0.75, false);
		expect(a.scale).toBeCloseTo(b.scale, 9);
		expect(a.scale > 1 && a.scale < peak.scale).toBe(true);
	});

	it("reduced motion: no pulse", () => {
		for (const t of [0, 0.1, 0.3, 0.5]) expect([t, chipPulse(t, true)]).toEqual([t, { scale: 1, transparency: 1 }]);
	});
});

describe("ModifierPayoff", () => {
	it("each kind pays off on its own signal only, once per floor", () => {
		for (const k of KINDS) {
			const latch = new ModifierPayoff();
			latch.reset(6);
			expect([k.key, latch.frame(input(k.id))]).toEqual([k.key, false]);
			// the other kinds' signals do nothing
			for (const other of KINDS) {
				if (other.id === k.id) continue;
				expect([k.key, other.key, latch.frame(input(k.id, paying(other.id)))]).toEqual([
					k.key,
					other.key,
					false,
				]);
			}
			expect([k.key, latch.hasPaid()]).toEqual([k.key, false]);
			expect([k.key, latch.frame(input(k.id, paying(k.id)))]).toEqual([k.key, true]);
			expect([k.key, latch.hasPaid()]).toEqual([k.key, true]);
			// once: a second Goldling / vault / pellet / piece / elite room on the floor pulses nothing
			expect([k.key, latch.frame(input(k.id, paying(k.id)))]).toEqual([k.key, false]);
			expect([k.key, latch.frame(input(k.id))]).toEqual([k.key, false]);
			// the next floor (reset) pays again
			latch.reset(7);
			expect([k.key, latch.hasPaid(), latch.frame(input(k.id, paying(k.id), 7))]).toEqual([k.key, false, true]);
		}
	});

	it("a plain floor never pays, whatever happens on it", () => {
		const latch = new ModifierPayoff();
		latch.reset(3);
		const all: ModifierPayoffInput = input(
			FloorModifier.NONE,
			{
				goldenAppeared: 1,
				vaultArmed: 1,
				powerTaken: 1,
				pieceLoot: 2,
				affixedEngaged: true,
			},
			3,
		);
		expect([modifierPaysOff(all), latch.frame(all), latch.frame(all)]).toEqual([false, false, false]);
		expect(modifierPaysOff({ ...all, modifier: 99 })).toBe(false);
	});

	it("a frame of another floor resets the latch to it and pays nothing (its events may be the old floor's)", () => {
		const latch = new ModifierPayoff();
		expect(latch.currentFloor()).toBe(NO_PAYOFF_FLOOR);
		// never reset: the first frame adopts the floor, the next pays
		const g = FloorModifier.GILDED;
		expect(latch.frame(input(g, paying(g), 4))).toBe(false);
		expect(latch.currentFloor()).toBe(4);
		expect(latch.frame(input(g, paying(g), 4))).toBe(true);
		// stairs mid-frame: floor 5's first frame carries floor 4's events
		const f = FloorModifier.FEAST;
		expect(latch.frame(input(f, paying(f), 5))).toBe(false);
		expect([latch.currentFloor(), latch.hasPaid()]).toEqual([5, false]);
		expect(latch.frame(input(f, paying(f), 5))).toBe(true);
		// reset to the new floor before its first frame: that frame counts
		latch.reset(6);
		expect(latch.frame(input(f, paying(f), 6))).toBe(true);
	});
});

describe("modifierPayoffInput", () => {
	function sources(state: SimState) {
		return {
			state,
			golden: new GoldenFrameEvents(),
			treasure: new TreasureFrameEvents(),
			pellets: new PelletFrameEvents(),
			boostEvents: new BoostFrameEvents(),
		};
	}

	it("counts the run view's frame events; outside endless the floor is NO_PAYOFF_FLOOR", () => {
		const state = createSimState(1, 0, 0, {});
		const view = sources(state);
		expect(modifierPayoffInput(view, FloorModifier.GILDED)).toEqual(
			input(FloorModifier.GILDED, {}, NO_PAYOFF_FLOOR),
		);
		view.golden.appeared.push({ x: 1, z: 2, actorId: 3, tick: 4 });
		view.treasure.armed.push({} as unknown as TreasureArmedEvent);
		view.pellets.power.push({ player: 0, px: 0, pz: 0, x: [], z: [], points: 0, tick: 1 });
		view.boostEvents.fromPiece.push({ slot: 0, kind: 1, x: 0, z: 0, spawnTick: 1 });
		view.boostEvents.lostLoot.push({ kind: 2, x: 0, z: 0 });
		expect(modifierPayoffInput(view, FloorModifier.HOARD)).toEqual(
			input(
				FloorModifier.HOARD,
				{ goldenAppeared: 1, vaultArmed: 1, powerTaken: 1, pieceLoot: 2 },
				NO_PAYOFF_FLOOR,
			),
		);
	});
});

describe("affixedRoomEngaged (Blood Moon's payoff)", () => {
	function config(spawns: ActorSpawn[], extra: Partial<SimConfig> = {}): SimConfig {
		return { encounter: { spawns, rooms: [], entranceRoom: -1, bossRoom: -1 }, scoring: {}, ...extra };
	}
	function slotOf(s: SimState, id: string): number {
		const actors = s.combat.actors;
		for (let i = 0; i < actors.size(); i++)
			if (actors[i].kind !== NO_KIND && archetypeAt(actors[i].kind).id === id) return i;
		error(`no ${id}`, 0);
	}
	/** A score record of room 1 whose members are `slots` (their current ids), engaged at `engageTick`. */
	function record(s: SimState, slots: number[], engageTick: number): RoomScore {
		const rec: RoomScore = {
			room: 1,
			minX: -10,
			maxX: 10,
			minZ: -10,
			maxZ: 10,
			parTicks: 600,
			engageTick,
			hitsAtEngage: 0,
			cleared: 0,
			memberSlots: [...slots],
			memberIds: slots.map((i) => s.combat.actors[i].id),
		};
		s.score!.rooms.push(rec);
		return rec;
	}

	it("true once a room with a living affixed member engaged; never before, without the affix or for a gone member", () => {
		const s = createSimState(
			1,
			0,
			0,
			config(
				[
					{ kind: "bruiser", x: 3, z: 0 },
					{ kind: "sniper", x: -3, z: 0 },
				],
				{ affixes: AFFIXES_CONFIG },
			),
		);
		const bruiser = slotOf(s, "bruiser");
		const sniper = slotOf(s, "sniper");
		const rec = record(s, [bruiser, sniper], -1);
		expect(affixedRoomEngaged(s)).toBe(false);
		rec.engageTick = 10;
		// engaged, but no member is affixed
		expect(affixedRoomEngaged(s)).toBe(false);
		affixesOnSpawn(s, sniper, s.combat.actors[sniper], AffixKind.HULKING);
		expect(affixedRoomEngaged(s)).toBe(true);
		// not yet engaged: false again
		rec.engageTick = -1;
		expect(affixedRoomEngaged(s)).toBe(false);
		rec.engageTick = 10;
		// the member is gone (its slot holds another id now)
		rec.memberIds[1] = rec.memberIds[1] + 1000;
		expect(affixedRoomEngaged(s)).toBe(false);
		rec.memberIds[1] = s.combat.actors[sniper].id;
		// a stale affix slot (another actor's) is not this member's
		s.affixes!.slots[sniper].actorId = -1;
		expect(affixedRoomEngaged(s)).toBe(false);
	});

	it("false without scoring or without affixes; the input reads it only on a Blood Moon floor", () => {
		const plain = createSimState(1, 0, 0, { encounter: { spawns: [], rooms: [], entranceRoom: -1, bossRoom: -1 } });
		expect(affixedRoomEngaged(plain)).toBe(false);
		const noAffixes = createSimState(1, 0, 0, config([{ kind: "bruiser", x: 3, z: 0 }]));
		record(noAffixes, [slotOf(noAffixes, "bruiser")], 5);
		expect(affixedRoomEngaged(noAffixes)).toBe(false);
		const s = createSimState(1, 0, 0, config([{ kind: "bruiser", x: 3, z: 0 }], { affixes: AFFIXES_CONFIG }));
		const slot = slotOf(s, "bruiser");
		affixesOnSpawn(s, slot, s.combat.actors[slot], AffixKind.SWIFT);
		record(s, [slot], 5);
		const view = {
			state: s,
			golden: new GoldenFrameEvents(),
			treasure: new TreasureFrameEvents(),
			pellets: new PelletFrameEvents(),
			boostEvents: new BoostFrameEvents(),
		};
		expect(modifierPayoffInput(view, FloorModifier.BLOOD_MOON).affixedEngaged).toBe(true);
		expect(modifierPayoffInput(view, FloorModifier.GILDED).affixedEngaged).toBe(false);
		const latch = new ModifierPayoff();
		latch.reset(NO_PAYOFF_FLOOR);
		expect(latch.frame(modifierPayoffInput(view, FloorModifier.BLOOD_MOON))).toBe(true);
	});
});
