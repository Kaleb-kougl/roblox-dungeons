import React, { useBinding, useEffect, useRef, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, RunService, UserInputService } from "@rbxts/services";
import { selectInputDevice, selectWallet, selectWalletState } from "client/store";
import { FocusScope } from "client/ui/focus";
import { MenuButton, MenuFit, PadHintBar, Panel, Row, SilverAmount, Text, type MenuLayout } from "client/ui/hud";
import { role, str } from "client/ui/theme";
import { keyDevice } from "shared/play";
import { ARMORY_KEYS, SILVER_ROLE } from "shared/theme";
import { SFX } from "shared/view/audio";
import { HUD_VIEW } from "shared/view/hud";
import {
	ARMORY_SCREEN,
	ARMORY_TABS,
	BuyHold,
	MENU_BACK_HINT,
	MENU_STRINGS,
	MENU_VIEW,
	affordableKeys,
	armoryDetail,
	armoryPips,
	armoryRows,
	armoryTabKey,
	screenSkin,
	stepTab,
	tabStep,
	type ArmoryDetail,
	type ArmoryRow,
	type ArmoryTab,
} from "shared/view/menu";
import { SILVER_SHOP, armoryItemLabel, statusBalance, walletShown } from "shared/view/silver";
import { useMenuActions } from "./actions";
import { SilverBalance } from "./SilverBalance";

const HIDDEN = 1;
const STROKE = 1;
const FOCUS_STROKE = 2;
const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);
const S = ARMORY_SCREEN;

interface ArmorySizes {
	readonly width: number;
	readonly listWidth: number;
	readonly detailWidth: number;
	readonly narrow: boolean;
}

function sizesOf(layout: MenuLayout): ArmorySizes {
	if (layout.narrow) {
		const inner = S.narrowWidth - 2 * S.pad;
		return { width: S.narrowWidth, listWidth: inner, detailWidth: inner, narrow: true };
	}
	const width = layout.compact ? S.compactWidth : S.width;
	const list = layout.compact ? S.compactListWidth : S.listWidth;
	return { width, listWidth: list, detailWidth: width - 2 * S.pad - list - S.detailGap, narrow: false };
}

/** A row's level pips (upgrades): filled for each level owned. */
function Pips(props: { order: number; pips: ReadonlyArray<boolean> }) {
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2()}
			AutomaticSize={Enum.AutomaticSize.XY}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap / 2)}
			/>
			{props.pips.map((on, i) => (
				<frame
					key={`Pip${i}`}
					LayoutOrder={i + 1}
					Size={UDim2.fromOffset(S.pip, S.pip)}
					BackgroundColor3={role(on ? SILVER_ROLE : "uiPanel")}
					BorderSizePixel={0}
				>
					<uistroke Thickness={STROKE} Color={role("uiTextDim")} />
				</frame>
			))}
		</frame>
	);
}

/** One row of the list: the item at its next level, its pips and mark on the left, its price or `to go` right. */
function ItemRow(props: {
	row: ArmoryRow;
	order: number;
	width: number;
	focused: boolean;
	rowRef?: React.Ref<TextButton>;
	onFocus: () => void;
}) {
	const r = props.row;
	const level = r.nextTier !== undefined ? r.level + 1 : r.maxLevel;
	const name = armoryItemLabel(r.itemId, level, str);
	const mark = r.mark === "next" ? str(ARMORY_KEYS.markNext) : r.mark === "after" ? str(ARMORY_KEYS.markAfter) : "";
	const right =
		r.state === "maxed"
			? str(ARMORY_KEYS.maxed)
			: r.state === "owned"
			? str(ARMORY_KEYS.owned)
			: r.state === "unavailable"
			? ""
			: r.state === "poor"
			? str(ARMORY_KEYS.toGo, { silver: r.toGo })
			: tostring(r.price ?? 0);
	const inner = props.width - 2 * HUD_VIEW.pad;
	return (
		<textbutton
			ref={props.rowRef}
			key={r.itemId}
			LayoutOrder={props.order}
			Size={UDim2.fromOffset(props.width, S.rowHeight)}
			AutoButtonColor={false}
			Selectable={true}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={props.focused ? 0 : HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
			Text=""
			Event={{
				Activated: () => props.onFocus(),
				MouseEnter: () => props.onFocus(),
				SelectionGained: () => props.onFocus(),
			}}
		>
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={props.focused ? FOCUS_STROKE : STROKE}
				Color={role(props.focused ? "uiAccent" : r.mark !== undefined ? SILVER_ROLE : "uiTextDim")}
			/>
			<uipadding PaddingLeft={new UDim(0, HUD_VIEW.pad)} PaddingRight={new UDim(0, HUD_VIEW.pad)} />
			<frame Size={UDim2.fromScale(1, 1)} BackgroundTransparency={HIDDEN}>
				<uilistlayout
					FillDirection={Enum.FillDirection.Horizontal}
					VerticalAlignment={Enum.VerticalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, HUD_VIEW.gap)}
				/>
				<Text order={1} size={HUD_VIEW.smallText} color="uiText" text={name} />
				<Pips order={2} pips={armoryPips(r)} />
				{mark !== "" ? <Text order={3} size={HUD_VIEW.smallText} color={SILVER_ROLE} text={mark} /> : undefined}
			</frame>
			<Text
				order={4}
				width={inner}
				size={HUD_VIEW.smallText}
				color={r.state === "poor" || r.dim ? "uiTextDim" : SILVER_ROLE}
				transparency={r.dim ? S.dimTransparency : 0}
				align={Enum.TextXAlignment.Right}
				text={right}
			/>
		</textbutton>
	);
}

