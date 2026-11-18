import React, { useBinding, useEffect } from "@rbxts/react";
import { RunService } from "@rbxts/services";
import { MenuButton, Row, SilverAmount, Text } from "client/ui/hud";
import { role, str } from "client/ui/theme";
import { characterDef, type CharacterId } from "shared/characters";
import { isPrismaticItem, type CosmeticLook } from "shared/cosmetics";
import {
	ARMORY_KEYS,
	COSMETIC_KEYS,
	SILVER_ROLE,
	cosmeticNameKey,
	cosmeticSlotKey,
	type ColorRole,
} from "shared/theme";
import { COSMETIC_VIEW, cosmeticClockSec, cosmeticRgb8, dyeForVisual } from "shared/view/cosmetics";
import { HUD_VIEW } from "shared/view/hud";
import {
	ARMORY_SCREEN,
	MENU_VIEW,
	cosmeticFlashScale,
	cosmeticFlashTransparency,
	cosmeticRowRight,
	type CosmeticDetail,
	type CosmeticItemEntry,
	type CosmeticListEntry,
} from "shared/view/menu";
import { CharacterPreview } from "./CharacterPreview";

const HIDDEN = 1;
const STROKE = 1;
const FOCUS_STROKE = 2;
const S = ARMORY_SCREEN;
const P = COSMETIC_VIEW.preview;
const SMALL = new Vector2(MENU_VIEW.smallButton.x, MENU_VIEW.smallButton.y);
const BLACK = new Color3(0, 0, 0);

/** An item's colour at `t` (reduced motion: its first stop), or black for none. */
function swatchColor(itemId: string, t: number, reduced: boolean): Color3 {
	const c = cosmeticRgb8(itemId, cosmeticClockSec(t, reduced));
	return c !== undefined ? Color3.fromRGB(c.r, c.g, c.b) : BLACK;
}

/**
 * A cosmetic's colour as a small square (docs/COSMETICS.md CS6 / CS7): the item's colour, a Prismatic dye drifting
 * through its stops on Heartbeat (a binding: no re-render; still under reduced motion or with `still`).
 */
export function CosmeticSwatch(props: {
	itemId: string;
	size: number;
	order?: number;
	reducedMotion: boolean;
	/** Never animate (the lobby's chip). */
	still?: boolean;
	position?: UDim2;
	anchor?: Vector2;
	zIndex?: number;
}) {
	const [clock, setClock] = useBinding(0);
	const animated = isPrismaticItem(props.itemId) && !props.reducedMotion && props.still !== true;
	useEffect(() => {
		setClock(0);
		if (!animated) return;
		let t = 0;
		const conn = RunService.Heartbeat.Connect((dt) => {
			t += dt;
			setClock(t);
		});
		return () => conn.Disconnect();
	}, [props.itemId, animated]);
	const reduced = props.reducedMotion || props.still === true;
	return (
		<frame
			key="Swatch"
			LayoutOrder={props.order ?? 0}
			Size={UDim2.fromOffset(props.size, props.size)}
			Position={props.position}
			AnchorPoint={props.anchor}
			ZIndex={props.zIndex}
			BackgroundColor3={clock.map((t) => swatchColor(props.itemId, t, reduced))}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role("uiTextDim")} />
		</frame>
	);
}

/** A slot's header line on the Cosmetics tab. */
function SlotHeader(props: { order: number; width: number; slotKey: string }) {
	return (
		<Text
			key="Header"
			order={props.order}
			width={props.width}
			size={HUD_VIEW.smallText}
			color="uiTextDim"
			text={str(props.slotKey)}
		/>
	);
}

/**
 * One cosmetic row: its swatch, name and `Animated` tag on the left, Equipped / Owned / the price / `to go` on the
 * right; the bought row stamps (a scale eased back to 1 and a silver flash fading out over
 * COSMETIC_VIEW.preview.flashSec) when `flashAt` (os.clock of the purchase) is set.
 */
