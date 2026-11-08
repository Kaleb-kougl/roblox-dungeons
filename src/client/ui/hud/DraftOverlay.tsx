import React, { joinBindings, useMemo } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectTutorialEnded, type GameState } from "client/store";
import { draftHint, keyDevice } from "shared/play";
import { useHudFont, hudText, role, str, themePack } from "client/ui/theme";
import { BOON_MAX_LEVEL, CardKind, DRAFT_OFFER_COUNT } from "shared/sim";
import type { ColorRole } from "shared/theme";
import {
	DRAFT_CARD_VIEW,
	DUO_CHIP_SPAN,
	ITEM_ART_FILL_ROLE,
	DraftBeat,
	DRAFT_REVEAL_VIEW,
	DRAFT_SKIN,
	HUD_VIEW,
	PROGRESSION_STRINGS,
	PROGRESSION_VIEW,
	TOUCH_STRINGS,
	draftBodyBox,
	draftChipArt,
	draftChipCells,
	draftShineOffset,
	fitArt,
	draftSkullPlacement,
	draftSurfaceImageId,
	draftTextNudge,
	draftToneRole,
	type DraftBodyBox,
	type DraftCardModel,
	type DraftSurface,
	type DraftTone,
} from "shared/view/hud";
import { useHudActions } from "./actions";
import { DraftRays } from "./DraftRays";
import { DRAFT_UI, type DraftCardUi } from "./draftUi";
import { usePortrait } from "./usePortrait";
import { useArtScale } from "./useHudScale";
import { Panel, SlicedImage, Text } from "./primitives";

const HALF = 0.5;
const HIDDEN = 1;
const NAME_TOP = 0.08;
const RARITY_TOP = 0.3;
const DESC_TOP = 0.48;
const DESC_HEIGHT = 0.46;
/** An Upgrade card (docs/BUILDS.md BU9): the new line above, the "was" line at WAS_TOP under it. */
const DESC_HEIGHT_WITH_WAS = 0.28;
const WAS_TOP = 0.78;
const INSET = 0.92;
/** Draw order inside a card slot (ZIndexBehavior Sibling): the tap target over the body. */
const SLOT_Z = { body: 1, tap: 2 } as const;
/** Draw order inside the card row: every ray ring on a layer under every card (a legendary's rays pass behind them). */
const ROW_Z = { rays: 1, cards: 2 } as const;
/** The surfaces a card can show (one dim silhouette each, visible while it is the current one). */
const SURFACES: ReadonlyArray<DraftSurface> = ["back", "common", "rare"];
/** Draw order inside the card body, bottom to top. */
const BODY_Z = {
	back: 1,
	eyes: 2,
	face: 3,
	skull: 4,
	text: 5,
	shine: 6,
	dim: 7,
	flash: 8,
	glow: 9,
	select: 9,
} as const;

const selectDraftOpen = (state: { game: GameState }) => state.game.snapshot.draftOpen;
const selectDraftWaiting = (state: { game: GameState }) => state.game.snapshot.draftWaiting;

/** A card tone's colour (its rarity, or boon.evolved / boon.duo: docs/BUILDS.md BU9). */
function toneColor(t: DraftTone): Color3 {
	return role(draftToneRole(t));
}

/** The banner row's colour: the tone's for an Evolution or a Duo card, else the dim rarity / level line. */
function bannerRole(m: DraftCardModel | undefined): ColorRole {
	return m !== undefined && (m.kind === CardKind.EVOLUTION || m.kind === CardKind.DUO)
		? draftToneRole(m.tone)
		: "uiTextDim";
}

/** An empty pip's transparency from the text's (faded with it, never more opaque than emptyPipTransparency). */
function emptyPipT(t: number): number {
	return 1 - (1 - t) * (1 - DRAFT_CARD_VIEW.emptyPipTransparency);
}

/** The eyes mask's tint (DRAFT_REVEAL_VIEW.eyeRgb, the red-eyed skulls' red). */
function eyeColor(): Color3 {
	const [r, g, b] = DRAFT_REVEAL_VIEW.eyeRgb;
	return Color3.fromRGB(r, g, b);
}

/** The shine band: clear outside, bandTransparency in its middle. */
function shineBand(): NumberSequence {
	const S = DRAFT_REVEAL_VIEW.shine;
	const half = S.bandWidth * HALF;
	return new NumberSequence([
		new NumberSequenceKeypoint(0, HIDDEN),
		new NumberSequenceKeypoint(HALF - half, HIDDEN),
		new NumberSequenceKeypoint(HALF, S.bandTransparency),
		new NumberSequenceKeypoint(HALF + half, HIDDEN),
		new NumberSequenceKeypoint(1, HIDDEN),
	]);
}