/** The detail beside the list (upright: a sheet under it): the item, tier, effects, price and the buy hold. */
function Detail(props: {
	detail: ArmoryDetail | undefined;
	sizes: ArmorySizes;
	height: number;
	order: number;
	fill: React.Binding<number>;
	buyRef: React.Ref<TextButton>;
	buying: boolean;
	confirm: boolean;
	result: string | undefined;
	onConfirm: (yes: boolean) => void;
}) {
	const d = props.detail;
	const lines = new Array<React.Element>();
	if (d !== undefined) {
		lines.push(<Text key="Name" order={1} wrap={true} size={HUD_VIEW.titleText} color="uiAccent" text={d.title} />);
		const parts: string[] = [];
		if (d.tier !== undefined) parts.push(d.tier);
		if (d.levels !== undefined) parts.push(d.levels);
		const sub = parts.join("  ·  ");
		if (sub !== "") {
			lines.push(
				<Text key="Tier" order={2} fill={true} size={HUD_VIEW.smallText} color="uiTextDim" text={sub} />,
			);
		}
		lines.push(<Text key="Desc" order={3} wrap={true} size={HUD_VIEW.smallText} color="uiText" text={d.desc} />);
		d.effects.forEach((e, i) =>
			lines.push(
				<Text key={`Effect${i}`} order={4 + i} wrap={true} size={HUD_VIEW.smallText} color="uiText" text={e} />,
			),
		);
		if (d.row.item.simLever || d.row.item.kind === "unlock") {
			lines.push(
				<Text
					key="NextRun"
					order={10}
					wrap={true}
					size={HUD_VIEW.smallText}
					color="uiTextDim"
					text={str(ARMORY_KEYS.nextRun)}
				/>,
			);
		}
		lines.push(
			<Row key="Price" order={11}>
				<SilverAmount order={1} text={d.price} size={HUD_VIEW.textSize} dim={d.row.dim} />
				{d.toGo !== undefined ? (
					<Text order={2} size={HUD_VIEW.smallText} color="uiTextDim" text={`(${d.toGo})`} />
				) : undefined}
			</Row>,
		);
		if (props.confirm) {
			lines.push(
				<Text
					key="Confirm"
					order={12}
					wrap={true}
					size={HUD_VIEW.smallText}
					color="uiAccent"
					text={str(ARMORY_KEYS.confirm, { price: d.row.price ?? 0 })}
				/>,
			);
			lines.push(
				<Row key="ConfirmRow" order={13}>
					<MenuButton
						order={1}
						name="ConfirmYes"
						size={SMALL}
						textSize={HUD_VIEW.smallText}
						text={str(ARMORY_KEYS.confirmYes)}
						onActivated={() => props.onConfirm(true)}
					/>
					<MenuButton
						order={2}
						name="ConfirmNo"
						size={SMALL}
						textSize={HUD_VIEW.smallText}
						text={str(ARMORY_KEYS.confirmNo)}
						onActivated={() => props.onConfirm(false)}
					/>
				</Row>,
			);
		} else if (d.buy !== "none" || props.buying) {
			lines.push(
				<MenuButton
					key="Buy"
					ref={props.buyRef}
					order={12}
					name="Buy"
					size={new Vector2(S.buyButton.x, S.buyButton.y)}
					text={str(props.buying ? ARMORY_KEYS.buying : ARMORY_KEYS.hold)}
					disabled={props.buying}
					fill={props.fill}
					onActivated={() => undefined}
				/>,
			);
		}
		if (props.result !== undefined) {
			lines.push(
				<Text
					key="Result"
					order={14}
					wrap={true}
					size={HUD_VIEW.smallText}
					color={SILVER_ROLE}
					text={props.result}
				/>,
			);
		}
	}
	return (
		<scrollingframe
			LayoutOrder={props.order}
			Size={new UDim2(0, props.sizes.detailWidth, 0, props.height)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={HUD_VIEW.panelTransparency}
			BorderSizePixel={0}
			CanvasSize={new UDim2()}
			AutomaticCanvasSize={Enum.AutomaticSize.Y}
			ScrollingDirection={Enum.ScrollingDirection.Y}
			ScrollBarThickness={S.scrollBar}
			ScrollBarImageColor3={role("uiTextDim")}
			Selectable={false}
		>
			<uipadding
				PaddingLeft={new UDim(0, HUD_VIEW.pad)}
				PaddingRight={new UDim(0, HUD_VIEW.pad)}
				PaddingTop={new UDim(0, HUD_VIEW.pad)}
				PaddingBottom={new UDim(0, HUD_VIEW.pad)}
			/>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Left}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{lines}
		</scrollingframe>
	);
}

