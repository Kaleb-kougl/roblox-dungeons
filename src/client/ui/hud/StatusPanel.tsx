import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { role, str, themePack } from "client/ui/theme";
import type { ThemePack } from "shared/theme";
import { HORDE_CHIP, hordeChipWidth } from "shared/view/pacts";
import { BOOST_VIEW, type BoostHudEntry } from "shared/view/boosts";
import {
	HUD_STRINGS,
	HUD_VIEW,
	heartFills,
	heartSkinState,
	pipArt,
	pipArtSlot,
	skinFor,
	skinHasOf,
	statusRowMaxWidth,
	type HudPipKind,
	type SkinHas,
} from "shared/view/hud";
import { BoostRow, boostCellWidth } from "./BoostRow";
import { HordeChip } from "./HordeChip";
import { ArtImage, Panel, Pip, Row, Text, type PipArtProps } from "./primitives";
import { RunItems } from "./RunItems";
import { GhostHeart, HighlightRing } from "./TutorialFx";
import { useHudScale } from "./useHudScale";

const HIDDEN = 1;
const STROKE = 1;
/** Half hearts per heart. */
const HALVES = 2;

/** The pack's art lookups for one render (docs/UI_ART.md UA10); undefined without a pack: every piece flat. */
export interface StatusSkin {
	readonly pack: ThemePack;
	readonly has: SkinHas;
	readonly uiScale: number;
}

/**
 * One heart: `fill` 0 (empty), 1 (half) or 2 (full) half hearts; the left half fills first (web PlayerHud Heart). With
 * the heart art (skinFor "heart": full / half / empty, all or none) the art fitted into the same HUD_VIEW.heartSize box
 * (ArtImage: whole screen px per art px); without, the flat heart.
 */
export function Heart(props: {
	order: number;
	fill: number;
	skin: StatusSkin | undefined;
	/** The heart's box, reference px (default HUD_VIEW.heartSize; the touch strip passes its slot). */
	box?: { readonly w: number; readonly h: number };
}) {
	const size = HUD_VIEW.heartSize;
	const box = props.box ?? { w: size, h: size };
	const art = props.skin !== undefined ? skinFor(props.skin.has, "heart", heartSkinState(props.fill)) : undefined;
	const flat = (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, box.w, 0, box.h)}
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
	if (art === undefined) return flat;
	return <ArtImage id={art} box={box} order={props.order} fallback={flat} />;
}

/** A pip's art (shared/view/hud pipArt) in its slot (pipArtSlot), or undefined: the flat pip. */
export function pipArtProps(skin: StatusSkin | undefined, kind: HudPipKind, filled: boolean): PipArtProps | undefined {
	if (skin === undefined) return undefined;
	const art = pipArt(skin.has, kind, filled);
	if (art === undefined) return undefined;
	const ref = skin.pack.image(art.id);
	if (ref === undefined) return undefined;
	const r = ref.rect;
	const box = pipArtSlot(kind, r?.w ?? ref.w, r?.h ?? ref.h, skin.uiScale);
	return { id: art.id, box, transparency: art.transparency, tinted: art.tinted };
}

/**
 * A row of `max` pips, `count` filled. With the art (UA10): flask charges are potions (full / spent), Ember pips
 * candles (unlit: dimmed), armor pips grey chips (empty: dimmed); without, the flat square / diamond pips.
 */
export function pips(
	count: number,
	max: number,
	color: "uiMana" | "uiAccent" | "ember",
	diamond: boolean,
	kind: HudPipKind,
	skin: StatusSkin | undefined,
) {
	const out = new Array<React.Element>();
	for (let i = 0; i < max; i++) {
		const filled = i < count;
		out.push(
			<Pip
				key={`p${i}`}
				order={i + 1}
				filled={filled}
				color={color}
				diamond={diamond}
				art={pipArtProps(skin, kind, filled)}
			/>,
		);
	}
	return out;
}

/**
 * The Aegis pips (docs/BOOSTS.md B7): filled diamonds in their own colour after the `after` armor pips; with the art
 * (UA10) the white chip tinted by that colour.
 */
