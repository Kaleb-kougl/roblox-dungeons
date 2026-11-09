/**
 * Per-character text (docs/ARCHER.md AR10, "Text per character"; presentation only). A progression string may have an
 * optional override per character, `<key>.<characterId>` (theme characterOverrideKey): the readers ask for
 * `boon.bastion.desc.archer` first, then `boon.bastion.desc`. The models stay character-free (draftCards.ts,
 * tooltip.ts, buildHud.ts build them from the sim's ids); the client passes each model it shows through the matching
 * helper here with the LOCAL player's character (SimController's run character, RunInfo.character) and the pack's
 * string lookup. Every key of the model's texts is rewritten, its varKeys too (an Upgrade's "was" line, a tooltip's
 * "Evolves into {evo}: {desc}"), so a key without an override, a player who is no character (M1's two weapons) or a
 * pack without the override all read exactly the base key. Pure (characterText.spec.ts).
 */
import { characterOverrideKey } from "shared/theme";
import type { BuildListRow } from "./buildHud";
import type { DraftCardModel, HudText } from "./draftCards";
import type { BuildListSection, TooltipLine, TooltipModel } from "./tooltip";

/** Whether the pack defines a string key (ThemePack.hasString). */
export type HasString = (key: string) => boolean;

/**
 * The key to read for `key` as `character` (a character id; undefined or "": no character): its override when the
 * pack has it, else `key` itself.
 */
export function characterStringKey(key: string, character: string | undefined, has: HasString): string {
	if (character === undefined || character === "") return key;
	const override = characterOverrideKey(key, character);
	return has(override) ? override : key;
}

/** `t` with its key and its varKeys read as `character` (characterStringKey); `t` itself when nothing changes. */
export function characterHudText(t: HudText, character: string | undefined, has: HasString): HudText {
	if (character === undefined || character === "") return t;
	const key = characterStringKey(t.key, character, has);
	let varKeys: Record<string, string> | undefined;
	if (t.varKeys !== undefined) {
		for (const [name, k] of pairs(t.varKeys as unknown as ReadonlyMap<string, string>)) {
			const read = characterStringKey(k, character, has);
			if (read === k) continue;
			if (varKeys === undefined) {
				varKeys = {};
				for (const [n2, k2] of pairs(t.varKeys as unknown as ReadonlyMap<string, string>)) varKeys[n2] = k2;
			}
			varKeys[name] = read;
		}
	}
	if (key === t.key && varKeys === undefined) return t;
	return { key, vars: t.vars, varKeys: varKeys ?? t.varKeys };
}

/** A draft card's name, banner, line, "was" line and duo hint read as `character`. */
export function characterDraftCard(m: DraftCardModel, character: string | undefined, has: HasString): DraftCardModel {
	if (character === undefined || character === "") return m;
	const text = (t: HudText) => characterHudText(t, character, has);
	return {
		...m,
		name: text(m.name),
		banner: text(m.banner),
		desc: text(m.desc),
		was: m.was !== undefined ? text(m.was) : undefined,
		hint: m.hint !== undefined ? { ...m.hint, text: text(m.hint.text) } : undefined,
	};
}

function characterLine(l: TooltipLine, character: string, has: HasString): TooltipLine {
	const text = characterHudText(l.text, character, has);
	return text === l.text ? l : { ...l, text };
}

/** An item tooltip's title, kind line and body lines read as `character`. */
export function characterTooltip(
	m: TooltipModel | undefined,
	character: string | undefined,
	has: HasString,
): TooltipModel | undefined {
	if (m === undefined || character === undefined || character === "") return m;
	return {
		...m,
		title: characterHudText(m.title, character, has),
		kindLine: characterLine(m.kindLine, character, has),
		lines: m.lines.map((l) => characterLine(l, character, has)),
	};
}

/** A Build list row's name and line read as `character`. */
export function characterBuildRow(row: BuildListRow, character: string | undefined, has: HasString): BuildListRow {
	if (character === undefined || character === "") return row;
	return {
		...row,
		name: characterHudText(row.name, character, has),
		desc: characterHudText(row.desc, character, has),
	};
}

/** The Build list's sections with every row read as `character` (characterBuildRow). */
export function characterBuildSections(
	sections: ReadonlyArray<BuildListSection>,
	character: string | undefined,
	has: HasString,
): BuildListSection[] {
	const out: BuildListSection[] = [];
	for (const s of sections) {
		out.push(
			character === undefined || character === ""
				? s
				: { ...s, rows: s.rows.map((r) => characterBuildRow(r, character, has)) },
		);
	}
	return out;
}
