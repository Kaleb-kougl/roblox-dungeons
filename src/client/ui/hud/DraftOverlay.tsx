import React, { useMemo } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectTutorialEnded, type GameState } from "client/store";
import { draftHint, keyDevice } from "shared/play";
import { HUD_FONT, role, str, themePack } from "client/ui/theme";
import { BOONS, DRAFT_OFFER_COUNT, Rarity, type RarityId } from "shared/sim";
import {
	DRAFT_REVEAL_VIEW,
	DRAFT_SKIN,
	HUD_VIEW,
	PROGRESSION_STRINGS,
	PROGRESSION_VIEW,
	TOUCH_STRINGS,
	draftBodyBox,
	draftShineOffset,
	draftSkullPlacement,
	draftSurfaceImageId,
	draftTextNudge,
	itemDescKey,
	itemNameKey,
	rarityColorRole,
	rarityNameKey,
	type DraftBodyBox,
	type DraftSurface,
} from "shared/view/hud";
import { useHudActions } from "./actions";
import { DraftRays } from "./DraftRays";
import { DRAFT_UI, type DraftCardUi } from "./draftUi";
import { Panel, SlicedImage, Text } from "./primitives";

const HALF = 0.5;
const HIDDEN = 1;
const NAME_TOP = 0.08;
const RARITY_TOP = 0.3;
const DESC_TOP = 0.48;
const DESC_HEIGHT = 0.46;
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

function boonOf(b: number) {
	return b >= 0 ? BOONS[b] : undefined;
}

