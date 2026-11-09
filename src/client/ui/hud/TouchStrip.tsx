import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { UI_IMAGES, role, uiImage, useUiArt } from "client/ui/theme";
import {
	FOOTPRINT_ESTIMATE,
	HUD_SKIN,
	TOUCH_STRIP,
	TOUCH_STRIP_GUI,
	heartFills,
	heartsCountText,
	pipArt,
	skinHasOf,
	wrapGrid,
	type ScreenRect,
	type StripSlot,
	type TouchStripLayout,
} from "shared/view/hud";
import { BestCompactLine, ScoreNumber } from "./BestTargetRow";
import { BoostRow, boostCellWidth, type BoostLook } from "./BoostRow";
import { HordeChip } from "./HordeChip";
import { HORDE_CHIP } from "shared/view/pacts";
import { ComboMeter } from "./ComboMeter";
import { ComboMultiplier } from "./ComboRow";
import { cornerFadeBinding, cornerRef } from "./cornerFade";
import { ArtImage, Pip, Text } from "./primitives";
import { RunItems, type ItemLook } from "./RunItems";
import { useTouchStrip } from "./touchStripContext";
import { Heart, aegisPips, pips, type StatusSkin } from "./StatusPanel";
import { GhostHeart, HighlightRing } from "./TutorialFx";
import { ArtScaleContext } from "./useHudScale";

const HIDDEN = 1;
const HALF = 0.5;
const ROUND = new UDim(HALF, 0);
const STROKE = 1;
/** Half hearts in a full heart. */
const FULL_HEART = 2;
/** The fade group's corner (the occlusion registry slot the status panel takes off touch). */
const CORNER = "topLeft";

const CHIPS = TOUCH_STRIP.chips;
const CHIP_BOOST: BoostLook = {
	iconSize: CHIPS.cell,
	iconTextSize: CHIPS.text,
	iconBarGap: CHIPS.boostIconBarGap,
	barWidth: CHIPS.boostBarWidth,
	barHeight: CHIPS.boostBarHeight,
};
const CHIP_ITEM: ItemLook = { size: CHIPS.cell, text: CHIPS.text };

/** A group of the strip's row: its children side by side, centred in the row's height, maybe ringed. */
function Group(props: {
	name: string;
	order: number;
	height: number;
	gap: number;
	ring?: boolean;
	children?: React.ReactNode;
}) {
	return (
		<frame
			key={props.name}
			LayoutOrder={props.order}
			Size={new UDim2(0, 0, 0, props.height)}
			AutomaticSize={Enum.AutomaticSize.X}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, props.gap)}
			/>
			{props.children}
			{props.ring === true ? <HighlightRing /> : undefined}
		</frame>
	);
}

/** An icon of the strip: its art in its slot when the pack has it, else the flat pip. */
function Icon(props: {
	order: number;
	slot: StripSlot;
	art: { id: string; transparency: number } | undefined;
	flat: React.ReactElement;
}) {
	if (props.art === undefined) return props.flat;
	return (
		<ArtImage
			id={props.art.id}
			box={{ w: props.slot.w, h: props.slot.h }}
			order={props.order}
			transparency={props.art.transparency}
			fallback={props.flat}
		/>
	);
}

/** The flat coin: a round uiAccent token (the score panel draws none without the art; the strip has no "Score" label). */
function FlatCoin(props: { order: number; size: number }) {
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, props.size, 0, props.size)}
			BackgroundColor3={role("uiAccent")}
			BorderSizePixel={0}
		>
			<uicorner CornerRadius={ROUND} />
			<uistroke Thickness={STROKE} Color={role("background")} />
		</frame>
	);
}

function count(order: number, value: number, size: number) {
	return <Text order={order} size={size} color={value > 0 ? "uiText" : "uiTextDim"} text={tostring(value)} />;
}

/** An invisible box at a screen rect (the strip's UIScale `k` scales it back to screen px). */
function FootprintBox(props: { name: string; rect: ScreenRect; k: number }) {
	const r = props.rect;
	const k = props.k;
	return (
		<frame
			key={props.name}
			Position={UDim2.fromOffset(r.x / k, r.y / k)}
			Size={UDim2.fromOffset(r.w / k, r.h / k)}
			BackgroundTransparency={HIDDEN}
			Active={false}
		/>
	);
}

export interface TouchStripProps {
	readonly layout: TouchStripLayout;
	/** The tutorial rings the hearts or the flask (TutorialView.highlight). */
	readonly highlight?: "hearts" | "flask";
	/** The tutorial's ghost half heart token (0 = never). */
	readonly ghostHeart?: number;
	readonly boostsHighlight?: boolean;
	readonly scoreHighlight?: boolean;
}

