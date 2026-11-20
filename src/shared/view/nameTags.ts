/**
 * Co-op name tags (docs/PLAYER_NAMES.md): who gets a tag, where it lies on the floor, when it ducks, and its fade.
 * Pure; the client's NameTagController draws it. Tunables NAME_TAGS (nameTagsConfig.ts).
 *
 * @module
 */
import { CAMERA_PITCH_DEG } from "shared/config";
import { TileType } from "shared/dungeon";
import { degToRad } from "./iso";
import { NAME_TAGS } from "./nameTagsConfig";

/** Above the head (preferred) or below the feet (when a wall or the void would stand in front of the tag). */
export type NameTagSide = "above" | "below";

/** Unit floor vectors of the camera's screen-right and screen-up (shared/view/hud floorAxes has this shape). */
export interface NameTagAxes {
	readonly rightX: number;
	readonly rightZ: number;
	readonly upX: number;
	readonly upZ: number;
}

/** The current floor's grid (shared/dungeon Dungeon has this shape): W x H tiles, indexed y * W + x. */
export interface NameTagGrid {
	readonly W: number;
	readonly H: number;
	readonly grid: ReadonlyArray<number>;
}

/** The enemy bullet pool as the duck test reads it (shared/view/hud ShoutBullets has this shape). */
export interface NameTagBullets {
	highWater(): number;
	isVisible(i: number): boolean;
	positionAt(i: number): Readonly<{ x: number; z: number }>;
}

/**
 * Whether player `index` gets a tag: a party run (partySize >= 2), not the watched player (`viewIndex`: yourself, or
 * the teammate you spectate, whose name the spectate bar shows), alive, a non-empty name, the setting on.
 */
export function nameTagShown(
	partySize: number,
	index: number,
	viewIndex: number,
	dead: boolean,
	name: string,
	settingOn: boolean,
): boolean {
	return settingOn && partySize >= 2 && index !== viewIndex && !dead && name !== "";
}

/** The tag's centre distance along screen-up on the floor from the feet, tiles (negative: below). */
export function nameTagOffsetTiles(side: NameTagSide, pitchDeg: number = CAMERA_PITCH_DEG): number {
	const T = NAME_TAGS;
	const s = math.sin(degToRad(pitchDeg));
	const halfScreen = (T.depthTiles * s) / 2;
	const screen = side === "above" ? T.headTiles + T.gapTiles + halfScreen : -(T.belowGapTiles + halfScreen);
	return screen / s;
}

/** Writes the tag's floor centre for a player at (x, z) into `out`. */
export function nameTagCentre(
	x: number,
	z: number,
	side: NameTagSide,
	axes: NameTagAxes,
	out: { x: number; z: number },
	pitchDeg: number = CAMERA_PITCH_DEG,
): { x: number; z: number } {
	const d = nameTagOffsetTiles(side, pitchDeg);
	out.x = x + axes.upX * d;
	out.z = z + axes.upZ * d;
	return out;
}

/** A tile a floor text can show on with nothing standing on it: floor or a pool (both flat). */
export function nameTagOpenTile(t: number): boolean {
	return t === TileType.FLOOR || t === TileType.POOL;
}

/** The tile under world (x, z) (cell (gx, gy) is centred on (gx, gy)); VOID outside the grid. */
function tileUnder(g: NameTagGrid, x: number, z: number): number {
	const gx = math.floor(x + 0.5);
	const gy = math.floor(z + 0.5);
	if (gx < 0 || gy < 0 || gx >= g.W || gy >= g.H) return TileType.VOID;
	return g.grid[gy * g.W + gx];
}

/**
 * Whether the above side is clear for a player at (x, z): every sample of the strip from sampleStartTiles up from the
 * feet to the tag's far edge, across the tag's width, lies on an open tile. A wall or the void in that strip stands
 * in front of the tag (its face rises up the screen) and would hide it. No grid (the greybox world): clear.
 */
