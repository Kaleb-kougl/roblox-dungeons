import React, { useBinding, useEffect, useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import { selectCharacterScreen, selectInputDevice, selectJuice } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, MenuFit, PadHintBar, Panel, Row, Text } from "client/ui/hud";
import { role, str, themePack } from "client/ui/theme";
import { keyDevice } from "shared/play";
import { SFX } from "shared/view/audio";
import { CHARACTER_SCREEN_STRINGS, type ColorRole } from "shared/theme";
import { HUD_VIEW } from "shared/view/hud";
import {
	CHARACTER_VIEW,
	MENU_BACK_HINT,
	MENU_STRINGS,
	characterArrangement,
	characterCards,
	characterConfirmKey,
	characterLayout,
	characterPreviewFacing,
	characterPreviewFrame,
	characterPreviewSize,
	screenSkin,
	type CharacterCard,
	type CharacterLayout,
} from "shared/view/menu";
import { useMenuActions } from "./actions";

const HIDDEN = 1;
const HALF = 0.5;
const IDLE = "idle";
const V = CHARACTER_VIEW;

/**
 * A character's idle animation facing the camera, drawn from its theme sprite set (`class.vanguard` / `class.ranger`)
 * and fitted into a `box` square (shared/view/menu characterPreviewFacing / Frame / Size); without a sprite set with
 * an idle animation (the Archer until its art is uploaded, the placeholder pack) the class colour's capsule. The
 * frame is written through a binding on Heartbeat (no re-render per frame); reduced motion holds frame 0.
 */
function CharacterPreview(props: { visualId: string; color: ColorRole; box: number; reducedMotion: boolean }) {
	const set = themePack()?.sprites(props.visualId);
	const idle = set !== undefined && set.has(IDLE) ? set.animation(IDLE) : undefined;
	const [frame, setFrame] = useBinding(0);
	const fps = idle?.fps ?? 0;
	const frames = idle?.frames ?? 0;
	useEffect(() => {
		if (frames <= 1 || props.reducedMotion) {
			setFrame(0);
			return;
		}
		let t = 0;
		const conn = RunService.Heartbeat.Connect((dt) => {
			t += dt;
			setFrame(characterPreviewFrame(t, fps, frames, false));
		});
		return () => conn.Disconnect();
	}, [fps, frames, props.reducedMotion]);
	const box = props.box;
	const outer = (children: React.ReactNode) => (
		<frame key="Preview" LayoutOrder={1} Size={UDim2.fromOffset(box, box)} BackgroundTransparency={HIDDEN}>
			{children}
		</frame>
	);
	if (set === undefined || idle === undefined) {
		return outer(
			<frame
				key="Capsule"
				AnchorPoint={new Vector2(HALF, HALF)}
				Position={UDim2.fromScale(HALF, HALF)}
				Size={UDim2.fromOffset(math.floor(box * V.capsule.w), math.floor(box * V.capsule.h))}
				BackgroundColor3={role(props.color)}
				BorderSizePixel={0}
			>
				<uicorner CornerRadius={new UDim(HALF, 0)} />
				<uistroke Thickness={V.stroke} Color={role("uiTextDim")} />
			</frame>,
		);
	}
	const facing = characterPreviewFacing(set.facings);
	const first = set.frame(IDLE, facing, 0);
	const size = characterPreviewSize(first.size.X, first.size.Y, box);
	return outer(
		<imagelabel
			key="Sprite"
			AnchorPoint={new Vector2(HALF, HALF)}
			Position={UDim2.fromScale(HALF, HALF)}
			Size={UDim2.fromOffset(size.w, size.h)}
			BackgroundTransparency={HIDDEN}
			Image={first.image}
			ImageRectSize={first.size}
			ImageRectOffset={frame.map((i) => set.frame(IDLE, facing, i).offset)}
			ResampleMode={Enum.ResamplerMode[set.resample]}
		/>,
	);
}

/**
 * One card (a selectable button): the preview, the name, the summary lines; the focused card (the pick Start takes)
 * outlined in uiAccent, the other dimmed. A tap or click focuses it; the pad's selection focuses it as it moves and
 * its A confirms it (docs/GAMEPAD_MENUS.md: one press on the pad as on the keyboard's Enter).
 */
function CardButton(props: {
	card: CharacterCard;
	order: number;
	layout: CharacterLayout;
	focused: boolean;
	pad: boolean;
	reducedMotion: boolean;
	buttonRef?: React.Ref<TextButton>;
	/** The pad's selection landed on it. */
	onFocus: () => void;
	/** A tap or click. */
	onTap: () => void;
	onConfirm: () => void;
}) {
	const l = props.layout;
	const inner = l.cardW - 2 * V.cardPad;
	const c = props.card;
	const dim = props.focused ? 0 : V.dimText;
	return (
		<textbutton
			key={`Card_${c.id}`}
			ref={props.buttonRef}
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(l.cardW, l.cardH)}
			AutoButtonColor={false}
			Selectable={true}
			Text=""
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={props.focused ? 0 : HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
			Event={{
				Activated: () => (props.pad ? props.onConfirm() : props.onTap()),
				SelectionGained: () => props.onFocus(),
			}}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={props.focused ? V.focusStroke : V.stroke}
				Color={role(props.focused ? "uiAccent" : "uiTextDim")}
			/>
			<uipadding
				PaddingLeft={new UDim(0, V.cardPad)}
				PaddingRight={new UDim(0, V.cardPad)}
				PaddingTop={new UDim(0, V.cardPad)}
				PaddingBottom={new UDim(0, V.cardPad)}
			/>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			<CharacterPreview
				visualId={c.visualId}
				color={c.role}
				box={l.previewPx}
				reducedMotion={props.reducedMotion}
			/>
			<Text
				order={2}
				width={inner}
				size={HUD_VIEW.titleText}
				color={props.focused ? "uiAccent" : "uiText"}
				align={Enum.TextXAlignment.Center}
				transparency={dim}
				text={str(c.nameKey)}
			/>
			{c.lineKeys.map((key, i) => (
				<Text
					key={`Line${i + 1}`}
					order={3 + i}
					width={inner}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					align={Enum.TextXAlignment.Center}
					wrap={true}
					transparency={dim}
					text={str(key)}
				/>
			))}
		</textbutton>
	);
}