/** A flat panel layer (the fallback when the pack has no card art): uiPanel fill and an outline. */
function FlatLayer(props: {
	z: number;
	fill: React.Binding<number>;
	stroke: React.Binding<number>;
	color: Color3 | React.Binding<Color3>;
	visible?: React.Binding<boolean>;
}) {
	return (
		<frame
			Size={UDim2.fromScale(1, 1)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={props.fill}
			BorderSizePixel={0}
			ZIndex={props.z}
			Visible={props.visible ?? true}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={PROGRESSION_VIEW.cardStroke}
				Color={props.color}
				Transparency={props.stroke}
			/>
		</frame>
	);
}

/** One legendary skull on the face's top corner (only with the rare face art and the skull's own image). */
function Skull(props: { side: "left" | "right"; ui: DraftCardUi; visible: React.Binding<boolean> }) {
	const pack = themePack();
	const face = pack?.image(DRAFT_SKIN.rare);
	const id = props.side === "left" ? DRAFT_SKIN.skullLeft : DRAFT_SKIN.skullRight;
	const skull = pack?.image(id);
	if (face === undefined || skull === undefined) return undefined;
	const p = draftSkullPlacement(props.side, skull, face.w);
	return (
		<SlicedImage
			id={id}
			name={`Skull_${props.side}`}
			size={UDim2.fromOffset(p.w, p.h)}
			position={new UDim2(p.fromRight ? 1 : 0, p.fromRight ? -p.x : p.x, 0, p.y)}
			anchor={new Vector2(p.anchorX, p.anchorY)}
			transparency={props.ui.ornamentT.binding}
			visible={props.visible}
			zIndex={BODY_Z.skull}
		/>
	);
}

/** A text row of the card (faded by the card's text transparency), `nudge` reference px below its row. */
function CardText(props: {
	top: number;
	nudge?: React.Binding<number>;
	height: UDim2 | React.Binding<UDim2>;
	size: number;
	text: React.Binding<string>;
	color: Color3 | React.Binding<Color3>;
	transparency: React.Binding<number>;
	wrap?: boolean;
}) {
	const hudFont = useHudFont();
	return (
		<textlabel
			AnchorPoint={new Vector2(HALF, 0)}
			Position={
				props.nudge !== undefined
					? props.nudge.map((px) => new UDim2(HALF, 0, props.top, px))
					: new UDim2(HALF, 0, props.top, 0)
			}
			Size={props.height}
			BackgroundTransparency={HIDDEN}
			Font={hudFont}
			TextSize={props.size}
			TextWrapped={props.wrap === true}
			TextYAlignment={props.wrap === true ? Enum.TextYAlignment.Top : Enum.TextYAlignment.Center}
			TextColor3={props.color}
			TextTransparency={props.transparency}
			Text={props.text}
			ZIndex={BODY_Z.text}
		/>
	);
}

/**
 * The row under a card's name (docs/BUILDS.md BU9), centred, every piece a binding (the card renders once): a Duo
 * card's joined chip (its two boons' icon cells side by side), the banner text (the rarity, "Level II", "EVOLVE ·
 * <boon>", "DUO") and an Upgrade / Evolution card's level pips (the level the card gives filled, in the card's colour).
 * Faded with the card's text. With the boon icon art (docs/BUILDS.md BU11, shared/view/hud draftChipArt) the chip's
 * cells draw the art on ITEM_ART_FILL_ROLE instead of the labels, and a boon card shows its own icon in a one-cell
 * chip; without it the row is exactly as before.
 */
function BannerRow(props: { ui: DraftCardUi; nudge: React.Binding<number> }) {
	const hudFont = useHudFont();
	const uiScale = useArtScale();
	const ui = props.ui;
	const look = useMemo(() => {
		const m = ui.model.binding;
		const pack = themePack();
		const has = (id: string) => pack?.image(id) !== undefined;
		const art = m.map((x) => draftChipArt(x, has));
		const cells = m.map((x) => draftChipCells(x, draftChipArt(x, has)));
		const textT = ui.textT.binding;
		const pips: { slot: React.Binding<boolean>; filled: React.Binding<boolean> }[] = [];
		for (let k = 0; k < BOON_MAX_LEVEL; k++)
			pips.push({
				slot: m.map((x) => x !== undefined && x.maxLevel > k),
				filled: m.map((x) => x !== undefined && x.level > k),
			});
		const chip: {
			text: React.Binding<string>;
			color: React.Binding<Color3>;
			visible: React.Binding<boolean>;
			image: React.Binding<string>;
			imageVisible: React.Binding<boolean>;
			rectOffset: React.Binding<Vector2>;
			rectSize: React.Binding<Vector2>;
			imageSize: React.Binding<UDim2>;
		}[] = [];
		for (let k = 0; k < DUO_CHIP_SPAN; k++) {
			const ref = art.map((a) => (a[k] !== undefined ? pack?.image(a[k]) : undefined));
			chip.push({
				text: m.map((x) =>
					x !== undefined && draftChipArt(x, has).size() === 0 && x.chipIcons[k] !== undefined
						? str(x.chipIcons[k])
						: "",
				),
				color: m.map((x) =>
					role(draftChipArt(x, has).size() > 0 ? ITEM_ART_FILL_ROLE : x?.chipRoles[k] ?? "uiPanel"),
				),
				visible: cells.map((n) => n > k),
				image: ref.map((r) => r?.assetId ?? ""),
				imageVisible: ref.map((r) => r !== undefined),
				rectOffset: ref.map((r) => (r?.rect !== undefined ? new Vector2(r.rect.x, r.rect.y) : Vector2.zero)),
				rectSize: ref.map((r) => (r?.rect !== undefined ? new Vector2(r.rect.w, r.rect.h) : Vector2.zero)),
				imageSize: ref.map((r) => {
					if (r === undefined) return new UDim2();
					const fit = fitArt(
						r.rect?.w ?? r.w,
						r.rect?.h ?? r.h,
						DRAFT_CARD_VIEW.chipCell,
						DRAFT_CARD_VIEW.chipCell,
						uiScale,
					);
					return UDim2.fromOffset(fit.w, fit.h);
				}),
			});
		}
		return {
			position: props.nudge.map((px) => new UDim2(HALF, 0, RARITY_TOP, px)),
			text: m.map((x) => (x !== undefined ? hudText(x.banner) : "")),
			textColor: m.map((x) => role(bannerRole(x))),
			chipVisible: cells.map((n) => n > 0),
			chipSize: cells.map((n) => UDim2.fromOffset(DRAFT_CARD_VIEW.chipCell * n, DRAFT_CARD_VIEW.chipCell)),
			pipsVisible: m.map((x) => x !== undefined && x.maxLevel > 0),
			pips,
			chip,
			pipColor: ui.tone.binding.map(toneColor),
			emptyT: textT.map(emptyPipT),
			textT,
		};
	}, [ui, uiScale]);
	const V = DRAFT_CARD_VIEW;
	const rowH = math.max(V.chipCell, HUD_VIEW.smallText + 4);
	return (
		<frame
			key="Banner"
			AnchorPoint={new Vector2(HALF, 0)}
			Position={look.position}
			Size={new UDim2(INSET, 0, 0, rowH)}
			BackgroundTransparency={HIDDEN}
			ZIndex={BODY_Z.text}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, V.bannerGap)}
			/>
			<frame
				key="Chip"
				LayoutOrder={1}
				Size={look.chipSize}
				BackgroundTransparency={HIDDEN}
				Visible={look.chipVisible}
				ZIndex={BODY_Z.text}
			>
				{look.chip.map((c, k) => (
					<textlabel
						key={`Icon${k}`}
						Position={UDim2.fromOffset(k * V.chipCell, 0)}
						Size={UDim2.fromOffset(V.chipCell, V.chipCell)}
						BackgroundColor3={c.color}
						BackgroundTransparency={look.textT}
						BorderSizePixel={0}
						Font={hudFont}
						TextSize={V.chipText}
						TextColor3={role("uiPanel")}
						TextTransparency={look.textT}
						Text={c.text}
						Visible={c.visible}
						ZIndex={BODY_Z.text}
					>
						<uistroke
							ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
							Thickness={V.chipStroke}
							Color={look.pipColor}
							Transparency={look.textT}
						/>
						<imagelabel
							key="Art"
							AnchorPoint={new Vector2(HALF, HALF)}
							Position={UDim2.fromScale(HALF, HALF)}
							Size={c.imageSize}
							Image={c.image}
							ImageRectOffset={c.rectOffset}
							ImageRectSize={c.rectSize}
							ImageTransparency={look.textT}
							ResampleMode={Enum.ResamplerMode.Pixelated}
							Visible={c.imageVisible}
							BackgroundTransparency={HIDDEN}
							BorderSizePixel={0}
							ZIndex={BODY_Z.text}
						/>
					</textlabel>
				))}
			</frame>
			<textlabel
				key="Text"
				LayoutOrder={2}
				Size={new UDim2(0, 0, 0, HUD_VIEW.smallText + 4)}
				AutomaticSize={Enum.AutomaticSize.X}
				BackgroundTransparency={HIDDEN}
				Font={hudFont}
				TextSize={HUD_VIEW.smallText}
				TextColor3={look.textColor}
				TextTransparency={look.textT}
				Text={look.text}
				ZIndex={BODY_Z.text}
			/>
			<frame
				key="Pips"
				LayoutOrder={3}
				Size={UDim2.fromOffset(0, V.pipSize)}
				AutomaticSize={Enum.AutomaticSize.X}
				BackgroundTransparency={HIDDEN}
				Visible={look.pipsVisible}
				ZIndex={BODY_Z.text}
			>
				<uilistlayout
					FillDirection={Enum.FillDirection.Horizontal}
					VerticalAlignment={Enum.VerticalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, V.pipGap)}
				/>
				{look.pips.map((p, k) => (
					<frame
						key={`Pip${k}`}
						LayoutOrder={k + 1}
						Size={UDim2.fromOffset(V.pipSize, V.pipSize)}
						BackgroundTransparency={HIDDEN}
						Visible={p.slot}
						ZIndex={BODY_Z.text}
					>
						<frame
							key="Fill"
							Size={UDim2.fromScale(1, 1)}
							BackgroundColor3={look.pipColor}
							BackgroundTransparency={look.textT}
							BorderSizePixel={0}
							Visible={p.filled}
							ZIndex={BODY_Z.text}
						/>
						<frame
							key="Empty"
							Size={UDim2.fromScale(1, 1)}
							BackgroundColor3={look.pipColor}
							BackgroundTransparency={look.emptyT}
							BorderSizePixel={0}
							Visible={p.filled.map((f) => !f)}
							ZIndex={BODY_Z.text}
						/>
					</frame>
				))}
			</frame>
		</frame>
	);
}

