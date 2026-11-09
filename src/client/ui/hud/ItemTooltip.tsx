import React, { useBinding, useEffect, useMemo, useRef } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService, TextService } from "@rbxts/services";
import { selectGameActive, selectJuice, selectRunInfo, selectSnapshot, selectTooltipShown } from "client/store";
import {
	alignFor,
	fontFor,
	hudText,
	role,
	str,
	textSizeFor,
	themePack,
	useUiFonts,
	type UiFonts,
} from "client/ui/theme";
import type { GameSnapshot } from "shared/play";
import type { ColorRole, StringVars } from "shared/theme";
import {
	DRAFT_CARD_VIEW,
	HUD_VIEW,
	ITEM_TOOLTIP,
	characterTooltip,
	itemTooltip,
	moreTooltip,
	tooltipPlacement,
	type HoverShown,
	type HudText,
	type TooltipLine,
	type TooltipModel,
	type TooltipTargetHit,
} from "shared/view/hud";
import { Panel } from "./primitives";
import { useHudScale } from "./useHudScale";

const HIDDEN = 1;
/** A text box's room for its stroke (primitives Text's line slack), reference px. */
const LINE_SLACK = 4;
/** TextService measuring box for a line's natural (unwrapped) width: wider than any tooltip line. */
const MEASURE_BOX = new Vector2(100000, 100000);
/** RichText var markers (control characters no theme string contains). */
const RICH_OPEN = string.char(1);
const RICH_CLOSE = string.char(2);
/** Frames the tooltip's measured size must hold before it shows (a fresh model lays out the frame after its commit). */
const STABLE_FRAMES = 1;

/** Whether the active pack has a string key (the per-character overrides' lookup). */
function hasString(key: string): boolean {
	return themePack()?.hasString(key) === true;
}

/**
 * The model of what the tracker shows: an item's tooltip, or the "+N" cell's list of hidden names, read as the local
 * player's `character` (docs/ARCHER.md AR10: characterTooltip; "" none).
 */
function modelOf(shown: HoverShown | undefined, s: GameSnapshot, character: string): TooltipModel | undefined {
	if (shown === undefined) return undefined;
	const t = shown.target;
	return characterTooltip(
		t.more !== undefined ? moreTooltip(t.more, s) : itemTooltip(t.ref, s),
		character,
		hasString,
	);
}

function escapeRich(text: string): string {
	return text
		.gsub("&", "&amp;")[0]
		.gsub("<", "&lt;")[0]
		.gsub(">", "&gt;")[0]
		.gsub('"', "&quot;")[0]
		.gsub("'", "&apos;")[0];
}

/** A HudText's vars as hudText resolves them (literal vars, then `varKeys` looked up as theme strings). */
function resolvedVars(t: HudText): Map<string, string | number> {
	const vars = new Map<string, string | number>();
	if (t.vars !== undefined)
		for (const [k, v] of pairs(t.vars as unknown as ReadonlyMap<string, string | number>)) vars.set(k, v);
	if (t.varKeys !== undefined)
		for (const [k, v] of pairs(t.varKeys as unknown as ReadonlyMap<string, string>)) vars.set(k, str(v));
	return vars;
}

/**
 * A line with coloured vars (TooltipLine.varRoles: a duo's recipe, the evolution's name) as RichText: the template and
 * every var escaped, each coloured var wrapped in a font tag of its role; the rest takes the label's colour (the line's
 * role). Markers stand in for the coloured vars while the theme formats the template, so a var's text never reaches
 * the markup unescaped.
 */
function richLineText(t: HudText, roles: Readonly<Record<string, ColorRole>>): string {
	const vars = resolvedVars(t);
	const colored = new Array<[string, ColorRole]>();
	for (const [k, r] of pairs(roles as unknown as ReadonlyMap<string, ColorRole>)) {
		const v = vars.get(k);
		if (v === undefined) continue;
		colored.push([tostring(v), r]);
		vars.set(k, `${RICH_OPEN}${colored.size()}${RICH_CLOSE}`);
	}
	let out = escapeRich(str(t.key, vars as unknown as StringVars));
	for (let i = 0; i < colored.size(); i++) {
		const [v, r] = colored[i];
		const tag = `<font color="#${role(r).ToHex()}">${escapeRich(v)}</font>`;
		out = out.gsub(`${RICH_OPEN}${i + 1}${RICH_CLOSE}`, () => tag)[0];
	}
	return out;
}

function naturalWidth(text: string, size: number, font: Enum.Font): number {
	return TextService.GetTextSize(text, size, font, MEASURE_BOX).X;
}

