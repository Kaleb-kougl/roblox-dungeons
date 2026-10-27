import React from "@rbxts/react";
import { HUD_FONT, role, str } from "client/ui/theme";
import { BOONS, CURSES, RELICS } from "shared/sim";
import type { ColorRole } from "shared/theme";
import {
	CURSE_COLOR_ROLE,
	PROGRESSION_VIEW,
	RELIC_COLOR_ROLE,
	itemIconKey,
	rarityColorRole,
	statusRowMaxWidth,
} from "shared/view/hud";
import { GridRow } from "./GridRow";

const STROKE = 1;

/** One owned item: a square in its colour role with the item's short theme label (`<id>.icon`). */
function ItemIcon(props: { order: number; id: string; color: ColorRole }) {
	const size = PROGRESSION_VIEW.iconSize;
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, size, 0, size)}
			BackgroundColor3={role(props.color)}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role("background")} />
			<textlabel
				Size={UDim2.fromScale(1, 1)}
				BackgroundTransparency={1}
				Font={HUD_FONT}
				TextSize={PROGRESSION_VIEW.iconTextSize}
				TextColor3={role("uiPanel")}
				Text={str(itemIconKey(props.id))}
			/>
		</frame>
	);
}

/**
 * The owned boons (rarity colour), relics and curses of an endless run as a row of icons, in the order taken (the
 * StatusPanel's last row), wrapping at the status panel's footprint width (GridRow). Nothing when there are none.
 */
export function RunItems(props: {
	order: number;
	boons: ReadonlyArray<number>;
	relics: ReadonlyArray<number>;
	curses: ReadonlyArray<number>;
}) {
	const icons = new Array<React.Element>();
	let n = 0;
	for (const b of props.boons) {
		const def = BOONS[b];
		if (def === undefined) continue;
		icons.push(<ItemIcon key={`b${b}`} order={++n} id={def.id} color={rarityColorRole(def.rarity)} />);
	}
	for (const x of props.relics) {
		const def = RELICS[x];
		if (def !== undefined) icons.push(<ItemIcon key={`r${x}`} order={++n} id={def.id} color={RELIC_COLOR_ROLE} />);
	}
	for (const c of props.curses) {
		const def = CURSES[c];
		if (def !== undefined) icons.push(<ItemIcon key={`c${c}`} order={++n} id={def.id} color={CURSE_COLOR_ROLE} />);
	}
	if (icons.size() === 0) return undefined;
	const size = PROGRESSION_VIEW.iconSize;
	return (
		<GridRow order={props.order} count={icons.size()} cellW={size} cellH={size} maxWidth={statusRowMaxWidth()}>
			{icons}
		</GridRow>
	);
}