export function nameTagAboveClear(
	g: NameTagGrid | undefined,
	x: number,
	z: number,
	axes: NameTagAxes,
	pitchDeg: number = CAMERA_PITCH_DEG,
): boolean {
	if (g === undefined) return true;
	const T = NAME_TAGS;
	const far = nameTagOffsetTiles("above", pitchDeg) + T.depthTiles / 2;
	const half = T.widthTiles / 2;
	const upSteps = math.max(1, math.ceil((far - T.sampleStartTiles) / T.sampleTiles));
	const acrossSteps = math.max(1, math.ceil((2 * half) / T.sampleTiles));
	for (let i = 0; i <= upSteps; i++) {
		const up = T.sampleStartTiles + ((far - T.sampleStartTiles) * i) / upSteps;
		for (let j = 0; j <= acrossSteps; j++) {
			const across = -half + (2 * half * j) / acrossSteps;
			const px = x + axes.upX * up + axes.rightX * across;
			const pz = z + axes.upZ * up + axes.rightZ * across;
			if (!nameTagOpenTile(tileUnder(g, px, pz))) return false;
		}
	}
	return true;
}

/**
 * Whether a visible enemy bullet lies in the tag's box centred at (cx, cz), grown by duckMarginTiles on every side
 * (the floor shouts' rule, shared/view/hud shoutDucked). Stops at the first hit.
 */
export function nameTagDucked(cx: number, cz: number, axes: NameTagAxes, bullets: NameTagBullets): boolean {
	const T = NAME_TAGS;
	const halfW = T.widthTiles / 2 + T.duckMarginTiles;
	const halfD = T.depthTiles / 2 + T.duckMarginTiles;
	const n = bullets.highWater();
	for (let i = 0; i < n; i++) {
		if (!bullets.isVisible(i)) continue;
		const p = bullets.positionAt(i);
		const dx = p.x - cx;
		const dz = p.z - cz;
		const along = dx * axes.rightX + dz * axes.rightZ;
		const across = dx * axes.upX + dz * axes.upZ;
		if (math.abs(along) <= halfW && math.abs(across) <= halfD) return true;
	}
	return false;
}

/** Whether a teammate at (x, z) is within nearTiles of the watched player at (vx, vz). */
export function nameTagNear(x: number, z: number, vx: number, vz: number): boolean {
	const dx = x - vx;
	const dz = z - vz;
	const r = NAME_TAGS.nearTiles;
	return dx * dx + dz * dz <= r * r;
}

/**
 * The tag's SurfaceGui CanvasSize, px: widthTiles x canvasPxPerTile wide, tall enough that laid on the floor and
 * foreshortened by the pitch a glyph reads unsquashed (shared/view/hud shoutCanvasSize's rule).
 */
export function nameTagCanvasSize(pitchDeg: number = CAMERA_PITCH_DEG): readonly [number, number] {
	const T = NAME_TAGS;
	const w = T.widthTiles * T.canvasPxPerTile;
	const h = (w * T.depthTiles * math.sin(degToRad(pitchDeg))) / T.widthTiles;
	return [w, math.max(1, math.round(h))];
}

/** The text size on that canvas, px. */
export function nameTagTextSize(pitchDeg: number = CAMERA_PITCH_DEG): number {
	const [, h] = nameTagCanvasSize(pitchDeg);
	return math.max(1, math.floor(h * NAME_TAGS.textShare));
}

/**
 * One tag's side and opacity over time. `reset` when the tag (re)appears: it takes the wanted side at once and fades
 * in from 0. `step` once a frame: the side follows the wanted one only after it held sideHoldSec; the opacity eases
 * toward duckOpacity (ducked), nearOpacity (near) or maxOpacity at maxOpacity / fadeSec per second.
 */
export class NameTagLook {
	side: NameTagSide = "above";
	opacity = 0;
	private wantedFor = 0;
	private fresh = true;

	reset(): void {
		this.fresh = true;
		this.opacity = 0;
		this.wantedFor = 0;
	}

	step(dt: number, aboveClear: boolean, ducked: boolean, near: boolean): void {
		const T = NAME_TAGS;
		const d = math.clamp(dt, 0, T.maxDtSec);
		const wanted: NameTagSide = aboveClear ? "above" : "below";
		if (this.fresh) {
			this.fresh = false;
			this.side = wanted;
			this.wantedFor = 0;
		} else if (wanted === this.side) {
			this.wantedFor = 0;
		} else {
			this.wantedFor += d;
			if (this.wantedFor >= T.sideHoldSec) {
				this.side = wanted;
				this.wantedFor = 0;
			}
		}
		const target = ducked ? T.duckOpacity : near ? T.nearOpacity : T.maxOpacity;
		const rate = T.fadeSec > 0 ? (T.maxOpacity / T.fadeSec) * d : math.huge;
		this.opacity =
			this.opacity < target ? math.min(target, this.opacity + rate) : math.max(target, this.opacity - rate);
	}
}