/** One wrapped body line (never truncated) in its role; coloured vars through RichText. */
function TipLine(props: { order: number; line: TooltipLine; size: number; fonts: UiFonts }) {
	const l = props.line;
	const roles = l.varRoles;
	const rich = roles !== undefined;
	return (
		<textlabel
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
			Active={false}
			Font={fontFor(props.fonts, "text")}
			TextSize={props.size}
			TextWrapped={true}
			RichText={rich}
			TextColor3={role(l.role)}
			TextStrokeColor3={role("background")}
			TextStrokeTransparency={HUD_VIEW.panelTransparency}
			TextXAlignment={alignFor(props.fonts, Enum.TextXAlignment.Left)}
			Text={roles !== undefined ? richLineText(l.text, roles) : hudText(l.text)}
		/>
	);
}

/** The title row's level pips: `level` of `max` filled, in the title's colour (the draft card's pips). */
function LevelPips(props: { level: number; max: number; color: ColorRole; lineH: number }) {
	const V = DRAFT_CARD_VIEW;
	const pips = new Array<React.Element>();
	for (let k = 0; k < props.max; k++) {
		pips.push(
			<frame
				key={`p${k}`}
				LayoutOrder={k + 1}
				Size={UDim2.fromOffset(V.pipSize, V.pipSize)}
				BackgroundColor3={role(props.color)}
				BackgroundTransparency={k < props.level ? 0 : V.emptyPipTransparency}
				BorderSizePixel={0}
			/>,
		);
	}
	const w = props.max * V.pipSize + math.max(0, props.max - 1) * V.pipGap;
	return (
		<frame
			key="Pips"
			AnchorPoint={new Vector2(1, 0)}
			Position={new UDim2(1, 0, 0, math.max(0, (props.lineH - V.pipSize) / 2))}
			Size={UDim2.fromOffset(w, V.pipSize)}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				HorizontalAlignment={Enum.HorizontalAlignment.Right}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, V.pipGap)}
			/>
			{pips}
		</frame>
	);
}

/**
 * The item tooltip (docs/ITEM_TOOLTIPS.md IT4): the title in its role with the level pips at its right, the kind line,
 * the body lines wrapped at ITEM_TOOLTIP.maxWidth (never truncated), on the run's `hud` frame art when the pack has it
 * (else the flat uiPanel). Its width is the widest line's natural width (TextService) up to maxWidth. It is measured
 * once laid out, then placed with shared/view/hud tooltipPlacement inside the safe area (this ScreenGui's own rect:
 * CoreUISafeInsets) every frame its size, the target or the safe area changes, and fades in over `fadeSec` (none under
 * Reduced motion; hidden while unmeasured); a hide unmounts it at once. Never Active, never a button: input passes
 * through it.
 */
