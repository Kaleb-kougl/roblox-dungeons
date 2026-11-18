import React, { useBinding, useEffect, useRef, useState } from "@rbxts/react";
import { cosmeticLookOf, equippedMapOf } from "shared/cosmetics";
import { dyeForVisual } from "shared/view/cosmetics";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, RunService, UserInputService } from "@rbxts/services";
import { selectCharacterScreen, selectInputDevice, selectJuice, selectWallet, selectWalletState } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, MenuFit, PadHintBar, Panel, Row, SilverAmount, Text } from "client/ui/hud";
import { role, str } from "client/ui/theme";
import { keyDevice } from "shared/play";
import { SFX } from "shared/view/audio";
import { ARMORY_KEYS, CHARACTER_LOCK_KEYS, CHARACTER_SCREEN_STRINGS, SILVER_ROLE } from "shared/theme";
import { statusBalance, walletShown } from "shared/view/silver";
import { characterUnlockId } from "shared/wallet";
import { HUD_VIEW } from "shared/view/hud";
import {
	CHARACTER_VIEW,
	MENU_BACK_HINT,
	MENU_STRINGS,
	characterArrangement,
	characterCards,
	characterConfirmKey,
	characterLayout,
	screenSkin,
	type CharacterCard,
	type CharacterLayout,
	BuyHold,
	characterLockState,
	characterPickAllowed,
	offeredCharacters,
	upgradesLine,
	type CharacterLockState,
} from "shared/view/menu";
import { useMenuActions } from "./actions";
import { CharacterPreview } from "./CharacterPreview";

const HIDDEN = 1;
const V = CHARACTER_VIEW;
/** Between the item labels of the upgrades line. */
const UPGRADES_SEPARATOR = " · ";

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
	/** docs/SILVER.md SV18: the card's lock (open / locked / unavailable) and the upgrades line under it. */
	lock: CharacterLockState;
	upgrades: string;
	/** The card was just bought in this visit (it lights). */
	lit: boolean;
	/** docs/COSMETICS.md CS6: the character's equipped dye (drawn once its sheet has downloaded). */
	dyeItem: string | undefined;
	onBuy: (itemId: string) => void;
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
				dim={props.lock.kind === "open" ? 0 : V.lockedArtTransparency}
				dyeItem={props.dyeItem}
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
			<LockRow key="Lock" order={3 + c.lineKeys.size()} width={inner} lock={props.lock} onBuy={props.onBuy} />
			<Text
				key="Upgrades"
				order={4 + c.lineKeys.size()}
				width={inner}
				size={HUD_VIEW.smallText}
				color={SILVER_ROLE}
				align={Enum.TextXAlignment.Center}
				transparency={dim}
				text={props.upgrades}
			/>
			{props.lit ? (
				<uistroke
					key="Lit"
					ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
					Thickness={V.focusStroke}
					Color={role(SILVER_ROLE)}
				/>
			) : undefined}
		</textbutton>
	);
}

/**
 * docs/SILVER.md SV18: a card's lock row, always its room (the cards stay one size): nothing for an open card; for a
 * locked one the `Unlock 300` hold button when the balance covers it (0.4 s, mouse / touch / the pad's A: BuyHold,
 * then the wallet's push answers with sfx.shop.buy), else `Unlock 300` and `Need 140 more`.
 */
