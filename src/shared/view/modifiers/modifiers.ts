/**
 * The floor modifiers on screen (docs/FLOOR_MODIFIERS.md FM5 / FM6): the floor card's banner rows and stamp, the card's
 * hold, the status chip's pulse. Pure: plain numbers in, plain looks out, tested headlessly (modifiers.spec.ts). The
 * client's StageController / StageCard draw the banner, FloorModifierChip the chip and the pause overlay its line
 * (`hud.pause.floorMod` with the name and line strings).
 */
import { floorModifierKind, isFloorModifierTwist } from "shared/dungeon";
import {
	floorModifierIconId,
	floorModifierLineKey,
	floorModifierNameKey,
	floorModifierRole,
	type ColorRole,
} from "shared/theme";
import { FLOOR_MODIFIER_VIEW } from "./config";

/** What the banner (and the chip, the pause line) shows for one modifier kind. */
export interface ModifierCardRows {
	/** The shared/dungeon FloorModifier id. */
	readonly kind: number;
	/** Its string id (MODIFIERS.kinds `key`: "gilded", "bloodMoon", ...). */
	readonly key: string;
	/** The banner's big name / the chip's text (`floormod.<key>.name`). */
	readonly nameKey: string;
	/** The line under the name / after it on the pause line (`floormod.<key>.line`). */
	readonly lineKey: string;
	/** The name's colour (`floorMod.<key>`): gold for the boons, blood red for the twist. */
	readonly role: ColorRole;
	/**
	 * The optional icon left of the name and on the chip (`ui.floormod.<key>`, lowercase). Draw it only when the pack
	 * has it (all five or none); absent: text only.
	 */
	readonly iconId: string;
	/** A twist (FloorModifierClass.TWIST, Blood Moon): the danger banner and the ominous sting. */
	readonly twist: boolean;
}

/** The banner rows of modifier `kind` (EndlessFloorLayout.modifier); undefined for NONE or an unknown id (no banner). */
export function modifierCardRows(kind: number): ModifierCardRows | undefined {
	const def = floorModifierKind(kind);
	if (def === undefined) return undefined;
	const role = floorModifierRole(def.key);
	if (role === undefined) return undefined;
	return {
		kind,
		key: def.key,
		nameKey: floorModifierNameKey(def.key),
		lineKey: floorModifierLineKey(def.key),
		role,
		iconId: floorModifierIconId(def.key),
		twist: isFloorModifierTwist(kind),
	};
}

/** The banner's look at one moment: draw it at all, its transparency (0 opaque) and its scale (1 at rest). */
export interface ModifierBannerLook {
	readonly visible: boolean;
	readonly transparency: number;
	readonly scale: number;
}

const HIDDEN_BANNER: ModifierBannerLook = { visible: false, transparency: 1, scale: 1 };
const RESTING_BANNER: ModifierBannerLook = { visible: true, transparency: 0, scale: 1 };

/**
 * The banner (both rows) `elapsedSec` after the floor card appeared: hidden for FLOOR_MODIFIER_VIEW.bannerDelaySec, then
 * the stamp (scale stamp.fromScale -> 1 easing out, transparency 1 -> 0) over stamp.durationSec, then at rest. Reduced
 * motion: no stamp, the banner shows at rest from the card's first frame (with the rest of the card).
 */
export function modifierBannerLook(elapsedSec: number, reducedMotion: boolean): ModifierBannerLook {
	if (reducedMotion) return RESTING_BANNER;
	const v = FLOOR_MODIFIER_VIEW;
	const since = elapsedSec - v.bannerDelaySec;
	if (since < 0) return HIDDEN_BANNER;
	const dur = v.stamp.durationSec;
	if (since >= dur) return RESTING_BANNER;
	const u = since / dur;
	const ease = 1 - (1 - u) * (1 - u) * (1 - u);
	return { visible: true, transparency: 1 - u, scale: v.stamp.fromScale + (1 - v.stamp.fromScale) * ease };
}

/**
 * Seconds the floor card must hold on floor modifier `kind` (StageLoad.holdAtLeast): FLOOR_MODIFIER_VIEW.modifierCardSec
 * on a modifier floor whose world is frozen under the card (the draft is open: a longer card costs no play time), else 0
 * (a plain floor keeps today's card; a live world under the card is never held, the chip carries the news).
 */
export function modifierCardHoldSec(kind: number, worldLive: boolean): number {
	if (worldLive || floorModifierKind(kind) === undefined) return 0;
	return FLOOR_MODIFIER_VIEW.modifierCardSec;
}

/** The chip's look during a pulse: its scale (1 at rest) and the highlight's transparency (1: invisible, at rest). */
export interface ModifierChipPulseLook {
	readonly scale: number;
	readonly transparency: number;
}

const RESTING_CHIP: ModifierChipPulseLook = { scale: 1, transparency: 1 };

/**
 * The chip's one pulse `sinceSec` after the payoff (ModifierPayoff.frame returned true): scale up to 1 + amplitude and
 * back over chipPulse.durationSec (a half sine), the highlight down to peakTransparency at the peak and back. Before
 * it, after it and under reduced motion: at rest.
 */
export function chipPulse(sinceSec: number, reducedMotion: boolean): ModifierChipPulseLook {
	const p = FLOOR_MODIFIER_VIEW.chipPulse;
	if (reducedMotion || sinceSec < 0 || sinceSec >= p.durationSec) return RESTING_CHIP;
	const s = math.sin((math.pi * sinceSec) / p.durationSec);
	return { scale: 1 + p.amplitude * s, transparency: 1 - (1 - p.peakTransparency) * s };
}
