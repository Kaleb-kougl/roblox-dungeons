/**
 * How the combo is DRAWN (docs/COMBO.md CB6 / CB7): the score panel's combo row and meter (client/ui/hud ComboRow /
 * ComboMeter, written per frame through COMBO_UI by the client's ComboController) and the floor shout. The display's
 * state machine (combo.ts ComboDisplay) decides WHAT shows and when; this module holds the pixel / tile sizes it is
 * drawn at and the small pure pieces of that drawing that are worth a spec: where a shard of the shattered meter track
 * is at a point of its flight, where the shine band is, the crack's `-xN.N` drop, the floor's screen axes, the shout's canvas
 * and the shout's own short timeline (ComboShout: fade in, fade out, slide, duck). Presentation only (CD1); every
 * number is free to move at the CB9 tuning pass.
 *
 * Units: HUD sizes are reference px (HUD_VIEW); floor sizes are tiles; times are real seconds.
 */
import { CAMERA_PITCH_DEG, CAMERA_YAW_DEG } from "shared/config";
import { degToRad } from "../iso";
import { COMBO_SHOUT, COMBO_VIEW } from "./comboConfig";
import { COMBO_STRINGS } from "./comboStrings";

/** The combo row and meter's drawing sizes (reference px) and looks. */
export const COMBO_DRAW = {
	/**
	 * The multiplier's fixed slot at the row's right (`x5.0` at HUD_VIEW.titleText); the tier slot takes the rest of
	 * the row. The multiplier pops / slams by a UIScale inside this slot, so no row moves (CD8, Room clear RCD16).
	 */
	multWidth: 80,
	/** The tier slot's text is TextScaled (a long name or translation shrinks to fit) up to this size. */
	slotMaxText: 20,
	/** The crack's `-xN.N` falls this far from under the multiplier while it fades (COMBO_VIEW.crack.dropSec). */
	dropFallPx: 14,
	/** The crack's drop text size. */
	dropText: 16,
	/** The warning blink's dim half: the fill at this transparency. */
	dimTransparency: 0.6,
	/**
	 * UNSTOPPABLE's shine: a white copy of the multiplier seen only through a band bandWidth wide (a fraction of the
	 * label) at bandTransparency, swept across by its UIGradient's Offset.
	 */
	shine: { bandWidth: 0.3, bandTransparency: 0.2 },
	/**
	 * The shatter (COMBO_VIEW.break.shards pieces of the WHOLE meter track, each 1 / shards of its width: a break is the
	 * timer reaching 0, so the fill is empty by then and pieces of it would be sub-pixel): each piece flies outward
	 * from the track's centre by up to spreadPx, rises risePx then falls fallPx (a parabola over the flight), turns up
	 * to spinDeg and fades out. Kept short so a piece stays inside the panel (the CanvasGroup clips at its edge).
	 */
	shards: { spreadPx: 12, risePx: 6, fallPx: 18, spinDeg: 160 },
	/**
	 * The run-over panel's best combo line (CD16, "x3.4 CARNAGE"): its value column is this much wider than
	 * HUD_VIEW.breakdownValueWidth and its label column this much narrower (the row keeps its width, so the columns
	 * stay aligned); the value is TextScaled up to HUD_VIEW.textSize, so a long name or translation shrinks to fit.
	 */
	runOverValueExtra: 70,
} as const;

/**
 * The floor shout's drawing (CD9): its Part's layer, its SurfaceGui canvas, the fade-in, the text's stroke, and the
 * Workspace folder. The shout's Part top sits `layerStepsBelowEffects` FX_SPRITE_VIEW.layerStepStuds BELOW the sprite
 * effects' lowest layer (FX_SPRITE_VIEW.liftStuds), its own layer in their stack: above the decor flats and room edges,
 * under every effect, floor marking and bullet, so it never z-fights an effect and loses every overlap.
 */
