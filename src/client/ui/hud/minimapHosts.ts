/**
 * The minimap's host frames (docs/MINIMAP.md M8 / M9), a ref registry like cornerFade: the React shells (MinimapPanel's
 * corner map, FullMapOverlay, the PauseOverlay's map) each render one empty, clipping host frame and register it here
 * by a stable ref callback; MinimapController parents its imperative map layer (the EditableImage's ImageLabel and the
 * marker pool) into the host that is mounted and drives it every frame. Nothing per frame goes through React.
 *
 * @module
 */

/** corner: the bottom-right panel; full: the full map toggle overlay; pause: the solo pause overlay's map. */
export type MinimapHost = "corner" | "full" | "pause";
export const MINIMAP_HOSTS: ReadonlyArray<MinimapHost> = ["corner", "full", "pause"];

interface HostSlot {
	frame: GuiObject | undefined;
	readonly ref: (frame: GuiObject | undefined) => void;
}

const hosts = new Map<MinimapHost, HostSlot>();
for (const host of MINIMAP_HOSTS) {
	const slot: HostSlot = {
		frame: undefined,
		ref: (frame) => {
			slot.frame = frame;
		},
	};
	hosts.set(host, slot);
}

/** The stable ref callback a host frame passes (a new function per render would detach and re-attach it). */
export function minimapHostRef(host: MinimapHost): (frame: GuiObject | undefined) => void {
	return hosts.get(host)!.ref;
}

/** The mounted host frame (undefined: not mounted, or no longer in the tree). */
export function minimapHostFrame(host: MinimapHost): GuiObject | undefined {
	const f = hosts.get(host)!.frame;
	return f !== undefined && f.Parent !== undefined ? f : undefined;
}