export function aegisPips(count: number, after: number, skin: StatusSkin | undefined) {
	const out = new Array<React.Element>();
	for (let i = 0; i < count; i++) {
		out.push(
			<Pip
				key={`a${i}`}
				order={after + i + 1}
				filled={true}
				color={BOOST_VIEW.aegisPipRole}
				diamond={true}
				art={pipArtProps(skin, "aegis", true)}
			/>,
		);
	}
	return out;
}

/**
 * The boost row while the Pact of the Horde is armed (docs/FORTUNE.md FO7): the Horde chip, then the running boosts in
 * what is left of the row (shared/view/pacts hordeChipWidth: one boost cell beside the chip; more boosts wrap under
 * it), so the chip shares the boost row's line instead of adding a panel or a row of its own.
 */
function HordeBoostRow(props: { order: number; boosts: ReadonlyArray<BoostHudEntry>; highlight?: boolean }) {
	const cell = boostCellWidth(BOOST_VIEW);
	const chipW = hordeChipWidth(statusRowMaxWidth(), cell, HUD_VIEW.gap);
	return (
		<Row order={props.order}>
			<HordeChip order={1} width={chipW} height={BOOST_VIEW.iconSize} textSize={HORDE_CHIP.textSize} />
			<BoostRow
				order={2}
				boosts={props.boosts}
				highlight={props.highlight}
				maxWidth={math.max(cell, statusRowMaxWidth() - chipW - HUD_VIEW.gap)}
			/>
		</Row>
	);
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
 * running boosts (BoostRow; while the Pact of the Horde is armed, docs/FORTUNE.md FO7, the Horde chip leads the row:
 * HordeBoostRow); on an unscored endless run a line with the floor and Depth (a scored run shows it under
 * the score, docs/HUD_LAYOUT.md H4); the owned boons, relics and curses (M2, RunItems). Reads only the ~10 Hz
 * snapshot. In the tutorial: the highlight ring on the hearts or the flask row or the boost row, and the ghost half
 * heart after a harmless hit. With the UI art (docs/UI_ART.md UA10) hearts, potions, candles and chips replace the
 * flat shapes in the same rows (the highlight ring and ghost heart sit where they did); without it, the flat panel.
 */
export function StatusPanel(props: StatusPanelProps) {
	const s = useSelector(selectSnapshot);
	const uiScale = useHudScale();
	const pack = themePack();
	const skin: StatusSkin | undefined = pack !== undefined ? { pack, has: skinHasOf(pack), uiScale } : undefined;
	const hearts = heartFills(s.hearts, s.heartsMax).map((fill, i) => (
		<Heart key={`h${i}`} order={i + 1} fill={fill} skin={skin} />
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
						{pips(s.armor, armorMax, "uiMana", true, "armor", skin)}
						{aegisPips(s.aegisPips, armorMax, skin)}
					</Row>
				) : undefined}
				{props.highlight === "hearts" ? <HighlightRing /> : undefined}
			</Row>
			<Row order={2}>
				<Text order={0} width={HUD_VIEW.statusLabelWidth} color="uiTextDim" text={str(HUD_STRINGS.flask)} />
				{pips(s.flask, s.flaskMax, "uiAccent", false, "flask", skin)}
				{props.highlight === "flask" ? <HighlightRing /> : undefined}
			</Row>
			<Row order={3}>
				<Text order={0} width={HUD_VIEW.statusLabelWidth} color="uiTextDim" text={str(HUD_STRINGS.ember)} />
				{pips(s.embers, s.emberMax, "ember", true, "ember", skin)}
			</Row>
			{s.hordeArmed ? (
				<HordeBoostRow order={4} boosts={s.boosts} highlight={props.boostsHighlight} />
			) : (
				<BoostRow order={4} boosts={s.boosts} highlight={props.boostsHighlight} />
			)}
			{s.floor > 0 && !s.scoring ? (
				<Text order={5} color="uiText" text={str(HUD_STRINGS.floor, { floor: s.floor, depth: s.depth })} />
			) : undefined}
			<RunItems
				order={6}
				boons={s.boons}
				relics={s.relics}
				curses={s.curses}
				levels={s.boonLevels}
				duos={s.duos}
			/>
		</Panel>
	);
}
