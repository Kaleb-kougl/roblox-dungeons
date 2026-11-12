import React from "@rbxts/react";
import { role, str, themePack, uiImage, useHudFont, useUiArt } from "client/ui/theme";
import {
	CODEX_ART,
	CODEX_SCREEN,
	CODEX_SCREEN_STRINGS,
	codexTileArt,
	type CodexArtPack,
	type CodexTileState,
} from "shared/view/codex";
import { ArtImage } from "./primitives";

const HIDDEN = 1;
const HALF = 0.5;
const STROKE = 1;
const EVOLVED_STROKE = 2;
/** A cell label's text height as a share of the cell (the items row's label share). */
const LABEL_SHARE = 0.5;

/** The pack as the tile art reads it: ui images once downloaded (uiImage), the theme's sprite sets. */
const PACK: CodexArtPack = {
	has(id: string): boolean {
		return uiImage(id) !== undefined;
	},
	sprites(id: string) {
		return themePack()?.sprites(id)?.layout;
	},
};

/**
 * A Codex entry's art in a square `box` (reference px; claude/codex-plan.md CX7, shared/view/codex codexTileArt): the
 * items row's cell look for build items and boosts (icon art, else the short labels on the cell's fill), a ring in a
 * champion's colour, an enemy's / boss's idle still (Pixelated per its set; a dark silhouette while unknown), the name
 * as a label without a sprite set, the `?` glyph (or `???`) for anything else unknown. A seen entry draws at
 * CODEX_SCREEN.seenTransparency. Used by the Codex screen's tiles and detail and a codex toast's 16 px icon. Never
 * takes input.
 */
export function CodexArt(props: { id: string; state: CodexTileState; box: number; order?: number; zIndex?: number }) {
	useUiArt();
	const font = useHudFont();
	const box = props.box;
	const z = props.zIndex ?? 1;
	const fade = props.state === "seen" ? CODEX_SCREEN.seenTransparency : 0;
	const art = codexTileArt(PACK, props.id, props.state);
	let body: React.Element;
	if (art.kind === "icons") {
		const n = math.max(1, art.labels.size());
		const cellW = box / n;
		const cells = art.labels.map((label, i) => {
			const icon = art.art?.[i];
			const fill = art.fills[i] ?? art.fills[0];
			return (
				<frame
					key={`c${i}`}
					LayoutOrder={i + 1}
					Size={new UDim2(0, cellW, 0, box)}
					BackgroundColor3={role(icon !== undefined ? "uiPanel" : fill)}
					BackgroundTransparency={fade}
					BorderSizePixel={0}
					ZIndex={z}
				>
					{icon !== undefined ? (
						<ArtImage name="Icon" id={icon} box={{ w: cellW, h: box }} transparency={fade} zIndex={z} />
					) : (
						<textlabel
							Size={UDim2.fromScale(1, 1)}
							BackgroundTransparency={HIDDEN}
							Font={font}
							TextSize={math.max(1, math.floor(box * LABEL_SHARE * HALF))}
							TextColor3={role("uiPanel")}
							TextTransparency={fade}
							Text={str(label)}
							ZIndex={z}
						/>
					)}
				</frame>
			);
		});
		const outline = art.frame ?? (art.art !== undefined ? art.fills[0] : "background");
		body = (
			<frame Size={UDim2.fromOffset(box, box)} BackgroundTransparency={HIDDEN} ZIndex={z}>
				<uilistlayout FillDirection={Enum.FillDirection.Horizontal} SortOrder={Enum.SortOrder.LayoutOrder} />
				<uistroke
					Thickness={art.frame !== undefined ? EVOLVED_STROKE : STROKE}
					Color={role(outline)}
					Transparency={fade}
				/>
				{cells}
			</frame>
		);
	} else if (art.kind === "sprite") {
		const f = art.frame;
		const k = math.min(box / f.w, box / f.h);
		body = (
			<imagelabel
				Image={f.assetId}
				ImageRectOffset={new Vector2(f.x, f.y)}
				ImageRectSize={new Vector2(f.w, f.h)}
				ResampleMode={art.pixelated ? Enum.ResamplerMode.Pixelated : Enum.ResamplerMode.Default}
				ImageColor3={art.silhouette ? role(CODEX_ART.silhouetteRole) : new Color3(1, 1, 1)}
				ImageTransparency={art.silhouette ? CODEX_ART.silhouetteTransparency : fade}
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromOffset(f.w * k, f.h * k)}
				BackgroundTransparency={HIDDEN}
				ZIndex={z}
			/>
		);
	} else if (art.kind === "ring") {
		body = (
			<frame
				Size={UDim2.fromOffset(box, box)}
				BackgroundColor3={role("uiPanel")}
				BackgroundTransparency={fade}
				BorderSizePixel={0}
				ZIndex={z}
			>
				<uicorner CornerRadius={new UDim(HALF, 0)} />
				<uistroke
					Thickness={math.max(STROKE, box * CODEX_ART.ringStrokeShare)}
					Color={role(art.role)}
					Transparency={fade}
				/>
				<textlabel
					AnchorPoint={new Vector2(HALF, HALF)}
					Position={UDim2.fromScale(HALF, HALF)}
					Size={new UDim2(1, -box * CODEX_ART.ringStrokeShare * 4, CODEX_ART.ringLabelShare, 0)}
					BackgroundTransparency={HIDDEN}
					Font={font}
					TextScaled={true}
					TextColor3={role(art.role)}
					TextTransparency={fade}
					Text={str(art.labelKey)}
					ZIndex={z}
				/>
			</frame>
		);
	} else if (art.kind === "label") {
		body = (
			<textlabel
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
				Font={font}
				TextScaled={true}
				TextWrapped={true}
				TextColor3={role(art.role)}
				TextTransparency={fade}
				Text={str(art.key)}
				ZIndex={z}
			/>
		);
	} else {
		const icon = art.icon;
		body =
			icon !== undefined ? (
				<ArtImage name="Unknown" id={icon} box={{ w: box, h: box }} color="uiTextDim" zIndex={z} />
			) : (
				<textlabel
					Size={UDim2.fromScale(1, 1)}
					BackgroundTransparency={HIDDEN}
					Font={font}
					TextScaled={true}
					TextColor3={role("uiTextDim")}
					Text={str(CODEX_SCREEN_STRINGS.unknown)}
					ZIndex={z}
				/>
			);
	}
	return (
		<frame
			LayoutOrder={props.order ?? 0}
			Size={UDim2.fromOffset(box, box)}
			BackgroundTransparency={HIDDEN}
			Active={false}
			ZIndex={z}
		>
			{body}
		</frame>
	);
}
