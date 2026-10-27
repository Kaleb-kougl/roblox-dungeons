import React, { useState } from "@rbxts/react";
import { HUD_FONT, MONO_FONT, role } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import { HUD_VIEW, cornerAnchor, type HudCorner } from "shared/view/hud";

/**
 * The HUD's building blocks: text in the HUD font token, panels in theme roles, pips, and the one interactive
 * primitive (MenuButton: mouse, touch and gamepad selection read the same). Every colour is a theme role.
 */

const FULL = 1;
const HIDDEN = 1;
const STROKE = 1;
const FOCUS_STROKE = 2;
const HALF = 0.5;
/** A diamond pip: a square turned 45 degrees, shrunk so its corners stay inside the cell. */
const DIAMOND_ROTATION = 45;
const DIAMOND_FILL = 0.72;
/** A disabled MenuButton's text transparency. */
const DISABLED_TEXT = 0.6;
/** Text box height = text size + this (room for the stroke). */
const LINE_SLACK = 4;

export interface TextProps {
	text: string;
	order?: number;
	color?: ColorRole;
	size?: number;
	align?: Enum.TextXAlignment;
	mono?: boolean;
	/**
	 * Width (reference px). Without it the text sizes to its content (AutomaticSize X), unless `fill` (or `wrap`) asks
	 * for the parent's width. Never fill inside an automatically sized panel: a scale width there resolves against the
	 * panel's parent and stretches the panel across the screen (docs/HUD_LAYOUT.md H1).
	 */
	width?: number;
	/** Take the parent's width (fixed-width panels). Implied by `wrap` when no width is given. */
	fill?: boolean;
	wrap?: boolean;
	/** Text transparency (a binding for a fading hint); the stroke fades with it. Default 0. */
	transparency?: number | React.Binding<number>;
}

/** The dark stroke never shows through more than the text it outlines. */
function strokeTransparency(t: number): number {
	return math.max(HUD_VIEW.panelTransparency, t);
}

/** One line (or a wrapped paragraph) of HUD text with a dark stroke for contrast over the dungeon. */
export function Text(props: TextProps) {
	const size = props.size ?? HUD_VIEW.textSize;
	const wrap = props.wrap === true;
	const fill = props.width === undefined && (props.fill === true || wrap);
	const hug = props.width === undefined && !fill;
	return (
		<textlabel
			LayoutOrder={props.order ?? 0}
			Size={
				props.width !== undefined
					? new UDim2(0, props.width, 0, size + LINE_SLACK)
					: new UDim2(fill ? 1 : 0, 0, 0, size + LINE_SLACK)
			}
			AutomaticSize={wrap ? Enum.AutomaticSize.Y : hug ? Enum.AutomaticSize.X : Enum.AutomaticSize.None}
			BackgroundTransparency={HIDDEN}
			Font={props.mono === true ? MONO_FONT : HUD_FONT}
			TextSize={size}
			TextWrapped={wrap}
			TextColor3={role(props.color ?? "uiText")}
			TextStrokeColor3={role("background")}
			TextTransparency={props.transparency ?? 0}
			TextStrokeTransparency={
				props.transparency === undefined
					? HUD_VIEW.panelTransparency
					: typeIs(props.transparency, "number")
					? strokeTransparency(props.transparency)
					: props.transparency.map(strokeTransparency)
			}
			TextXAlignment={props.align ?? Enum.TextXAlignment.Left}
			Text={props.text}
		/>
	);
}

export interface PanelProps {
	/** Explicit placement; ignored when `corner` is given. Default: the parent's top left. */
	position?: UDim2;
	anchor?: Vector2;
	/** An always-on corner panel (docs/HUD_LAYOUT.md H3): placed in that corner, HUD_VIEW.margin from both edges. */
	corner?: HudCorner;
	width?: number;
	order?: number;
	padding?: number;
	horizontal?: boolean;
	align?: Enum.HorizontalAlignment;
	transparency?: number;
	name?: string;
	children?: React.ReactNode;
}

/** A corner's position and anchor, HUD_VIEW.margin in from both edges. */
function cornerPlacement(corner: HudCorner): [UDim2, Vector2] {
	const a = cornerAnchor(corner);
	const m = HUD_VIEW.margin;
	return [new UDim2(a.ax, a.ax === 1 ? -m : m, a.ay, a.ay === 1 ? -m : m), new Vector2(a.ax, a.ay)];
}