export const COMBO_SHOUT_DRAW = {
	layerStepsBelowEffects: 1,
	/** Canvas px per tile along the shout's width (its depth follows from shoutCanvasSize). */
	canvasPxPerTile: 64,
	/** Fades in over this, peaks, then fades out linearly to COMBO_SHOUT.lifeSec. */
	fadeInSec: 0.08,
	/** The dark stroke's transparency at full opacity (it fades with the fill). */
	strokeTransparency: 0,
	/** Lit like the HUD (LightInfluence 0): the tier colour as validated, on every biome's lighting. */
	lightInfluence: 0,
	folderName: "KV_ComboShout",
} as const;

/**
 * Studio check aid (CLAUDE.md working agreement: off by default). Set the Workspace string attribute `attribute` to
 * "1".."4" (that tier's tier-up: the slam, flash and floor shout), "break", "small" (a small break), "lapse" or "cut";
 * every CHANGE to one of these fires it once on the next frame of a scored run, on the display and (through the same
 * quiet gate as real play) the sting / shatter. Absent / anything else: nothing.
 */
export const COMBO_DEBUG = {
	attribute: "KV_ComboDebug",
	/** The value a forced break / lapse / cut loses (x3.4, a CARNAGE). */
	lostTenths: 34,
	/** A forced small break loses this (x1.4). */
	smallLostTenths: 14,
	/** A forced cut goes from lostTenths to this (x1.7, CARNAGE down to none). */
	cutToTenths: 17,
} as const;

/** One shard's look at a point of its flight. Mutable: one per shard, refilled. */
export interface ComboShardLook {
	/** Its start: the centre of its piece of the track, a fraction of the meter's width. */
	xScale: number;
	/** Offsets from that start and from the meter's vertical centre, px (y down). */
	dxPx: number;
	dyPx: number;
	rotationDeg: number;
	transparency: number;
}

/**
 * Shard `i` of `n` at flight progress `u` (0..1, ComboDisplayFrame.shards): piece i of the whole track (comboShardWidth
 * wide, never sized from the fill). Pieces left of the centre fly left, right of it right; outer pieces fly and turn
 * further.
 */
export function comboShardAt(i: number, n: number, u: number, out: ComboShardLook): ComboShardLook {
	const S = COMBO_DRAW.shards;
	const t = math.clamp(u, 0, 1);
	const centre = n > 0 ? (i + 1 / 2) / n : 1 / 2;
	const side = centre * 2 - 1;
	out.xScale = centre;
	out.dxPx = S.spreadPx * side * t;
	out.dyPx = (S.fallPx + S.risePx) * t * t - 2 * S.risePx * t;
	out.rotationDeg = S.spinDeg * side * t;
	out.transparency = t;
	return out;
}

/** Each of `n` shards' width, a fraction of the meter's width: together they tile the whole track. */
export function comboShardWidth(n: number): number {
	return n > 0 ? 1 / n : 0;
}

/** The shine's UIGradient Offset X at sweep progress `u` (0..1): the band enters at the left and leaves at the right. */
export function comboShineOffset(u: number): number {
	const reach = 1 / 2 + COMBO_DRAW.shine.bandWidth / 2;
	return -reach + 2 * reach * math.clamp(u, 0, 1);
}

/** The crack's `-xN.N` at a point of its drop. Mutable: the controller keeps one and refills it each frame. */
export interface ComboDropLook {
	/** How far it fell from under the multiplier, px (0 under reduced motion). */
	fallPx: number;
	transparency: number;
}

/**
 * The crack's `-xN.N` at drop progress `u` (0..1), written into `out`: it falls COMBO_DRAW.dropFallPx while it fades;
 * under reduced motion (`still`) it fades in place.
 */
export function comboDropAt(u: number, still: boolean, out: ComboDropLook): ComboDropLook {
	const t = math.clamp(u, 0, 1);
	out.fallPx = still ? 0 : COMBO_DRAW.dropFallPx * t;
	out.transparency = t;
	return out;
}

/** The crack's drop text: the multiplier string of the cut (HUD_STRINGS.combo, "x1.2") with a minus. */
export function comboDropText(multiplier: string): string {
	return `-${multiplier}`;
}