/**
 * One offered boon's slot (docs/DRAFT_REVEAL.md DR5), by offer index: everything it draws is a DRAFT_UI binding
 * (DraftRevealController writes them per frame), so it renders once. The slot is a fixed 240 x 150 layout box (its
 * ray rings are on the row's ray layer, SlotRays); inside:
 *   - the body, the flip holder: centred (AnchorPoint 0.5), its width factor and offsets (tremble, rise, drop) and its
 *     UIScale (pop * stamp * the selected scale) from bindings. Bottom to top: the back (`ui.draft.back` 9-sliced, or a
 *     flat uiPanel card with a dim outline: every back looks the same), the back's red eyes (`ui.draft.back.eyes`, same
 *     size and slice, tinted), the face (`ui.draft.card.common`, or `ui.draft.card.rare` for rare and legendary; else
 *     the flat card with the card's stroke), the legendary skulls (the legendary beat: legendaries, evolutions, duos),
 *     the name (the card's colour) / banner (BannerRow: rarity, level + pips, EVOLVE, the duo chip) / effect rows and an
 *     Upgrade's "was" line (docs/BUILDS.md BU9; hidden while the card is thin; on the rare face art the name and banner
 *     rows sit lower, clear of its tab: draftTextNudge), the shine sweep, the dim, the flash, the glow stroke in the
 *     card's colour (its rarity's, boon.evolved or boon.duo) and the uiAccent selection
 *     stroke (only once settled). With the art, the dim is the current surface's own sliced image tinted dark (its
 *     exact silhouette), and the shine, flash, glow and selection are drawn on the surface's opaque body box
 *     (draftBodyBox, rounded by a UICorner), never as a rectangle over the art's transparent corners: ImageColor3 only
 *     multiplies, so a white silhouette of the art for the flash would need a baked mask (like the eyes). Without the
 *     art every overlay covers the whole card, as before; the flat outlines hide while the card is a sliver.
 *   - tap / click (`onTap`): a see-through button over the card takes a touch tap or a mouse click (during the reveal it
 *     skips: InputController); a click's mouse press never reaches the sim as the confirm (InputController.sample).
 */