/**
 * The touch HUD strip (docs/UI_ART.md "Phones", shared/view/hud touchStrip): on touch it replaces the StatusPanel and
 * the ScorePanel's corner panels. One row in the Roblox top bar, right of the pause button: hearts (with the armor /
 * Aegis pips and the tutorial's ghost heart), the flask icon and count, the Ember candle and count, the score (coin,
 * the rolling ROOM_CLEAR_UI number, the COMBO_UI multiplier) over a thin combo line (ComboMeter, tier colours and
 * bindings unchanged) and, on a run with a new-best target, the compact target line hung under the combo line
 * (BestCompactLine, docs/NEW_BEST.md NB6; no size changes); under it one line of chips (the Horde chip while armed,
 * docs/FORTUNE.md FO7, then BoostRow, then RunItems capped
 * with "+N"). No panel box: icons and stroked text, the art's icons when the pack has them (fitted to whole screen px under the strip's own UIScale,
 * ArtScaleContext), the flat pips and hearts otherwise. The row and the chips are one CanvasGroup registered as the
 * top-left corner panel, so HudOcclusionController fades it when the action passes under it. The tutorial's rings sit
 * on the hearts, the flask, the boosts and the score. Rendered in GameHud's KV_TouchStrip ScreenGui (full screen, no
 * insets: the top bar lies outside the safe area); its footprint boxes (the fade group and the boss slot) are invisible
 * frames the touch controls keep clear of.
 */
