/**
 * The room clear celebration's HUD (docs/ROOM_CLEAR.md RC3 / RC7): its strings, layout numbers (reference px, like
 * HUD_VIEW) and the pure text builders the controller uses. The stamp and its one-row tally sit in the boss bar's
 * slot at the top centre (no boss bar shows while a room record clears), above the toasts and the touch tutorial
 * prompt; the corner chips sit under the score panel (footprint.ts HUD_TRANSIENT.roomClear / roomClearChip).
 */
import type { StringVars } from "shared/theme";
import type { RoomClearLook, TallyKind } from "shared/view/fx";
import { HUD_VIEW } from "./layout";
import { TUTORIAL_VIEW } from "./tutorial";

/** Every theme string key the celebration reads; all REQUIRED (theme contract ROOM_CLEAR_STRING_KEYS). */
export const ROOM_CLEAR_STRINGS = {
	clear: "room.clear.stamp.clear",
	perfect: "room.clear.stamp.perfect",
	multi: "room.clear.stamp.multi",
	kills: "room.clear.line.kills",
	clearLine: "room.clear.line.clear",
	perfectLine: "room.clear.line.perfect",
	fast: "room.clear.line.fast",
	total: "room.clear.total",
	chip: "room.clear.chip",
	fly: "room.clear.fly",
	/** docs/PELLETS.md PL6: the tally's pellet points (like `kills`) and its Sweep bonus (like `clearLine`). */
	pellets: "room.clear.line.pellets",
	sweep: "room.clear.line.sweep",
} as const;

export const ROOM_CLEAR_VIEW = {
	/** The stamp row's width: the touch tutorial prompt's, which is proven to fit between the top corners on touch. */
	width: TUTORIAL_VIEW.touchPanelWidth,
	stampText: HUD_VIEW.bigText,
	/** The tally row's largest text size (it is TextScaled down to fit `width`). */
	tallyText: HUD_VIEW.smallText,
	/** Between the stamp and the tally row. */
	rowGap: 4,
	/** Between tally segments. */
	separator: "   ",
	/** PERFECT's shine band: half its width, as a fraction of the stamp (UIGradient keypoints). */
	shineHalfWidth: 0.08,
	/** The flying bonus chip. */
	flyText: HUD_VIEW.titleText,
	flyWidth: 160,
	/** Where it lands: this far below the safe area's top, under the score panel's number. */
	flyTargetY: 40,
	/** Corner chips: text size, and how many (must equal ROOM_CLEAR.chip.max; the spec checks). */
	chipText: HUD_VIEW.textSize,
	maxChips: 2,
} as const;

export type RoomClearStr = (key: string, vars?: StringVars) => string;

const SEGMENT_KEYS: Readonly<Record<TallyKind, string>> = {
	kills: ROOM_CLEAR_STRINGS.kills,
	clear: ROOM_CLEAR_STRINGS.clearLine,
	perfect: ROOM_CLEAR_STRINGS.perfectLine,
	fast: ROOM_CLEAR_STRINGS.fast,
};

/** CLEAR / PERFECT, or "PERFECT x2" for several rooms on one tick. */
export function roomClearStampText(perfect: boolean, rooms: number, s: RoomClearStr): string {
	const stamp = s(perfect ? ROOM_CLEAR_STRINGS.perfect : ROOM_CLEAR_STRINGS.clear);
	return rooms > 1 ? s(ROOM_CLEAR_STRINGS.multi, { stamp, rooms }) : stamp;
}

/** The tally row: every started segment with its counted value, then "= total" ("" before the first segment). */
export function roomClearTallyText(
	look: Pick<RoomClearLook, "segments" | "segmentCount" | "total">,
	s: RoomClearStr,
): string {
	const parts: string[] = [];
	for (let i = 0; i < look.segmentCount; i++) {
		const seg = look.segments[i];
		if (!seg.started) break;
		parts.push(s(SEGMENT_KEYS[seg.kind], { points: seg.shown }));
	}
	if (parts.size() === 0) return "";
	parts.push(s(ROOM_CLEAR_STRINGS.total, { points: look.total }));
	return parts.join(ROOM_CLEAR_VIEW.separator);
}
