// StateWatch (docs/FEEL.md J1): the hurt kind of each player's hit (harmless / armor / heart / lethal), from real
// damagePlayer calls on solo, party, boost-drop and tutorial states. The audio edges it also raises are covered by
// shared/view/audio audio.spec.ts (unchanged by the move out of the audio folder).
import { describe, expect, it } from "@rbxts/jest-globals";
import {
	DROPS_CONFIG,
	HIT_HEAVY,
	HIT_NORMAL,
	createSimState,
	damagePlayer,
	markPlayerLeft,
	playerAt,
	type SimConfig,
	type SimState,
} from "shared/sim";
import { HURT_KINDS, StateWatch, type HurtKind } from "./watch";

/** A watch that has seen `s` once (its baseline frame: no edges). */
function primed(s: SimState, view = 0): StateWatch {
	const w = new StateWatch();
	w.update(s, view);
	return w;
}

/** Player `i` is hit for `halfHearts` (its post-hit invulnerability cleared first, as after HURT_INVULN_TICKS). */
function hit(s: SimState, i: number, halfHearts = HIT_NORMAL): boolean {
	const p = playerAt(s, i);
	p.hurtTicks = 0;
	return damagePlayer(s, halfHearts, p, i);
}

/** One frame after `act`: player `i`'s hurt kind. The watch sees the cleared invulnerability first. */
function kindAfter(w: StateWatch, s: SimState, i: number, act: () => void, view = 0): HurtKind {
	playerAt(s, i).hurtTicks = 0;
	w.update(s, view);
	act();
	w.update(s, view);
	return w.hurtKind[i];
}

const DUO: SimConfig = { party: { size: 2 } };

describe("StateWatch hurtKind (docs/FEEL.md J1)", () => {
	it("lists the kinds weakest first", () => {
		expect(HURT_KINDS).toEqual(["none", "harmless", "armor", "heart", "lethal"]);
	});

	it("heart: hearts dropped; none on the next frame and on frames without a hit", () => {
		const s = createSimState(1, 0, 0);
		const w = primed(s);
		expect(w.hurtKind[0]).toBe("none");
		expect(kindAfter(w, s, 0, () => hit(s, 0))).toBe("heart");
		expect(w.hurtEdge[0]).toBe(true);
		w.update(s, 0);
		expect(w.hurtKind[0]).toBe("none");
		expect(w.hurtEdge[0]).toBe(false);
	});

	it("armor: only an armor pip dropped", () => {
		const s = createSimState(1, 0, 0);
		const p = playerAt(s, 0);
		p.armor = 1;
		p.armorMax = 1;
		const w = primed(s);
		const hearts = p.hearts;
		expect(kindAfter(w, s, 0, () => hit(s, 0, HIT_HEAVY))).toBe("armor");
		expect([p.armor, p.hearts]).toEqual([0, hearts]);
		// the next hit reaches the hearts
		expect(kindAfter(w, s, 0, () => hit(s, 0))).toBe("heart");
	});

	it("armor: the Aegis pip (state.drops, docs/BOOSTS.md) took the hit before armor and hearts", () => {
		const s = createSimState(1, 0, 0, { drops: DROPS_CONFIG });
		const p = playerAt(s, 0);
		p.armor = 1;
		s.drops!.players[0].aegisPips = 1;
		const w = primed(s);
		expect(kindAfter(w, s, 0, () => hit(s, 0))).toBe("armor");
		expect([s.drops!.players[0].aegisPips, p.armor]).toEqual([0, 1]);
		expect(kindAfter(w, s, 0, () => hit(s, 0))).toBe("armor"); // then the armor pip
		expect(kindAfter(w, s, 0, () => hit(s, 0))).toBe("heart");
	});

	it("lethal: the death edge (a lethal hit clears hurtTicks, so no hurt edge); then none while dead", () => {
		const s = createSimState(1, 0, 0);
		const p = playerAt(s, 0);
		p.hearts = HIT_NORMAL;
		const w = primed(s);
		expect(kindAfter(w, s, 0, () => hit(s, 0))).toBe("lethal");
		expect([w.deathEdge[0], w.hurtEdge[0], p.dead]).toEqual([true, false, 1]);
		w.update(s, 0);
		expect(w.hurtKind[0]).toBe("none");
	});

	it("harmless: the tutorial's harmless hits drop nothing", () => {
		const s = createSimState(1, 0, 0, { tutorial: { harmless: true, startHalfHearts: 4 } });
		const p = playerAt(s, 0);
		p.armor = 1;
		const w = primed(s);
		expect(kindAfter(w, s, 0, () => hit(s, 0, HIT_HEAVY))).toBe("harmless");
		expect([p.armor, p.hearts, p.dead]).toEqual([1, 4, 0]);
		// even on the last half heart: never lethal
		p.hearts = HIT_NORMAL;
		expect(kindAfter(w, s, 0, () => hit(s, 0))).toBe("harmless");
	});

	it("outside the tutorial a hit that dropped nothing reached the hearts (Second Wind gave them back): heart", () => {
		const s = createSimState(1, 0, 0);
		const p = playerAt(s, 0);
		const w = primed(s);
		const hearts = p.hearts;
		expect(
			kindAfter(w, s, 0, () => {
				p.hurtTicks = 45; // the hit's invulnerability, hearts restored in the same frame
				p.hearts = hearts;
			}),
		).toBe("heart");
	});

	it("co-op: each player's own kind; a teammate's hit is theirs, whoever the view follows", () => {
		const s = createSimState(1, 0, 0, DUO);
		playerAt(s, 1).armor = 1;
		const w = primed(s, 0);
		w.update(s, 0);
		hit(s, 1);
		w.update(s, 0);
		expect([w.hurtKind[0], w.hurtKind[1]]).toEqual(["none", "armor"]);
		hit(s, 0);
		playerAt(s, 1).hearts = HIT_NORMAL;
		hit(s, 1);
		w.update(s, 1); // the view index does not change who was hit
		expect([w.hurtKind[0], w.hurtKind[1]]).toEqual(["heart", "lethal"]);
	});

	it("a player who left is never hurt (leaving kills without a hit)", () => {
		const s = createSimState(1, 0, 0, DUO);
		const w = primed(s);
		markPlayerLeft(s, 1);
		w.update(s, 0);
		expect([w.hurtKind[1], w.deathEdge[1]]).toEqual(["none", false]);
	});

	it("a new run's state is a baseline: no kind from the difference", () => {
		const a = createSimState(1, 0, 0);
		const w = primed(a);
		const b = createSimState(1, 0, 0);
		playerAt(b, 0).hearts = 0;
		playerAt(b, 0).dead = 1;
		playerAt(b, 0).hurtTicks = 30;
		w.update(b, 0);
		expect(w.hurtKind[0]).toBe("none");
		w.reset();
		hit(b, 0);
		w.update(b, 0);
		expect(w.hurtKind[0]).toBe("none");
	});
});
