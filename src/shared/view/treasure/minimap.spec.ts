// The vault's minimap mark (docs/TREASURE.md TR8, correction 13): vaultMarkStyle colours the mark by the current tier's
// floor role (recoloured by a crack), fills it until the chest is opened and rings it after, and hides it until the
// chest's cell or room is revealed; no vault, no mark. The marker size sits in MINIMAP_VIEW.
import { describe, expect, it } from "@rbxts/jest-globals";
import { VaultTier } from "shared/dungeon";
import { VaultStatus } from "shared/sim";
import { TREASURE_FLOOR_ROLES } from "shared/theme";
import { MINIMAP_VIEW } from "shared/view/minimap";
import { vaultMarkStyle } from ".";

describe("vaultMarkStyle", () => {
	it("colours the mark by tier: the tier's floor role (the sparkle's colour)", () => {
		expect(vaultMarkStyle(VaultStatus.SEALED, VaultTier.LEGENDARY, true)).toEqual({
			role: "treasure.legendary",
			style: "fill",
		});
		expect(vaultMarkStyle(VaultStatus.SEALED, VaultTier.RARE, true)?.role).toBe("treasure.rare");
		// A crack steps the tier down: the mark recolours with it.
		expect(vaultMarkStyle(VaultStatus.CRACKED, VaultTier.COMMON, true)?.role).toBe("treasure.common");
		for (let tier = 0; tier < TREASURE_FLOOR_ROLES.size(); tier++) {
			expect(vaultMarkStyle(VaultStatus.ARMED, tier, true)?.role).toBe(TREASURE_FLOOR_ROLES[tier]);
		}
	});

	it("is filled while the chest is closed and hollow once it is opened", () => {
		for (const status of [VaultStatus.SEALED, VaultStatus.ARMED, VaultStatus.CRACKED, VaultStatus.UNLOCKED]) {
			expect(vaultMarkStyle(status, VaultTier.RARE, true)?.style).toBe("fill");
		}
		expect(vaultMarkStyle(VaultStatus.OPENED, VaultTier.RARE, true)).toEqual({
			role: "treasure.rare",
			style: "hollow",
		});
	});

	it("is hidden until revealed, whatever the status; a floor without a vault has none", () => {
		for (const status of [
			VaultStatus.SEALED,
			VaultStatus.ARMED,
			VaultStatus.CRACKED,
			VaultStatus.UNLOCKED,
			VaultStatus.OPENED,
		]) {
			expect(vaultMarkStyle(status, VaultTier.LEGENDARY, false)).toBe(undefined);
		}
		expect(vaultMarkStyle(VaultStatus.NONE, VaultTier.RARE, true)).toBe(undefined);
		expect(vaultMarkStyle(VaultStatus.NONE, -1, false)).toBe(undefined);
	});

	it("draws a step over the treasure / shrine room marks", () => {
		expect(MINIMAP_VIEW.markers.vault > MINIMAP_VIEW.markers.room).toBe(true);
	});
});
