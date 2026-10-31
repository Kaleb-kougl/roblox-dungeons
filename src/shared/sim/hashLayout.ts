/**
 * The hash, labelled and split into the fixtures' subsystems (fixtures/hashed-fields.md). Built from the SAME writers
 * as writeHashFields (replay.ts), group by group, so `values` is exactly writeHashFields(state) (a spec checks it).
 * Use it to bisect a parity failure: per-subsystem hashes every tick, then the first differing named field.
 */

import { PLAYER_HASH_FIELDS, writePlayerHash } from "./player";
import {
	COMBAT_HEADER_NAMES,
	actorsHashNames,
	bulletsHashNames,
	weaponsHashNames,
	writeActorsHash,
	writeBulletsHash,
	writeCombatHeader,
	writeWeaponsHash,
} from "./combat/combat";
import { scoreHashNames, writeScoreHash } from "./score/score";
import type { SimState } from "./state";
import { endlessHashNames, writeEndlessHash } from "./endless";
import { runHashNames, writeRunHash } from "./progression/progression";
import { partyHashNames, writePartyHash } from "./party";
import { tutorialHashNames, writeTutorialHash } from "./tutorial/tutorial";
import { breakablesHashNames, writeBreakablesHash } from "./breakables/breakables";
import { dropsHashNames, writeDropsHash } from "./drops/drops";
import { affixesHashNames, writeAffixesHash } from "./affixes/affixes";

/** The fixtures' subsystem groups, in hash order. */
export const HASH_SUBSYSTEMS = ["core", "combatHeader", "actors", "weapons", "enemyBullets", "playerBullets"] as const;
export type HashSubsystem = (typeof HASH_SUBSYSTEMS)[number];
/**
 * The Roblox port's extra groups, appended after playerBullets in this order and only when present, so every fixture
 * run keeps exactly the six groups above (the parity tools compare HASH_SUBSYSTEMS only):
 *   endless  endless mode (floor, Depth, stairwell, rooms entered), when state.endless exists
 *   score    M2 scoring, when state.score exists
 *   run      M2 in-run progression (boons, relics, curses, the draft, pedestals, shrine), when state.run exists
 *   party    M4 co-op (players 1..n-1, their weapons, who left), when state.party exists
 *   tutorial first-run tutorial (harmless flag, harmless hits), when state.tutorial exists
 *   breakables  breakable barrels and crates (docs/DECOR.md D4: per piece kind, cell, hp, broken tick), when
 *            state.breakables exists
 *   drops    boost drops (docs/BOOSTS.md: the drop stream, pity, ground slots, guards, boost timers, Aegis pips), when
 *            state.drops exists
 *   affixes  elite affixes (docs/ENEMY_VARIANTS.md EV7: per actor slot affix, actorId, shield, Vengeful timer), when
 *            state.affixes exists; the LAST group
 */
export const ENDLESS_HASH_SUBSYSTEM = "endless";
export const SCORE_SUBSYSTEM = "score";
export const RUN_SUBSYSTEM = "run";
export const PARTY_SUBSYSTEM = "party";
export const TUTORIAL_SUBSYSTEM = "tutorial";
export const BREAKABLES_SUBSYSTEM = "breakables";
export const DROPS_SUBSYSTEM = "drops";
export const AFFIXES_SUBSYSTEM = "affixes";
/** Every group name a layout can have. */
export type HashGroupName =
	| HashSubsystem
	| typeof ENDLESS_HASH_SUBSYSTEM
	| typeof SCORE_SUBSYSTEM
	| typeof RUN_SUBSYSTEM
	| typeof PARTY_SUBSYSTEM
	| typeof TUTORIAL_SUBSYSTEM
	| typeof BREAKABLES_SUBSYSTEM
	| typeof DROPS_SUBSYSTEM
	| typeof AFFIXES_SUBSYSTEM;

