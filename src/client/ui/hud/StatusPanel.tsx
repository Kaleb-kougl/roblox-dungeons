import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { role, str } from "client/ui/theme";
import { BOOST_VIEW } from "shared/view/boosts";
import { HUD_STRINGS, HUD_VIEW, heartFills } from "shared/view/hud";
import { BoostRow } from "./BoostRow";
import { Panel, Pip, Row, Text } from "./primitives";
import { RunItems } from "./RunItems";
import { GhostHeart, HighlightRing } from "./TutorialFx";

const HIDDEN = 1;
const STROKE = 1;
/** Half hearts per heart. */
const HALVES = 2;

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

/** The Aegis pips (docs/BOOSTS.md B7): filled diamonds in their own colour after the `after` armor pips. */
function aegisPips(count: number, after: number) {
	const out = new Array<React.Element>();
	for (let i = 0; i < count; i++) {
		out.push(
			<Pip key={`a${i}`} order={after + i + 1} filled={true} color={BOOST_VIEW.aegisPipRole} diamond={true} />,
		);
	}
	return out;
}

export interface StatusPanelProps {
	/** The tutorial rings the hearts row or the flask row (TutorialView.highlight). */
	readonly highlight?: "hearts" | "flask";
	/** The tutorial's ghost half heart: a new token flashes it once more (0 = never). */
	readonly ghostHeart?: number;
	/** The tutorial rings the boost row (highlight id `boosts`, shared/view/boosts isBoostsHighlight). */
	readonly boostsHighlight?: boolean;
}

/**
 * Top left (web PlayerHud): hearts (full / half / empty) with armor pips, flask charges and Ember pips, each row
 * labelled from the theme string table (labels in a column of HUD_VIEW.statusLabelWidth so the rows line up); with
 * boost drops (docs/BOOSTS.md B7) the Aegis pip after the armor pips (its own colour, BOOST_VIEW.aegisPipRole) and the
 * running boosts (BoostRow); on an unscored endless run a line with the floor and Depth (a scored run shows it under
 * the score, docs/HUD_LAYOUT.md H4); the owned boons, relics and curses (M2, RunItems). Reads only the ~10 Hz
 * snapshot. In the tutorial: the highlight ring on the hearts or the flask row or the boost row, and the ghost half
 * heart after a harmless hit.
 */
export function StatusPanel(props: StatusPanelProps) {
	const s = useSelector(selectSnapshot);
	const hearts = heartFills(s.hearts, s.heartsMax).map((fill, i) => (
		<Heart key={`h${i}`} order={i + 1} fill={fill} />
	));
	const armorMax = math.max(s.armorMax, s.armor);
	const ghost = props.ghostHeart ?? 0;
	return (
		<Panel corner="topLeft" name="Status">
			<Row order={1}>
				<Text order={0} width={HUD_VIEW.statusLabelWidth} color="uiTextDim" text={str(HUD_STRINGS.health)} />
				{hearts}
				{ghost > 0 ? <GhostHeart key={`ghost${ghost}`} order={hearts.size() + 1} /> : undefined}
				{armorMax > 0 || s.aegisPips > 0 ? (
					<Row order={hearts.size() + 2}>
						{pips(s.armor, armorMax, "uiMana", true)}
						{aegisPips(s.aegisPips, armorMax)}
					</Row>
				) : undefined}
				{props.highlight === "hearts" ? <HighlightRing /> : undefined}
			</Row>
			<Row order={2}>
				<Text order={0} width={HUD_VIEW.statusLabelWidth} color="uiTextDim" text={str(HUD_STRINGS.flask)} />
				{pips(s.flask, s.flaskMax, "uiAccent", false)}
				{props.highlight === "flask" ? <HighlightRing /> : undefined}
			</Row>
			<Row order={3}>
				<Text order={0} width={HUD_VIEW.statusLabelWidth} color="uiTextDim" text={str(HUD_STRINGS.ember)} />
				{pips(s.embers, s.emberMax, "ember", true)}
			</Row>
			<BoostRow order={4} boosts={s.boosts} highlight={props.boostsHighlight} />
			{s.floor > 0 && !s.scoring ? (
				<Text order={5} color="uiText" text={str(HUD_STRINGS.floor, { floor: s.floor, depth: s.depth })} />
			) : undefined}
			<RunItems order={6} boons={s.boons} relics={s.relics} curses={s.curses} />
		</Panel>
	);
}
