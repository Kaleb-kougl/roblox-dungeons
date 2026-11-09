import React from "@rbxts/react";
import { role, str, uiImage, useHudFont, useUiArt } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import {
	BUILD_HUD_VIEW,
	DRAFT_CARD_VIEW,
	PROGRESSION_VIEW,
	HUD_STRINGS,
	HUD_VIEW,
	ITEM_ART_FILL_ROLE,
	UI_ART,
	capItemCells,
	itemCellArt,
	itemCellWidth,
	itemPipLayout,
	runItemCells,
	statusRowMaxWidth,
	type ItemCellModel,
	type ItemRef,
} from "shared/view/hud";
import { ArtImage, panelIcon } from "./primitives";
import { MORE_CELL_REF, useTooltipTarget } from "./tooltipTargets";

const HIDDEN = 1;
/** Inside a cell: the curse skull under the label (or the item's icon art), the level pips over both. */
const CELL_Z = { art: 1, label: 2, pips: 3 } as const;
/** The status panel (RunItems' host) is a corner panel: the run's dark frame. */
const HOST_SKIN = "hud";
/** The status panel's corner: a live tooltip goes under it, and its occlusion fade blocks the tooltip. */
const HOST_CORNER = "topLeft";

/** An item cell's size and text (reference px): PROGRESSION_VIEW's in the status panel, the touch chips' smaller. */
export interface ItemLook {
	readonly size: number;
	readonly text: number;
}

const STATUS_LOOK: ItemLook = { size: PROGRESSION_VIEW.iconSize, text: PROGRESSION_VIEW.iconTextSize };

/**
 * A square cell of the items row: `color` fill, `text` centred. `art` (a curse's skull, docs/UI_ART.md UA8) draws
 * behind the label, faded (UI_ART.curseSkullTransparency) and clipped to the cell: the label stays the item's name.
 * Builds (docs/BUILDS.md BU10): `level` of `maxLevel` pips inside the cell's bottom (the label moves up over them; the
 * status panel's footprint has no room for a row under the icons) and `frame`, the evolved boon's gold outline.
 * `icon` (docs/BUILDS.md BU11: a boon's, relic's or curse's icon art the pack has) replaces the label: the cell is
 * ITEM_ART_FILL_ROLE under the art and `color` (the rarity / duo / relic / curse role) moves to its outline and pips; a
 * curse with its own icon draws no skull behind it.
 */
