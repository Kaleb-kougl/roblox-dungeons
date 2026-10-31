import React from "@rbxts/react";
import { ArtImage, FocusCorners, SlicedImage, Text, useHudScale } from "client/ui/hud";
import { role, themePack } from "client/ui/theme";
import { UI_ART_SPIKE } from "shared/config";
import { HUD_VIEW, UI_ART, artPixelScale, snappedSliceScale } from "shared/view/hud";

const HIDDEN = 1;

function fmt(n: number): string {
	return string.format(UI_ART_SPIKE.scaleFormat, n);
}

/** A horizontal or vertical list layout with the spike's gap. */
function List(props: { horizontal?: boolean }) {
	return (
		<uilistlayout
			FillDirection={props.horizontal === true ? Enum.FillDirection.Horizontal : Enum.FillDirection.Vertical}
			SortOrder={Enum.SortOrder.LayoutOrder}
			Padding={new UDim(0, UI_ART_SPIKE.gap)}
		/>
	);
}

/** One sliced test panel with its label: snapped or at the fixed UI_ART.refPerArt. */
function TestPanel(props: { order: number; w: number; h: number; snap: boolean }) {
	return (
		<frame LayoutOrder={props.order} Size={new UDim2(0, props.w, 0, props.h)} BackgroundTransparency={HIDDEN}>
			<SlicedImage
				id={UI_ART_SPIKE.panelId}
				snap={props.snap}
				sliceScale={UI_ART.refPerArt}
				size={UDim2.fromScale(1, 1)}
			/>
			<frame Position={new UDim2(0, HUD_VIEW.pad * 2, 0, HUD_VIEW.pad * 2)} BackgroundTransparency={HIDDEN}>
				<Text text={`${props.w}x${props.h} ${props.snap ? "snap" : "fixed"}`} size={HUD_VIEW.smallText} />
			</frame>
		</frame>
	);
}

/** (a): both sizes, snap on and off. */
function PanelRow(props: { order: number }) {
	const cells: React.Element[] = [];
	let order = 0;
	for (const [w, h] of UI_ART_SPIKE.sizes) {
		for (const snap of [true, false]) {
			order += 1;
			cells.push(<TestPanel key={`P${order}`} order={order} w={w} h={h} snap={snap} />);
		}
	}
	return (
		<frame LayoutOrder={props.order} AutomaticSize={Enum.AutomaticSize.XY} BackgroundTransparency={HIDDEN}>
			<List horizontal={true} />
			{cells}
		</frame>
	);
}

/**
 * Spike UA1 (docs/UI_ART.md UA1, docs/SPIKES.md "Spike UA1"), mounted by UiArtSpikeController in its own ScreenGui:
 * the scales line, (a) ui.panel.menu sliced at two sizes with SliceScale snapped and fixed, (b) the same inside a
 * CanvasGroup at GroupTransparency UI_ART_SPIKE.groupTransparency, (c) a row of icon-atlas ArtImages at their fitArt
 * size, and a ui.button with FocusCorners. Without the art it says so.
 */
export function UiArtSpike() {
	const uiScale = useHudScale();
	const pack = themePack();
	const hasPanel = pack?.image(UI_ART_SPIKE.panelId) !== undefined;
	const hasIcons = pack?.image(UI_ART.ids.focusCorner) !== undefined;
	const scales =
		`UIScale ${fmt(uiScale)} | menu: artPixelScale ${artPixelScale(uiScale, UI_ART.refPerArt)}, ` +
		`SliceScale ${fmt(snappedSliceScale(uiScale, UI_ART.refPerArt))} | hud: artPixelScale ` +
		`${artPixelScale(uiScale, UI_ART.hudRefPerArt)}, SliceScale ${fmt(
			snappedSliceScale(uiScale, UI_ART.hudRefPerArt),
		)}`;
	const missing = new Array<string>();
	if (!hasPanel) missing.push(`${UI_ART_SPIKE.panelId} (sliced)`);
	if (!hasIcons) missing.push("ui-icons.png (the icon atlas)");
	const icons = UI_ART_SPIKE.icons.map(([id, kind], i) => {
		const box = UI_ART.iconBox[kind];
		return <ArtImage key={`I${i}`} name={id} id={id} order={i + 1} box={new Vector2(box, box)} />;
	});
	const [bw, bh] = UI_ART_SPIKE.buttonSize;
	return (
		<frame
			key="Backdrop"
			Size={UDim2.fromScale(1, 1)}
			BackgroundColor3={role("background")}
			BackgroundTransparency={UI_ART_SPIKE.backdropTransparency}
			BorderSizePixel={0}
		>
			<scrollingframe
				key="Scroll"
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
				CanvasSize={new UDim2()}
				AutomaticCanvasSize={Enum.AutomaticSize.XY}
				Selectable={false}
			>
				<uipadding
					PaddingLeft={new UDim(0, UI_ART_SPIKE.margin)}
					PaddingTop={new UDim(0, UI_ART_SPIKE.margin)}
				/>
				<List />
				<Text order={1} text={`[UiArtSpike] ${scales}`} />
				{missing.size() > 0 ? (
					<Text
						order={2}
						color="uiHealth"
						text={`[UiArtSpike] UI art not uploaded: ${missing.join(
							", ",
						)} has no asset id (vale assetIds.ts)`}
					/>
				) : undefined}
				<Text order={3} size={HUD_VIEW.smallText} text="(a) sliced, snap on / off" />
				<PanelRow order={4} />
				<Text
					order={5}
					size={HUD_VIEW.smallText}
					text={`(b) in a CanvasGroup, GroupTransparency ${UI_ART_SPIKE.groupTransparency}`}
				/>
				<canvasgroup
					LayoutOrder={6}
					AutomaticSize={Enum.AutomaticSize.XY}
					BackgroundTransparency={HIDDEN}
					GroupTransparency={UI_ART_SPIKE.groupTransparency}
				>
					<PanelRow order={1} />
				</canvasgroup>
				<Text
					order={7}
					size={HUD_VIEW.smallText}
					text="(c) icon atlas at fitArt size; a button with its focus brackets"
				/>
				<frame LayoutOrder={8} AutomaticSize={Enum.AutomaticSize.XY} BackgroundTransparency={HIDDEN}>
					<List horizontal={true} />
					{icons}
				</frame>
				<frame LayoutOrder={9} Size={new UDim2(0, bw, 0, bh)} BackgroundTransparency={HIDDEN}>
					<SlicedImage id={UI_ART_SPIKE.buttonId} snap={true} zIndex={1} />
					<FocusCorners zIndex={2} />
				</frame>
			</scrollingframe>
		</frame>
	);
}
