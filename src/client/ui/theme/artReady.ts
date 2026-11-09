import { useEffect, useState } from "@rbxts/react";
import { getActiveThemePack, type ImageRef } from "shared/theme";

/**
 * UI art readiness (docs/STAGE_ASSETS.md "Revision 2", SA18): a ui image is drawn only once its content has downloaded
 * on this device; until then every component takes its existing "without the art" path (the flat UI, labels, flat
 * pips, UI_ART's art-less layout), and swaps on the flip. The readiness is PreloadController's; the client's
 * UiArtController binds it here (client/ui never imports a controller). Before it is bound every image counts as
 * ready (today's behaviour).
 *
 *   uiImage(id)        the active pack's `image(id)`, or undefined while it is not ready: use it wherever a component
 *                      asks `pack.image(id)` (and so whether to draw art at all).
 *   UI_IMAGES          a `{ image }` view on uiImage for helpers that take a pack's image lookup (shared/view/hud
 *                      skinHasOf, pipArt, touchArtId, ...).
 *   useUiArt()         React: re-renders the calling component when a ui image it (or anyone) asked about flips.
 *                      Every component that reads uiImage / UI_IMAGES calls it once, unconditionally.
 *   onUiArtChanged(cb) the same for code outside React (TouchControlsController); returns the disconnect.
 *
 * One subscription to the feed for the whole UI: a change bumps one counter and calls the listeners in-thread, and
 * only when a flipped id is one the UI has asked about.
 */

/** What the UI reads of the client's readiness feed (PreloadController satisfies it). */
export interface UiArtReadinessFeed {
	isArtReady(logicalId: string): boolean;
	onReadinessChanged(listener: (epoch: number) => void): () => void;
	getReadiness(): { flippedSince(epoch: number): ReadonlyArray<string> };
}

let feed: UiArtReadinessFeed | undefined;
let unsubscribe: (() => void) | undefined;
let lastEpoch = -1;
let revision = 0;
/** Logical ids the UI asked about (only their flips re-render). */
const asked = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
	revision++;
	// copied first: a listener may disconnect (an unmount) while we iterate
	const list = new Array<() => void>();
	for (const l of listeners) list.push(l);
	for (const l of list) l();
}

/** Binds the client's readiness feed (UiArtController, once). Returns the unbind. Every listener re-reads at once. */
export function bindUiArtReadiness(source: UiArtReadinessFeed, epoch: number): () => void {
	unsubscribe?.();
	feed = source;
	lastEpoch = epoch;
	unsubscribe = source.onReadinessChanged((now) => {
		const flipped = source.getReadiness().flippedSince(lastEpoch);
		lastEpoch = now;
		for (const id of flipped) {
			if (asked.has(id)) {
				notify();
				return;
			}
		}
	});
	notify();
	return () => {
		unsubscribe?.();
		unsubscribe = undefined;
		feed = undefined;
		notify();
	};
}

/** Whether ui image `id` has downloaded (true before a feed is bound). Records the id as asked about. */
export function uiArtReady(id: string): boolean {
	asked.add(id);
	return feed === undefined || feed.isArtReady(id);
}

/** The active pack's ui image `id`, or undefined when the pack has none or it has not downloaded yet. */
export function uiImage(id: string): ImageRef | undefined {
	const ref = getActiveThemePack()?.image(id);
	if (ref === undefined) return undefined;
	return uiArtReady(id) ? ref : undefined;
}

/** A pack-like `{ image }` over uiImage, for helpers that take a pack's image lookup. */
export const UI_IMAGES = {
	image(id: string): ImageRef | undefined {
		return uiImage(id);
	},
};

/** Calls `cb` after a ui image asked about flipped (or the feed was bound). Returns the disconnect. */
export function onUiArtChanged(cb: () => void): () => void {
	listeners.add(cb);
	return () => {
		listeners.delete(cb);
	};
}

/** React: re-renders on a ui art flip; returns the UI art revision (a change counter). */
export function useUiArt(): number {
	const [seen, setSeen] = useState(revision);
	useEffect(() => {
		const disconnect = onUiArtChanged(() => setSeen(revision));
		// a flip between the render and this effect
		if (seen !== revision) setSeen(revision);
		return disconnect;
	}, []);
	return seen;
}