function DraftCard(props: { index: number; onTap?: () => void }) {
	const ui = DRAFT_UI.cards[props.index];
	const look = useMemo(() => {
		const beat = ui.beat.binding;
		const tone = ui.tone.binding;
		const model = ui.model.binding;
		const panelText = role("uiText");
		const pack = themePack();
		const hasArt = (s: DraftSurface) => pack?.image(draftSurfaceImageId(s)) !== undefined;
		const rareArt = hasArt("rare");
		const box = ui.surface.binding.map((s): DraftBodyBox => draftBodyBox(s, hasArt(s)));
		const isSurface = new Map<DraftSurface, React.Binding<boolean>>();
		for (const s of SURFACES)
			isSurface.set(
				s,
				ui.surface.binding.map((cur) => cur === s),
			);
		return {
			boxPosition: box.map((b) => UDim2.fromOffset(b.left, b.top)),
			boxSize: box.map((b) => new UDim2(1, -(b.left + b.right), 1, -(b.top + b.bottom))),
			boxCorner: box.map((b) => new UDim(0, b.corner)),
			isSurface,
			nameNudge: beat.map((r) => draftTextNudge(r, rareArt).name),
			rarityNudge: beat.map((r) => draftTextNudge(r, rareArt).rarity),
			common: beat.map((r) => r === DraftBeat.COMMON),
			rare: beat.map((r) => r !== DraftBeat.COMMON),
			legendary: beat.map((r) => r === DraftBeat.LEGENDARY),
			color: tone.map(toneColor),
			flashColor: tone.map((t) => panelText.Lerp(toneColor(t), DRAFT_REVEAL_VIEW.flashRarityMix)),
			// docs/BUILDS.md BU9: what the card shows for its kind (shared/view/hud draftCardModel).
			name: model.map((m) => (m !== undefined ? hudText(m.name) : "")),
			nameColor: model.map((m) => toneColor(m?.tone ?? "common")),
			desc: model.map((m) => (m !== undefined ? hudText(m.desc) : "")),
			descSize: model.map(
				(m) => new UDim2(INSET, 0, m?.was !== undefined ? DESC_HEIGHT_WITH_WAS : DESC_HEIGHT, 0),
			),
			was: model.map((m) => (m?.was !== undefined ? hudText(m.was) : "")),
			shineVisible: ui.shine.binding.map((u) => u >= 0),
			shineOffset: ui.shine.binding.map((u) => new Vector2(draftShineOffset(u), 0)),
			band: shineBand(),
			eyes: eyeColor(),
		};
	}, [ui]);
	const v = PROGRESSION_VIEW;
	const dim = role("uiTextDim");
	return (
		<frame
			LayoutOrder={props.index + 1}
			Size={new UDim2(0, v.cardWidth, 0, v.cardHeight)}
			BackgroundTransparency={HIDDEN}
			Visible={ui.shown.binding}
			ZIndex={ui.z.binding}
		>
			<frame
				key="Body"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={ui.position.binding}
				Size={ui.size.binding}
				BackgroundTransparency={HIDDEN}
				ZIndex={SLOT_Z.body}
			>
				<uiscale Scale={ui.scale.binding} />
				<SlicedImage
					id={DRAFT_SKIN.back}
					name="Back"
					transparency={ui.backT.binding}
					zIndex={BODY_Z.back}
					fallback={
						<FlatLayer
							key="Back"
							z={BODY_Z.back}
							fill={ui.backFillT.binding}
							stroke={ui.backStrokeT.binding}
							color={dim}
						/>
					}
				/>
				{/* The eyes light the back's skull sockets: only over the back art (never red sockets on the flat card). */}
				{themePack()?.image(DRAFT_SKIN.back) !== undefined ? (
					<SlicedImage
						id={DRAFT_SKIN.backEyes}
						name="Eyes"
						color={look.eyes}
						transparency={ui.eyesT.binding}
						zIndex={BODY_Z.eyes}
					/>
				) : undefined}
				<SlicedImage
					id={DRAFT_SKIN.common}
					name="FaceCommon"
					transparency={ui.faceT.binding}
					visible={look.common}
					zIndex={BODY_Z.face}
					fallback={
						<FlatLayer
							key="FaceCommon"
							z={BODY_Z.face}
							fill={ui.faceFillT.binding}
							stroke={ui.faceT.binding}
							color={look.color}
							visible={look.common}
						/>
					}
				/>
				<SlicedImage
					id={DRAFT_SKIN.rare}
					name="FaceRare"
					transparency={ui.faceT.binding}
					visible={look.rare}
					zIndex={BODY_Z.face}
					fallback={
						<FlatLayer
							key="FaceRare"
							z={BODY_Z.face}
							fill={ui.faceFillT.binding}
							stroke={ui.faceT.binding}
							color={look.color}
							visible={look.rare}
						/>
					}
				/>
				<Skull key="SkullLeft" side="left" ui={ui} visible={look.legendary} />
				<Skull key="SkullRight" side="right" ui={ui} visible={look.legendary} />
				<CardText
					key="Name"
					top={NAME_TOP}
					nudge={look.nameNudge}
					height={new UDim2(INSET, 0, 0, HUD_VIEW.titleText)}
					size={HUD_VIEW.titleText}
					text={look.name}
					color={look.nameColor}
					transparency={ui.textT.binding}
				/>
				<BannerRow key="Banner" ui={ui} nudge={look.rarityNudge} />
				<CardText
					key="Desc"
					top={DESC_TOP}
					height={look.descSize}
					size={HUD_VIEW.smallText}
					text={look.desc}
					color={role("uiText")}
					transparency={ui.textT.binding}
					wrap={true}
				/>
				<CardText
					key="Was"
					top={WAS_TOP}
					height={new UDim2(INSET, 0, 0, HUD_VIEW.smallText)}
					size={HUD_VIEW.smallText}
					text={look.was}
					color={dim}
					transparency={ui.textT.binding}
				/>
				<frame
					key="Shine"
					Position={look.boxPosition}
					Size={look.boxSize}
					BackgroundColor3={role("uiText")}
					BorderSizePixel={0}
					Visible={look.shineVisible}
					ZIndex={BODY_Z.shine}
				>
					<uicorner CornerRadius={look.boxCorner} />
					<uigradient
						Transparency={look.band}
						Rotation={DRAFT_REVEAL_VIEW.shine.rotationDeg}
						Offset={look.shineOffset}
					/>
				</frame>
				<frame key="Dim" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={HIDDEN} ZIndex={BODY_Z.dim}>
					{SURFACES.map((surface) => (
						<SlicedImage
							key={`Dim_${surface}`}
							id={draftSurfaceImageId(surface)}
							name={`Dim_${surface}`}
							color={role("background")}
							transparency={ui.dimT.binding}
							visible={look.isSurface.get(surface)}
							fallback={
								<frame
									key={`Dim_${surface}`}
									Size={UDim2.fromScale(1, 1)}
									BackgroundColor3={role("background")}
									BackgroundTransparency={ui.dimT.binding}
									BorderSizePixel={0}
									Visible={look.isSurface.get(surface)}
								/>
							}
						/>
					))}
				</frame>
				<frame
					key="Flash"
					Position={look.boxPosition}
					Size={look.boxSize}
					BackgroundColor3={look.flashColor}
					BackgroundTransparency={ui.flashT.binding}
					BorderSizePixel={0}
					ZIndex={BODY_Z.flash}
				>
					<uicorner CornerRadius={look.boxCorner} />
				</frame>
				<frame
					key="Glow"
					Position={look.boxPosition}
					Size={look.boxSize}
					BackgroundTransparency={HIDDEN}
					ZIndex={BODY_Z.glow}
				>
					<uicorner CornerRadius={look.boxCorner} />
					<uistroke
						ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
						Thickness={DRAFT_REVEAL_VIEW.glowStroke}
						Color={look.color}
						Transparency={ui.glowT.binding}
					/>
				</frame>
				<frame
					key="Selected"
					Position={look.boxPosition}
					Size={look.boxSize}
					BackgroundTransparency={HIDDEN}
					Visible={ui.selected.binding}
					ZIndex={BODY_Z.select}
				>
					<uicorner CornerRadius={look.boxCorner} />
					<uistroke
						ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
						Thickness={v.selectedStroke}
						Color={role("uiAccent")}
					/>
				</frame>
			</frame>
			{props.onTap !== undefined ? (
				<textbutton
					key="Tap"
					Size={UDim2.fromScale(1, 1)}
					BackgroundTransparency={HIDDEN}
					AutoButtonColor={false}
					Selectable={false}
					Text=""
					ZIndex={SLOT_Z.tap}
					Event={{ Activated: props.onTap }}
				/>
			) : undefined}
		</frame>
	);
}

