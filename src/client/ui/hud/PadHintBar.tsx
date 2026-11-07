import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { UserInputService } from "@rbxts/services";
import { selectBindings, selectInputDevice } from "client/store";
import { fontFor, role, str, textSizeFor, useUiFonts } from "client/ui/theme";
import { inputLabel } from "shared/play";
import { HUD_VIEW } from "shared/view/hud";
import { PAD_HINT_VIEW, padGlyph, padHints, type PadContext, type PadGlyph, type PadSurface } from "shared/view/menu";

const HIDDEN = 1;

/** Enum.KeyCode by name (the hint table names keys by their Enum names). */
const KEY_CODES = new Map<string, Enum.KeyCode>();
for (const k of Enum.KeyCode.GetEnumItems()) KEY_CODES.set(k.Name, k);

/**
 * A pad key's glyph (docs/GAMEPAD_MENUS.md 4.2, GMD8): the engine's platform image (GetImageForKeyCode: Xbox or
 * PlayStation art, engine content, not a theme asset), else its text for the key (GetStringForKeyCode), else our label
 * (shared/play inputLabel). Every engine call behind pcall.
 */
function glyphOf(keyName: string): PadGlyph {
	const label = inputLabel(keyName, str);
	const key = KEY_CODES.get(keyName);
	if (key === undefined) return { kind: "text", text: label };
	const [okImage, image] = pcall(() => UserInputService.GetImageForKeyCode(key));
	const [okText, text] = pcall(() => UserInputService.GetStringForKeyCode(key));
	return padGlyph(
		keyName,
		okImage && typeIs(image, "string") ? image : undefined,
		okText && typeIs(text, "string") ? text : undefined,
		label,
	);
}

/** One glyph: the engine's image in a square, or the key's name on a small plate the same height. */
function Glyph(props: { order: number; keyName: string }) {
	const fonts = useUiFonts();
	const glyph = glyphOf(props.keyName);
	const size = PAD_HINT_VIEW.glyphSize;
	if (glyph.kind === "image") {
		return (
			<imagelabel
				key={props.keyName}
				LayoutOrder={props.order}
				Size={new UDim2(0, size, 0, size)}
				BackgroundTransparency={HIDDEN}
				Image={glyph.image}
				ScaleType={Enum.ScaleType.Fit}
			/>
		);
	}
	return (
		<textlabel
			key={props.keyName}
			LayoutOrder={props.order}
			Size={new UDim2(0, size, 0, size)}
			AutomaticSize={Enum.AutomaticSize.X}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={PAD_HINT_VIEW.plateTransparency}
			BorderSizePixel={0}
			Font={fontFor(fonts, "text")}
			TextSize={textSizeFor(fonts, HUD_VIEW.smallText)}
			TextColor3={role("uiText")}
			Text={glyph.text}
		>
			<uipadding
				PaddingLeft={new UDim(0, PAD_HINT_VIEW.labelGap)}
				PaddingRight={new UDim(0, PAD_HINT_VIEW.labelGap)}
			/>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={PAD_HINT_VIEW.plateStroke}
				Color={role("uiTextDim")}
			/>
		</textlabel>
	);
}

/**
 * The gamepad hint bar (docs/GAMEPAD_MENUS.md 4.1, GM7): a row of `[glyph] label` items at the bottom of a scope's
 * panel, from shared/view/menu padHints(surface, context) (the same table FocusController acts on, so it never names a
 * button that does nothing; a shortcut on the player's pad restart key is left out), shown only while the last-used
 * device is the gamepad (elsewhere nothing: the screens keep their keyboard back hints). Items wrap onto a second line in a narrow panel (UIListLayout Wraps). Labels are theme
 * strings (`pad.hint.*`) in the locale's font; it sits inside the panel, so the HUD scale and MenuFit apply to it.
 */
export function PadHintBar(props: { order: number; surface: PadSurface; context?: PadContext }) {
	const device = useSelector(selectInputDevice);
	const restartPad = useSelector(selectBindings).pad.restart;
	const fonts = useUiFonts();
	if (device !== "gamepad") return undefined;
	// A shortcut on the player's pad restart key yields to the restart (padShortcutYields): not hinted.
	const hints = padHints(props.surface, { ...(props.context ?? {}), restartPad });
	if (hints.size() === 0) return undefined;
	return (
		<frame
			key="PadHints"
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, PAD_HINT_VIEW.itemGap)}
				Wraps={true}
			/>
			{hints.map((h, i) => (
				<frame
					key={`Hint${i}`}
					LayoutOrder={i + 1}
					Size={new UDim2()}
					AutomaticSize={Enum.AutomaticSize.XY}
					BackgroundTransparency={HIDDEN}
				>
					<uilistlayout
						FillDirection={Enum.FillDirection.Horizontal}
						VerticalAlignment={Enum.VerticalAlignment.Center}
						SortOrder={Enum.SortOrder.LayoutOrder}
						Padding={new UDim(0, PAD_HINT_VIEW.glyphGap)}
					/>
					{h.keyNames.map((k, j) => (
						<Glyph key={k} order={j + 1} keyName={k} />
					))}
					<textlabel
						key="Label"
						LayoutOrder={h.keyNames.size() + 1}
						Size={new UDim2(0, 0, 0, PAD_HINT_VIEW.glyphSize)}
						AutomaticSize={Enum.AutomaticSize.X}
						BackgroundTransparency={HIDDEN}
						Font={fontFor(fonts, "text")}
						TextSize={textSizeFor(fonts, HUD_VIEW.smallText)}
						TextColor3={role("uiTextDim")}
						TextStrokeColor3={role("background")}
						TextStrokeTransparency={HUD_VIEW.panelTransparency}
						Text={str(h.stringKey)}
					>
						<uipadding PaddingLeft={new UDim(0, PAD_HINT_VIEW.labelGap)} />
					</textlabel>
				</frame>
			))}
		</frame>
	);
}
