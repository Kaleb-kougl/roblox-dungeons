import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { UI_IMAGES, role, str, useUiArt } from "client/ui/theme";
import type { ThemePack } from "shared/theme";
import { FloorModifier } from "shared/dungeon";
import { HORDE_CHIP } from "shared/view/pacts";
import { GOLDEN_VIEW, GoldenRumourPhase, chipRowWidth } from "shared/view/golden";
import { BOOST_VIEW, type BoostHudEntry } from "shared/view/boosts";
import { BRACE_VIEW } from "shared/view/fx";
import { FLOOR_MODIFIER_VIEW } from "shared/view/modifiers";
import {
	HUD_STRINGS,
	HUD_VIEW,
	HEART_FILL,
	heartArt,
	heartFills,
	isHalfContainer,
	pipArt,
	pipArtSlot,
	skinHasOf,
	statusRowMaxWidth,
	type HudPipKind,
	type SkinHas,
} from "shared/view/hud";
import { BoostRow, boostCellWidth } from "./BoostRow";
import { BRACE_UI } from "./braceUi";
import { FloorModifierChip, useFloorModifier } from "./FloorModifierChip";
import { GoldenRumourChip } from "./GoldenRumourChip";
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
	/** The ui image lookup (client/ui UI_IMAGES: the pack's images that have downloaded, docs/STAGE_ASSETS.md SA18). */
	readonly pack: Pick<ThemePack, "image">;
	readonly has: SkinHas;
	readonly uiScale: number;
}

/**
 * One heart: `fill` 0 (empty), 1 (half) or 2 (full) half hearts; the left half fills first (web PlayerHud Heart). With
 * the heart art (skinFor "heart": full / half / empty, all or none) the art fitted into the same HUD_VIEW.heartSize box
 * (ArtImage: whole screen px per art px); without, the flat heart.
 *
 * docs/SILVER.md SV16 (OC18): the half container of an odd maximum (heartFills' HALF_MAX_FULL / HALF_MAX_EMPTY) sits in
 * the same box: the pack's container art (heartArt), else the whole heart art's left half (clipped), else a flat
 * half-width container, filled while it holds its half heart. Never a half-filled heart.
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
	const art = props.skin !== undefined ? heartArt(props.skin.has, props.fill) : undefined;
	if (isHalfContainer(props.fill)) return <HalfContainer order={props.order} fill={props.fill} box={box} art={art} />;
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
	return <ArtImage id={art.id} box={box} order={props.order} fallback={flat} />;
}

/** Heart's half container (docs/SILVER.md SV16): see Heart. */
function HalfContainer(props: {
	order: number;
	fill: number;
	box: { readonly w: number; readonly h: number };
	art: ReturnType<typeof heartArt>;
}) {
	const box = props.box;
	const full = props.fill === HEART_FILL.HALF_MAX_FULL;
	// The flat container: the left half of the heart's box, its own outline, filled while it holds its half heart.
	const flat = (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, box.w, 0, box.h)}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
		>
			<frame
				Size={UDim2.fromScale(1 / HALVES, 1)}
				BackgroundColor3={full ? role("uiHealth") : role("uiPanel")}
				BorderSizePixel={0}
			>
				<uistroke Thickness={STROKE} Color={role("background")} />
			</frame>
		</frame>
	);
	const art = props.art;
	if (art === undefined) return flat;
	if (!art.leftHalf) return <ArtImage id={art.id} box={box} order={props.order} fallback={flat} />;
	// The whole heart's art, only its left half shown (the box keeps its width, so the row is spaced as before).
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, box.w, 0, box.h)}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
		>
			<frame
				Size={UDim2.fromScale(1 / HALVES, 1)}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
				ClipsDescendants={true}
			>
				<ArtImage id={art.id} box={box} order={0} fallback={flat} />
			</frame>
		</frame>
	);
}

/** A pip's art (shared/view/hud pipArt) in its slot (pipArtSlot), or undefined: the flat pip. */
export function pipArtProps(skin: StatusSkin | undefined, kind: HudPipKind, filled: boolean): PipArtProps | undefined {
	if (skin === undefined) return undefined;
	const art = pipArt(skin.has, kind, filled);
	if (art === undefined) return undefined;
	const ref = skin.pack.image(art.id);
	if (ref === undefined) return undefined;
	const r = ref.rect;
	// The pack's own shields sit in the hearts' whole box, spaced like the hearts; the chips in their trimmed pip slot.
	const box =
		art.box !== undefined
			? { w: art.box, h: art.box }
			: pipArtSlot(kind, r?.w ?? ref.w, r?.h ?? ref.h, skin.uiScale);
	return { id: art.id, box, transparency: art.transparency, tinted: art.tinted };
}

/**
 * A row of `max` pips, `count` filled. With the art (UA10): flask charges are potions (full / spent), Ember pips
 * candles (unlit: dimmed), armor pips shields (shared/theme PIP_ICON_IDS; else grey chips, empty: dimmed); without, the
 * flat square / diamond pips.
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
 * (UA10) the Aegis shield (ui.pip.aegis), else the white chip tinted by that colour.
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
 * Bastion's brace pulse round the armor pips (docs/LEGENDARIES.md LG6): a stroke in the pip colour whose thickness and
 * transparency BraceFxController drives through BRACE_UI (bindings: no re-render). Invisible at rest.
 */
