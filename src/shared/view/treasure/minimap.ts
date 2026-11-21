/**
 * The vault's minimap mark (docs/TREASURE.md TR8, correction 13: a dynamic marker, not a fixed RoomMark): a square at
 * the chest's cell, hidden until revealed (the room marks' rule: the cell is no longer UNKNOWN to the party's fog, or
 * the room was revealed whole), filled in the CURRENT tier's floor role (treasureFloorRole: the colour of the sparkle
 * seen through the doorway, so it recolours with a crack; every floor role is held to 3:1 on `minimap.floor` by
 * shared/theme treasureReport), hollow once the chest is opened (nothing left to come back for). The client's
 * MinimapController places and draws it (MINIMAP_VIEW.markers.vault); this decides only whether and how. Pure, tested
 * headlessly (minimap.spec.ts).
 *
 * @module
 */
import { VaultStatus } from "shared/sim";
import { treasureFloorRole, type ColorRole } from "shared/theme";

/** How the mark draws: a solid square in `role`, or a ring in it. */
export interface VaultMarkStyle {
	readonly role: ColorRole;
	readonly style: "fill" | "hollow";
}

/**
 * The mark for a vault with `status` (VaultStatus) and `tier` (VaultTier, after any crack), `revealed` as above;
 * undefined: no mark (no vault on the floor, or not revealed yet).
 */
export function vaultMarkStyle(status: number, tier: number, revealed: boolean): VaultMarkStyle | undefined {
	if (status === VaultStatus.NONE || !revealed) return undefined;
	return { role: treasureFloorRole(tier), style: status === VaultStatus.OPENED ? "hollow" : "fill" };
}
