import React, { useMemo, useState } from "@rbxts/react";
import { alignFor, fontFor, role, textSizeFor, themePack, useUiFonts, type FontRole } from "client/ui/theme";
import type { ColorRole, ImageRef } from "shared/theme";
import {
	DRAFT_REVEAL_VIEW,
	HUD_VIEW,
	UI_ART,
	artDensityBox,
	contentInsetsOf,
	cornerAnchor,
	dividerShown,
	iconShown,
	draftSliceCenter,
	fitTurnedArt,
	focusCornerBox,
	menuButtonSkin,
	ornamentShown,
	panelHasArt,
	panelHidden,
	panelSkinContext,
	skinFor,
	skinHasOf,
	skinPadding,
	skinRefPerArt,
	skinnedButtonTextRole,
	snappedSliceScale,
	uniformPadding,
	type HudCorner,
	type PanelSkin,
	type SkinButtonVariant,
	type SkinPadding,
	type SkinPanelContext,
} from "shared/view/hud";
import { cornerFadeBinding, cornerRef } from "./cornerFade";
import { useArtScale } from "./useHudScale";

/**
 * The HUD's building blocks: text in the locale's fonts, panels in theme roles, pips, and the one interactive
 * primitive (MenuButton: mouse, touch and gamepad selection read the same). Every colour is a theme role.
 *
 * Locale (docs/LOCALIZATION.md L4, design 7): the text primitives read the locale's fonts (client/ui/theme
 * useUiFonts), scale text sizes by its sizeScale (1 for Latin: unchanged) and align left-aligned text right in a
 * right-to-left locale (alignFor); nothing else is mirrored (LD6).
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
/** An untinted image. */
const WHITE = new Color3(1, 1, 1);
/** Text box height = text size + this (room for the stroke). */
const LINE_SLACK = 4;
/** Draw order inside a skinned MenuButton (ZIndexBehavior Sibling): the frame art, the label over it, the brackets on top. */
const SKIN_Z = { art: 1, label: 2, corners: 3 } as const;

export interface TextProps {
	/** A binding for a value written every frame (the rolling score): changes one property, never re-renders. */
	text: string | React.Binding<string>;
	order?: number;
	color?: ColorRole;
	size?: number;
	align?: Enum.TextXAlignment;
	mono?: boolean;
	/** Which locale font (default "text"; `mono` is "mono"): "name" for player display names and endonyms (LD13). */
	font?: FontRole;
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
	const fonts = useUiFonts();
	const size = textSizeFor(fonts, props.size ?? HUD_VIEW.textSize);
	const fade = props.transparency;
	// One mapped binding per source binding, not one per render (the snapshot re-renders panels ~10 Hz).
	const stroke = useMemo(
		() =>
			fade === undefined
				? HUD_VIEW.panelTransparency
				: typeIs(fade, "number")
				? strokeTransparency(fade)
				: fade.map(strokeTransparency),
		[fade],
	);
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
			Font={fontFor(fonts, props.font ?? (props.mono === true ? "mono" : "text"))}
			TextSize={size}
			TextWrapped={wrap}
			TextColor3={role(props.color ?? "uiText")}
			TextStrokeColor3={role("background")}
			TextTransparency={props.transparency ?? 0}
			TextStrokeTransparency={stroke}
			TextXAlignment={alignFor(fonts, props.align ?? Enum.TextXAlignment.Left)}
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
	/** The uiPanel fill's transparency (a binding for a fading panel: the draft reveal, docs/DRAFT_REVEAL.md DR5). */
	transparency?: number | React.Binding<number>;
	name?: string;
	/**
	 * Visible (default true): a panel that hides without unmounting (its children keep their instances); a binding
	 * shows / hides it per frame without a re-render.
	 */
	visible?: boolean | React.Binding<boolean>;
	children?: React.ReactNode;
	/**
	 * Corner panels only: drawn on the outer frame, outside the CanvasGroup (a UIStroke such as the tutorial's
	 * HighlightRing, which the group would clip at its edge).
	 */
	overlay?: React.ReactNode;
	/**
	 * The frame art (docs/UI_ART.md UA7): "menu" (red-rimmed), "hud" (dark, in a run), "list" (tall), or "none" (always
	 * the flat uiPanel fill). Default: "hud" for a corner panel, "menu" for every other. Drawn only when the pack has the
	 * art (skinFor); otherwise the panel is exactly the flat one.
	 */
	skin?: PanelSkin;
	/**
	 * The bone ornament (ui.ornament.bones, docs/UI_ART.md UAD8) centred on the top edge, outside the layout (it never
	 * moves content). Drawn only on a skinned menu panel with the art (ornamentShown); the main menu and pause panels ask.
	 */
	ornament?: boolean;
	/**
	 * Children drawn only in the flat look (an accent UIStroke round a flat panel: the frame art replaces it).
	 */
	flatOnly?: React.ReactNode;
}