function ItemCell(props: {
	order: number;
	color: ColorRole;
	text: string;
	textColor: ColorRole;
	art?: string;
	/** The item's icon art drawn instead of the label (shared/view/hud itemCellArt: the pack has it). */
	icon?: string;
	look: ItemLook;
	/** Width in reference px (default: the look's square; a duo chip's half is one cell of it). */
	width?: number;
	frame?: ColorRole;
	level?: number;
	maxLevel?: number;
	/** No outline (a duo chip's halves: the chip draws one around both). */
	bare?: boolean;
	position?: UDim2;
	/** The tooltip target's ref callback (docs/ITEM_TOOLTIPS.md IT6), on the cell's root frame. */
	frameRef?: (frame: GuiObject | undefined) => void;
}) {
	const hudFont = useHudFont();
	const size = props.look.size;
	const max = props.maxLevel ?? 0;
	const pips = itemPipLayout(size);
	const icon = props.icon;
	const pipColor = icon !== undefined ? props.color : props.textColor;
	const pipRow = new Array<React.Element>();
	for (let k = 0; k < max; k++) {
		pipRow.push(
			<frame
				key={`p${k}`}
				LayoutOrder={k + 1}
				Size={UDim2.fromOffset(pips.pip, pips.pip)}
				BackgroundColor3={role(pipColor)}
				BackgroundTransparency={k < (props.level ?? 0) ? 0 : DRAFT_CARD_VIEW.emptyPipTransparency}
				BorderSizePixel={0}
			/>,
		);
	}
	return (
		<frame
			ref={props.frameRef}
			LayoutOrder={props.order}
			Position={props.position}
			Size={new UDim2(0, props.width ?? size, 0, size)}
			BackgroundColor3={role(icon !== undefined ? ITEM_ART_FILL_ROLE : props.color)}
			BorderSizePixel={0}
			ClipsDescendants={props.art !== undefined}
		>
			{props.bare === true ? undefined : (
				<uistroke
					Thickness={props.frame !== undefined ? BUILD_HUD_VIEW.evolvedStroke : BUILD_HUD_VIEW.cellStroke}
					Color={role(props.frame ?? (icon !== undefined ? props.color : "background"))}
				/>
			)}
			{props.art !== undefined ? (
				<ArtImage
					key="Art"
					name="Art"
					id={props.art}
					box={{ w: size, h: size }}
					transparency={UI_ART.curseSkullTransparency}
					zIndex={CELL_Z.art}
				/>
			) : undefined}
			{icon !== undefined ? (
				<ArtImage
					key="Icon"
					name="Icon"
					id={icon}
					box={{ w: props.width ?? size, h: max > 0 ? pips.labelHeight : size }}
					zIndex={CELL_Z.label}
				/>
			) : (
				<textlabel
					key="Label"
					ZIndex={CELL_Z.label}
					Size={max > 0 ? new UDim2(1, 0, 0, pips.labelHeight) : UDim2.fromScale(1, 1)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextSize={props.look.text}
					TextColor3={role(props.textColor)}
					Text={props.text}
				/>
			)}
			{max > 0 ? (
				<frame
					key="Pips"
					AnchorPoint={new Vector2(0, 1)}
					Position={new UDim2(0, 0, 1, -pips.bottom)}
					Size={new UDim2(1, 0, 0, pips.pip)}
					BackgroundTransparency={HIDDEN}
					ZIndex={CELL_Z.pips}
				>
					<uilistlayout
						FillDirection={Enum.FillDirection.Horizontal}
						HorizontalAlignment={Enum.HorizontalAlignment.Center}
						SortOrder={Enum.SortOrder.LayoutOrder}
						Padding={new UDim(0, pips.gap)}
					/>
					{pipRow}
				</frame>
			) : undefined}
		</frame>
	);
}

/** One cell of the row from its model (shared/view/hud runItemCells): a boon / relic / curse square or a duo chip. */
function ModelCell(props: {
	order: number;
	cell: ItemCellModel;
	look: ItemLook;
	gap: number;
	curseArt?: string;
	tooltips: boolean;
}) {
	useUiArt();
	const c = props.cell;
	const look = props.look;
	const tipRef = useTooltipTarget(c.ref, "hud", { panel: HOST_CORNER, enabled: props.tooltips });
	const art = itemCellArt(c, (id) => uiImage(id) !== undefined);
	if (c.span <= 1) {
		return (
			<ItemCell
				frameRef={tipRef}
				order={props.order}
				color={c.fills[0]}
				text={str(c.icons[0])}
				textColor="uiPanel"
				art={c.curse && art === undefined ? props.curseArt : undefined}
				icon={art?.[0]}
				look={look}
				frame={c.frame}
				level={c.level}
				maxLevel={c.maxLevel}
			/>
		);
	}
	// A duo chip (docs/BUILDS.md BU10): its two boons' icon cells joined into one double-wide chip in boon.duo.
	const halves = new Array<React.Element>();
	const step = (itemCellWidth(c.span, look.size, props.gap) - look.size) / math.max(1, c.span - 1);
	for (let k = 0; k < c.icons.size(); k++) {
		halves.push(
			<ItemCell
				key={`h${k}`}
				order={k + 1}
				color={c.fills[k] ?? c.fills[0]}
				text={str(c.icons[k])}
				textColor="uiPanel"
				icon={art?.[k]}
				look={look}
				bare={true}
				position={UDim2.fromOffset(k * step, 0)}
			/>,
		);
	}
	return (
		<frame
			ref={tipRef}
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(itemCellWidth(c.span, look.size, props.gap), look.size)}
			BackgroundColor3={role(art !== undefined ? ITEM_ART_FILL_ROLE : c.fills[0])}
			BorderSizePixel={0}
		>
			<uistroke
				Thickness={BUILD_HUD_VIEW.cellStroke}
				Color={role(art !== undefined ? c.fills[0] : "background")}
			/>
			{halves}
		</frame>
	);
}

