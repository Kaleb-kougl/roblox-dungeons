import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectBindings, selectInputDevice, selectSnapshot, selectTutorialEnded } from "client/store";
import { draftHint } from "shared/play";
import { HUD_FONT, role, str } from "client/ui/theme";
import { BOONS, DRAFT_OFFER_COUNT } from "shared/sim";
import {
	HUD_VIEW,
	PROGRESSION_STRINGS,
	PROGRESSION_VIEW,
	itemDescKey,
	itemNameKey,
	rarityColorRole,
	rarityNameKey,
} from "shared/view/hud";
import { Panel, Row, Text } from "./primitives";

const HALF = 0.5;
const NAME_TOP = 0.08;
const RARITY_TOP = 0.3;
const DESC_TOP = 0.48;
const DESC_HEIGHT = 0.46;
const INSET = 0.92;

/** One offered boon: name (rarity colour), rarity, one-line effect; the card under the stick is highlighted. */
function DraftCard(props: { order: number; boon: number; selected: boolean }) {
	const def = BOONS[props.boon];
	if (def === undefined) return undefined;
	const v = PROGRESSION_VIEW;
	const rarity = rarityColorRole(def.rarity);
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, v.cardWidth, 0, v.cardHeight)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={props.selected ? 0 : HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
		>
			<uiscale Scale={props.selected ? v.selectedScale : 1} />
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={props.selected ? v.selectedStroke : v.cardStroke}
				Color={role(props.selected ? "uiAccent" : rarity)}
			/>
			<textlabel
				AnchorPoint={new Vector2(HALF, 0)}
				Position={new UDim2(HALF, 0, NAME_TOP, 0)}
				Size={new UDim2(INSET, 0, 0, HUD_VIEW.titleText)}
				BackgroundTransparency={1}
				Font={HUD_FONT}
				TextSize={HUD_VIEW.titleText}
				TextColor3={role(rarity)}
				Text={str(itemNameKey(def.id))}
			/>
			<textlabel
				AnchorPoint={new Vector2(HALF, 0)}
				Position={new UDim2(HALF, 0, RARITY_TOP, 0)}
				Size={new UDim2(INSET, 0, 0, HUD_VIEW.smallText)}
				BackgroundTransparency={1}
				Font={HUD_FONT}
				TextSize={HUD_VIEW.smallText}
				TextColor3={role("uiTextDim")}
				Text={str(rarityNameKey(def.rarity))}
			/>
			<textlabel
				AnchorPoint={new Vector2(HALF, 0)}
				Position={new UDim2(HALF, 0, DESC_TOP, 0)}
				Size={new UDim2(INSET, 0, DESC_HEIGHT, 0)}
				BackgroundTransparency={1}
				Font={HUD_FONT}
				TextSize={HUD_VIEW.smallText}
				TextWrapped={true}
				TextYAlignment={Enum.TextYAlignment.Top}
				TextColor3={role("uiText")}
				Text={str(itemDescKey(def.id))}
			/>
		</frame>
	);
}

/** A full draft's cards with the row's gaps between them, plus the panel's padding on both sides. */
const SIDES = 2;
const DRAFT_CARDS_WIDTH =
	PROGRESSION_VIEW.cardWidth * DRAFT_OFFER_COUNT +
	HUD_VIEW.gap * (DRAFT_OFFER_COUNT - 1) +
	PROGRESSION_VIEW.cardGap * SIDES;

/** Co-op: "waiting for N teammates" while others still choose (the world stays frozen until all confirmed). */
function WaitingLine(props: { order: number; count: number }) {
	return (
		<Text
			fill={true}
			order={props.order}
			size={HUD_VIEW.smallText}
			color="uiTextDim"
			align={Enum.TextXAlignment.Center}
			text={str(PROGRESSION_STRINGS.draftWaiting, { count: props.count })}
		/>
	);
}

/**
 * Centre, M2 boon draft (endless runs, the world frozen): the LOCAL player's offered cards left to right (co-op: the
 * snapshot reads the client's player index), the one under the stick highlighted (the snapshot follows the live input
 * every frame while a draft is open), and the device-aware hint; until the draft accepts a confirm
 * (DRAFT_MIN_OPEN_TICKS) the hint reads "wait". Co-op: a "waiting for N teammates" line while others still choose,
 * alone once the local player has confirmed. Hidden once the tutorial ended (its floor 3 draft is never played).
 */
export function DraftOverlay() {
	const s = useSelector(selectSnapshot);
	const device = useSelector(selectInputDevice);
	const bindings = useSelector(selectBindings);
	const tutorialEnded = useSelector(selectTutorialEnded);
	if (tutorialEnded) return undefined;
	if (!s.draftOpen) {
		if (s.draftWaiting <= 0) return undefined;
		return (
			<Panel
				position={UDim2.fromScale(HALF, HALF)}
				anchor={new Vector2(HALF, HALF)}
				width={DRAFT_CARDS_WIDTH}
				align={Enum.HorizontalAlignment.Center}
				padding={PROGRESSION_VIEW.cardGap}
				name="DraftWaiting"
			>
				<WaitingLine order={1} count={s.draftWaiting} />
			</Panel>
		);
	}
	const v = PROGRESSION_VIEW;
	const width = DRAFT_CARDS_WIDTH;
	const hint = draftHint(bindings)[device];
	const cards = s.draftOffers.map((boon, i) => (
		<DraftCard key={`c${i}`} order={i + 1} boon={boon} selected={i === s.draftSelected} />
	));
	return (
		<Panel
			position={UDim2.fromScale(HALF, HALF)}
			anchor={new Vector2(HALF, HALF)}
			width={width}
			align={Enum.HorizontalAlignment.Center}
			padding={v.cardGap}
			name="Draft"
		>
			<Text
				fill={true}
				order={1}
				size={HUD_VIEW.bigText}
				align={Enum.TextXAlignment.Center}
				text={str(PROGRESSION_STRINGS.draftTitle)}
			/>
			<Row order={2} align={Enum.HorizontalAlignment.Center}>
				{cards}
			</Row>
			<Text
				fill={true}
				order={3}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Center}
				text={
					s.draftReady
						? str(PROGRESSION_STRINGS.draftHint, {
								left: hint.left,
								right: hint.right,
								confirm: hint.confirm,
						  })
						: str(PROGRESSION_STRINGS.draftWait)
				}
			/>
			{s.draftWaiting > 0 ? <WaitingLine order={4} count={s.draftWaiting} /> : undefined}
		</Panel>
	);
}