export function TouchStrip(props: TouchStripProps) {
	const s = useSelector(selectSnapshot);
	const L = props.layout;
	const k = L.scale;
	const T = TOUCH_STRIP;
	useUiArt();
	const skin: StatusSkin = { pack: UI_IMAGES, has: skinHasOf(UI_IMAGES), uiScale: k };
	const slots = L.slots;
	const row = L.rowHeight;

	// Hearts: every heart, or one heart and a count; the ghost heart after them; the pips.
	const hearts = new Array<React.Element>();
	if (L.heartsAsCount) {
		hearts.push(<Heart key="h" order={1} fill={s.hearts > 0 ? FULL_HEART : 0} skin={skin} box={slots.heart} />);
		hearts.push(<Text key="n" order={2} size={T.countText} text={heartsCountText(s.hearts)} />);
	} else {
		heartFills(s.hearts, s.heartsMax).forEach((fill, i) =>
			hearts.push(<Heart key={`h${i}`} order={i + 1} fill={fill} skin={skin} box={slots.heart} />),
		);
	}
	const ghost = props.ghostHeart ?? 0;
	const armorMax = math.max(s.armorMax, s.armor);
	const has = skin?.has;
	const flaskArt = has !== undefined ? pipArt(has, "flask", s.flask > 0) : undefined;
	const emberArt = has !== undefined ? pipArt(has, "ember", s.embers > 0) : undefined;
	const coin = uiImage(HUD_SKIN.ids.coin) !== undefined;
	const multW = T.multChars * T.multText * T.charEm;
	const lineH = T.multText + FOOTPRINT_ESTIMATE.lineSlack;

	const boostsW =
		s.boosts.size() > 0
			? wrapGrid(s.boosts.size(), boostCellWidth(CHIP_BOOST), CHIPS.cell, CHIPS.cellGap, L.maxWidth).width
			: 0;
	// docs/FORTUNE.md FO7: the Horde chip (while armed) leads the chip line; the items take what is left.
	const hordeW = s.hordeArmed ? HORDE_CHIP.touchWidth + CHIPS.cellGap : 0;
	const itemsW = math.max(0, L.maxWidth - hordeW - boostsW - (boostsW > 0 ? CHIPS.cellGap : 0));

	return (
		<ArtScaleContext.Provider value={k}>
			<uiscale key="Scale" Scale={k} />
			<frame key={TOUCH_STRIP_GUI.footprint} Size={new UDim2()} BackgroundTransparency={HIDDEN} Active={false}>
				{L.footprint.map((r, i) => (
					<FootprintBox key={`Box${i}`} name={`Box${i}`} rect={r} k={k} />
				))}
			</frame>
			<frame
				key="Strip"
				ref={cornerRef(CORNER)}
				Position={UDim2.fromOffset(L.group.x / k, L.group.y / k)}
				Size={new UDim2()}
				AutomaticSize={Enum.AutomaticSize.XY}
				BackgroundTransparency={HIDDEN}
			>
				<canvasgroup
					key="Group"
					Size={new UDim2()}
					AutomaticSize={Enum.AutomaticSize.XY}
					BackgroundTransparency={HIDDEN}
					BorderSizePixel={0}
					GroupTransparency={cornerFadeBinding(CORNER)}
				>
					<uipadding
						PaddingLeft={new UDim(0, T.ringPad)}
						PaddingRight={new UDim(0, T.ringPad)}
						PaddingTop={new UDim(0, T.ringPad)}
						PaddingBottom={new UDim(0, T.ringPad)}
					/>
					<uilistlayout
						FillDirection={Enum.FillDirection.Vertical}
						SortOrder={Enum.SortOrder.LayoutOrder}
						Padding={new UDim(0, CHIPS.gap)}
					/>
					<frame
						key="Row"
						LayoutOrder={1}
						Size={new UDim2()}
						AutomaticSize={Enum.AutomaticSize.XY}
						BackgroundTransparency={HIDDEN}
					>
						<uilistlayout
							FillDirection={Enum.FillDirection.Horizontal}
							VerticalAlignment={Enum.VerticalAlignment.Top}
							SortOrder={Enum.SortOrder.LayoutOrder}
							Padding={new UDim(0, T.groupGap)}
						/>
						<Group name="Hearts" order={1} height={row} gap={T.itemGap} ring={props.highlight === "hearts"}>
							{hearts}
							{ghost > 0 ? <GhostHeart key={`ghost${ghost}`} order={hearts.size() + 1} /> : undefined}
							{armorMax > 0 || s.aegisPips > 0 ? (
								<Group name="Pips" order={hearts.size() + 2} height={row} gap={T.itemGap}>
									{pips(s.armor, armorMax, "uiMana", true, "armor", skin)}
									{aegisPips(s.aegisPips, armorMax, skin)}
								</Group>
							) : undefined}
						</Group>
						<Group name="Flask" order={2} height={row} gap={T.pairGap} ring={props.highlight === "flask"}>
							<Icon
								order={1}
								slot={slots.flask}
								art={flaskArt}
								flat={<Pip order={1} filled={s.flask > 0} color="uiAccent" size={T.flatIcon} />}
							/>
							{count(2, s.flask, T.countText)}
						</Group>
						<Group name="Ember" order={3} height={row} gap={T.pairGap}>
							<Icon
								order={1}
								slot={slots.candle}
								art={emberArt}
								flat={
									<Pip
										order={1}
										filled={s.embers > 0}
										color="ember"
										diamond={true}
										size={T.flatIcon}
									/>
								}
							/>
							{count(2, s.embers, T.countText)}
						</Group>
						{s.scoring ? (
							<frame
								key="Score"
								LayoutOrder={4}
								Size={new UDim2(0, L.widths.score, 0, row + T.comboGap + T.comboHeight)}
								BackgroundTransparency={HIDDEN}
							>
								<uilistlayout
									FillDirection={Enum.FillDirection.Vertical}
									SortOrder={Enum.SortOrder.LayoutOrder}
									Padding={new UDim(0, T.comboGap)}
								/>
								<Group name="Number" order={1} height={row} gap={T.pairGap}>
									{coin ? (
										<ArtImage
											id={HUD_SKIN.ids.coin}
											order={1}
											box={{ w: slots.coin.w, h: slots.coin.h }}
										/>
									) : (
										<FlatCoin order={1} size={T.flatIcon} />
									)}
									<ScoreNumber order={2} size={T.scoreText} align={Enum.TextXAlignment.Left} />
									{L.showMult ? (
										<ComboMultiplier
											key="Mult"
											order={3}
											width={multW}
											height={lineH}
											textSize={T.multText}
										/>
									) : undefined}
								</Group>
								<ComboMeter order={2} width={L.widths.score} height={T.comboHeight} />
								<BestCompactLine order={3} width={L.widths.score} />
								{props.scoreHighlight === true ? <HighlightRing /> : undefined}
							</frame>
						) : undefined}
					</frame>
					<frame
						key="Chips"
						LayoutOrder={2}
						Size={new UDim2(0, 0, 0, CHIPS.cell)}
						AutomaticSize={Enum.AutomaticSize.X}
						BackgroundTransparency={HIDDEN}
					>
						<uilistlayout
							FillDirection={Enum.FillDirection.Horizontal}
							VerticalAlignment={Enum.VerticalAlignment.Center}
							SortOrder={Enum.SortOrder.LayoutOrder}
							Padding={new UDim(0, CHIPS.cellGap)}
						/>
						{s.hordeArmed ? (
							<HordeChip
								order={0}
								width={HORDE_CHIP.touchWidth}
								height={CHIPS.cell}
								textSize={HORDE_CHIP.touchTextSize}
							/>
						) : undefined}
						<BoostRow
							order={1}
							boosts={s.boosts}
							highlight={props.boostsHighlight}
							look={CHIP_BOOST}
							maxWidth={L.maxWidth}
							gap={CHIPS.cellGap}
						/>
						<RunItems
							order={2}
							boons={s.boons}
							relics={s.relics}
							curses={s.curses}
							levels={s.boonLevels}
							duos={s.duos}
							look={CHIP_ITEM}
							maxWidth={itemsW}
							gap={CHIPS.cellGap}
						/>
					</frame>
				</canvasgroup>
			</frame>
		</ArtScaleContext.Provider>
	);
}

/** The touch strip at its layout for the measured geometry (GameHud's TouchStripGeometryContext); nothing before. */
export function TouchStripHost(props: Omit<TouchStripProps, "layout">) {
	const layout = useTouchStrip();
	if (layout === undefined) return undefined;
	return <TouchStrip layout={layout} {...props} />;
}