/**
 * One slot's ray rings (the legendary's burst and halo, DraftRays) on the row's ray layer, centred where the slot's
 * card sits in the row (DRAFT_UI rayX, shared/view/hud draftSlotOffsetX), so they pass behind every card.
 */
function SlotRays(props: { index: number }) {
	const ui = DRAFT_UI.cards[props.index];
	const look = useMemo(
		() => ({
			position: joinBindings({ x: ui.rayX.binding, y: ui.rayY.binding }).map(
				({ x, y }) => new UDim2(HALF, x, HALF, y),
			),
			// The legendary beat's rays in the card's colour: gold, or boon.evolved / boon.duo (docs/BUILDS.md BU9).
			gold: ui.tone.binding.map(toneColor),
		}),
		[ui],
	);
	return (
		<frame
			AnchorPoint={new Vector2(HALF, HALF)}
			Position={look.position}
			Size={new UDim2()}
			BackgroundTransparency={HIDDEN}
			Visible={ui.shown.binding}
		>
			<DraftRays
				key="Burst"
				color={look.gold}
				visible={ui.burstVisible.binding}
				transparency={ui.burstT.binding}
				scale={ui.burstScale.binding}
				rotation={ui.rayAngle.binding}
				zIndex={1}
			/>
			<DraftRays
				key="Halo"
				color={look.gold}
				visible={ui.haloVisible.binding}
				transparency={ui.haloT.binding}
				scale={1}
				rotation={ui.rayAngle.binding}
				zIndex={1}
			/>
		</frame>
	);
}