/** Escapes text for a RichText label (& < > " ': a pack's string never turns into a tag). */
export function richTextEscape(text: string): string {
	const [out] = text
		.gsub("&", "&amp;")[0]
		.gsub("<", "&lt;")[0]
		.gsub(">", "&gt;")[0]
		.gsub('"', "&quot;")[0]
		.gsub("'", "&apos;");
	return out;
}

/** The multiplier's RichText: the escaped text, struck through (`<s>`) while a break shows. */
export function comboMultRichText(multiplier: string, struck: boolean): string {
	const safe = richTextEscape(multiplier);
	return struck ? `<s>${safe}</s>` : safe;
}

/** A theme string lookup for the combo's composed texts (the client's `str`, or `(k, v) => pack.str(k, v)`). */
export type ComboTextStr = (key: string, vars?: Readonly<Record<string, string | number>>) => string;

/** Fill `{name}` placeholders of a RichText template with already-escaped (or tagged) parts; the template is escaped. */
function fillRich(template: string, parts: Readonly<Record<string, string>>): string {
	const [out] = richTextEscape(template).gsub("{([%w_]+)}", (key: string) => parts[key]);
	return out;
}

/**
 * The run-over best combo value (CD16): the multiplier, then the tier's name in its colour (`hex`, "#rrggbb") when the
 * best reached a tier (`name` undefined below x2: the multiplier alone), in `hud.combo.bestNamed`'s order ("{combo}
 * {name}"). RichText, every part escaped.
 */
export function comboBestRichText(multiplier: string, name: string | undefined, hex: string, s: ComboTextStr): string {
	const safe = richTextEscape(multiplier);
	if (name === undefined || name === "") return safe;
	const named = richTextEscape(name);
	const tinted = hex === "" ? named : `<font color="${hex}">${named}</font>`;
	return fillRich(s(COMBO_STRINGS.bestNamed), { combo: safe, name: tinted });
}

/** The floor shout's text: the tier's name in `hud.combo.shout` ("{name}!": "RAMPAGE!"). */
export function comboShoutText(name: string, s: ComboTextStr): string {
	return s(COMBO_STRINGS.shout, { name });
}

/** Unit floor (x, z) vectors of the camera's screen-right and screen-up (away from the camera) for a yaw. */
export interface FloorAxes {
	readonly rightX: number;
	readonly rightZ: number;
	readonly upX: number;
	readonly upZ: number;
}

/** The floor axes for camera yaw `yawDeg` (shared/view isoBasis: right = (cos, 0, -sin), forward's floor part = up). */
export function floorAxes(yawDeg: number = CAMERA_YAW_DEG): FloorAxes {
	const y = degToRad(yawDeg);
	const s = math.sin(y);
	const c = math.cos(y);
	return { rightX: c, rightZ: -s, upX: -s, upZ: -c };
}

/**
 * The shout's SurfaceGui CanvasSize, px: COMBO_SHOUT.widthTiles x canvasPxPerTile wide; tall enough that, laid on a
 * face of widthTiles x depthTiles and foreshortened by the camera's pitch, a glyph reads unsquashed on screen.
 */
export function shoutCanvasSize(pitchDeg: number = CAMERA_PITCH_DEG): readonly [number, number] {
	const w = COMBO_SHOUT.widthTiles * COMBO_SHOUT_DRAW.canvasPxPerTile;
	const h = (w * COMBO_SHOUT.depthTiles * math.sin(degToRad(pitchDeg))) / COMBO_SHOUT.widthTiles;
	return [w, math.max(1, math.round(h))];
}

/**
 * CD9's duck ceiling, shared by every floor text (the combo shout; the PARRY! flash, docs/GRAZE_PARRY.md GP7): at
 * COMBO_SHOUT.maxOpacity while clear; while an enemy bullet is in the text's box (shoutDucked) it eases down to
 * duckOpacity at a rate of (maxOpacity - duckOpacity) / duckSec, and back up at the same rate when clear. The text's
 * opacity is min(its own envelope x maxOpacity, ceiling).
 */
export class ShoutDuck {
	private ceiling: number = COMBO_SHOUT.maxOpacity;

