/**
 * The room clear celebration's HUD (docs/ROOM_CLEAR.md RC3 / RC7): its strings, layout numbers (reference px, like
 * HUD_VIEW) and the pure text builders the controller uses. The stamp and its one-row tally sit in the boss bar's
 * slot at the top centre (no boss bar shows while a room record clears), above the toasts and the touch tutorial
 * prompt; the corner chips sit under the score panel (footprint.ts HUD_TRANSIENT.roomClear / roomClearChip).
 *
 * @module
 */
import type { StringVars } from "shared/theme";
import { roomClearSegments, type RoomClear, type RoomClearLook, type TallyEntry, type TallyKind } from "shared/view/fx";
import { richTextEscape } from "./comboDraw";
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
	/** docs/FORTUNE.md FO6: a Horde room's last segment, the doubled half (like `sweep`). */
	horde: "room.clear.line.horde",
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
	/**
	 * The tally row's fit (docs/PELLETS.md PL7): TextScaled shrinks a long row to `width`, so a row is estimated at
	 * `glyphAspect` (the HUD font's average advance per px of text size; Arcade, provisional until the Studio check
	 * measures TextBounds) per byte. A row whose estimate falls under `minText` reference px (today's full four-segment
	 * row, Kills / Clear / No hits / Speed, sits at it; x HUD_VIEW.touchMinScale on the smallest phone) folds the pellet
	 * points into the kills segment (roomClearFoldPellets).
	 */
	tallyFit: { glyphAspect: 0.62, minText: 10 },
} as const;

export type RoomClearStr = (key: string, vars?: StringVars) => string;

const SEGMENT_KEYS: Readonly<Record<TallyKind, string>> = {
	kills: ROOM_CLEAR_STRINGS.kills,
	pellets: ROOM_CLEAR_STRINGS.pellets,
	clear: ROOM_CLEAR_STRINGS.clearLine,
	perfect: ROOM_CLEAR_STRINGS.perfectLine,
	fast: ROOM_CLEAR_STRINGS.fast,
	sweep: ROOM_CLEAR_STRINGS.sweep,
	horde: ROOM_CLEAR_STRINGS.horde,
};

/**
 * The co-op team perfect's strings (docs/RUN_RECAP.md CM2 / CM3; required: the contract's TEAM_MOMENT_STRING_KEYS).
 * `teamStreak` reads "TEAM PERFECT x{n}", `n` the streak (TeamPerfectMoment.streak, which counts every room of a
 * multi-room clear, so it replaces the "x{rooms}" form).
 */
export const TEAM_PERFECT_STRINGS = {
	teamPerfect: "room.clear.teamPerfect",
	teamStreak: "room.clear.teamStreak",
} as const;

/**
 * CLEAR / PERFECT, or "PERFECT x2" for several rooms on one tick. A co-op team perfect (CM2, CMD1: `team`, only with
 * `perfect`) reads TEAM PERFECT instead, and "TEAM PERFECT x{streak}" once `teamStreak` > 0 (the stamp's
 * RoomClearLook.teamStreak; a chip passes 0); its multi-room form is the streak's, which counts those rooms.
 */
export function roomClearStampText(
	perfect: boolean,
	rooms: number,
	s: RoomClearStr,
	team = false,
	teamStreak = 0,
): string {
	if (perfect && team) {
		if (teamStreak > 0) return s(TEAM_PERFECT_STRINGS.teamStreak, { n: teamStreak });
		const stamp = s(TEAM_PERFECT_STRINGS.teamPerfect);
		return rooms > 1 ? s(ROOM_CLEAR_STRINGS.multi, { stamp, rooms }) : stamp;
	}
	const stamp = s(perfect ? ROOM_CLEAR_STRINGS.perfect : ROOM_CLEAR_STRINGS.clear);
	return rooms > 1 ? s(ROOM_CLEAR_STRINGS.multi, { stamp, rooms }) : stamp;
}

/**
 * The tally row: every started segment with its counted value, then "= total" ("" before the first segment).
 * `hordeHex` (docs/FORTUNE.md FO7; `#rrggbb`, the `pact.horde` colour): the row as RichText, every part escaped and the
 * Horde segment in that colour (the Tally label has RichText on); absent: plain text.
 */
export function roomClearTallyText(
	look: Pick<RoomClearLook, "segments" | "segmentCount" | "total">,
	s: RoomClearStr,
	hordeHex?: string,
): string {
	const parts: string[] = [];
	for (let i = 0; i < look.segmentCount; i++) {
		const seg = look.segments[i];
		if (!seg.started) break;
		const text = s(SEGMENT_KEYS[seg.kind], { points: seg.shown });
		if (hordeHex === undefined) parts.push(text);
		else if (seg.kind === "horde") parts.push(`<font color="${hordeHex}">${richTextEscape(text)}</font>`);
		else parts.push(richTextEscape(text));
	}
	if (parts.size() === 0) return "";
	const total = s(ROOM_CLEAR_STRINGS.total, { points: look.total });
	parts.push(hordeHex === undefined ? total : richTextEscape(total));
	return parts.join(ROOM_CLEAR_VIEW.separator);
}

/** The tally row as it ends (every segment counted up), for `entries` (shared/view/fx roomClearSegments). */
export function roomClearFinalTallyText(entries: ReadonlyArray<TallyEntry>, s: RoomClearStr): string {
	let total = 0;
	const segments = entries.map((e) => {
		total += e.value;
		return { kind: e.kind, value: e.value, shown: e.value, started: true };
	});
	return roomClearTallyText({ segments, segmentCount: segments.size(), total }, s);
}

/**
 * The text size (reference px) TextScaled settles at for the tally row `text` in ROOM_CLEAR_VIEW.width: tallyText, or
 * less for a row too long for it (see ROOM_CLEAR_VIEW.tallyFit; bytes, so a non-Latin row is over-estimated).
 */
export function roomClearTallyTextSize(text: string): number {
	const em = text.size() * ROOM_CLEAR_VIEW.tallyFit.glyphAspect;
	return em <= 0 ? ROOM_CLEAR_VIEW.tallyText : math.min(ROOM_CLEAR_VIEW.tallyText, ROOM_CLEAR_VIEW.width / em);
}

/**
 * Should clear `c`'s pellet points join the kills segment (docs/PELLETS.md PL7)? Only when it has pellet points and
 * its full row (its own Pellets segment) would shrink under ROOM_CLEAR_VIEW.tallyFit.minText.
 */
export function roomClearFoldPellets(c: RoomClear, s: RoomClearStr): boolean {
	if (!(c.pelletPoints > 0)) return false;
	const text = roomClearFinalTallyText(roomClearSegments(c, false), s);
	return roomClearTallyTextSize(text) < ROOM_CLEAR_VIEW.tallyFit.minText;
}
