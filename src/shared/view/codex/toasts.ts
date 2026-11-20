/**
 * The Codex on the in-run toasts (claude/codex-plan.md "In-run NEW", CX6, decisions R11 / R14). Pure; the client's
 * SimController / SightingController / ToastPanel / SightingCard read it.
 *
 *   decorated toast   a top-centre toast (SimController.pushToasts, one per run event) whose entry is in the tracker's
 *                     `chips` this frame wears the NEW! chip at its left (uiAccent) and a second line `Added to your
 *                     Codex` (uiTextDim): codexToastEntryId maps the run event to its entry
 *   sighting card     a first-sighting card (SightingController) wears the chip when the tracker's sightingChip says so
 *                     (its text and timing stay EV12's)
 *   codex toast       the tracker's `codexToasts` (a first kill, a vault chest's relic, a boss down): one line
 *                     `NEW! <name> · Codex` on the SightingCard, through the sighting queue's slot (one at a time, its
 *                     gaps and gates), with `sfx.codex.new`
 *
 * The chip pops in (CODEX_CHIP: a short scale from popScale down to 1); under Reduced motion it simply appears.
 *
 * @module
 */
import {
	CodexTier,
	codexBoostId,
	codexCardId,
	codexCurseId,
	codexEntry,
	codexRelicId,
	codexTier,
	type CodexDoc,
} from "shared/codex";
import { SIGHTING_IDS } from "shared/onboarding";
import { CardKind } from "shared/sim";
import type { CodexTileState } from "./screen";
import { codexSightingId } from "./tracker";

/** The Codex's HUD strings (shared/theme CODEX_STRING_KEYS). */
export const CODEX_HUD_STRINGS = {
	/** The chip: `NEW!`. */
	chip: "hud.codex.new",
	/** A decorated toast's second line: `Added to your Codex`. */
	added: "hud.codex.added",
	/** A codex toast's line: `{name} · Codex` (after the chip). */
	toast: "hud.codex.toast",
	/** A draft card's tag (CX8): `NEW`. */
	tag: "hud.codex.tag",
} as const;

/** The NEW! chip's look (reference px, seconds). */
export const CODEX_CHIP = {
	/** Horizontal / vertical padding inside the chip. */
	padX: 4,
	padY: 1,
	/** The pop: starts this much larger and settles to 1 over popSeconds (ease out). None under Reduced motion. */
	popScale: 1.35,
	popSeconds: 0.18,
} as const;

/** A codex toast's line (CX7): the entry's tile art before the chip, this many reference px square (the line's height). */
export const CODEX_TOAST = {
	iconBox: 16,
} as const;

/**
 * The tile art state a codex toast draws its entry in (ToastView.codexTier, the tier the entry rose to): a sighting
 * (SEEN: a swarmer walking in) its faded seen art, a find (FOUND, and an unknown tier) its full art.
 */
export function codexToastArtState(tier: number | undefined): CodexTileState {
	return tier === CodexTier.SEEN ? "seen" : "found";
}

/** The chip's scale `elapsed` seconds after it appeared (1 once settled, and always under Reduced motion). */
export function codexChipScale(elapsed: number, reducedMotion: boolean): number {
	if (reducedMotion || elapsed >= CODEX_CHIP.popSeconds) return 1;
	const t = math.max(0, elapsed) / CODEX_CHIP.popSeconds;
	const ease = 1 - (1 - t) * (1 - t);
	return CODEX_CHIP.popScale + (1 - CODEX_CHIP.popScale) * ease;
}

/**
 * The Codex entry a run event's toast is about (shared/play RunEventRecord: `kind`, `index`, `build`), or undefined
 * for a toast that is no entry (Second Wind, the Fang's heal): a boon card (an evolution when `build` is `evolved`, a
 * duo card itself), a relic, a curse, a boost (R14 lead decision: a first boost decorates its `hud.toast.boost`).
 */
export function codexToastEntryId(kind: string, index: number, build?: string): string | undefined {
	switch (kind) {
		case "boon":
			return codexCardId(index, build === "evolved" ? CardKind.EVOLUTION : undefined);
		case "relic":
			return codexRelicId(index);
		case "curse":
			return codexCurseId(index);
		case "boost":
			return codexBoostId(index);
	}
	return undefined;
}

/** A run event's toast wears the chip: its entry is in this frame's `chips` (CodexTracker output). */
export function codexToastChip(chips: ReadonlyArray<string>, kind: string, index: number, build?: string): boolean {
	if (chips.size() === 0) return false;
	const id = codexToastEntryId(kind, index, build);
	return id !== undefined && chips.includes(id);
}

/** A codex toast's name key (the entry's `nameKey`), or undefined for an unknown id. */
export function codexToastNameKey(id: string): string | undefined {
	return codexEntry(id)?.nameKey;
}

/**
 * The first sightings (shared/onboarding SIGHTING_IDS) a SEEDED Codex doc already has (tier seen or found), for the
 * sighting queue (SightingController: unioned with the onboarding `seen` list). An unseeded doc gives none: until the
 * seed ran, the onboarding list is the only account-wide record of the sightings.
 */
export function codexSeenSightings(doc: Readonly<CodexDoc> | undefined): string[] {
	const out: string[] = [];
	if (doc === undefined || doc.seeded !== true) return out;
	for (const s of SIGHTING_IDS) {
		const id = codexSightingId(s);
		if (id !== undefined && codexTier(doc, id) >= CodexTier.SEEN) out.push(s);
	}
	return out;
}