function rarityColor(r: RarityId): Color3 {
	return role(rarityColorRole(r));
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
	height: UDim2;
	size: number;
	text: React.Binding<string>;
	color: Color3 | React.Binding<Color3>;
	transparency: React.Binding<number>;
	wrap?: boolean;
}) {
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
			Font={HUD_FONT}
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
 * One offered boon's slot (docs/DRAFT_REVEAL.md DR5), by offer index: everything it draws is a DRAFT_UI binding
 * (DraftRevealController writes them per frame), so it renders once. The slot is a fixed 240 x 150 layout box (its
 * ray rings are on the row's ray layer, SlotRays); inside:
 *   - the body, the flip holder: centred (AnchorPoint 0.5), its width factor and offsets (tremble, rise, drop) and its
 *     UIScale (pop * stamp * the selected scale) from bindings. Bottom to top: the back (`ui.draft.back` 9-sliced, or a
 *     flat uiPanel card with a dim outline: every back looks the same), the back's red eyes (`ui.draft.back.eyes`, same
 *     size and slice, tinted), the face (`ui.draft.card.common`, or `ui.draft.card.rare` for rare and legendary; else
 *     the flat card with the rarity stroke), the legendary skulls, the name (real boon's rarity colour) / rarity /
 *     effect rows (hidden while the card is thin; on the rare face art the name and rarity rows sit lower, clear of
 *     its tab: draftTextNudge), the shine sweep, the dim, the flash, the rarity glow stroke and the uiAccent selection
 *     stroke (only once settled). With the art, the dim is the current surface's own sliced image tinted dark (its
 *     exact silhouette), and the shine, flash, glow and selection are drawn on the surface's opaque body box
 *     (draftBodyBox, rounded by a UICorner), never as a rectangle over the art's transparent corners: ImageColor3 only
 *     multiplies, so a white silhouette of the art for the flash would need a baked mask (like the eyes). Without the
 *     art every overlay covers the whole card, as before; the flat outlines hide while the card is a sliver.
 *   - touch (`onTap`): a see-through button over the card takes the tap (during the reveal it skips: InputController).
 */
function DraftCard(props: { index: number; onTap?: () => void }) {
	const ui = DRAFT_UI.cards[props.index];
	const look = useMemo(() => {
		const rarity = ui.rarity.binding;
		const boon = ui.boon.binding;
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
			nameNudge: rarity.map((r) => draftTextNudge(r, rareArt).name),
			rarityNudge: rarity.map((r) => draftTextNudge(r, rareArt).rarity),
			common: rarity.map((r) => r === Rarity.COMMON),
			rare: rarity.map((r) => r !== Rarity.COMMON),
			legendary: rarity.map((r) => r === Rarity.LEGENDARY),
			color: rarity.map(rarityColor),
			flashColor: rarity.map((r) => panelText.Lerp(rarityColor(r), DRAFT_REVEAL_VIEW.flashRarityMix)),
			name: boon.map((b) => {
				const def = boonOf(b);
				return def !== undefined ? str(itemNameKey(def.id)) : "";
			}),
			nameColor: boon.map((b) => rarityColor(boonOf(b)?.rarity ?? Rarity.COMMON)),
			rarityName: boon.map((b) => {
				const def = boonOf(b);
				return def !== undefined ? str(rarityNameKey(def.rarity)) : "";
			}),
			desc: boon.map((b) => {
				const def = boonOf(b);
				return def !== undefined ? str(itemDescKey(def.id)) : "";
			}),
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
				<CardText
					key="Rarity"
					top={RARITY_TOP}
					nudge={look.rarityNudge}
					height={new UDim2(INSET, 0, 0, HUD_VIEW.smallText)}
					size={HUD_VIEW.smallText}
					text={look.rarityName}
					color={dim}
					transparency={ui.textT.binding}
				/>
				<CardText
					key="Desc"
					top={DESC_TOP}
					height={new UDim2(INSET, 0, DESC_HEIGHT, 0)}
					size={HUD_VIEW.smallText}
					text={look.desc}
					color={role("uiText")}
					transparency={ui.textT.binding}
					wrap={true}
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
			position: ui.rayX.binding.map((x) => new UDim2(HALF, x, HALF, 0)),
			gold: rarityColor(Rarity.LEGENDARY),
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

/**
 * Centre, M2 boon draft (endless runs and the tutorial's floor 2 draft, the world frozen) with its reveal
 * (docs/DRAFT_REVEAL.md DR5): the LOCAL player's offered cards left to right, dealt face down and flipped one by one by
 * DraftRevealController, which writes every per-frame value (DRAFT_UI), including which boons the slots show: the
 * overlay stays mounted from the controller's copy of the offers through the pick's stamp and exit fade (the
 * snapshot's draft is already closed then) and hides when the reveal is done. The selection (uiAccent stroke, 1.06x)
 * shows only once the reveal settled; the hint reads "wait" until settled and the sim's draftReady (DRAFT_UI.hintReady),
 * then the device-aware key hint. Co-op: a "waiting for N teammates" line under the cards while others still choose,
 * alone once the local reveal is done. Hidden once the tutorial ended (its floor 3 draft is never played). Renders on
 * a device, bindings, tutorial or waiting-count change only, never per frame.
 */
export function DraftOverlay() {
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const tutorialEnded = useSelector(selectTutorialEnded);
	const draftOpen = useSelector(selectDraftOpen);
	const waiting = useSelector(selectDraftWaiting);
	const actions = useHudActions();
	const touch = device === "touch";
	const hintText = useMemo(() => {
		const hint = draftHint(bindings)[keyDevice(device)];
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
		cards.push(<DraftCard key={`c${i}`} index={i} onTap={touch ? () => actions.draftTap(i) : undefined} />);
		rays.push(<SlotRays key={`r${i}`} index={i} />);
	}
	return (
		<>
			<Panel
				key="Draft"
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				width={DRAFT_CARDS_WIDTH}
				align={Enum.HorizontalAlignment.Center}
				padding={PROGRESSION_VIEW.cardGap}
				transparency={DRAFT_UI.panelT.binding}
				visible={DRAFT_UI.visible.binding}
				name="Draft"
			>
				<Text
					fill={true}
					order={1}
					size={HUD_VIEW.bigText}
					align={Enum.TextXAlignment.Center}
					text={str(PROGRESSION_STRINGS.draftTitle)}
					transparency={DRAFT_UI.titleT.binding}
				/>
				<frame
					key="CardRow"
					LayoutOrder={2}
					Size={UDim2.fromOffset(DRAFT_ROW_WIDTH, PROGRESSION_VIEW.cardHeight)}
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
							FillDirection={Enum.FillDirection.Horizontal}
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
					order={3}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					text={hintText}
					transparency={DRAFT_UI.hintT.binding}
				/>
				{waiting > 0 ? (
					<WaitingLine order={4} count={waiting} transparency={DRAFT_UI.hintT.binding} />
				) : undefined}
			</Panel>
			{!draftOpen && waiting > 0 ? (
				<Panel
					key="DraftWaiting"
					position={UDim2.fromScale(HALF, HALF)}
					anchor={new Vector2(HALF, HALF)}
					width={DRAFT_CARDS_WIDTH}
					align={Enum.HorizontalAlignment.Center}
					padding={PROGRESSION_VIEW.cardGap}
					visible={NOT_VISIBLE}
					name="DraftWaiting"
				>
					<WaitingLine order={1} count={waiting} />
				</Panel>
			) : undefined}
		</>
	);
}
