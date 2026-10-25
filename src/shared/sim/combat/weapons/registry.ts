/**
 * Weapon registry (E1.8; source: `src/sim/weapons/registry.ts`), the same scheme as the archetype registry: weapon
 * files call registerWeapon(def) at module load, ./defs/index.ts imports them all, combat.ts imports that index.
 * A weapon's numeric index (stored in WeaponSlotState.weapon and in player bullets' payload `source` - 1) is its
 * position among the registered ids in code-unit order. Sealed when the first run starts.
 */

import { stableSort } from "shared/jsmath";
import { isFiniteNumber, isIntegerNumber } from "../../jsnum";
import { compareIds, isValidRegistryId } from "../registryIds";
import type { WeaponData, WeaponDef } from "./types";

const byId = new Map<string, WeaponDef>();
let sorted: WeaponDef[] | undefined;
let sealed = false;

function check(cond: boolean, id: string, what: string): void {
	if (!cond) error(`registerWeapon('${id}'): ${what}`, 0);
}

/** Registers a weapon (call once, at module load, from the weapon's own file). Returns `def`. */
export function registerWeapon<D extends WeaponData>(def: WeaponDef<D>): WeaponDef<D> {
	const id = def.id;
	check(isValidRegistryId(id), tostring(id), 'ids are lowercase dot-separated, e.g. "weapon.bow"');
	const d = def.data;
	check(
		isIntegerNumber(d.cooldownTicks) && d.cooldownTicks >= 0,
		id,
		"data.cooldownTicks must be a whole number >= 0",
	);
	check(d.damage >= 0 && isFiniteNumber(d.damage), id, "data.damage must be >= 0");
	check(d.style === "ranged" || d.style === "melee", id, "data.style must be 'ranged' or 'melee'");
	check(typeIs(def.fire, "function"), id, "fire(ctx, slot) is required");
	if (sealed && !byId.has(id)) {
		error(
			`registerWeapon('${id}'): the weapon table is sealed (a run already started). Register weapons at module ` +
				"load: add an import line to src/shared/sim/combat/weapons/defs/index.ts.",
			0,
		);
	}
	byId.set(id, def as unknown as WeaponDef);
	sorted = undefined;
	return def;
}

function sortedTable(): WeaponDef[] {
	if (sorted === undefined) {
		const defs: WeaponDef[] = [];
		for (const [, def] of byId) defs.push(def);
		sorted = stableSort(defs, (a, b) => compareIds(a.id, b.id));
	}
	return sorted;
}

/** Freezes the numbering (called by createCombatState). */
export function sealWeapons(): void {
	sealed = true;
}

/** Numeric index of weapon `id`. Throws for an unknown id (lists the known ones). */
export function weaponIndex(id: string): number {
	const t = sortedTable();
	for (let i = 0; i < t.size(); i++) if (t[i].id === id) return i;
	const known = t.map((d) => d.id).join(", ");
	return error(`Unknown weapon '${id}'. Registered: ${known !== "" ? known : "(none)"}`, 0);
}

/** The def for a weapon index. */
export function weaponAt(index: number): WeaponDef {
	const def = sortedTable()[index];
	if (def === undefined) error(`No weapon at index ${index}`, 0);
	return def;
}

export function hasWeapon(id: string): boolean {
	return byId.has(id);
}

/** Every registered id, in index order. */
export function weaponIds(): ReadonlyArray<string> {
	return sortedTable().map((d) => d.id);
}