/** A corner's position and anchor, HUD_VIEW.margin in from both edges. */
function cornerPlacement(corner: HudCorner): [UDim2, Vector2] {
	const a = cornerAnchor(corner);
	const m = HUD_VIEW.margin;
	return [new UDim2(a.ax, a.ax === 1 ? -m : m, a.ay, a.ay === 1 ? -m : m), new Vector2(a.ax, a.ay)];
}

/** A Panel's padding and list layout (the same for the flat and the skinned panel; only the padding values differ). */
function panelLayout(props: PanelProps, pad: SkinPadding) {
	return (
		<>
			<uipadding
				PaddingLeft={new UDim(0, pad.left)}
				PaddingRight={new UDim(0, pad.right)}
				PaddingTop={new UDim(0, pad.top)}
				PaddingBottom={new UDim(0, pad.bottom)}
			/>
			<uilistlayout
				FillDirection={props.horizontal === true ? Enum.FillDirection.Horizontal : Enum.FillDirection.Vertical}
				HorizontalAlignment={props.align ?? Enum.HorizontalAlignment.Left}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
		</>
	);
}

/** A Panel's placement and size: [position, anchor, size, automatic size]. */
function panelBox(props: PanelProps): [UDim2, Vector2, UDim2, Enum.AutomaticSize] {
	const corner = props.corner;
	const [position, anchor] =
		corner !== undefined ? cornerPlacement(corner) : [props.position ?? new UDim2(), props.anchor ?? new Vector2()];
	const size = new UDim2(0, props.width ?? 0, 0, 0);
	const autoSize = props.width !== undefined ? Enum.AutomaticSize.Y : Enum.AutomaticSize.XY;
	return [position, anchor, size, autoSize];
}

/** The panel art id the pack draws for these props (skinFor "panel"), or undefined: the flat panel. */
function panelSkinId(props: PanelProps): [string, SkinPanelContext] | undefined {
	const context = panelSkinContext(props.skin, props.corner !== undefined, panelHidden(props.transparency));
	const pack = themePack();
	if (context === undefined || pack === undefined) return undefined;
	const id = skinFor(skinHasOf(pack), "panel", context);
	return id !== undefined ? [id, context] : undefined;
}

/**
 * A uiPanel-coloured box that grows with its children (vertical list by default). With frame art in the pack
 * (docs/UI_ART.md UA7) the box is that art, 9-sliced (SkinnedPanel); without, exactly the flat box.
 */