/** A full draft's cards with the row's gaps between them, plus the panel's padding on both sides. */
const SIDES = 2;
const DRAFT_ROW_WIDTH = PROGRESSION_VIEW.cardWidth * DRAFT_OFFER_COUNT + HUD_VIEW.gap * (DRAFT_OFFER_COUNT - 1);
const DRAFT_CARDS_WIDTH = DRAFT_ROW_WIDTH + PROGRESSION_VIEW.cardGap * SIDES;
/** Upright (docs/PORTRAIT.md PT7): the cards in a column, one card wide. */
const DRAFT_COLUMN_HEIGHT = PROGRESSION_VIEW.cardHeight * DRAFT_OFFER_COUNT + HUD_VIEW.gap * (DRAFT_OFFER_COUNT - 1);
const DRAFT_COLUMN_PANEL_WIDTH = PROGRESSION_VIEW.cardWidth + PROGRESSION_VIEW.cardGap * SIDES;

/** Co-op: "waiting for N teammates" while others still choose (the world stays frozen until all confirmed). */
function WaitingLine(props: { order: number; count: number; transparency?: React.Binding<number> }) {
	return (
		<Text
			fill={true}
			order={props.order}
			size={HUD_VIEW.smallText}
			color="uiTextDim"
			align={Enum.TextXAlignment.Center}
			text={str(PROGRESSION_STRINGS.draftWaiting, { count: props.count })}
			transparency={props.transparency}
		/>
	);
}