function BracePulse() {
	return (
		<uistroke
			key="BracePulse"
			ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
			Color={role(BRACE_VIEW.pulse.role)}
			Thickness={BRACE_UI.pulseThickness.binding}
			Transparency={BRACE_UI.pulseTransparency.binding}
		/>
	);
}

/**
 * The boost row while chips lead it: the floor's modifier (docs/FLOOR_MODIFIERS.md FM6, `modifier`: a FloorModifier
 * id, NONE for none), the Pact of the Horde armed (docs/FORTUNE.md FO7, `horde`) and the Goldling's rumour
 * (docs/GOLDLING_RUMOURS.md GR7, `rumour`). Without the modifier the chips split the row but one boost cell
 * (shared/view/golden chipRowWidth; one chip: hordeChipWidth's slot) and the boosts share their line. With the modifier
 * and another chip, the chips take a line of their own (the modifier in a boost cell's width, the others splitting the
 * rest) and the boosts go on the line under them.
 */
function ChipBoostRow(props: {
	order: number;
	boosts: ReadonlyArray<BoostHudEntry>;
	highlight?: boolean;
	horde: boolean;
	modifier: number;
	rumour: number;
}) {
	const cell = boostCellWidth(BOOST_VIEW);
	const rowW = statusRowMaxWidth();
	const h = BOOST_VIEW.iconSize;
	const hasModifier = props.modifier !== FloorModifier.NONE;
	const hasRumour = props.rumour !== GoldenRumourPhase.NONE;
	const others = (props.horde ? 1 : 0) + (hasRumour ? 1 : 0);
	const stacked = hasModifier && others > 0;
	const chipW = chipRowWidth(rowW, cell, HUD_VIEW.gap, stacked ? others : others + (hasModifier ? 1 : 0));
	const chips = new Array<React.Element>();
	if (hasModifier) {
		chips.push(
			<FloorModifierChip
				key="FloorModifier"
				order={1}
				kind={props.modifier}
				width={stacked ? cell : chipW}
				height={h}
				textSize={FLOOR_MODIFIER_VIEW.chip.textSize}
			/>,
		);
	}
	if (props.horde) {
		chips.push(<HordeChip key="Horde" order={2} width={chipW} height={h} textSize={HORDE_CHIP.textSize} />);
	}
	if (hasRumour) {
		chips.push(
			<GoldenRumourChip
				key="GoldenRumour"
				order={3}
				width={chipW}
				height={h}
				textSize={GOLDEN_VIEW.rumour.chip.textSize}
				phase={props.rumour}
			/>,
		);
	}
	if (stacked) {
		return (
			<frame
				LayoutOrder={props.order}
				Size={new UDim2()}
				AutomaticSize={Enum.AutomaticSize.XY}
				BackgroundTransparency={HIDDEN}
			>
				<uilistlayout
					FillDirection={Enum.FillDirection.Vertical}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, HUD_VIEW.gap)}
				/>
				<Row order={1}>{chips}</Row>
				<BoostRow order={2} boosts={props.boosts} highlight={props.highlight} tooltips={true} />
			</frame>
		);
	}
	const used = chips.size() * (chipW + HUD_VIEW.gap);
	return (
		<Row order={props.order}>
			{chips}
			<BoostRow
				order={3}
				boosts={props.boosts}
				highlight={props.highlight}
				tooltips={true}
				maxWidth={math.max(cell, statusRowMaxWidth() - used)}
			/>
		</Row>
	);
}

/**
 * `StatusPanel`'s props: only the tutorial's marks (which row is ringed, the ghost half heart's token). Everything the
 * panel shows comes from the store's snapshot. GameHud passes them from the store's tutorial slice.
 */
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
 * running boosts (BoostRow; while the Pact of the Horde is armed, docs/FORTUNE.md FO7, the Horde chip leads the row,
 * and on a floor modifier's floor, docs/FLOOR_MODIFIERS.md FM6, the modifier chip, and while a Goldling's rumour is heard, docs/GOLDLING_RUMOURS.md GR7, its
 * chip: ChipBoostRow); on an unscored
 * endless run a line with the floor and Depth (a scored run shows it under
 * the score, docs/HUD_LAYOUT.md H4); the owned boons, relics and curses (M2, RunItems). Reads only the ~10 Hz
 * snapshot. In the tutorial: the highlight ring on the hearts or the flask row or the boost row, and the ghost half
 * heart after a harmless hit. With the UI art (docs/UI_ART.md UA10) hearts, potions, candles and chips replace the
 * flat shapes in the same rows (the highlight ring and ghost heart sit where they did); without it, the flat panel.
 */
export function StatusPanel(props: StatusPanelProps) {
	const s = useSelector(selectSnapshot);
	const modifier = useFloorModifier();
	const uiScale = useHudScale();
	useUiArt();
	const skin: StatusSkin = { pack: UI_IMAGES, has: skinHasOf(UI_IMAGES), uiScale };
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
						<BracePulse />
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
			{s.hordeArmed || modifier !== FloorModifier.NONE || s.goldenRumour !== GoldenRumourPhase.NONE ? (
				<ChipBoostRow
					order={4}
					boosts={s.boosts}
					highlight={props.boostsHighlight}
					horde={s.hordeArmed}
					modifier={modifier}
					rumour={s.goldenRumour}
				/>
			) : (
				<BoostRow order={4} boosts={s.boosts} highlight={props.boostsHighlight} tooltips={true} />
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
				tooltips={true}
			/>
		</Panel>
	);
}
