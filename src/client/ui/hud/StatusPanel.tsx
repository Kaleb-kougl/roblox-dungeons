import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { role, str } from "client/ui/theme";
import { HUD_STRINGS, HUD_VIEW, heartFills } from "shared/view/hud";
import { Panel, Pip, Row, Text } from "./primitives";
import { RunItems } from "./RunItems";

const HIDDEN = 1;
const STROKE = 1;
/** Half hearts per heart. */
const HALVES = 2;
/** Labels sit in a fixed column so the rows line up. */
const LABEL_WIDTH = 86;

/** One heart: `fill` 0 (empty), 1 (half) or 2 (full) half hearts; the left half fills first (web PlayerHud Heart). */
function Heart(props: { order: number; fill: number }) {
	const size = HUD_VIEW.heartSize;
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, size, 0, size)}
			BackgroundColor3={role("uiPanel")}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role("background")} />
			<frame
				Size={UDim2.fromScale(props.fill / HALVES, 1)}
				BackgroundColor3={role("uiHealth")}
				BackgroundTransparency={props.fill > 0 ? 0 : HIDDEN}
				BorderSizePixel={0}
			/>
		</frame>
	);
}

function pips(count: number, max: number, color: "uiMana" | "uiAccent" | "ember", diamond: boolean) {
	const out = new Array<React.Element>();
	for (let i = 0; i < max; i++) {
		out.push(<Pip key={`p${i}`} order={i + 1} filled={i < count} color={color} diamond={diamond} />);
	}
	return out;
}

/**
 * Top left (web PlayerHud): hearts (full / half / empty) with armor pips, flask charges and Ember pips, each row
 * labelled from the theme string table; in endless runs a line with the floor and Depth and the owned boons, relics
 * and curses (M2, RunItems). Reads only the ~10 Hz snapshot.
 */
export function StatusPanel() {
	const s = useSelector(selectSnapshot);
	const hearts = heartFills(s.hearts, s.heartsMax).map((fill, i) => (
		<Heart key={`h${i}`} order={i + 1} fill={fill} />
	));
	const armorMax = math.max(s.armorMax, s.armor);
	return (
		<Panel position={new UDim2(0, HUD_VIEW.margin, 0, HUD_VIEW.margin)} anchor={new Vector2(0, 0)} name="Status">
			<Row order={1}>
				<Text order={0} width={LABEL_WIDTH} color="uiTextDim" text={str(HUD_STRINGS.health)} />
				{hearts}
				{armorMax > 0 ? (
					<Row order={hearts.size() + 1}>{pips(s.armor, armorMax, "uiMana", true)}</Row>
				) : undefined}
			</Row>
			<Row order={2}>
				<Text order={0} width={LABEL_WIDTH} color="uiTextDim" text={str(HUD_STRINGS.flask)} />
				{pips(s.flask, s.flaskMax, "uiAccent", false)}
			</Row>
			<Row order={3}>
				<Text order={0} width={LABEL_WIDTH} color="uiTextDim" text={str(HUD_STRINGS.ember)} />
				{pips(s.embers, s.emberMax, "ember", true)}
			</Row>
			{s.floor > 0 ? (
				<Text order={4} color="uiText" text={str(HUD_STRINGS.floor, { floor: s.floor, depth: s.depth })} />
			) : undefined}
			<RunItems order={5} boons={s.boons} relics={s.relics} curses={s.curses} />
		</Panel>
	);
}
