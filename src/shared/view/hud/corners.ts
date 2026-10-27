/**
 * The four screen corners the always-on HUD panels sit in (docs/HUD_LAYOUT.md H3). Pure: the client turns an anchor
 * into a UDim2 position with HUD_VIEW.margin (client/ui/hud primitives Panel `corner`).
 */
export type HudCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

/** A corner's anchor point: 0 = left / top edge, 1 = right / bottom edge. */
export function cornerAnchor(corner: HudCorner): { readonly ax: number; readonly ay: number } {
	switch (corner) {
		case "topLeft":
			return { ax: 0, ay: 0 };
		case "topRight":
			return { ax: 1, ay: 0 };
		case "bottomLeft":
			return { ax: 0, ay: 1 };
		case "bottomRight":
			return { ax: 1, ay: 1 };
	}
}
