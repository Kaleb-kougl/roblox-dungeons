/**
 * The `vale` pack's sprite effects (`fx.*`, docs/FX_AUDIO.md F2 / F5) and ambient particle textures
 * (`decor.fx.ambient.b<n>`, F6), built from the generated fxLayout.ts. Like every vale entry, an ID switches on only
 * once the PNG it needs has an ID in assetIds.ts: every effect needs its sheet (VALE_FX_SOURCES: the effects atlas
 * VALE_FX_SHEET, or the bullet atlas for the bullet impact, docs/PROJECTILE_ART.md PA7, which rides there so the
 * effects atlas never repacks), each ambient texture its own file. With no ID the pack has no fx / ambient entry at all (both slots are optional), so
 * nothing is drawn: exactly the placeholder pack.
 *
 * Presentation choices (decision X2: selective and tinted; the sheet per ID is art/atlases.json's): drawn size of the
 * longer cell side (tiles, at most FX_SPRITE_MAX_TILES), the theme role multiplied into the greyed sheet, and the
 * brighter self-lit blend. Two sheets keep their own colours (Mother Mayhem's rock spikes and the explosion): they
 * carry the pipeline's meanColor, which the validator holds to the enemy-bullet rule like every tint.
 */
import { BOOST_COLLECT_FX_ID, BOOST_FX_IDS, FX_IDS, type BoostFxId, type FxId } from "../../contract";
import { GOLDEN_COIN_ROLE } from "../../fortune";
import { SECRET_DUST_ROLE } from "../../secrets";
import type { ColorRole, ImageAsset, SpriteSetAsset } from "../../types";
import { sortedKeys } from "../../util";
import { VALE_BULLET_SOURCE, type ValeBulletSource } from "./bullets";
import { VALE_FORTUNE_FX_LAYOUTS, VALE_FORTUNE_FX_SHEET } from "./fortuneLayout";
import { VALE_AMBIENT_LAYOUTS, VALE_FX_LAYOUTS, VALE_FX_SHEET, type ValeFxLayout } from "./fxLayout";
import type { ValeSheetFile } from "./layout";
import { VALE_SECRET_FX_LAYOUTS, VALE_SECRET_SHEET } from "./secretLayout";
import { VALE_TREASURE_FX_LAYOUTS, VALE_TREASURE_FX_SHEET } from "./treasureLayout";

type AssetIds = Readonly<Record<string, string>>;

/** How vale draws one effect. `tint` undefined: the sheet's own colours (its layout has a meanColor). */
export interface ValeFxLook {
	readonly sizeTiles: number;
	readonly tint?: ColorRole;
	readonly additive: boolean;
}

/** Neutral grey for dust, smoke and splinters (breakable.crate is too dark for the enemy-bullet rule). */
const DUST: ColorRole = "uiTextDim";

/**
 * The fx IDs vale draws: every FX_IDS entry but the boost drops' effects (the pickup burst: no art yet,
 * docs/BOOSTS.md B8; the auras: their own sheet, boostAuras.ts, docs/BOOST_ART.md BAD3).
 */
export type ValeFxId = Exclude<FxId, BoostFxId>;

/**
 * FX_IDS that vale has no art for yet (absent from the pack: not drawn). docs/BOOSTS.md B8 vendors and maps the boost
 * pickup burst. The boost auras are neither here nor in VALE_FX_IDS: boostAuras.ts draws them (VALE_BOOST_AURA_IDS)
 * once boost-auras.png has an ID.
 */
export const VALE_FX_PENDING: ReadonlyArray<FxId> = [BOOST_COLLECT_FX_ID];

/** One sheet of effects: the PNG and the effects packed into it (cells `start + f`, floor(sheet w / frameW) per row). */
export interface ValeFxSource {
	readonly sheet: Readonly<ValeSheetFile>;
	readonly layouts: Readonly<Record<string, Readonly<ValeFxLayout>>>;
}