function CosmeticRow(props: {
	entry: CosmeticItemEntry;
	order: number;
	width: number;
	focused: boolean;
	reducedMotion: boolean;
	flashAt: number | undefined;
	rowRef?: React.Ref<TextButton>;
	onFocus: () => void;
}) {
	const e = props.entry;
	const r = e.row;
	const [scale, setScale] = useBinding(1);
	const [flash, setFlash] = useBinding(1);
	useEffect(() => {
		const at = props.flashAt;
		if (at === undefined) return;
		const conn = RunService.Heartbeat.Connect(() => {
			const t = os.clock() - at;
			setScale(cosmeticFlashScale(t, props.reducedMotion));
			setFlash(cosmeticFlashTransparency(t));
			if (t >= P.flashSec) conn.Disconnect();
		});
		return () => conn.Disconnect();
	}, [props.flashAt]);
	const inner = props.width - 2 * HUD_VIEW.pad;
	const right = cosmeticRowRight(e, str);
	return (
		<textbutton
			key={r.itemId}
			ref={props.rowRef}
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
			<uiscale Scale={scale} />
			<uistroke
				ApplyStrokeMode={Enum.ApplyStrokeMode.Border}
				Thickness={props.focused ? FOCUS_STROKE : STROKE}
				Color={role(props.focused ? "uiAccent" : e.equipped ? SILVER_ROLE : "uiTextDim")}
			/>
			<frame
				key="Flash"
				Size={UDim2.fromScale(1, 1)}
				BackgroundColor3={role(SILVER_ROLE)}
				BackgroundTransparency={flash}
				BorderSizePixel={0}
			/>
			<uipadding PaddingLeft={new UDim(0, HUD_VIEW.pad)} PaddingRight={new UDim(0, HUD_VIEW.pad)} />
			<frame Size={UDim2.fromScale(1, 1)} BackgroundTransparency={HIDDEN}>
				<uilistlayout
					FillDirection={Enum.FillDirection.Horizontal}
					VerticalAlignment={Enum.VerticalAlignment.Center}
					SortOrder={Enum.SortOrder.LayoutOrder}
					Padding={new UDim(0, HUD_VIEW.gap)}
				/>
				<CosmeticSwatch
					order={1}
					itemId={r.itemId}
					size={COSMETIC_VIEW.rowSwatch}
					reducedMotion={props.reducedMotion}
				/>
				<Text order={2} size={HUD_VIEW.smallText} color="uiText" text={str(cosmeticNameKey(r.itemId))} />
				{e.animated ? (
					<Text order={3} size={HUD_VIEW.smallText} color={SILVER_ROLE} text={str(COSMETIC_KEYS.animated)} />
				) : undefined}
			</frame>
			<Text
				order={4}
				width={inner}
				size={HUD_VIEW.smallText}
				color={e.equipped ? "uiAccent" : r.state === "poor" || r.dim ? "uiTextDim" : SILVER_ROLE}
				transparency={r.dim && !e.owned ? S.dimTransparency : 0}
				align={Enum.TextXAlignment.Right}
				text={right}
			/>
		</textbutton>
	);
}

/**
 * The Cosmetics tab's list rows (docs/COSMETICS.md CS6): a header per slot, then its items (the first item takes
 * `firstRef`, the scope's default selection).
 */
export function cosmeticListRows(props: {
	entries: ReadonlyArray<CosmeticListEntry>;
	width: number;
	focusId: string | undefined;
	reducedMotion: boolean;
	flash: { readonly itemId: string; readonly at: number } | undefined;
	firstRef: React.Ref<TextButton>;
	onFocus: (itemId: string) => void;
}): React.Element[] {
	const out: React.Element[] = [];
	let first = true;
	props.entries.forEach((e, i) => {
		if (e.kind === "header") {
			out.push(
				<SlotHeader key={`H_${e.slot}`} order={i + 1} width={props.width} slotKey={cosmeticSlotKey(e.slot)} />,
			);
			return;
		}
		const id = e.row.itemId;
		out.push(
			<CosmeticRow
				key={id}
				entry={e}
				order={i + 1}
				width={props.width}
				focused={props.focusId === id}
				reducedMotion={props.reducedMotion}
				flashAt={props.flash !== undefined && props.flash.itemId === id ? props.flash.at : undefined}
				rowRef={first ? props.firstRef : undefined}
				onFocus={() => props.onFocus(id)}
			/>,
		);
		first = false;
	});
	return out;
}

/**
 * The live preview (docs/COSMETICS.md CS6, "Armory"): the slot's character (a dye's own; else the picked one) turning
 * through its facings with `look` on (the focused item tried on, else the equipped look): the dye from its dye sheet
 * once downloaded, the rim in the outline colour; beside it the focused item's swatch (always: a trail / spark colour
 * has no sprite to show, and a dye whose sheet is not in shows as the chip, never as a tint over the whole sprite).
 */