/** The result line of the last purchase answer (or undefined). */
function resultLine(itemId: string, level: number | undefined, ok: boolean, reason: string | undefined): string {
	if (ok) return str(ARMORY_KEYS.bought, { item: armoryItemLabel(itemId, level ?? 1, str) });
	return str(reason === "poor" ? ARMORY_KEYS.poor : ARMORY_KEYS.failed);
}

/**
 * The Armory (main menu > Armory; docs/SILVER.md "The Armory", SV9; rules in shared/view/menu armory.ts): the title and
 * the Silver balance, the Upgrades / Unlocks / Cosmetics tabs, the tab's items sorted by tier (the next goal and the
 * one after marked, far prices dimmed) and the focused item's detail beside them (upright: under them): its exact
 * effects per character, the price or `to go`, and the buy button: hold it 0.4 s (mouse, touch, the pad's A); from
 * tier 6 a confirm follows. The wallet's push answers (sfx.shop.buy / sfx.shop.deny, WalletController) and the line
 * under the button says how it went. With the wallet not loaded: `Armory unavailable`, greyed, nothing to buy. A
 * `screen` focus scope: LB / RB the tabs, the right stick scrolls the list, B goes back. Fitted on touch (the list is
 * the flexible part). Opening it marks what is affordable now as seen (the main menu's badge dot clears).
 */