	/** Back to maxOpacity (a new text). */
	reset(): void {
		this.ceiling = COMBO_SHOUT.maxOpacity;
	}

	/** The current ceiling, without stepping. */
	value(): number {
		return this.ceiling;
	}

	/** Steps by `dt` real seconds (clamped to 0..COMBO_VIEW.maxFrameDtSec) with this frame's duck test; the ceiling. */
	step(dt: number, ducked: boolean): number {
		const S = COMBO_SHOUT;
		const d = math.clamp(dt, 0, COMBO_VIEW.maxFrameDtSec);
		const rate = S.duckSec > 0 ? ((S.maxOpacity - S.duckOpacity) / S.duckSec) * d : math.huge;
		this.ceiling = ducked
			? math.max(S.duckOpacity, this.ceiling - rate)
			: math.min(S.maxOpacity, this.ceiling + rate);
		return this.ceiling;
	}
}

/** The shout's look this frame. Mutable, reused. */
export interface ComboShoutLook {
	/** A shout shows. */
	active: boolean;
	/** The tier it names (1..4). */
	tier: number;
	/** Opacity of the fill and stroke (0..COMBO_SHOUT.maxOpacity). */
	opacity: number;
	/** How far it slid up-screen, tiles (0 under reduced motion). */
	slideTiles: number;
}

/**
 * The floor shout's timeline (CD9): `start(tier)` on a tierUp edge (a new one replaces a showing one), `frame` once
 * per rendered frame with whether an enemy bullet is in its box (shoutDucked). It fades in over fadeInSec, then out
 * linearly to COMBO_SHOUT.lifeSec, at most maxOpacity; while ducked its opacity eases down to duckOpacity at a rate of
 * (maxOpacity - duckOpacity) / duckSec and back up when clear; it slides slideTiles up-screen (ease out) over its
 * life, not at all under reduced motion (a plain fade). `clear` drops it (stage cover, a new run, no run). `lifeSec`
 * (default COMBO_SHOUT.lifeSec): a longer shout on the same construction (the new-best NEW BEST! shout, docs/NEW_BEST.md
 * NB7: NEW_BEST.shout.lifeSec); the fade-in, duck and slide rules are the same over its own life.
 */
export class ComboShout {
	readonly look: ComboShoutLook = { active: false, tier: 0, opacity: 0, slideTiles: 0 };
	private age = 0;
	private life: number = COMBO_SHOUT.lifeSec;
	/** The duck ceiling: maxOpacity when clear, eased down to duckOpacity while ducked. */
	private readonly duck = new ShoutDuck();

	start(tier: number, lifeSec: number = COMBO_SHOUT.lifeSec): void {
		this.look.active = tier > 0;
		this.look.tier = tier;
		this.life = lifeSec;
		this.age = 0;
		this.duck.reset();
		this.look.opacity = 0;
		this.look.slideTiles = 0;
	}

	clear(): void {
		this.look.active = false;
		this.look.tier = 0;
		this.look.opacity = 0;
		this.look.slideTiles = 0;
		this.age = 0;
		this.duck.reset();
	}

	frame(dt: number, ducked: boolean, reducedMotion: boolean): ComboShoutLook {
		const L = this.look;
		if (!L.active) return L;
		const d = math.clamp(dt, 0, COMBO_VIEW.maxFrameDtSec);
		this.age += d;
		const life = this.life;
		if (this.age >= life) {
			this.clear();
			return L;
		}
		const S = COMBO_SHOUT;
		const ceiling = this.duck.step(d, ducked);
		const fadeIn = COMBO_SHOUT_DRAW.fadeInSec;
		const rise = fadeIn > 0 ? this.age / fadeIn : 1;
		const fall = (life - this.age) / (life - fadeIn);
		const envelope = math.clamp(math.min(rise, fall), 0, 1);
		L.opacity = math.min(S.maxOpacity * envelope, ceiling);
		const u = this.age / life;
		L.slideTiles = reducedMotion ? 0 : S.slideTiles * (1 - (1 - u) * (1 - u));
		return L;
	}
}