/**
 * Every sheet vale's effects live in: the effects atlas (fxLayout.ts), the bullet atlas (`bullets`, default the
 * generated VALE_BULLET_SOURCE: its `fx`, bulletLayout.ts's VALE_BULLET_FX_LAYOUTS, i.e. fx.bullet.hit) and the vault's
 * light column sheet (treasureLayout.ts, docs/TREASURE.md TR9: fx.treasure.column, its own sheet so the effects atlas
 * never repacks) and the Goldling's coin burst sheet (fortuneLayout.ts, docs/FORTUNE.md FO10: fx.golden.coin, likewise)
 * and the secret rooms' sheet (secretLayout.ts, docs/SECRET_ROOMS.md SR11: fx.secret.dust rides with the crack and the
 * rubble). An fx ID is in exactly one of them (fx.spec).
 */
export function valeFxSources(bullets: ValeBulletSource = VALE_BULLET_SOURCE): ReadonlyArray<ValeFxSource> {
	return [
		{ sheet: VALE_FX_SHEET, layouts: VALE_FX_LAYOUTS },
		{ sheet: bullets.sheet, layouts: bullets.fx ?? {} },
		{ sheet: VALE_TREASURE_FX_SHEET, layouts: VALE_TREASURE_FX_LAYOUTS },
		{ sheet: VALE_FORTUNE_FX_SHEET, layouts: VALE_FORTUNE_FX_LAYOUTS },
		{ sheet: VALE_SECRET_SHEET, layouts: VALE_SECRET_FX_LAYOUTS },
	];
}

/** The generated sources (valeFxSources()). */
export const VALE_FX_SOURCES: ReadonlyArray<ValeFxSource> = valeFxSources();

/** The source holding effect `id`'s layout, or undefined (no art). */
export function valeFxSourceOf(
	id: string,
	sources: ReadonlyArray<ValeFxSource> = VALE_FX_SOURCES,
): ValeFxSource | undefined {
	for (const s of sources) if (s.layouts[id] !== undefined) return s;
	return undefined;
}

/** VALE_FX's IDs in FX_IDS order (FX_IDS without VALE_FX_PENDING and the boost auras, BOOST_FX_IDS' others). */
export const VALE_FX_IDS: ReadonlyArray<ValeFxId> = FX_IDS.filter(
	(id) => !VALE_FX_PENDING.includes(id) && !(BOOST_FX_IDS as ReadonlyArray<FxId>).includes(id),
) as Array<ValeFxId>;

/** Every fx ID vale draws (VALE_FX_IDS), and how. */
export const VALE_FX: Readonly<Record<ValeFxId, ValeFxLook>> = {
	"fx.hit.light": { sizeTiles: 0.75, tint: "damageNumber", additive: true },
	"fx.hit.heavy": { sizeTiles: 1, tint: "uiAccent", additive: true },
	"fx.swing.1": { sizeTiles: 1.5, tint: "playerBullet", additive: true },
	"fx.swing.2": { sizeTiles: 1.5, tint: "playerBullet", additive: true },
	"fx.swing.3": { sizeTiles: 2, tint: "uiAccent", additive: true },
	"fx.death.puff": { sizeTiles: 0.9, tint: DUST, additive: false },
	"fx.roll.dust": { sizeTiles: 0.9, tint: DUST, additive: false },
	"fx.guard.shield": { sizeTiles: 1.25, tint: "uiMana", additive: true },
	"fx.ember.ring": { sizeTiles: 1.5, tint: "uiAccent", additive: true },
	"fx.flask": { sizeTiles: 1.25, tint: "fx.heal", additive: true },
	"fx.boss.phase": { sizeTiles: 2.5, tint: "boss", additive: true },
	"fx.boss.slam": { sizeTiles: 3, additive: false },
	"fx.boss.death": { sizeTiles: 2.5, additive: true },
	"fx.relic.take": { sizeTiles: 1, tint: "uiAccent", additive: true },
	"fx.shrine.use": { sizeTiles: 1, tint: "fx.curse", additive: true },
	"fx.stairwell": { sizeTiles: 1.5, tint: "decor.fx.zone", additive: true },
	"fx.breakable.splinter": { sizeTiles: 1, tint: DUST, additive: false },
	// docs/PROJECTILE_ART.md PA7: the pack's own yellow / orange burst, untinted (its meanColor under the fx rule)
	"fx.bullet.hit": { sizeTiles: 0.5, additive: true },
	// docs/TREASURE.md TR9: the vault's light column (original art, gen-treasure-art.js). TreasureRenderController draws
	// it upright at TREASURE_VIEW.open.column's size, tinted by the opened tier's floor role (not this tint, which only
	// holds the sheet to the fx colour rule: the Legendary tier's role) and fading on its own; sizeTiles is the cap.
	"fx.treasure.column": { sizeTiles: 3, tint: "treasure.legendary", additive: true },
	// docs/FORTUNE.md FO10: the Goldling's coin burst (original art, gen-fortune-art.js): solid coins (not additive: their
	// dark rims would vanish), tinted golden.coin; GoldenRenderController plays it x GOLDEN_VIEW.fountainFxScale on a catch
	"fx.golden.coin": { sizeTiles: 1, tint: GOLDEN_COIN_ROLE, additive: false },
	// docs/SECRET_ROOMS.md SR10 / SR11: a secret room's dust trickle (original art, gen-secret-art.js): solid grey motes
	// (not additive: dust is not light), tinted secret.dust; the view drops it down the crack's face
	"fx.secret.dust": { sizeTiles: 1, tint: SECRET_DUST_ROLE, additive: false },
};