export interface HashGroup {
	readonly name: HashGroupName;
	/** First index in `values` (0-based). */
	readonly start: number;
	/** One past the last index. */
	readonly finish: number;
}

export interface HashLayout {
	/** Every hashed number, in hash order (= writeHashFields(state)). */
	readonly values: number[];
	/** Dump name of each value (only when requested), e.g. `player.x`, `weapons.sets[0].v[3]`. */
	readonly names: string[];
	readonly groups: HashGroup[];
}

/** Values (and optionally names) of every hashed number, with subsystem boundaries. */
export function hashLayout(state: Readonly<SimState>, withNames = false): HashLayout {
	const values: number[] = [];
	const names: string[] = [];
	const groups: HashGroup[] = [];
	const c = state.combat;
	let start = 0;
	const close = (name: HashGroupName) => {
		groups.push({ name, start, finish: values.size() });
		start = values.size();
	};

	values.push(state.tick, state.rngState);
	writePlayerHash(state, values);
	if (withNames) {
		names.push("tick", "rngState");
		for (const f of PLAYER_HASH_FIELDS) names.push(`player.${f}`);
	}
	close("core");

	writeCombatHeader(c, values);
	if (withNames) for (const n of COMBAT_HEADER_NAMES) names.push(n);
	close("combatHeader");

	writeActorsHash(c, values);
	if (withNames) actorsHashNames(c, names);
	close("actors");

	writeWeaponsHash(c.weapons, values);
	if (withNames) weaponsHashNames(c.weapons, names);
	close("weapons");

	const enemyStart = values.size();
	writeBulletsHash(c.enemyBullets, values);
	if (withNames) {
		bulletsHashNames("enemyBullets", values, enemyStart, names);
	}
	close("enemyBullets");

	const playerStart = values.size();
	writeBulletsHash(c.playerBullets, values);
	if (withNames) {
		bulletsHashNames("playerBullets", values, playerStart, names);
	}
	close("playerBullets");

	const e = state.endless;
	if (e !== undefined) {
		writeEndlessHash(e, values);
		if (withNames) endlessHashNames(e, names);
		close(ENDLESS_HASH_SUBSYSTEM);
	}

	const score = state.score;
	if (score !== undefined) {
		writeScoreHash(score, values);
		if (withNames) scoreHashNames(score, names);
		close(SCORE_SUBSYSTEM);
	}

	const run = state.run;
	if (run !== undefined) {
		writeRunHash(run, values);
		if (withNames) runHashNames(run, names);
		close(RUN_SUBSYSTEM);
	}

	const party = state.party;
	if (party !== undefined) {
		writePartyHash(party, values);
		if (withNames) partyHashNames(party, names);
		close(PARTY_SUBSYSTEM);
	}

	const tutorial = state.tutorial;
	if (tutorial !== undefined) {
		writeTutorialHash(tutorial, values);
		if (withNames) tutorialHashNames(names);
		close(TUTORIAL_SUBSYSTEM);
	}

	const breakables = state.breakables;
	if (breakables !== undefined) {
		writeBreakablesHash(breakables, values);
		if (withNames) breakablesHashNames(breakables, names);
		close(BREAKABLES_SUBSYSTEM);
	}

	const drops = state.drops;
	if (drops !== undefined) {
		writeDropsHash(drops, values);
		if (withNames) dropsHashNames(drops, names);
		close(DROPS_SUBSYSTEM);
	}

	const affixes = state.affixes;
	if (affixes !== undefined) {
		writeAffixesHash(affixes, values);
		if (withNames) affixesHashNames(affixes, names);
		close(AFFIXES_SUBSYSTEM);
	}

	return { values, names, groups };
}

/** The numbers of one subsystem group. */
export function groupValues(layout: HashLayout, group: HashGroup): number[] {
	const out: number[] = [];
	for (let i = group.start; i < group.finish; i++) out.push(layout.values[i]);
	return out;
}
