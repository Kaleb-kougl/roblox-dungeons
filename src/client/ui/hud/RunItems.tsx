import React from "@rbxts/react";
import { HUD_FONT, role, str } from "client/ui/theme";
import { BOONS, CURSES, RELICS } from "shared/sim";
import type { ColorRole } from "shared/theme";
import {
	CURSE_COLOR_ROLE,
	PROGRESSION_VIEW,
	HUD_STRINGS,
	HUD_VIEW,
	RELIC_COLOR_ROLE,
	UI_ART,
	capOneRow,
	itemIconKey,
	rarityColorRole,
	statusRowMaxWidth,
} from "shared/view/hud";
import { GridRow } from "./GridRow";
import { ArtImage, panelIcon } from "./primitives";

const STROKE = 1;
/** Inside a cell: the curse skull under the label. */
const CELL_Z = { art: 1, label: 2 } as const;
/** The status panel (RunItems' host) is a corner panel: the run's dark frame. */
const HOST_SKIN = "hud";

/** One owned item: a square in its colour role with the item's short theme label (`<id>.icon`). */
function ItemIcon(props: { order: number; id: string; color: ColorRole; art?: string; look: ItemLook }) {
	return (
		<ItemCell
			order={props.order}
			color={props.color}
			text={str(itemIconKey(props.id))}
			textColor="uiPanel"
			art={props.art}
			look={props.look}
		/>
	);
}

/** An item cell's size and text (reference px): PROGRESSION_VIEW's in the status panel, the touch chips' smaller. */
export interface ItemLook {
	readonly size: number;
	readonly text: number;
}

const STATUS_LOOK: ItemLook = { size: PROGRESSION_VIEW.iconSize, text: PROGRESSION_VIEW.iconTextSize };

/**
 * A square cell of the items row: `color` fill, `text` centred. `art` (a curse's skull, docs/UI_ART.md UA8) draws
 * behind the label, faded (UI_ART.curseSkullTransparency) and clipped to the cell: the label stays the item's name.
 */
function ItemCell(props: {
	order: number;
	color: ColorRole;
	text: string;
	textColor: ColorRole;
	art?: string;
	look: ItemLook;
}) {
	const size = props.look.size;
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, size, 0, size)}
			BackgroundColor3={role(props.color)}
			BorderSizePixel={0}
			ClipsDescendants={props.art !== undefined}
		>
			<uistroke Thickness={STROKE} Color={role("background")} />
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
			<textlabel
				ZIndex={CELL_Z.label}
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={1}
				Font={HUD_FONT}
				TextSize={props.look.text}
				TextColor3={role(props.textColor)}
				Text={props.text}
			/>
		</frame>
	);
}

/**
 * The owned boons (rarity colour), relics and curses of an endless run as a row of icons, in the order taken (the
 * StatusPanel's last row). ONE row at most (capOneRow, docs/HUD_LAYOUT.md): when more are owned than fit the status
 * panel's footprint width, the last ones show and a first "+N" cell counts the rest. Nothing when there are none.
 */
export function RunItems(props: {
	order: number;
	boons: ReadonlyArray<number>;
	relics: ReadonlyArray<number>;
	curses: ReadonlyArray<number>;
	/** Cell size and text, the row's widest and the gap (default: the status panel's; the touch chips pass their own). */
	look?: ItemLook;
	maxWidth?: number;
	gap?: number;
}) {
	const look = props.look ?? STATUS_LOOK;
	const maxWidth = props.maxWidth ?? statusRowMaxWidth();
	const gap = props.gap ?? HUD_VIEW.gap;
	const icons = new Array<React.Element>();
	let n = 0;
	for (const b of props.boons) {
		const def = BOONS[b];
		if (def === undefined) continue;
		icons.push(<ItemIcon key={`b${b}`} order={++n} id={def.id} color={rarityColorRole(def.rarity)} look={look} />);
	}
	for (const x of props.relics) {
		const def = RELICS[x];
		if (def !== undefined)
			icons.push(<ItemIcon key={`r${x}`} order={++n} id={def.id} color={RELIC_COLOR_ROLE} look={look} />);
	}
	const curseArt = panelIcon(HOST_SKIN, UI_ART.ids.iconSkullCurse);
	for (const c of props.curses) {
		const def = CURSES[c];
		if (def !== undefined) {
			icons.push(
				<ItemIcon key={`c${c}`} order={++n} id={def.id} color={CURSE_COLOR_ROLE} art={curseArt} look={look} />,
			);
		}
	}
	if (icons.size() === 0) return undefined;
	const size = look.size;
	const cap = capOneRow(icons.size(), size, gap, maxWidth);
	const cells = new Array<React.Element>();
	if (cap.more > 0) {
		cells.push(
			<ItemCell
				key="more"
				order={0}
				color="uiPanel"
				textColor="uiText"
				text={str(HUD_STRINGS.itemsMore, { count: cap.more })}
				look={look}
			/>,
		);
	}
	// The newest `shown` items (the list is in the order taken); their LayoutOrder keeps them after the "+N" cell.
	const first = icons.size() - cap.shown;
	for (let i = first; i < icons.size(); i++) cells.push(icons[i]);
	return (
		<GridRow order={props.order} count={cells.size()} cellW={size} cellH={size} maxWidth={maxWidth} gap={gap}>
			{cells}
		</GridRow>
	);
}