const NOT_VISIBLE = DRAFT_UI.visible.binding.map((v) => !v);
/** The "Pick again" line's box over its text size (primitives Text's line slack). */
const AGAIN_SLACK = 4;

/**
 * Centre, M2 boon draft (endless runs and the tutorial's floor 2 draft, the world frozen) with its reveal
 * (docs/DRAFT_REVEAL.md DR5): the LOCAL player's offered cards left to right, dealt face down and flipped one by one by
 * DraftRevealController, which writes every per-frame value (DRAFT_UI), including which boons the slots show: the
 * overlay stays mounted from the controller's copy of the offers through the pick's stamp and exit fade (the
 * snapshot's draft is already closed then) and hides when the reveal is done. The selection (uiAccent stroke, 1.06x)
 * shows only once the reveal settled; the hint reads "wait" until settled and the sim's draftReady (DRAFT_UI.hintReady),
 * then the device-aware key hint. Builds (docs/BUILDS.md BU9): each card shows its kind (BannerRow: rarity, level and
 * pips, EVOLVE, the duo's joined chip; an Upgrade's "was" line; the evolved / duo colours) and the boss double draft's
 * re-deal shows "Pick again" under the title (DRAFT_UI.again). The title is DRAFT_UI.titleKey's (docs/FORTUNE.md FO7:
 * Greed's Legendary deal reads PACT OF GREED). Co-op: a "waiting for N teammates" line under the cards while others still choose,
 * alone once the local reveal is done. Hidden once the tutorial ended (its floor 3 draft is never played). Renders on
 * a device, bindings, tutorial or waiting-count change only, never per frame.
 */