/** The leading "+N" cell; a tooltip target listing the hidden items' names (moreTooltip, docs/ITEM_TOOLTIPS.md IT6). */
function MoreCell(props: { count: number; hidden: ReadonlyArray<ItemRef>; look: ItemLook; tooltips: boolean }) {
	const tipRef = useTooltipTarget(MORE_CELL_REF, "hud", {
		panel: HOST_CORNER,
		more: props.hidden,
		enabled: props.tooltips,
	});
	return (
		<ItemCell
			frameRef={tipRef}
			order={0}
			color="uiPanel"
			textColor="uiText"
			text={str(HUD_STRINGS.itemsMore, { count: props.count })}
			look={props.look}
		/>
	);
}

/**
 * The owned boons (rarity colour), relics and curses of an endless run (their icon art where the pack has it,
 * docs/BUILDS.md BU11) as a row of icons, in the order taken (the
 * StatusPanel's last row); with builds (docs/BUILDS.md BU10) each boon's level pips, the evolved boons' gold frame and
 * the duos after the boons, each its own icon where the pack has it, else a joined chip (shared/view/hud runItemCells). ONE row at most (capItemCells,
 * docs/HUD_LAYOUT.md): when more are owned than fit the status panel's footprint width, the last ones show and a first
 * "+N" cell counts the rest. Nothing when there are none.
 */
export function RunItems(props: {
	order: number;
	boons: ReadonlyArray<number>;
	relics: ReadonlyArray<number>;
	curses: ReadonlyArray<number>;
	/** Builds: each boon's level (parallel to `boons`; empty: no pips) and the duos taken. */
	levels?: ReadonlyArray<number>;
	duos?: ReadonlyArray<number>;
	/** Cell size and text, the row's widest and the gap (default: the status panel's; the touch chips pass their own). */
	look?: ItemLook;
	maxWidth?: number;
	gap?: number;
	/**
	 * The status panel's row (docs/ITEM_TOOLTIPS.md IT6): every cell and the "+N" cell register as live `hud` tooltip
	 * targets in the status panel. Off (default) on the touch strip (ITD9).
	 */
	tooltips?: boolean;
}) {
	const look = props.look ?? STATUS_LOOK;
	const tooltips = props.tooltips === true;
	const maxWidth = props.maxWidth ?? statusRowMaxWidth();
	const gap = props.gap ?? HUD_VIEW.gap;
	useUiArt();
	const cells = runItemCells(
		props.boons,
		props.levels ?? [],
		props.duos ?? [],
		props.relics,
		props.curses,
		(id) => uiImage(id) !== undefined,
	);
	if (cells.size() === 0) return undefined;
	const size = look.size;
	const cap = capItemCells(
		cells.map((c) => c.span),
		size,
		gap,
		maxWidth,
	);
	const curseArt = panelIcon(HOST_SKIN, UI_ART.ids.iconSkullCurse);
	const out = new Array<React.Element>();
	if (cap.more > 0) {
		const hidden = new Array<ItemRef>();
		for (let i = 0; i < cap.first; i++) hidden.push(cells[i].ref);
		out.push(<MoreCell key="more" count={cap.more} hidden={hidden} look={look} tooltips={tooltips} />);
	}
	// The newest cells that fit (the list is in the order shown); their LayoutOrder keeps them after the "+N" cell.
	for (let i = cap.first; i < cells.size(); i++) {
		const c = cells[i];
		out.push(
			<ModelCell
				key={c.key}
				order={i + 1}
				cell={c}
				look={look}
				gap={gap}
				curseArt={curseArt}
				tooltips={tooltips}
			/>,
		);
	}
	return (
		<frame LayoutOrder={props.order} Size={UDim2.fromOffset(cap.width, size)} BackgroundTransparency={HIDDEN}>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, gap)}
			/>
			{out}
		</frame>
	);
}