/** Ambient textures that glow (LightEmission 1): molten embers. */
export const VALE_AMBIENT_EMISSIVE: ReadonlyArray<string> = ["decor.fx.ambient.b2"];

/** The animation an effect plays (contract FX_ANIMATION). */
const PLAY = "play";

/**
 * The fx.* sprite sets for `ids`: every effect of each source (VALE_FX_SOURCES) once that source's sheet has an ID,
 * else none of its effects.
 */
export function valeFxAssets(
	ids: AssetIds,
	sources: ReadonlyArray<ValeFxSource> = VALE_FX_SOURCES,
): Record<string, SpriteSetAsset> {
	const out: Record<string, SpriteSetAsset> = {};
	for (const source of sources) {
		const assetId = ids[source.sheet.file];
		if (assetId !== undefined) addFxSets(out, source, assetId);
	}
	return out;
}

function addFxSets(out: Record<string, SpriteSetAsset>, source: ValeFxSource, assetId: string): void {
	for (const id of sortedKeys(source.layouts)) {
		const l = source.layouts[id];
		const look = VALE_FX[id as ValeFxId];
		if (look === undefined) {
			continue;
		}
		const set: SpriteSetAsset = {
			kind: "sprites",
			frameW: l.frameW,
			frameH: l.frameH,
			pivot: { x: l.pivot.x, y: l.pivot.y },
			pixelsPerTile: math.max(l.frameW, l.frameH) / look.sizeTiles,
			resample: "Pixelated",
			facings: { count: 1, zeroDeg: 0, ccw: true },
			sheets: [
				{
					assetId: assetId as SpriteSetAsset["sheets"][number]["assetId"],
					w: source.sheet.w,
					h: source.sheet.h,
				},
			],
			animations: { [PLAY]: { sheet: 0, start: l.start, frames: l.frames, fps: l.fps, loop: l.loop } },
			sizeTiles: look.sizeTiles,
			additive: look.additive,
		};
		if (look.tint !== undefined) {
			set.tint = look.tint;
		} else if (l.meanColor !== undefined) {
			set.meanColor = l.meanColor;
		}
		out[id] = set;
	}
}

/** The decor.fx.ambient.b<n> textures for `ids`: each once its own PNG has an ID. */
export function valeAmbientAssets(ids: AssetIds): Record<string, ImageAsset> {
	const out: Record<string, ImageAsset> = {};
	for (const id of sortedKeys(VALE_AMBIENT_LAYOUTS)) {
		const l = VALE_AMBIENT_LAYOUTS[id];
		const assetId = ids[l.file];
		if (assetId === undefined) {
			continue;
		}
		const image: ImageAsset = { kind: "image", assetId: assetId as ImageAsset["assetId"], w: l.w, h: l.h };
		if (l.grid > 1 && l.fps !== undefined && l.mode !== undefined) {
			image.particle = { flipbook: { grid: l.grid, fps: l.fps, mode: l.mode } };
		}
		if (VALE_AMBIENT_EMISSIVE.includes(id)) {
			image.emissive = true;
		}
		out[id] = image;
	}
	return out;
}
