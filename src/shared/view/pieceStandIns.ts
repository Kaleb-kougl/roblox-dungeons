/**
 * Stand-ins (docs/STAGE_ASSETS.md "Revision 2: playable while loading", SA18), the pure part. A renderer that draws a
 * pack's art or, without it, the placeholder also draws the placeholder (the stand-in) while the art's logical id has
 * not finished downloading (ArtReadiness), and swaps on the flip. This module holds what those renderers share:
 *
 *   ReadinessCursor   one renderer's view of the readiness feed: `take()` lists the logical ids whose readiness
 *                     changed since its last call (empty, without a list, while the epoch stands), so a frame loop
 *                     polls it for the cost of one number compare. The list names ids that changed in EITHER
 *                     direction (KV_StandInsForce flips ids back): re-read `isReady(id)`.
 *   lookWhenReady     a theme look with its `art` dropped while not ready: the renderer's existing "no art" branch
 *                     builds the placeholder from it, unchanged.
 *   solidStandIns     the solid decor stand-in boxes (SAD15): one per Forge `Dungeon.solidDecor` piece (WALL cells for
 *                     the sim, drawn as floor under their decor art), its footprint, the kind's height
 *                     (SOLID_DECOR_STAND_IN) and the decor plan entry that draws its art (so the box shows while that
 *                     entry has no piece drawn, or its piece's id is not ready: never an invisible blocker).
 *
 * No Roblox APIs (Color3 aside, none used). Tunables: SOLID_DECOR_STAND_IN in standInsConfig.ts.
 *
 * @module
 */
import type { SolidDecorKind, SolidDecorPiece } from "shared/dungeon";
import type { DecorEntry } from "./decor";
import type { ReadinessFeed } from "./standIns";
import { SOLID_DECOR_STAND_IN, type SolidDecorStandInConfig } from "./standInsConfig";

const NONE: ReadonlyArray<string> = [];

/** See the module comment. Starts at the feed's current epoch: flips before it are not listed. */
export class ReadinessCursor {
	private last: number;

	constructor(private readonly feed: ReadinessFeed) {
		this.last = feed.epoch();
	}

	/** The logical ids whose readiness changed since the last call (or construction), each once; empty when none. */
	take(): ReadonlyArray<string> {
		const now = this.feed.epoch();
		if (now === this.last) return NONE;
		const out = this.feed.flippedSince(this.last);
		this.last = now;
		return out;
	}

	/** The feed's `isReady`. */
	isReady(id: string): boolean {
		return this.feed.isReady(id);
	}
}

/** `look` as is while `ready`, else a copy without its `art` (the renderer then draws its placeholder). */
export function lookWhenReady<T extends { readonly art: unknown }>(look: T, ready: boolean): T {
	if (ready || look.art === undefined) return look;
	return { ...look, art: undefined };
}

/** One solid decor piece's stand-in box: its cells, height and the decor plan entry drawing its art (-1: none). */
export interface SolidStandIn {
	readonly kind: SolidDecorKind;
	/** First cell (grid x / y) and size in cells. */
	readonly x: number;
	readonly y: number;
	readonly w: number;
	readonly h: number;
	readonly heightTiles: number;
	/** The plan entry whose art stands on this piece (a wide bookcase pair shares one); -1 when the plan has none. */
	readonly entry: number;
}

function cellKey(x: number, y: number): string {
	return `${x},${y}`;
}

/**
 * The stand-in boxes for `pieces` (Dungeon.solidDecor), each matched to the decor plan entry that draws it: the plan's
 * `solid` standing entries sit on their piece's first cell (cellX / cellY), and a `bookcaseWide` entry also covers the
 * second case of its pair, one cell along its run. Piece order kept.
 */
export function solidStandIns(
	pieces: ReadonlyArray<SolidDecorPiece>,
	entries: ReadonlyArray<DecorEntry>,
	cfg: SolidDecorStandInConfig = SOLID_DECOR_STAND_IN,
): SolidStandIn[] {
	const byCell = new Map<string, number>();
	for (let i = 0; i < entries.size(); i++) {
		const e = entries[i];
		if (e.source !== "solid" || e.layer === "flat") continue;
		byCell.set(cellKey(e.cellX, e.cellY), i);
		if (e.kind === "bookcaseWide") byCell.set(cellKey(e.cellX + e.runX, e.cellY + e.runZ), i);
	}
	const out = new Array<SolidStandIn>();
	for (const p of pieces) {
		out.push({
			kind: p.kind,
			x: p.x,
			y: p.y,
			w: p.w,
			h: p.h,
			heightTiles: cfg.heightTiles[p.kind],
			entry: byCell.get(cellKey(p.x, p.y)) ?? -1,
		});
	}
	return out;
}

/**
 * Whether a stand-in box shows: its entry draws no piece (`pieceId` undefined: no art in the pack, or art too large for
 * its box), or the piece's id is not ready.
 */
export function solidStandInShown(pieceId: string | undefined, isReady: (id: string) => boolean): boolean {
	return pieceId === undefined || !isReady(pieceId);
}