/** A uiPanel-coloured box that grows with its children (vertical list by default). */
export function Panel(props: PanelProps) {
	const pad = props.padding ?? HUD_VIEW.pad;
	const [position, anchor] =
		props.corner !== undefined
			? cornerPlacement(props.corner)
			: [props.position ?? new UDim2(), props.anchor ?? new Vector2()];
	return (
		<frame
			key={props.name}
			LayoutOrder={props.order ?? 0}
			Position={position}
			AnchorPoint={anchor}
			Size={new UDim2(0, props.width ?? 0, 0, 0)}
			AutomaticSize={props.width !== undefined ? Enum.AutomaticSize.Y : Enum.AutomaticSize.XY}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={props.transparency ?? HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
		>
			<uipadding
				PaddingLeft={new UDim(0, pad)}
				PaddingRight={new UDim(0, pad)}
				PaddingTop={new UDim(0, pad)}
				PaddingBottom={new UDim(0, pad)}
			/>
			<uilistlayout
				FillDirection={props.horizontal === true ? Enum.FillDirection.Horizontal : Enum.FillDirection.Vertical}
				HorizontalAlignment={props.align ?? Enum.HorizontalAlignment.Left}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{props.children}
		</frame>
	);
}

/** A transparent horizontal row (label + icons). */
export function Row(props: { order?: number; children?: React.ReactNode; align?: Enum.HorizontalAlignment }) {
	return (
		<frame
			LayoutOrder={props.order ?? 0}
			Size={new UDim2(0, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				HorizontalAlignment={props.align ?? Enum.HorizontalAlignment.Left}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{props.children}
		</frame>
	);
}

/** A square or diamond pip, filled with `color` or empty (uiPanel with a dim outline). */
export function Pip(props: { order: number; filled: boolean; color: ColorRole; diamond?: boolean; size?: number }) {
	const size = props.size ?? HUD_VIEW.pipSize;
	return (
		<frame LayoutOrder={props.order} Size={new UDim2(0, size, 0, size)} BackgroundTransparency={HIDDEN}>
			<frame
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromScale(
					props.diamond === true ? DIAMOND_FILL : FULL,
					props.diamond === true ? DIAMOND_FILL : FULL,
				)}
				Rotation={props.diamond === true ? DIAMOND_ROTATION : 0}
				BackgroundColor3={role(props.filled ? props.color : "uiPanel")}
				BorderSizePixel={0}
			>
				<uistroke Thickness={STROKE} Color={role(props.filled ? "background" : "uiTextDim")} />
			</frame>
		</frame>
	);
}

export interface MenuButtonProps {
	text: string;
	order: number;
	onActivated: () => void;
	/** False: the gamepad selection skips it (a prompt is open over it). Default true. */
	selectable?: boolean;
	/** Highlighted as the current choice (settings options). */
	active?: boolean;
	size?: Vector2;
	textSize?: number;
	name?: string;
	/** Greyed out and inert (still selectable, so the pad's selection can pass over it). */
	disabled?: boolean;
}

/**
 * The one interactive primitive: a button whose look follows hover, touch and gamepad selection alike (Activated
 * covers mouse, touch and a gamepad confirm). Active choices are uiAccent on uiPanel text; focus adds a uiAccent ring.
 */
export const MenuButton = React.forwardRef<TextButton, MenuButtonProps>((props, ref) => {
	const [focused, setFocused] = useState(false);
	const size = props.size ?? new Vector2(HUD_VIEW.buttonSize.x, HUD_VIEW.buttonSize.y);
	const active = props.active === true;
	const disabled = props.disabled === true;
	return (
		<textbutton
			key={props.name}
			ref={ref}
			LayoutOrder={props.order}
			Size={new UDim2(0, size.X, 0, size.Y)}
			AutoButtonColor={false}
			Selectable={props.selectable !== false}
			BackgroundColor3={role(active ? "uiAccent" : "uiPanel")}
			BackgroundTransparency={active || focused ? 0 : HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
			Font={HUD_FONT}
			TextSize={props.textSize ?? HUD_VIEW.textSize}
			TextColor3={role(active ? "uiPanel" : focused ? "uiText" : "uiTextDim")}
			Text={props.text}
			TextTransparency={disabled ? DISABLED_TEXT : 0}
			Event={{
				Activated: () => {
					if (!disabled) props.onActivated();
				},
				MouseEnter: () => setFocused(true),
				MouseLeave: () => setFocused(false),
				SelectionGained: () => setFocused(true),
				SelectionLost: () => setFocused(false),
			}}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={focused ? FOCUS_STROKE : STROKE}
				Color={role(focused || active ? "uiAccent" : "uiTextDim")}
			/>
		</textbutton>
	);
});