export function ArmoryScreen() {
	const actions = useMenuActions();
	const device = useSelector(selectInputDevice);
	const status = useSelector(selectWallet);
	const ws = useSelector(selectWalletState);
	const [tab, setTab] = useState<ArmoryTab>(ARMORY_TABS[0]);
	const [focusId, setFocusId] = useState<string | undefined>(undefined);
	const [confirmId, setConfirmId] = useState<string | undefined>(undefined);
	const [openedVersion] = useState(() => ws.resultVersion);
	const [resultUntil, setResultUntil] = useState(0);
	const [fill, setFill] = useBinding(0);
	const holdRef = useRef(new BuyHold());
	const holdItem = useRef<string | undefined>(undefined);
	const buyRef = useRef<TextButton>();
	const firstRef = useRef<TextButton>();
	const listRef = useRef<ScrollingFrame>();
	const shown = walletShown(status);
	const rows = armoryRows(tab, status);
	const focusRow = rows.find((r) => r.itemId === focusId) ?? rows[0];
	const detail = focusRow !== undefined ? armoryDetail(focusRow, str) : undefined;
	const detailRef = useRef(detail);
	detailRef.current = detail;
	const buying = ws.buying !== undefined;

	// Opening: what is affordable now is seen (the main menu's badge dot clears); a later push adds what became so.
	useEffect(() => {
		actions.armorySeen(affordableKeys(status));
	}, [ws.version]);
	// A purchase answer arriving while open: its line shows for a while.
	useEffect(() => {
		if (ws.resultVersion > openedVersion && ws.result?.action === "buy")
			setResultUntil(os.clock() + SILVER_SHOP.resultSec);
	}, [ws.resultVersion]);

	const start = (itemId: string) => {
		const d = detailRef.current;
		if (d === undefined || d.itemId !== itemId || d.buy === "none" || buying) return;
		holdItem.current = itemId;
		holdRef.current.press(os.clock());
	};
	const stop = () => {
		holdRef.current.release();
		holdItem.current = undefined;
	};
	const buyNow = (itemId: string) => {
		if (actions.armoryBuy(itemId)) actions.playUi(SFX.uiConfirm);
	};
	// The hold: mouse / touch on the buy button, the pad's A while it is selected; stepped every frame.
	useEffect(() => {
		const conns = new Array<RBXScriptConnection>();
		const button = buyRef.current;
		if (button !== undefined) {
			conns.push(
				button.InputBegan.Connect((input) => {
					const t = input.UserInputType;
					if (t === Enum.UserInputType.MouseButton1 || t === Enum.UserInputType.Touch)
						start(detailRef.current?.itemId ?? "");
				}),
			);
			conns.push(button.InputEnded.Connect(() => stop()));
			conns.push(button.MouseLeave.Connect(() => stop()));
		}
		conns.push(
			UserInputService.InputBegan.Connect((input) => {
				if (input.KeyCode !== Enum.KeyCode.ButtonA) return;
				if (buyRef.current !== undefined && GuiService.SelectedObject === buyRef.current)
					start(detailRef.current?.itemId ?? "");
			}),
		);
		conns.push(
			UserInputService.InputEnded.Connect((input) => {
				if (input.KeyCode === Enum.KeyCode.ButtonA) stop();
			}),
		);
		conns.push(
			RunService.Heartbeat.Connect(() => {
				const now = os.clock();
				const step = holdRef.current.step(now);
				setFill(holdRef.current.progress(now));
				if (step !== "complete") return;
				const id = holdItem.current;
				const d = detailRef.current;
				stop();
				setFill(0);
				if (id === undefined || d === undefined || d.itemId !== id) return;
				if (d.buy === "holdConfirm") setConfirmId(id);
				else if (d.buy === "hold") buyNow(id);
			}),
		);
		return () => {
			for (const c of conns) c.Disconnect();
		};
	}, [detail?.itemId, buying, shown, confirmId]);

	const showTab = (t: ArmoryTab) => {
		if (t === tab) return;
		actions.playUi(SFX.uiClick);
		setTab(t);
		setFocusId(undefined);
		setConfirmId(undefined);
		stop();
		const list = listRef.current;
		if (list !== undefined) list.CanvasPosition = Vector2.zero;
	};
	const r = ws.result;
	const result =
		r !== undefined && r.action === "buy" && ws.resultVersion > openedVersion && os.clock() < resultUntil
			? resultLine(r.itemId, r.level, r.ok, r.reason)
			: undefined;
	const padContext = { scrollList: true };
	return (
		<FocusScope
			name="ArmoryScope"
			id="armory"
			layer="screen"
			surface="armory"
			defaultRef={firstRef}
			memoryKey="armory"
			padContext={padContext}
			scrollRef={listRef}
			onPadAction={(action) => {
				if (action.kind === "back") {
					actions.screenBack();
					return;
				}
				const nextTab = stepTab(ARMORY_TABS, tab, tabStep(action));
				if (nextTab !== undefined) showTab(nextTab);
			}}
		>
			<MenuFit
				flex={{ min: S.listMin, max: S.listHeight }}
				render={(layout) => {
					const sizes = sizesOf(layout);
					const inner = sizes.width - 2 * S.pad;
					const list = (
						<scrollingframe
							key="List"
							ref={listRef}
							LayoutOrder={1}
							Size={new UDim2(0, sizes.listWidth, 0, layout.flex)}
							BackgroundTransparency={HIDDEN}
							BorderSizePixel={0}
							CanvasSize={new UDim2()}
							AutomaticCanvasSize={Enum.AutomaticSize.Y}
							ScrollingDirection={Enum.ScrollingDirection.Y}
							ScrollBarThickness={S.scrollBar}
							ScrollBarImageColor3={role("uiTextDim")}
							Selectable={false}
						>
							<uipadding PaddingTop={new UDim(0, FOCUS_STROKE)} PaddingLeft={new UDim(0, FOCUS_STROKE)} />
							<uilistlayout
								FillDirection={Enum.FillDirection.Vertical}
								SortOrder={Enum.SortOrder.LayoutOrder}
								Padding={new UDim(0, S.rowGap)}
							/>
							{shown === "unavailable" ? (
								<Text
									key="Unavailable"
									order={1}
									width={sizes.listWidth - 2 * FOCUS_STROKE}
									wrap={true}
									size={HUD_VIEW.smallText}
									color="uiTextDim"
									text={str(ARMORY_KEYS.unavailableBody)}
								/>
							) : rows.size() === 0 ? (
								<Text
									key="Later"
									order={1}
									width={sizes.listWidth - 2 * FOCUS_STROKE}
									wrap={true}
									size={HUD_VIEW.smallText}
									color="uiTextDim"
									text={str(ARMORY_KEYS.cosmeticsLater)}
								/>
							) : (
								rows.map((row, i) => (
									<ItemRow
										key={row.itemId}
										row={row}
										order={i + 1}
										width={sizes.listWidth - 2 * FOCUS_STROKE}
										focused={focusRow?.itemId === row.itemId}
										rowRef={i === 0 ? firstRef : undefined}
										onFocus={() => {
											if (focusId !== row.itemId) {
												setFocusId(row.itemId);
												setConfirmId(undefined);
												stop();
											}
										}}
									/>
								))
							)}
						</scrollingframe>
					);
					const detailPanel = (
						<Detail
							key="Detail"
							order={2}
							detail={shown === "unavailable" ? undefined : detail}
							sizes={sizes}
							height={sizes.narrow ? S.sheetHeight : layout.flex}
							fill={fill}
							buyRef={buyRef}
							buying={buying}
							confirm={confirmId !== undefined && confirmId === detail?.itemId}
							result={result}
							onConfirm={(yes) => {
								const id = confirmId;
								setConfirmId(undefined);
								if (yes && id !== undefined) buyNow(id);
								else actions.playUi(SFX.uiBack);
							}}
						/>
					);
					return (
						<Panel width={sizes.width} padding={S.pad} skin={screenSkin("armory")} name="Armory">
							<Row key="Header" order={1}>
								<Text
									order={1}
									size={HUD_VIEW.titleText}
									color="uiAccent"
									text={str(shown === "unavailable" ? ARMORY_KEYS.unavailable : ARMORY_KEYS.title)}
								/>
								{shown === "loaded" ? (
									// docs/SILVER_SHOP.md SH6: the balance with the Silver shop's `+` (SilverBalance)
									<SilverBalance
										order={2}
										from="armory"
										text={str(ARMORY_KEYS.balance, { silver: statusBalance(status) })}
									/>
								) : undefined}
							</Row>
							<Row key="Tabs" order={2}>
								{ARMORY_TABS.map((t, i) => (
									<MenuButton
										key={t}
										order={i + 1}
										name={`Tab_${t}`}
										size={new Vector2(S.tab.w, S.tab.h)}
										textSize={HUD_VIEW.smallText}
										text={str(armoryTabKey(t))}
										active={t === tab}
										disabled={shown === "unavailable"}
										onActivated={() => showTab(t)}
									/>
								))}
							</Row>
							<frame
								key="Body"
								LayoutOrder={3}
								Size={new UDim2(0, inner, 0, 0)}
								AutomaticSize={Enum.AutomaticSize.Y}
								BackgroundTransparency={HIDDEN}
							>
								<uilistlayout
									FillDirection={
										sizes.narrow ? Enum.FillDirection.Vertical : Enum.FillDirection.Horizontal
									}
									SortOrder={Enum.SortOrder.LayoutOrder}
									Padding={new UDim(0, S.detailGap)}
								/>
								{list}
								{detailPanel}
							</frame>
							<Row key="Back" order={4} align={Enum.HorizontalAlignment.Center}>
								<MenuButton
									order={1}
									name="Back"
									size={SMALL}
									textSize={HUD_VIEW.smallText}
									text={str(MENU_STRINGS.back)}
									onActivated={() => {
										actions.playUi(SFX.uiBack);
										actions.back();
									}}
								/>
							</Row>
							{device === "gamepad" ? (
								<PadHintBar key="PadHints" order={5} surface="armory" context={padContext} />
							) : device === "touch" ? undefined : (
								<Text
									key="BackHint"
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
