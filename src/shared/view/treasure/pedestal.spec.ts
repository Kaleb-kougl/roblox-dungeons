// Relic pedestals drawn as chests: closed while live, hidden when nobody can take them, the vault's opening once taken
// (jolt, pop, column), and open and settled when the view was rebuilt after the take.
import { describe, expect, it } from "@rbxts/jest-globals";
import { PedestalChestTracker, TREASURE_VIEW, newPedestalChestLook } from ".";

const O = TREASURE_VIEW.open;

describe("PedestalChestTracker", () => {
	it("draws a live pedestal closed, and hides one nobody can take", () => {
		const t = new PedestalChestTracker();
		t.reset([0, 0]);
		const look = newPedestalChestLook();
		t.update(0, false, true, 5, false, true, look);
		expect(look.shown).toBe(true);
		expect(look.open).toBe(false);
		expect(look.liftStuds).toBe(0);
		expect(look.popEdge).toBe(false);
		expect(look.column.shown).toBe(false);
		t.update(1, false, false, 5, false, true, look);
		expect(look.shown).toBe(false);
	});

	it("plays the vault's opening from the frame the take is seen: jolt, one pop, the column, then open", () => {
		const t = new PedestalChestTracker();
		t.reset([0]);
		const look = newPedestalChestLook();
		t.update(0, false, true, 10, false, true, look);
		t.update(0, true, false, 10, false, true, look);
		expect(look.shown).toBe(true);
		expect(look.open).toBe(false);
		expect(look.openAge).toBe(0);
		t.update(0, true, false, 10 + O.joltSec / (2 * O.jolts), false, true, look);
		expect(look.liftStuds).toBeGreaterThan(0);
		expect(look.open).toBe(false);
		let pops = 0;
		for (let i = 1; i <= 40; i++) {
			t.update(0, true, false, 10 + i * 0.05, false, true, look);
			if (look.popEdge) {
				pops++;
				expect(look.open).toBe(true);
				expect(look.column.shown).toBe(true);
			}
		}
		expect(pops).toBe(1);
		expect(look.open).toBe(true);
		expect(look.column.shown).toBe(false);
		expect(look.liftStuds).toBe(0);
	});

	it("holds the opening while sim time holds (pause, hitstop)", () => {
		const t = new PedestalChestTracker();
		t.reset([0]);
		const look = newPedestalChestLook();
		t.update(0, true, false, 3, false, true, look);
		t.update(0, true, false, 3, false, true, look);
		expect(look.openAge).toBe(0);
		expect(look.open).toBe(false);
	});

	it("drops the jolt under reduced motion and the column with Particles off, keeping the pop", () => {
		const t = new PedestalChestTracker();
		t.reset([0]);
		const look = newPedestalChestLook();
		t.update(0, true, false, 0, true, false, look);
		t.update(0, true, false, O.joltSec / (2 * O.jolts), true, false, look);
		expect(look.liftStuds).toBe(0);
		t.update(0, true, false, O.popSec + 0.01, true, false, look);
		expect(look.popEdge).toBe(true);
		expect(look.open).toBe(true);
		expect(look.column.shown).toBe(false);
	});

	it("shows a pedestal taken before the reset open and settled: no jolt, no pop", () => {
		const t = new PedestalChestTracker();
		t.reset([1, 0]);
		const look = newPedestalChestLook();
		for (let i = 0; i < 10; i++) {
			t.update(0, true, false, i * 0.1, false, true, look);
			expect(look.shown).toBe(true);
			expect(look.open).toBe(true);
			expect(look.popEdge).toBe(false);
			expect(look.liftStuds).toBe(0);
			expect(look.column.shown).toBe(false);
		}
	});

	it("a reset closes every pedestal again (a new floor)", () => {
		const t = new PedestalChestTracker();
		t.reset([0]);
		const look = newPedestalChestLook();
		t.update(0, true, false, 1, false, true, look);
		t.reset([0]);
		t.update(0, false, true, 2, false, true, look);
		expect(look.open).toBe(false);
		expect(look.shown).toBe(true);
	});
});
