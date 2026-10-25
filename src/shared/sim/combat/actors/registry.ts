/**
 * Archetype registry (E1.8; source: `src/sim/actors/registry.ts`). Archetype files call registerArchetype(def) at
 * module load; an archetypes index imports every archetype file, and combat.ts imports that index, so every archetype
 * is registered before a run starts.
 *
 * Kinds in sim state are NUMBERS: an archetype's index is its position in the list of registered ids sorted by
 * code-unit order (compareIds). The index depends only on WHICH archetypes are registered, never on import order.
 * The table is sealed when the first run's combat state is created: registering a NEW id after that throws;
 * re-registering an existing id replaces its def and keeps its index.
 *
 * The game registers `boss.act1, bruiser, sniper, swarmer, turret.caster, turret.sniper, turret.sprayer` (indices 0..6,
 * the web build's table); specs may add test archetypes (shared/sim/testing) in their own module world.
 */

import { stableSort } from "shared/jsmath";
import { isFiniteNumber, isIntegerNumber } from "../../jsnum";
import { compareIds, isValidRegistryId } from "../registryIds";
import type { ArchetypeData, ArchetypeDef } from "./types";

const byId = new Map<string, ArchetypeDef>();
let sorted: ArchetypeDef[] | undefined;
let sealed = false;

function check(cond: boolean, id: string, what: string): void {
	if (!cond) error(`registerArchetype('${id}'): ${what}`, 0);
}

/** Registers an archetype (call once, at module load, from the archetype's own file). Returns `def`. */
export function registerArchetype<D extends ArchetypeData>(def: ArchetypeDef<D>): ArchetypeDef<D> {
	const id = def.id;
	check(isValidRegistryId(id), tostring(id), 'ids are lowercase dot-separated, e.g. "boss.warden"');
	const d = def.data;
	check(d.hp > 0 && isFiniteNumber(d.hp), id, "data.hp must be a positive number");
	check(d.radius > 0 && isFiniteNumber(d.radius), id, "data.radius must be a positive number");
	check(d.speed >= 0 && isFiniteNumber(d.speed), id, "data.speed must be >= 0");
	check(
		isIntegerNumber(d.contactDamage) && d.contactDamage >= 0,
		id,
		"data.contactDamage must be a whole number of half hearts >= 0",
	);
	check(typeIs(d.spriteId, "string") && d.spriteId.size() > 0, id, "data.spriteId must be a logical theme ID");
	check(
		d.damageCapPerSecond === undefined || d.damageCapPerSecond > 0,
		id,
		"data.damageCapPerSecond must be > 0 when set",
	);
	check(typeIs(def.step, "function"), id, "step(ctx, actor) is required");
	if (sealed && !byId.has(id)) {
		error(
			`registerArchetype('${id}'): the archetype table is sealed (a run already started). Register archetypes at ` +
				"module load: add an import line to the archetypes index.",
			0,
		);
	}
	byId.set(id, def as unknown as ArchetypeDef);
	sorted = undefined;
	return def;
}

function sortedTable(): ArchetypeDef[] {
	if (sorted === undefined) {
		const defs: ArchetypeDef[] = [];
		for (const [, def] of byId) defs.push(def);
		sorted = stableSort(defs, (a, b) => compareIds(a.id, b.id));
	}
	return sorted;
}

/** Freezes the numbering (called by createCombatState). New ids throw afterwards; existing ids may be replaced. */
export function sealArchetypes(): void {
	sealed = true;
}

/** The numeric kind stored in ActorState.kind for archetype `id`. Throws for an unknown id (lists the known ones). */
export function archetypeIndex(id: string): number {
	const t = sortedTable();
	for (let i = 0; i < t.size(); i++) if (t[i].id === id) return i;
	const known = t.map((d) => d.id).join(", ");
	return error(`Unknown archetype '${id}'. Registered: ${known !== "" ? known : "(none)"}`, 0);
}

/** The def for a numeric kind (ActorState.kind). */
export function archetypeAt(index: number): ArchetypeDef {
	const def = sortedTable()[index];
	if (def === undefined) error(`No archetype at index ${index}`, 0);
	return def;
}

/** True when `id` is registered. */
export function hasArchetype(id: string): boolean {
	return byId.has(id);
}

/** Every registered id, in index order. */
export function archetypeIds(): ReadonlyArray<string> {
	return sortedTable().map((d) => d.id);
}
