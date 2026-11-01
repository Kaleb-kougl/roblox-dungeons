import React, { useEffect, useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, UserInputService, Workspace } from "@rbxts/services";
import { selectInputDevice } from "client/store";
import { role, themePack } from "client/ui/theme";
import { UI_ART, ornamentShown, skinHasOf } from "shared/view/hud";
import {
	MENU_FIT,
	fitMenu,
	menuArea,
	menuCompact,
	menuFitChanged,
	menuFitDevice,
	menuNarrow,
	MENU_VIEW,
	type MenuFitResult,
	type MenuSize,
} from "shared/view/menu";
import { ArtScaleContext, useArtScale, useHudScale } from "./useHudScale";

const HALF = 0.5;
const HIDDEN = 1;

/** What a fitted screen draws (MenuFit's `render`). */
export interface MenuLayout {
	/** Take the compact arrangement (shared/view/menu menuCompact: touch, a short safe area). */
	readonly compact: boolean;
	/** Take the narrow arrangement (shared/view/menu menuNarrow: touch, a portrait safe area). */
	readonly narrow: boolean;
	/** Draw the bone ornament (asked for, and fitMenu found room above the panel). Pass it to the Panel. */
	readonly ornament: boolean;
	/** The flexible list's height, reference px (the `flex` range's max when there is none or nothing to fit). */
	readonly flex: number;
	/** The compact Options body's content height, reference px (caps the flexible list at it: it never draws taller). */
	readonly setFlexContent: (h: number) => void;
}

export interface MenuFitProps {
	/** The screen asks for the bone ornament (shared/view/menu screenOrnament); drawn only on menu art. */
	ornament?: boolean;
	/**
	 * The screen's one flexible list (reference px): drawn at exactly MenuLayout.flex, between min and max; or a
	 * function of the compact flag (the list a screen draws can depend on it). None: nothing flexes.
	 */
	flex?: MenuFlexRange | ((compact: boolean) => MenuFlexRange | undefined);
	/** The screen's panel, at the area's top left (default Panel position); MenuFit places and scales it. */
	render: (layout: MenuLayout) => React.Element | undefined;
}

/** A flexible list's range, reference px. */
export interface MenuFlexRange {
	readonly min: number;
	readonly max: number;
}

/** The safe area before the first measurement: the viewport under the top bar (GuiService.TopbarInset). */
function guessArea(uiScale: number): MenuSize {
	const vp = Workspace.CurrentCamera?.ViewportSize ?? Vector2.zero;
	const [ok, inset] = pcall(() => GuiService.TopbarInset);
	const top = ok ? inset.Max.Y : 0;
	return menuArea(vp.X, vp.Y, { top, left: 0, right: 0, bottom: 0 }, uiScale);
}

/**
 * A full-screen menu panel fitted into its area (docs/UI_ART.md "Phones"; the rules are shared/view/menu fitMenu).
 * A transparent frame fills the parent (the ScreenGui's safe area, or a full-size overlay inside it) and measures it;
 * a box at its centre holds the panel under a UIScale (the fit factor) and measures the panel. On touch the screen
 * gets the compact flag, its flexible list's height and the ornament decision, and the box is scaled / moved to fit;
 * the art under it snaps at the scale it is drawn at (ArtScaleContext). "Touch" is menuFitDevice: the last-used device
 * is touch or the device has a touchscreen (a phone stays fitted after a key press). Without it the factor is 1,
 * nothing moves and the flexible list keeps its max: exactly the unfitted layout.
 */