export function Panel(props: PanelProps) {
	const skin = panelSkinId(props);
	if (skin !== undefined) return <SkinnedPanel panel={props} skinId={skin[0]} context={skin[1]} />;
	const pad = props.padding ?? HUD_VIEW.pad;
	const corner = props.corner;
	const [position, anchor, size, autoSize] = panelBox(props);
	const layout = panelLayout(props, uniformPadding(pad));
	if (corner !== undefined) {
		// docs/HUD_LAYOUT.md H7: a transparent root (placed, registered for HudOcclusionController) holding the panel
		// as a CanvasGroup whose GroupTransparency is the corner's fade binding. Every size is offset (a scale child of
		// an automatically sized frame resolves against the ScreenGui: the H1 bug).
		return (
			<frame
				key={props.name}
				ref={cornerRef(corner)}
				Visible={props.visible ?? true}
				LayoutOrder={props.order ?? 0}
				Position={position}
				AnchorPoint={anchor}
				Size={new UDim2()}
				AutomaticSize={Enum.AutomaticSize.XY}
				BackgroundTransparency={HIDDEN}
			>
				<canvasgroup
					key="Group"
					Size={size}
					AutomaticSize={autoSize}
					BackgroundColor3={role("uiPanel")}
					BackgroundTransparency={props.transparency ?? HUD_VIEW.panelTransparency}
					BorderSizePixel={0}
					GroupTransparency={cornerFadeBinding(corner)}
				>
					{layout}
					{props.children}
					{props.flatOnly}
				</canvasgroup>
				{props.overlay}
			</frame>
		);
	}
	return (
		<frame
			key={props.name}
			Visible={props.visible ?? true}
			LayoutOrder={props.order ?? 0}
			Position={position}
			AnchorPoint={anchor}
			Size={size}
			AutomaticSize={autoSize}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={props.transparency ?? HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
		>
			{layout}
			{props.children}
			{props.flatOnly}
			{props.overlay}
		</frame>
	);
}

/**
 * Whether a Panel with this `skin` (and corner placement) is drawn on its frame art in the active pack: a screen draws
 * extras that belong to the art only (the spectate bar's ghost) when it is.
 */
export function panelArt(skin: PanelSkin | undefined, corner = false): boolean {
	const pack = themePack();
	return pack !== undefined && panelHasArt(skinHasOf(pack), panelSkinContext(skin, corner));
}

/**
 * `icon` when a Panel with this `skin` is drawn on art and the pack has the icon (iconShown), else undefined: a screen's
 * icon beside a label (the run-over header, the audio rows) that the flat look leaves out.
 */
export function panelIcon(skin: PanelSkin | undefined, icon: string | undefined): string | undefined {
	const pack = themePack();
	if (pack === undefined) return undefined;
	const has = skinHasOf(pack);
	return iconShown(has, panelHasArt(has, panelSkinContext(skin, false)), icon);
}

/**
 * A Panel drawn on its frame art (docs/UI_ART.md UA7): the box is a SlicedImage at the context's snapped density
 * (hud: UI_ART.hudRefPerArt, else refPerArt; whole screen px per art px), its ImageTransparency the panel's
 * transparency (in-run panels keep HUD_VIEW.panelTransparency, UAD6), its padding grown so no content sits on the
 * visible border (skinPadding over contentInsetsOf: the measured border, not the slice insets). The image is the
 * container (a sibling image would be placed by the list layout). A corner panel's image sits inside its CanvasGroup,
 * so the occlusion fade still applies. With the ornament, a transparent wrapper takes the placement and holds the image
 * and the ornament as siblings (no layout there, so the ornament never moves content).
 */
function SkinnedPanel(props: { panel: PanelProps; skinId: string; context: SkinPanelContext }) {
	const p = props.panel;
	const uiScale = useArtScale();
	const sliceScale = snappedSliceScale(uiScale, skinRefPerArt(props.context));
	const pack = themePack();
	const slice = pack?.image(props.skinId)?.slice;
	const pad = skinPadding(
		uniformPadding(p.padding ?? HUD_VIEW.pad),
		contentInsetsOf(props.skinId, slice),
		sliceScale,
	);
	const ornament = pack !== undefined && ornamentShown(skinHasOf(pack), props.context, p.ornament === true);
	const corner = p.corner;
	const [position, anchor, size, autoSize] = panelBox(p);
	const transparency = p.transparency ?? HUD_VIEW.panelTransparency;
	if (corner !== undefined) {
		return (
			<frame
				key={p.name}
				ref={cornerRef(corner)}
				Visible={p.visible ?? true}
				LayoutOrder={p.order ?? 0}
				Position={position}
				AnchorPoint={anchor}
				Size={new UDim2()}
				AutomaticSize={Enum.AutomaticSize.XY}
				BackgroundTransparency={HIDDEN}
			>
				<canvasgroup
					key="Group"
					Size={size}
					AutomaticSize={autoSize}
					BackgroundTransparency={HIDDEN}
					BorderSizePixel={0}
					GroupTransparency={cornerFadeBinding(corner)}
				>
					<SlicedImage
						id={props.skinId}
						name="Skin"
						sliceScale={sliceScale}
						size={size}
						automaticSize={autoSize}
						transparency={transparency}
					>
						{panelLayout(p, pad)}
						{p.children}
					</SlicedImage>
				</canvasgroup>
				{p.overlay}
			</frame>
		);
	}
	if (ornament) {
		return (
			<frame
				key={p.name}
				Visible={p.visible ?? true}
				LayoutOrder={p.order ?? 0}
				Position={position}
				AnchorPoint={anchor}
				Size={size}
				AutomaticSize={autoSize}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
			>
				<SlicedImage
					id={props.skinId}
					name="Skin"
					sliceScale={sliceScale}
					size={size}
					automaticSize={autoSize}
					transparency={transparency}
				>
					{panelLayout(p, pad)}
					{p.children}
					{p.overlay}
				</SlicedImage>
				<PanelOrnament key="Ornament" />
			</frame>
		);
	}
	return (
		<SlicedImage
			id={props.skinId}
			name={p.name}
			sliceScale={sliceScale}
			order={p.order ?? 0}
			position={position}
			anchor={anchor}
			size={size}
			automaticSize={autoSize}
			transparency={transparency}
			visible={p.visible ?? true}
		>
			{panelLayout(p, pad)}
			{p.children}
			{p.overlay}
		</SlicedImage>
	);
}

/**
 * The bone ornament on a menu panel's top edge (UI_ART.ornament): the art at the menu frames' whole screen-px density
 * (artDensityBox), centred horizontally, its anchorY fraction on the edge, drawn over the frame.
 */
function PanelOrnament() {
	const ref = themePack()?.image(UI_ART.ids.ornament);
	const uiScale = useArtScale();
	if (ref === undefined) return undefined;
	const r = ref.rect;
	const box = artDensityBox(r?.w ?? ref.w, r?.h ?? ref.h, uiScale, UI_ART.refPerArt);
	return (
		<ArtImage
			name="Ornament"
			id={UI_ART.ids.ornament}
			box={box}
			position={UDim2.fromScale(HALF, 0)}
			anchor={new Vector2(HALF, UI_ART.ornament.anchorY)}
			zIndex={SKIN_Z.corners}
		/>
	);
}

/**
 * A divider between a panel's sections (docs/UI_ART.md UA7): the ui.divider stripe stretched to the row's width (its
 * columns are identical, so stretching is exact), its 3 art px tall at the menu frames' whole screen-px density.
 * Nothing unless a panel with that `skin` is drawn on art and the pack has the stripe (dividerShown): the flat look has
 * no divider.
 */
export function Divider(props: { order: number; skin: PanelSkin }) {
	const pack = themePack();
	const ref = pack?.image(UI_ART.ids.divider);
	if (
		pack === undefined ||
		ref === undefined ||
		!dividerShown(skinHasOf(pack), panelSkinContext(props.skin, false))
	) {
		return undefined;
	}
	return <DrawnDivider order={props.order} image={ref} />;
}

function DrawnDivider(props: { order: number; image: ImageRef }) {
	const uiScale = useArtScale();
	const r = props.image.rect;
	const h = artDensityBox(r?.w ?? props.image.w, r?.h ?? props.image.h, uiScale, UI_ART.refPerArt).h;
	return (
		<imagelabel
			key="Divider"
			LayoutOrder={props.order}
			Image={props.image.assetId}
			ImageRectOffset={r !== undefined ? new Vector2(r.x, r.y) : Vector2.zero}
			ImageRectSize={r !== undefined ? new Vector2(r.w, r.h) : Vector2.zero}
			ScaleType={Enum.ScaleType.Stretch}
			ResampleMode={Enum.ResamplerMode.Pixelated}
			Size={new UDim2(FULL, 0, 0, h)}
			Active={false}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
		/>
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

/** A Pip's art (docs/UI_ART.md UA10): a theme ui image fitted into `box`, maybe dimmed (an empty pip) or tinted. */
export interface PipArtProps {
	/** A theme ui image id (an icon-atlas cut); the pack lacking it draws the flat pip. */
	readonly id: string;
	/** The slot the art fits into, reference px (shared/view/hud pipArtSlot). */
	readonly box: { readonly w: number; readonly h: number };
	/** ImageTransparency (an unlit candle, an empty chip). Default 0. */
	readonly transparency?: number;
	/** Tint the (white) art with the pip's `color` role (the Aegis chip). Default false. */
	readonly tinted?: boolean;
}

/**
 * A square or diamond pip, filled with `color` or empty (uiPanel with a dim outline). With `art` the pip is that ui
 * image (ArtImage, in `art.box`) when the pack has it; without the art, exactly the flat pip.
 */
export function Pip(props: {
	order: number;
	filled: boolean;
	color: ColorRole;
	diamond?: boolean;
	size?: number;
	art?: PipArtProps;
}) {
	const size = props.size ?? HUD_VIEW.pipSize;
	const flat = (
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
	const art = props.art;
	if (art === undefined) return flat;
	return (
		<ArtImage
			id={art.id}
			box={art.box}
			order={props.order}
			transparency={art.transparency ?? 0}
			color={art.tinted === true ? props.color : undefined}
			fallback={flat}
		/>
	);
}

export interface SlicedImageProps {
	/** A theme ui image id (shared/theme ImageRef: its asset, size and optional 9-slice insets). */
	id: string;
	/** Drawn when the pack has no image for `id` (the placeholder pack, art not uploaded yet); default nothing. */
	fallback?: React.ReactElement;
	/** Art pixel -> reference px of a sliced image (SliceScale; default the card art's DRAFT_REVEAL_VIEW.artScale). */
	sliceScale?: number;
	/**
	 * Snap the SliceScale to whole screen px per art px (docs/UI_ART.md UAD1): `snappedSliceScale(useArtScale(),
	 * refPerArt)` instead of `sliceScale`. Default off (the draft reveal's cards keep the fixed scale).
	 */
	snap?: boolean;
	/** With `snap`: reference px per art px before snapping (default UI_ART.refPerArt, the menus' density). */
	refPerArt?: number;
	order?: number;
	/** AutomaticSize (a container image that grows with its children: a skinned Panel). Default None. */
	automaticSize?: Enum.AutomaticSize;
	/** Children (a skinned Panel's layout and content; drawn over the image). */
	children?: React.ReactNode;
	size?: UDim2;
	position?: UDim2;
	anchor?: Vector2;
	zIndex?: number;
	transparency?: number | React.Binding<number>;
	/** ImageColor3 (a white mask tinted, e.g. the draft back's eyes). */
	color?: Color3;
	visible?: boolean | React.Binding<boolean>;
	name?: string;
}

/**
 * A theme ui image as an ImageLabel (docs/DRAFT_REVEAL.md DR5; the primitive docs/UI_ART.md builds on): with `slice`
 * insets it is 9-sliced (ScaleType Slice, SliceCenter = Rect(left, top, w - right, h - bottom), SliceScale), so the
 * art's corners and studs keep their pixel size at any panel size; without, stretched. Always Pixelated. An id the
 * pack does not have renders `fallback` (or nothing), so callers keep their flat look until the art is uploaded.
 */
export function SlicedImage(props: SlicedImageProps) {
	const ref = themePack()?.image(props.id);
	if (ref === undefined) return props.fallback;
	if (props.snap === true) return <SnappedSlicedImage image={ref} props={props} />;
	return slicedLabel(props, ref, props.sliceScale ?? DRAFT_REVEAL_VIEW.artScale);
}

/** A snapped SlicedImage: its own component, so the UIScale hook runs only for snapped images (always, in it). */
function SnappedSlicedImage(p: { image: ImageRef; props: SlicedImageProps }) {
	const uiScale = useArtScale();
	return slicedLabel(p.props, p.image, snappedSliceScale(uiScale, p.props.refPerArt ?? UI_ART.refPerArt));
}

function slicedLabel(props: SlicedImageProps, ref: ImageRef, sliceScale: number) {
	const s = ref.slice;
	const c = s !== undefined ? draftSliceCenter(ref.w, ref.h, s) : undefined;
	return (
		<imagelabel
			key={props.name}
			Image={ref.assetId}
			ScaleType={c !== undefined ? Enum.ScaleType.Slice : Enum.ScaleType.Stretch}
			SliceCenter={c !== undefined ? new Rect(c.x0, c.y0, c.x1, c.y1) : new Rect()}
			SliceScale={sliceScale}
			ResampleMode={Enum.ResamplerMode.Pixelated}
			ImageColor3={props.color ?? WHITE}
			ImageTransparency={props.transparency ?? 0}
			Size={props.size ?? UDim2.fromScale(FULL, FULL)}
			Position={props.position ?? new UDim2()}
			AnchorPoint={props.anchor ?? new Vector2()}
			ZIndex={props.zIndex ?? 1}
			Visible={props.visible ?? true}
			LayoutOrder={props.order ?? 0}
			AutomaticSize={props.automaticSize ?? Enum.AutomaticSize.None}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
		>
			{props.children}
		</imagelabel>
	);
}

export interface ArtImageProps {
	/** A theme ui image id: an icon-atlas cut (`rect`) or a whole image. */
	id: string;
	/**
	 * The box the art fits into, reference px (the layout's size: the frame is always this big, the art centred in it
	 * at the largest whole screen-px scale that fits, fitArt; never below 1 screen px per art px).
	 */
	box: Vector2 | { readonly w: number; readonly h: number };
	order?: number;
	/** ImageColor3 from a role (a white piece tinted); default untinted. */
	color?: ColorRole;
	transparency?: number | React.Binding<number>;
	/** Clockwise degrees; a quarter turn fits the turned art into the box. */
	rotation?: number;
	/** Drawn when the pack has no image for `id`; default nothing. */
	fallback?: React.ReactElement;
	position?: UDim2;
	anchor?: Vector2;
	zIndex?: number;
	visible?: boolean | React.Binding<boolean>;
	name?: string;
	/**
	 * The UIScale the image is drawn under (fitArt's screen px per reference px); default the one art is drawn under
	 * here (useArtScale: the HUD's, or a fitted menu's). 1 for a GUI outside the HUD's UIScale (the pause button in the
	 * top bar, in screen px).
	 */
	uiScale?: number;
}

/**
 * One ui image drawn whole-pixel (docs/UI_ART.md UA6): an icon-atlas cut (ImageRectOffset / ImageRectSize from its
 * `rect`) or a whole image, Pixelated, sized by fitArt and centred in a `box`-sized frame, so layouts keep their sizes.
 * An id the pack does not have renders `fallback` (or nothing).
 */
export function ArtImage(props: ArtImageProps) {
	const ref = themePack()?.image(props.id);
	if (ref === undefined) return props.fallback;
	return <DrawnArtImage image={ref} props={props} />;
}

function DrawnArtImage(p: { image: ImageRef; props: ArtImageProps }) {
	const props = p.props;
	const ref = p.image;
	const hudScale = useArtScale();
	const uiScale = props.uiScale ?? hudScale;
	const box = props.box;
	const [boxW, boxH] = typeIs(box, "Vector2") ? [box.X, box.Y] : [box.w, box.h];
	const r = ref.rect;
	const rotation = props.rotation ?? 0;
	const fit = fitTurnedArt(r?.w ?? ref.w, r?.h ?? ref.h, boxW, boxH, uiScale, rotation);
	const z = props.zIndex ?? 1;
	return (
		<frame
			key={props.name}
			LayoutOrder={props.order ?? 0}
			Size={new UDim2(0, boxW, 0, boxH)}
			Position={props.position ?? new UDim2()}
			AnchorPoint={props.anchor ?? new Vector2()}
			ZIndex={z}
			Visible={props.visible ?? true}
			Active={false}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
		>
			<imagelabel
				key="Art"
				Image={ref.assetId}
				ImageRectOffset={r !== undefined ? new Vector2(r.x, r.y) : Vector2.zero}
				ImageRectSize={r !== undefined ? new Vector2(r.w, r.h) : Vector2.zero}
				ResampleMode={Enum.ResamplerMode.Pixelated}
				ImageColor3={props.color !== undefined ? role(props.color) : WHITE}
				ImageTransparency={props.transparency ?? 0}
				Rotation={rotation}
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={new UDim2(0, fit.w, 0, fit.h)}
				ZIndex={z}
				Active={false}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
			/>
		</frame>
	);
}

/**
 * The focus ring of a skinned button (docs/UI_ART.md UA6): four `ui.focus.corner` brackets (a top-left L turned 0 / 90 /
 * 180 / 270 degrees), each bracket's corner on a corner of the parent, tinted uiAccent (UAD3), at the button art's
 * whole screen-px density, drawn on top (`zIndex`) and never taking input. Nothing when the pack lacks the bracket.
 */
export function FocusCorners(props: { zIndex?: number }) {
	const ref = themePack()?.image(UI_ART.ids.focusCorner);
	if (ref === undefined) return undefined;
	return <DrawnFocusCorners image={ref} zIndex={props.zIndex ?? SKIN_Z.corners} />;
}

function DrawnFocusCorners(props: { image: ImageRef; zIndex: number }) {
	const uiScale = useArtScale();
	const r = props.image.rect;
	const w = r?.w ?? props.image.w;
	const h = r?.h ?? props.image.h;
	const corners = UI_ART.focusCorners.map((c, i) => {
		const box = focusCornerBox(w, h, uiScale, c.rotation);
		return (
			<ArtImage
				key={`Corner${i}`}
				name={`Corner${i}`}
				id={UI_ART.ids.focusCorner}
				box={box}
				rotation={c.rotation}
				color="uiAccent"
				position={UDim2.fromScale(c.ax, c.ay)}
				anchor={new Vector2(c.ax, c.ay)}
				zIndex={props.zIndex}
			/>
		);
	});
	return <>{corners}</>;
}

/**
 * A skinned button's label with an icon: the glyph (UI_ART.iconBox.glyph box, tinted like the text: the white glyph
 * set) and the text side by side, centred as a pair in the button. Never takes input (the button does).
 */
function IconLabel(props: {
	icon: string;
	text: string;
	textSize: number;
	color: ColorRole;
	transparency: number;
	font: Enum.Font;
}) {
	return (
		<frame Size={UDim2.fromScale(FULL, FULL)} BackgroundTransparency={HIDDEN} Active={false} ZIndex={SKIN_Z.label}>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			<ArtImage
				name="Icon"
				id={props.icon}
				order={1}
				box={{ w: UI_ART.iconBox.glyph, h: UI_ART.iconBox.glyph }}
				color={props.color}
				transparency={props.transparency}
				zIndex={SKIN_Z.label}
			/>
			<textlabel
				key="Text"
				LayoutOrder={2}
				Size={UDim2.fromScale(0, FULL)}
				AutomaticSize={Enum.AutomaticSize.X}
				BackgroundTransparency={HIDDEN}
				Active={false}
				ZIndex={SKIN_Z.label}
				Font={props.font}
				TextSize={props.textSize}
				TextColor3={role(props.color)}
				Text={props.text}
				TextTransparency={props.transparency}
			/>
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
	/** "option": an Options value, drawn on the option bars when the pack has them (on = active). Default a button. */
	variant?: SkinButtonVariant;
	/**
	 * A ui icon id (UI_ART.ids, e.g. the gear beside Options) drawn left of the label, the pair centred (UAD9: beside the
	 * text, never instead of it). Only on a button drawn on its art with the icon in the pack (iconShown);
	 * otherwise no icon and the text exactly as today.
	 */
	icon?: string;
	/** Which locale font the label uses (default "text"; "name" for a display name or an endonym, LD13). */
	font?: FontRole;
}

/**
 * The one interactive primitive: a button whose look follows hover, touch and gamepad selection alike (Activated
 * covers mouse, touch and a gamepad confirm). Active choices are uiAccent on uiPanel text; focus adds a uiAccent ring.
 * With button art in the pack (docs/UI_ART.md UA7) the button draws it instead (SkinnedButtonBody); without, exactly
 * the flat button.
 */
export const MenuButton = React.forwardRef<TextButton, MenuButtonProps>((props, ref) => {
	const [focused, setFocused] = useState(false);
	const fonts = useUiFonts();
	const font = fontFor(fonts, props.font);
	const textSize = textSizeFor(fonts, props.textSize ?? HUD_VIEW.textSize);
	const size = props.size ?? new Vector2(HUD_VIEW.buttonSize.x, HUD_VIEW.buttonSize.y);
	const active = props.active === true;
	const disabled = props.disabled === true;
	const pack = themePack();
	const has = pack !== undefined ? skinHasOf(pack) : undefined;
	const skinId =
		has !== undefined ? menuButtonSkin(has, props.variant ?? "button", active, focused, disabled) : undefined;
	if (has !== undefined && skinId !== undefined) {
		const corners = has(UI_ART.ids.focusCorner);
		const icon = iconShown(has, true, props.icon);
		return (
			<textbutton
				key={props.name}
				ref={ref}
				LayoutOrder={props.order}
				Size={new UDim2(0, size.X, 0, size.Y)}
				AutoButtonColor={false}
				Selectable={props.selectable !== false}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
				Font={font}
				TextSize={textSize}
				Text={props.text}
				TextTransparency={HIDDEN}
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
				<SlicedImage key="Skin" name="Skin" id={skinId} snap={true} zIndex={SKIN_Z.art} />
				{icon !== undefined ? (
					<IconLabel
						key="Label"
						icon={icon}
						text={props.text}
						textSize={textSize}
						font={font}
						color={skinnedButtonTextRole(active, focused)}
						transparency={disabled ? DISABLED_TEXT : 0}
					/>
				) : (
					<textlabel
						key="Label"
						Size={UDim2.fromScale(FULL, FULL)}
						BackgroundTransparency={HIDDEN}
						Active={false}
						ZIndex={SKIN_Z.label}
						Font={font}
						TextSize={textSize}
						TextColor3={role(skinnedButtonTextRole(active, focused))}
						Text={props.text}
						TextTransparency={disabled ? DISABLED_TEXT : 0}
					/>
				)}
				{corners ? (
					focused ? (
						<FocusCorners key="Focus" zIndex={SKIN_Z.corners} />
					) : undefined
				) : (
					<uistroke
						key="Stroke"
						ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
						Thickness={focused ? FOCUS_STROKE : STROKE}
						Color={role(focused || active ? "uiAccent" : "uiTextDim")}
					/>
				)}
			</textbutton>
		);
	}
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
			Font={font}
			TextSize={textSize}
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