function ItemTooltip(props: { scale: number }) {
	const shown = useSelector(selectTooltipShown);
	const s = useSelector(selectSnapshot);
	const reduced = useSelector(selectJuice).reducedMotion;
	const fonts = useUiFonts();
	const character = useSelector(selectRunInfo).character;
	const model = useMemo(() => modelOf(shown, s, character), [shown, s, character]);
	const [position, setPosition] = useBinding(new UDim2());
	const [fade, setFade] = useBinding(HIDDEN);
	const rootRef = useRef<CanvasGroup>();
	const targetRef = useRef<TooltipTargetHit | undefined>(undefined);
	targetRef.current = shown?.target;
	const key = model?.key;
	const shownAt = shown?.shownAtSec;
	const scale = props.scale;

	useEffect(() => {
		setFade(HIDDEN);
		if (key === undefined) return;
		let lastTarget: TooltipTargetHit | undefined;
		let lastW = -1;
		let lastH = -1;
		let lastGx = 0;
		let lastGy = 0;
		let lastGw = -1;
		let lastGh = -1;
		let stable = 0;
		let fadeStart = -1;
		const conn = RunService.RenderStepped.Connect(() => {
			const root = rootRef.current;
			const target = targetRef.current;
			const gui = root?.FindFirstAncestorOfClass("ScreenGui");
			if (root === undefined || gui === undefined || target === undefined) return;
			const size = root.AbsoluteSize;
			const gp = gui.AbsolutePosition;
			const gs = gui.AbsoluteSize;
			if (
				target !== lastTarget ||
				size.X !== lastW ||
				size.Y !== lastH ||
				gp.X !== lastGx ||
				gp.Y !== lastGy ||
				gs.X !== lastGw ||
				gs.Y !== lastGh
			) {
				lastTarget = target;
				lastW = size.X;
				lastH = size.Y;
				lastGx = gp.X;
				lastGy = gp.Y;
				lastGw = gs.X;
				lastGh = gs.Y;
				stable = 0;
				const p = tooltipPlacement({
					anchor: target.rect,
					size: { w: size.X, h: size.Y },
					safe: { x: gp.X, y: gp.Y, w: gs.X, h: gs.Y },
					source: target.source,
					panel: target.panel,
					offset: ITEM_TOOLTIP.offset * scale,
				});
				const k = scale > 0 ? scale : 1;
				setPosition(UDim2.fromOffset((p.x - gp.X) / k, (p.y - gp.Y) / k));
			} else if (fadeStart < 0) {
				stable += 1;
			}
			if (fadeStart < 0) {
				if (stable < STABLE_FRAMES) return;
				fadeStart = os.clock();
			}
			const fadeSec = ITEM_TOOLTIP.fadeSec;
			const t = reduced || fadeSec <= 0 ? 1 : math.clamp((os.clock() - fadeStart) / fadeSec, 0, 1);
			setFade(1 - t);
		});
		return () => conn.Disconnect();
	}, [key, shownAt, scale, reduced]);

	if (model === undefined) return undefined;
	const T = ITEM_TOOLTIP;
	const font = fontFor(fonts, "text");
	const titleSize = textSizeFor(fonts, HUD_VIEW.textSize);
	const bodySize = textSizeFor(fonts, HUD_VIEW.smallText);
	const V = DRAFT_CARD_VIEW;
	const pipsW = model.maxLevel > 0 ? model.maxLevel * V.pipSize + (model.maxLevel - 1) * V.pipGap + T.levelGap : 0;
	const titleText = hudText(model.title);
	let natural = naturalWidth(titleText, titleSize, font) + pipsW;
	natural = math.max(natural, naturalWidth(hudText(model.kindLine.text), bodySize, font));
	for (const l of model.lines) natural = math.max(natural, naturalWidth(hudText(l.text), bodySize, font));
	const contentW = math.min(T.maxWidth - 2 * T.pad, math.ceil(natural) + LINE_SLACK);
	const lines = model.lines.map((l, i) => (
		<TipLine key={`l${i}`} order={i + 3} line={l} size={bodySize} fonts={fonts} />
	));
	return (
		<canvasgroup
			key="ItemTooltip"
			ref={rootRef}
			Position={position}
			Size={new UDim2()}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundTransparency={HIDDEN}
			GroupTransparency={fade}
			Active={false}
		>
			<Panel
				name="Tip"
				width={contentW + 2 * T.pad}
				padding={T.pad}
				skin="hud"
				transparency={T.panelTransparency}
			>
				<frame
					key="Title"
					LayoutOrder={1}
					Size={new UDim2(1, 0, 0, 0)}
					AutomaticSize={Enum.AutomaticSize.Y}
					BackgroundTransparency={HIDDEN}
				>
					<textlabel
						key="Name"
						Size={new UDim2(1, -pipsW, 0, 0)}
						AutomaticSize={Enum.AutomaticSize.Y}
						BackgroundTransparency={HIDDEN}
						Active={false}
						Font={font}
						TextSize={titleSize}
						TextWrapped={true}
						TextColor3={role(model.titleRole)}
						TextStrokeColor3={role("background")}
						TextStrokeTransparency={HUD_VIEW.panelTransparency}
						TextXAlignment={alignFor(fonts, Enum.TextXAlignment.Left)}
						Text={titleText}
					/>
					{model.maxLevel > 0 ? (
						<LevelPips
							level={model.level}
							max={model.maxLevel}
							color={model.titleRole}
							lineH={titleSize + LINE_SLACK}
						/>
					) : undefined}
				</frame>
				<TipLine key="Kind" order={2} line={model.kindLine} size={bodySize} fonts={fonts} />
				{lines}
			</Panel>
		</canvasgroup>
	);
}

/**
 * The item tooltip's own ScreenGui (docs/ITEM_TOOLTIPS.md IT4, fact 2: a corner panel's CanvasGroup clips, so the
 * tooltip cannot live inside the panel it describes): ITEM_TOOLTIP.displayOrder (over the pause / menu layer, under the
 * loading and stage cover), the safe area (CoreUISafeInsets, the HUD's), the HUD scale, AutoLocalize off. Mounted by
 * GameHud next to the HUD's other ScreenGuis; only during a run.
 */
export function ItemTooltipLayer() {
	const active = useSelector(selectGameActive);
	const scale = useHudScale();
	return (
		<screengui
			key="KV_ItemTooltip"
			ResetOnSpawn={false}
			AutoLocalize={false}
			DisplayOrder={ITEM_TOOLTIP.displayOrder}
			ScreenInsets={Enum.ScreenInsets.CoreUISafeInsets}
			ZIndexBehavior={Enum.ZIndexBehavior.Sibling}
		>
			<uiscale Scale={scale} />
			{active ? <ItemTooltip key="Tooltip" scale={scale} /> : undefined}
		</screengui>
	);
}