export function DraftOverlay() {
	const hudFont = useHudFont();
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const tutorialEnded = useSelector(selectTutorialEnded);
	const draftOpen = useSelector(selectDraftOpen);
	const waiting = useSelector(selectDraftWaiting);
	const actions = useHudActions();
	const touch = device === "touch";
	const column = usePortrait();
	const panelWidth = column ? DRAFT_COLUMN_PANEL_WIDTH : DRAFT_CARDS_WIDTH;
	const hintText = useMemo(() => {
		const hint = draftHint(bindings, str)[keyDevice(device)];
		const ready = touch
			? str(TOUCH_STRINGS.hintDraft)
			: str(PROGRESSION_STRINGS.draftHint, { left: hint.left, right: hint.right, confirm: hint.confirm });
		const wait = str(PROGRESSION_STRINGS.draftWait);
		return DRAFT_UI.hintReady.binding.map((r) => (r ? ready : wait));
	}, [bindings, device, touch]);
	if (tutorialEnded) return undefined;
	const cards: React.Element[] = [];
	const rays: React.Element[] = [];
	for (let i = 0; i < DRAFT_OFFER_COUNT; i++) {
		// Touch taps and mouse clicks pick the card; a gamepad never focuses the button (Selectable false).
		cards.push(<DraftCard key={`c${i}`} index={i} onTap={() => actions.draftTap(i)} />);
		rays.push(<SlotRays key={`r${i}`} index={i} />);
	}
	return (
		<>
			<Panel
				key="Draft"
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				width={panelWidth}
				align={Enum.HorizontalAlignment.Center}
				padding={PROGRESSION_VIEW.cardGap}
				transparency={DRAFT_UI.panelT.binding}
				visible={DRAFT_UI.visible.binding}
				name="Draft"
				skin="none"
			>
				<Text
					fill={true}
					order={1}
					size={HUD_VIEW.bigText}
					align={Enum.TextXAlignment.Center}
					text={DRAFT_UI.titleKey.binding.map((key) => str(key))}
					transparency={DRAFT_UI.titleT.binding}
				/>
				<textlabel
					key="Again"
					LayoutOrder={2}
					Size={new UDim2(1, 0, 0, HUD_VIEW.textSize + AGAIN_SLACK)}
					BackgroundTransparency={HIDDEN}
					Font={hudFont}
					TextSize={HUD_VIEW.textSize}
					TextColor3={role("uiAccent")}
					TextStrokeColor3={role("background")}
					TextStrokeTransparency={DRAFT_UI.titleT.binding.map((t) => math.max(t, HUD_VIEW.panelTransparency))}
					TextTransparency={DRAFT_UI.titleT.binding}
					Text={str(PROGRESSION_STRINGS.draftAgain)}
					Visible={DRAFT_UI.again.binding}
				/>
				<frame
					key="CardRow"
					LayoutOrder={3}
					Size={
						column
							? UDim2.fromOffset(PROGRESSION_VIEW.cardWidth, DRAFT_COLUMN_HEIGHT)
							: UDim2.fromOffset(DRAFT_ROW_WIDTH, PROGRESSION_VIEW.cardHeight)
					}
					BackgroundTransparency={HIDDEN}
				>
					<frame key="Rays" Size={UDim2.fromScale(1, 1)} BackgroundTransparency={HIDDEN} ZIndex={ROW_Z.rays}>
						{rays}
					</frame>
					<frame
						key="Cards"
						Size={UDim2.fromScale(1, 1)}
						BackgroundTransparency={HIDDEN}
						ZIndex={ROW_Z.cards}
					>
						<uilistlayout
							FillDirection={column ? Enum.FillDirection.Vertical : Enum.FillDirection.Horizontal}
							HorizontalAlignment={Enum.HorizontalAlignment.Center}
							VerticalAlignment={Enum.VerticalAlignment.Center}
							SortOrder={Enum.SortOrder.LayoutOrder}
							Padding={new UDim(0, HUD_VIEW.gap)}
						/>
						{cards}
					</frame>
				</frame>
				<Text
					fill={true}
					order={4}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					text={hintText}
					transparency={DRAFT_UI.hintT.binding}
				/>
				{waiting > 0 ? (
					<WaitingLine order={5} count={waiting} transparency={DRAFT_UI.hintT.binding} />
				) : undefined}
			</Panel>
			{!draftOpen && waiting > 0 ? (
				<Panel
					key="DraftWaiting"
					position={UDim2.fromScale(HALF, HALF)}
					anchor={new Vector2(HALF, HALF)}
					width={panelWidth}
					align={Enum.HorizontalAlignment.Center}
					padding={PROGRESSION_VIEW.cardGap}
					visible={NOT_VISIBLE}
					name="DraftWaiting"
					skin="none"
				>
					<WaitingLine order={1} count={waiting} />
				</Panel>
			) : undefined}
		</>
	);
}