/**
 * The character screen (docs/ARCHER.md AR7 / AR8, "The character screen"; shared/view/menu character.ts): opened before
 * every run started from the menu (MenuController: Play solo, the Daily card, the tutorial outro's Start my first run,
 * the dev panel's Go), by a lobby member's Ready and by the run-over panel's Character. The title, two cards side by
 * side (a column in portrait; smaller previews on a landscape phone), Start (Ready in a lobby) and Back, and the key
 * hint (keyboard) or the pad hint bar (gamepad). The last pick is focused (the store's `menu.character.focus`).
 * Keyboard: arrows / A-D move the focus and Enter / Space confirm (MenuController); mouse / touch: tap a card, then
 * Start; pad: a `screen` focus scope starting on the focused card, the D-pad moves between the cards (each one it lands
 * on is focused), A on a card confirms it, B goes back. Fitted on touch and a console (MenuFit). No timer.
 */
export function CharacterScreen() {
	const actions = useMenuActions();
	const device = useSelector(selectInputDevice);
	const screen = useSelector(selectCharacterScreen);
	const reducedMotion = useSelector(selectJuice).reducedMotion;
	const defaultRef = useRef<TextButton>();
	// The pad starts on the card focused when the screen opened (the last pick).
	const [opened] = useState(() => screen?.focus);
	if (screen === undefined) return undefined;
	const cards = characterCards();
	const pad = device === "gamepad";
	return (
		<FocusScope
			name="CharacterScope"
			id="character"
			layer="screen"
			surface="character"
			defaultRef={defaultRef}
			onPadAction={(action) => {
				if (action.kind === "back") actions.characterBack();
			}}
		>
			<MenuFit
				render={(fit) => {
					const l = characterLayout(characterArrangement(fit.compact, fit.narrow));
					const column = l.arrangement === "column";
					return (
						<Panel
							width={l.panelW}
							padding={V.panelPad}
							align={Enum.HorizontalAlignment.Center}
							skin={screenSkin("character")}
							name="Character"
						>
							<Text
								fill={true}
								order={1}
								size={HUD_VIEW.titleText}
								color="uiAccent"
								align={Enum.TextXAlignment.Center}
								text={str(CHARACTER_SCREEN_STRINGS.title)}
							/>
							<frame
								key="Cards"
								LayoutOrder={2}
								Size={new UDim2()}
								AutomaticSize={Enum.AutomaticSize.XY}
								BackgroundTransparency={HIDDEN}
							>
								<uilistlayout
									FillDirection={column ? Enum.FillDirection.Vertical : Enum.FillDirection.Horizontal}
									HorizontalAlignment={Enum.HorizontalAlignment.Center}
									SortOrder={Enum.SortOrder.LayoutOrder}
									Padding={new UDim(0, V.cardGap)}
								/>
								{cards.map((c, i) => (
									<CardButton
										key={`Card_${c.id}`}
										card={c}
										order={i + 1}
										layout={l}
										focused={screen.focus === c.id}
										pad={pad}
										reducedMotion={reducedMotion}
										buttonRef={c.id === opened ? defaultRef : undefined}
										onFocus={() => actions.focusCharacter(c.id)}
										onTap={() => {
											if (screen.focus !== c.id) actions.playUi(SFX.uiClick);
											actions.focusCharacter(c.id);
										}}
										onConfirm={() => actions.confirmCharacter(c.id)}
									/>
								))}
							</frame>
							<Row order={3} align={Enum.HorizontalAlignment.Center}>
								<MenuButton
									order={1}
									name="Start"
									size={new Vector2(V.startButton.x, V.startButton.y)}
									text={str(characterConfirmKey(screen.origin))}
									onActivated={() => actions.confirmCharacter()}
								/>
								<MenuButton
									order={2}
									name="Back"
									size={new Vector2(V.backButton.x, V.backButton.y)}
									textSize={HUD_VIEW.smallText}
									text={str(MENU_STRINGS.back)}
									onActivated={() => actions.characterBack()}
								/>
							</Row>
							{pad ? (
								<PadHintBar order={4} surface="character" />
							) : device === "touch" ? undefined : (
								<Text
									fill={true}
									order={4}
									size={HUD_VIEW.smallText}
									color="uiTextDim"
									align={Enum.TextXAlignment.Center}
									text={str(MENU_STRINGS.backHint, { key: MENU_BACK_HINT[keyDevice(device)] })}
								/>
							)}
						</Panel>
					);
				}}
			/>
		</FocusScope>
	);
}