export function MenuFit(props: MenuFitProps) {
	const hud = useHudScale();
	const touch = menuFitDevice(useSelector(selectInputDevice) === "touch", UserInputService.TouchEnabled);
	const areaRef = useRef<Frame>();
	const boxRef = useRef<Frame>();
	const [area, setArea] = useState<MenuSize>(() => guessArea(hud));
	const [content, setContent] = useState<number | undefined>(undefined);
	const pack = themePack();
	const ornamentArt = pack?.image(UI_ART.ids.ornament);
	const wantsOrnament = pack !== undefined && ornamentShown(skinHasOf(pack), "menu", props.ornament === true);
	const compact = menuCompact(area.h, touch);
	const narrow = menuNarrow(area.w, area.h, touch);
	// The compact body's content height belongs to the compact layout only.
	useEffect(() => setContent(undefined), [compact, narrow]);
	const flexRange = typeIs(props.flex, "function") ? props.flex(compact) : props.flex;
	const flexMax = flexRange !== undefined ? math.min(flexRange.max, content ?? math.huge) : 0;
	const initial: MenuFitResult = {
		factor: 1,
		ornament: wantsOrnament,
		offsetY: 0,
		flex: flexRange !== undefined ? flexMax : undefined,
		overflow: false,
	};
	const [fit, setFit] = useState<MenuFitResult>(initial);
	// What is drawn: the fit on touch; without touch exactly the unfitted layout (initial), whatever was measured.
	const shown = touch ? fit : initial;
	const fitRef = useRef<MenuFitResult>(shown);
	fitRef.current = shown;

	const measure = () => {
		const a = areaRef.current;
		const b = boxRef.current;
		if (a === undefined || b === undefined || !(hud > 0)) return;
		const areaW = a.AbsoluteSize.X / hud;
		const areaH = a.AbsoluteSize.Y / hud;
		if (math.abs(areaW - area.w) > MENU_FIT.epsilon || math.abs(areaH - area.h) > MENU_FIT.epsilon) {
			setArea({ w: areaW, h: areaH });
		}
		const applied = fitRef.current;
		const drawn = hud * applied.factor;
		const fitted = fitMenu({
			w: b.AbsoluteSize.X / drawn,
			h: b.AbsoluteSize.Y / drawn,
			areaW,
			areaH,
			uiScale: hud,
			touch,
			narrow,
			ornament: wantsOrnament,
			ornamentArtH: ornamentArt?.rect?.h ?? ornamentArt?.h ?? 0,
			flex:
				flexRange !== undefined
					? {
							current: math.min(applied.flex ?? flexMax, flexMax),
							min: math.min(flexRange.min, flexMax),
							max: flexMax,
					  }
					: undefined,
		});
		if (touch && menuFitChanged(fitted, applied)) {
			fitRef.current = fitted;
			setFit(fitted);
		}
	};

	useEffect(() => {
		const a = areaRef.current;
		const b = boxRef.current;
		if (a === undefined || b === undefined) return;
		const ca = a.GetPropertyChangedSignal("AbsoluteSize").Connect(measure);
		const cb = b.GetPropertyChangedSignal("AbsoluteSize").Connect(measure);
		measure();
		return () => {
			ca.Disconnect();
			cb.Disconnect();
		};
	});

	const layout: MenuLayout = {
		compact,
		narrow,
		ornament: wantsOrnament && shown.ornament,
		flex: math.min(shown.flex ?? flexMax, flexMax),
		setFlexContent: (h) => {
			if (content === undefined || math.abs(content - h) > MENU_FIT.epsilon) setContent(h);
		},
	};
	return (
		<frame key="MenuFit" ref={areaRef} Size={UDim2.fromScale(1, 1)} BackgroundTransparency={HIDDEN}>
			<frame
				key="Box"
				ref={boxRef}
				Position={new UDim2(HALF, 0, HALF, shown.offsetY)}
				AnchorPoint={new Vector2(HALF, HALF)}
				Size={new UDim2()}
				AutomaticSize={Enum.AutomaticSize.XY}
				BackgroundTransparency={HIDDEN}
			>
				<uiscale Scale={shown.factor} />
				<ArtScaleContext.Provider value={hud * shown.factor}>{props.render(layout)}</ArtScaleContext.Provider>
			</frame>
		</frame>
	);
}

/**
 * A screen's body as a vertical scroll list exactly `height` reference px tall (a compact screen's flexible list:
 * MenuLayout.flex), reporting its content's height (reference px, at the scale it is drawn under) through `onContent`
 * (MenuLayout.setFlexContent), so the flexible list never grows past its content.
 */
export function FitScroll(props: {
	order: number;
	height: number;
	onContent: (h: number) => void;
	children?: React.ReactNode;
}) {
	const scale = useArtScale();
	const listRef = useRef<UIListLayout>();
	useEffect(() => {
		const list = listRef.current;
		if (list === undefined || !(scale > 0)) return;
		const report = () => props.onContent(list.AbsoluteContentSize.Y / scale);
		const changed = list.GetPropertyChangedSignal("AbsoluteContentSize").Connect(report);
		report();
		return () => changed.Disconnect();
	});
	return (
		<scrollingframe
			key="FitScroll"
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, props.height)}
			CanvasSize={new UDim2()}
			AutomaticCanvasSize={Enum.AutomaticSize.Y}
			ScrollingDirection={Enum.ScrollingDirection.Y}
			ScrollBarThickness={MENU_VIEW.scrollBarThickness}
			ScrollBarImageColor3={role("uiTextDim")}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
			Selectable={false}
		>
			<uilistlayout ref={listRef} SortOrder={Enum.SortOrder.LayoutOrder} />
			{props.children}
		</scrollingframe>
	);
}