function LivePreview(props: {
	character: CharacterId;
	look: CosmeticLook;
	itemId: string;
	box: number;
	reducedMotion: boolean;
}) {
	const visualId = characterDef(props.character).visualId;
	return (
		<Row key="Preview" order={1}>
			<CharacterPreview
				key={`P_${visualId}`}
				visualId={visualId}
				color={visualId as ColorRole}
				box={props.box}
				reducedMotion={props.reducedMotion}
				dyeItem={dyeForVisual(props.look, visualId)}
				rim={true}
				outlineItem={props.look.outline}
				turn={true}
			/>
			<frame
				key="Chip"
				LayoutOrder={2}
				Size={UDim2.fromOffset(P.swatch, props.box)}
				BackgroundTransparency={HIDDEN}
			>
				<CosmeticSwatch
					itemId={props.itemId}
					size={P.swatch}
					reducedMotion={props.reducedMotion}
					anchor={new Vector2(0, 1)}
					position={UDim2.fromScale(0, 1)}
				/>
			</frame>
		</Row>
	);
}

/**
 * The Cosmetics tab's detail (docs/COSMETICS.md CS6): the live preview with the focused item tried on, its name,
 * `{slot} · Tier n`, `Animated`, `Try on` while it is not owned, the price / `to go` / Equipped / Owned, and the button:
 * the Armory's buy hold (and its confirm from CONFIRM_FROM_TIER), Equip or Take off.
 */
export function cosmeticDetailLines(props: {
	detail: CosmeticDetail;
	character: CharacterId;
	look: CosmeticLook;
	box: number;
	reducedMotion: boolean;
	fill: React.Binding<number>;
	buyRef: React.Ref<TextButton>;
	buying: boolean;
	confirm: boolean;
	result: string | undefined;
	onConfirm: (yes: boolean) => void;
	onEquip: () => void;
}): React.Element[] {
	const d = props.detail;
	const lines: React.Element[] = [];
	lines.push(
		<LivePreview
			key="Live"
			character={props.character}
			look={props.look}
			itemId={d.itemId}
			box={props.box}
			reducedMotion={props.reducedMotion}
		/>,
	);
	lines.push(<Text key="Name" order={2} wrap={true} size={HUD_VIEW.titleText} color="uiAccent" text={d.title} />);
	const sub = d.tag !== undefined ? `${d.sub}  ·  ${d.tag}` : d.sub;
	lines.push(<Text key="Sub" order={3} fill={true} size={HUD_VIEW.smallText} color="uiTextDim" text={sub} />);
	if (!d.entry.owned) {
		lines.push(
			<Text
				key="TryOn"
				order={4}
				fill={true}
				size={HUD_VIEW.smallText}
				color="uiText"
				text={str(COSMETIC_KEYS.tryOn)}
			/>,
		);
	}
	lines.push(
		<Row key="Price" order={5}>
			{d.entry.owned ? (
				<Text
					order={1}
					size={HUD_VIEW.textSize}
					color={d.entry.equipped ? "uiAccent" : "uiText"}
					text={d.price}
				/>
			) : (
				<SilverAmount order={1} text={d.price} size={HUD_VIEW.textSize} dim={d.entry.row.dim} />
			)}
			{d.toGo !== undefined ? (
				<Text order={2} size={HUD_VIEW.smallText} color="uiTextDim" text={`(${d.toGo})`} />
			) : undefined}
		</Row>,
	);
	if (props.confirm) {
		lines.push(
			<Text
				key="Confirm"
				order={6}
				wrap={true}
				size={HUD_VIEW.smallText}
				color="uiAccent"
				text={str(ARMORY_KEYS.confirm, { price: d.entry.row.price ?? 0 })}
			/>,
		);
		lines.push(
			<Row key="ConfirmRow" order={7}>
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
	} else if (d.equip !== undefined && d.equipKey !== undefined) {
		lines.push(
			<MenuButton
				key="Equip"
				order={6}
				name="Equip"
				size={new Vector2(S.buyButton.x, S.buyButton.y)}
				text={str(d.equipKey)}
				onActivated={props.onEquip}
			/>,
		);
	} else if (d.buy !== "none" || props.buying) {
		lines.push(
			<MenuButton
				key="Buy"
				ref={props.buyRef}
				order={6}
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
				order={8}
				wrap={true}
				size={HUD_VIEW.smallText}
				color={SILVER_ROLE}
				text={props.result}
			/>,
		);
	}
	return lines;
}