function LockRow(props: { order: number; width: number; lock: CharacterLockState; onBuy: (itemId: string) => void }) {
	const lock = props.lock;
	const ref = useRef<TextButton>();
	const hold = useRef(new BuyHold());
	const [fill, setFill] = useBinding(0);
	const itemId = lock.kind === "locked" && lock.canBuy ? lock.itemId : undefined;
	useEffect(() => {
		if (itemId === undefined) return;
		const conns = new Array<RBXScriptConnection>();
		const button = ref.current;
		const begin = () => hold.current.press(os.clock());
		const finish = () => hold.current.release();
		if (button !== undefined) {
			conns.push(
				button.InputBegan.Connect((input) => {
					const t = input.UserInputType;
					if (t === Enum.UserInputType.MouseButton1 || t === Enum.UserInputType.Touch) begin();
				}),
			);
			conns.push(button.InputEnded.Connect(finish));
			conns.push(button.MouseLeave.Connect(finish));
		}
		conns.push(
			UserInputService.InputBegan.Connect((input) => {
				if (input.KeyCode === Enum.KeyCode.ButtonA && GuiService.SelectedObject === ref.current) begin();
			}),
		);
		conns.push(
			UserInputService.InputEnded.Connect((input) => {
				if (input.KeyCode === Enum.KeyCode.ButtonA) finish();
			}),
		);
		conns.push(
			RunService.Heartbeat.Connect(() => {
				const now = os.clock();
				const step = hold.current.step(now);
				setFill(hold.current.progress(now));
				if (step === "complete") {
					hold.current.release();
					setFill(0);
					props.onBuy(itemId);
				}
			}),
		);
		return () => {
			for (const c of conns) c.Disconnect();
		};
	}, [itemId]);
	const h = V.lockRow;
	let body: React.Element | undefined;
	if (lock.kind === "locked" && lock.canBuy) {
		body = (
			<MenuButton
				ref={ref}
				order={1}
				name="Unlock"
				size={new Vector2(math.min(props.width, V.startButton.x), h)}
				textSize={HUD_VIEW.smallText}
				text={str(CHARACTER_LOCK_KEYS.unlock, { price: lock.price })}
				fill={fill}
				onActivated={() => undefined}
			/>
		);
	} else if (lock.kind === "locked") {
		body = (
			<Row order={1} align={Enum.HorizontalAlignment.Center}>
				<SilverAmount
					order={1}
					size={HUD_VIEW.smallText}
					text={str(CHARACTER_LOCK_KEYS.unlock, { price: lock.price })}
				/>
				<Text
					order={2}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					text={str(CHARACTER_LOCK_KEYS.need, { silver: lock.need })}
				/>
			</Row>
		);
	}
	return (
		<frame
			key="LockRow"
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(props.width, h)}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{body}
		</frame>
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
	// docs/SILVER.md SV18: the wallet (locks, the balance, the upgrades line) and a card bought in this visit.
	const wallet = useSelector(selectWallet);
	const walletState = useSelector(selectWalletState);
	const [litId, setLitId] = useState<string | undefined>(undefined);
	const resultSeen = useRef(walletState.resultVersion);
	useEffect(() => {
		if (walletState.resultVersion === resultSeen.current) return;
		resultSeen.current = walletState.resultVersion;
		const r = walletState.result;
		if (r !== undefined && r.action === "buy" && r.ok) setLitId(r.itemId);
	}, [walletState.resultVersion]);
	const defaultRef = useRef<TextButton>();
	// The pad starts on the card focused when the screen opened (the last pick).
	const [opened] = useState(() => screen?.focus);
	if (screen === undefined) return undefined;
	const offered = offeredCharacters(wallet);
	const cards = characterCards().filter((c) => offered.includes(c.id));
	const upgrades = upgradesLine(wallet, str, UPGRADES_SEPARATOR);
	const focusLocked = !characterPickAllowed(screen.focus, wallet);
	const pad = device === "gamepad";
	// docs/COSMETICS.md CS6: each card's character wears its equipped dye.
	const equipped = wallet !== undefined && wallet.loaded ? equippedMapOf(wallet.equipped) : undefined;
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
							{/* docs/SILVER.md SV18: beside the title, the balance or that only the Knight can be offered. */}
							<Row key="Title" order={1} align={Enum.HorizontalAlignment.Center}>
								<Text
									order={1}
									size={HUD_VIEW.titleText}
									color="uiAccent"
									text={str(CHARACTER_SCREEN_STRINGS.title)}
								/>
								{walletShown(wallet) === "loaded" ? (
									<SilverAmount
										order={2}
										size={HUD_VIEW.smallText}
										text={str(ARMORY_KEYS.balance, { silver: statusBalance(wallet) })}
									/>
								) : (
									<Text
										order={2}
										size={HUD_VIEW.smallText}
										color="uiTextDim"
										text={str(CHARACTER_LOCK_KEYS.unavailable)}
									/>
								)}
							</Row>
							<frame
								key="Cards"
								LayoutOrder={3}
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
										lock={characterLockState(c.id, wallet)}
										upgrades={upgrades}
										lit={litId !== undefined && litId === characterUnlockId(c.id)}
										dyeItem={dyeForVisual(cosmeticLookOf(equipped, c.id), c.visualId)}
										onBuy={(itemId) => {
											if (actions.armoryBuy(itemId)) actions.playUi(SFX.uiConfirm);
										}}
									/>
								))}
							</frame>
							<Row order={4} align={Enum.HorizontalAlignment.Center}>
								<MenuButton
									order={1}
									name="Start"
									size={new Vector2(V.startButton.x, V.startButton.y)}
									text={str(characterConfirmKey(screen.origin))}
									disabled={focusLocked}
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
								<PadHintBar order={5} surface="character" />
							) : device === "touch" ? undefined : (
								<Text
									fill={true}
									order={5}
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
