// docs/ARCHER.md AR2 / ARD3: a SWAP onto an empty weapon set does nothing (no event, no buildsOnSwap, a guard keeps
// running, the set in hand stays); every two-weapon loadout swaps exactly as before. Co-op: per player.
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	BOW_WEAPON_ID,
	BUILDS_CONFIG,
	Button,
	DEFAULT_LOADOUT,
	EMPTY_INPUT,
	SWORD_V_GUARD,
	SWORD_WEAPON_ID,
	createSimState,
	hashState,
	step,
	stepParty,
	weaponIndex,
	weaponsAt,
	type InputFrame,
	type SimConfig,
	type SimState,
} from "shared/sim";

const SWAP: InputFrame = { ...EMPTY_INPUT, buttons: Button.SWAP };
const ALT: InputFrame = { ...EMPTY_INPUT, buttons: Button.ALT };

function stateOf(config: SimConfig): SimState {
	return createSimState(7, 0, 0, config);
}

describe("SWAP with one weapon (docs/ARCHER.md ARD3)", () => {
	for (const [label, loadout] of [
		["[sword, undefined]", [SWORD_WEAPON_ID, undefined]],
		["[sword]", [SWORD_WEAPON_ID]],
		["[bow]", [BOW_WEAPON_ID]],
	] as const) {
		it(`${label}: a SWAP press changes nothing: no event, the same set in hand, buildsOnSwap not called`, () => {
			const config: SimConfig = { loadout, builds: BUILDS_CONFIG };
			const s = stateOf(config);
			const bp = s.builds!.players[0];
			bp.riposteCount = 3; // buildsOnSwap would zero it (a swap ends a guard's count)
			for (let n = 0; n < 4; n++) {
				step(s, SWAP, config);
				expect([n, s.events.weaponSwapped, s.combat.weapons.activeSet]).toEqual([n, 0, 0]);
				step(s, EMPTY_INPUT, config);
			}
			expect(bp.riposteCount).toBe(3);
			expect(s.combat.weapons.prevButtons).toBe(0); // prevButtons still follows the input
		});
	}

	it("[sword, undefined]: a guard keeps running through a SWAP press (a two-weapon swap ends it)", () => {
		const guardLeft = (loadout: ReadonlyArray<string | undefined>): [number, number, number] => {
			const config: SimConfig = { loadout };
			const s = stateOf(config);
			step(s, ALT, config);
			step(s, EMPTY_INPUT, config);
			const sword = s.combat.weapons.sets[0];
			const before = sword.v[SWORD_V_GUARD];
			step(s, SWAP, config);
			return [before, sword.v[SWORD_V_GUARD], s.combat.weapons.activeSet];
		};
		const [before, after, hand] = guardLeft([SWORD_WEAPON_ID, undefined]);
		expect(before > 1).toBe(true);
		expect([after, hand]).toEqual([before - 1, 0]); // counted down one tick: still guarding
		// Two weapons: swapped away, the sword's guard no longer runs (frozen until a swap back zeroes it), as before.
		expect(guardLeft(DEFAULT_LOADOUT)).toEqual([before, before, 1]);
	});

	it("two weapons: SWAP swaps as before (event, set 1 in hand, buildsOnSwap), and back", () => {
		const config: SimConfig = { loadout: DEFAULT_LOADOUT, builds: BUILDS_CONFIG };
		const s = stateOf(config);
		const bp = s.builds!.players[0];
		bp.riposteCount = 3;
		step(s, SWAP, config);
		expect([s.events.weaponSwapped, s.combat.weapons.activeSet, bp.riposteCount]).toEqual([1, 1, 0]);
		expect(s.combat.weapons.sets[1].weapon).toBe(weaponIndex(BOW_WEAPON_ID));
		step(s, SWAP, config); // held: no edge
		expect([s.events.weaponSwapped, s.combat.weapons.activeSet]).toEqual([0, 1]);
		step(s, EMPTY_INPUT, config);
		step(s, SWAP, config);
		expect([s.events.weaponSwapped, s.combat.weapons.activeSet]).toEqual([1, 0]);
	});

	it("an empty set 0 with a weapon in set 1 still swaps to it (only an empty target is refused)", () => {
		const config: SimConfig = { loadout: [undefined, BOW_WEAPON_ID] };
		const s = stateOf(config);
		step(s, SWAP, config);
		expect([s.events.weaponSwapped, s.combat.weapons.activeSet]).toEqual([1, 1]);
		step(s, EMPTY_INPUT, config);
		step(s, SWAP, config); // back onto the empty set 0: refused
		expect([s.events.weaponSwapped, s.combat.weapons.activeSet]).toEqual([0, 1]);
	});

	it("co-op: a one-weapon player's SWAP is dead, a two-weapon teammate's swaps, the same tick; two runs hash alike", () => {
		const config: SimConfig = { party: { size: 2, loadouts: [[SWORD_WEAPON_ID], DEFAULT_LOADOUT] } };
		const run = () => {
			const s = stateOf(config);
			stepParty(s, [SWAP, SWAP], config);
			return s;
		};
		const s = run();
		expect([weaponsAt(s, 0).activeSet, weaponsAt(s, 1).activeSet, s.events.weaponSwapped]).toEqual([0, 1, 1]);
		expect(hashState(run())).toBe(hashState(s));
	});
});
