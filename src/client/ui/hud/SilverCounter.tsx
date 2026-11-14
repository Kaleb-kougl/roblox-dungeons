import React, { useEffect, useRef } from "@rbxts/react";
import { fontFor, role, textSizeFor, useUiFonts } from "client/ui/theme";
import { SILVER_ICON_ID, SILVER_ROLE } from "shared/theme";
import { HUD_VIEW } from "shared/view/hud";
import { SILVER_COUNTER } from "shared/view/silver";
import { ArtImage, Text } from "./primitives";
import { SILVER_UI, setSilverCounterTarget } from "./silverBindings";

const HIDDEN = 1;
const HALF = 0.5;
const RIM = 1;
/** The fallback chip's inner highlight: its share of the chip, and how far it sits up-left. */
const SHINE = { share: 0.4, offset: 0.3 } as const;

/**
 * Silver's icon (docs/SILVER.md SV7): the pack's optional `ui.icon.silver` in a `px` box, else a round chip in the
 * `silver` role with a dark rim and a small highlight (never the score's gold coin).
 */
export function SilverIcon(props: { order?: number; px: number; iconRef?: React.Ref<Frame> }) {
	const px = props.px;
	const chip = (
		<frame
			key="SilverChip"
			ref={props.iconRef}
			LayoutOrder={props.order ?? 0}
			Size={UDim2.fromOffset(px, px)}
			BackgroundColor3={role(SILVER_ROLE)}
			BorderSizePixel={0}
			Active={false}
		>
			<uicorner CornerRadius={new UDim(HALF, 0)} />
			<uistroke Thickness={RIM} Color={role("background")} />
			<frame
				key="Shine"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(SHINE.offset, SHINE.offset)}
				Size={UDim2.fromScale(SHINE.share, SHINE.share)}
				BackgroundColor3={role("uiText")}
				BorderSizePixel={0}
				Active={false}
			>
				<uicorner CornerRadius={new UDim(HALF, 0)} />
			</frame>
		</frame>
	);
	return <ArtImage id={SILVER_ICON_ID} order={props.order} box={{ w: px, h: px }} fallback={chip} />;
}

/**
 * An inline balance: the icon and `text` in the silver role (the main menu, the Armory header, the character screen).
 */
export function SilverAmount(props: { order?: number; text: string; size?: number; dim?: boolean }) {
	const size = props.size ?? HUD_VIEW.textSize;
	return (
		<frame
			LayoutOrder={props.order ?? 0}
			Size={new UDim2()}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, SILVER_COUNTER.gap)}
			/>
			<SilverIcon order={1} px={math.floor(size * 0.75)} />
			<Text order={2} size={size} color={props.dim === true ? "uiTextDim" : SILVER_ROLE} text={props.text} />
		</frame>
	);
}

/**
 * The score panel's row 5 (docs/SILVER.md SV8, SV0): the Silver counter (icon, number) on the left and the floor /
 * Depth line on the right, TextScaled into what the counter leaves (shared/view/silver silverRowFit; never over
 * HUD_VIEW.smallText). The counter's `+N` floats left of the panel, outside the row. The numbers come from SILVER_UI
 * bindings (SilverHudController, per frame); `counterW` is the counter's width the controller last measured.
 */
export function SilverFloorRow(props: {
	order: number;
	width: number;
	floorText: string;
	counterW: React.Binding<number>;
}) {
	const fonts = useUiFonts();
	const iconRef = useRef<Frame>();
	useEffect(() => {
		setSilverCounterTarget(iconRef.current);
		return () => setSilverCounterTarget(undefined);
	}, []);
	const c = SILVER_COUNTER;
	const h = HUD_VIEW.smallText + 4;
	const numberSize = textSizeFor(fonts, c.numberText);
	return (
		<frame
			key="SilverRow"
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(props.width, h)}
			BackgroundTransparency={HIDDEN}
		>
			<frame
				key="Counter"
				Size={props.counterW.map((w) => UDim2.fromOffset(w, h))}
				BackgroundTransparency={HIDDEN}
			>
				<uilistlayout
					FillDirection={Enum.FillDirection.Horizontal}
					VerticalAlignment={Enum.VerticalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, c.gap)}
				/>
				<SilverIcon order={1} px={c.iconPx} iconRef={iconRef} />
				<textlabel
					key="Number"
					LayoutOrder={2}
					Size={new UDim2(0, 0, 1, 0)}
					AutomaticSize={Enum.AutomaticSize.X}
					BackgroundTransparency={HIDDEN}
					Font={fontFor(fonts)}
					TextSize={numberSize}
					TextColor3={role(SILVER_ROLE)}
					TextStrokeColor3={role("background")}
					TextStrokeTransparency={HUD_VIEW.panelTransparency}
					Text={SILVER_UI.text.binding}
				/>
				<textlabel
					key="Gain"
					AnchorPoint={new Vector2(1, HALF)}
					Position={new UDim2(0, -HUD_VIEW.pad - c.gap, HALF, 0)}
					Size={UDim2.fromOffset(0, h)}
					AutomaticSize={Enum.AutomaticSize.X}
					BackgroundTransparency={HIDDEN}
					Font={fontFor(fonts)}
					TextSize={numberSize}
					TextColor3={role(SILVER_ROLE)}
					TextStrokeColor3={role("background")}
					TextTransparency={SILVER_UI.chipTransparency.binding}
					TextStrokeTransparency={SILVER_UI.chipTransparency.binding}
					Text={SILVER_UI.chipText.binding}
				/>
			</frame>
			<textlabel
				key="Floor"
				AnchorPoint={new Vector2(1, 0)}
				Position={UDim2.fromScale(1, 0)}
				Size={props.counterW.map((w) => UDim2.fromOffset(math.max(0, props.width - w - c.gap), h))}
				BackgroundTransparency={HIDDEN}
				Font={fontFor(fonts)}
				TextScaled={true}
				TextColor3={role("uiText")}
				TextStrokeColor3={role("background")}
				TextStrokeTransparency={HUD_VIEW.panelTransparency}
				TextXAlignment={Enum.TextXAlignment.Right}
				Text={props.floorText}
			>
				<uitextsizeconstraint MaxTextSize={textSizeFor(fonts, HUD_VIEW.smallText)} />
			</textlabel>
		</frame>
	);
}
