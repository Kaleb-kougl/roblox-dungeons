import React from "@rbxts/react";
import { DEV_PANEL_VIEW } from "shared/config";
import { DEV_MONO_FONT, DEV_TEXT_FONT, role } from "client/ui/theme";

const V = DEV_PANEL_VIEW;
const S = DEV_PANEL_VIEW.strings;
const HIDDEN = 1;
const HALF = 0.5;

/** What the dev panel shows and what it can ask for (DevModeController owns the state). */
export interface DevPanelProps {
	readonly open: boolean;
	/** The floor Go starts on. */
	readonly floor: number;
	readonly floorIsBoss: boolean;
	readonly seed: number;
	/** God mode as shown: the running dev run's (sim state), else the option Go will use. */
	readonly god: boolean;
	readonly godPending: boolean;
	/** The next Go arms both weapons with the picked character's roll (docs/ARCHER.md AR4). */
	readonly bothWeapons: boolean;
	/** The current run is a dev run, on this floor (undefined outside one). */
	readonly runFloor: number | undefined;
	/** The rollback probe's device tag (Workspace KV_RollbackDeviceTag; "" = none). */
	readonly rollbackTag: string;
	readonly onToggleOpen: () => void;
	readonly onFloorDelta: (delta: number) => void;
	readonly onFloorText: (text: string) => void;
	readonly onSeedText: (text: string) => void;
	readonly onReroll: () => void;
	readonly onToggleGod: () => void;
	readonly onToggleBothWeapons: () => void;
	readonly onGo: () => void;
	readonly onRestart: () => void;
	readonly onRollbackTagText: (text: string) => void;
}

function Corner() {
	return <uicorner CornerRadius={new UDim(0, V.corner)} />;
}

function Button(props: { text: string; width?: number; order: number; accent?: boolean; onClick: () => void }) {
	return (
		<textbutton
			LayoutOrder={props.order}
			Size={
				props.width !== undefined ? new UDim2(0, props.width, 0, V.rowHeight) : new UDim2(1, 0, 0, V.rowHeight)
			}
			BackgroundColor3={props.accent === true ? role("uiAccent") : role("uiTextDim")}
			BackgroundTransparency={props.accent === true ? 0 : HALF}
			AutoButtonColor={true}
			Text={props.text}
			TextColor3={role("uiText")}
			TextSize={V.textSize}
			Font={DEV_TEXT_FONT}
			Event={{ Activated: props.onClick }}
		>
			<Corner />
		</textbutton>
	);
}

function Label(props: { text: string; order: number; width?: number; dim?: boolean; size?: number }) {
	return (
		<textlabel
			LayoutOrder={props.order}
			Size={
				props.width !== undefined ? new UDim2(0, props.width, 0, V.rowHeight) : new UDim2(1, 0, 0, V.rowHeight)
			}
			BackgroundTransparency={HIDDEN}
			Text={props.text}
			TextColor3={props.dim === true ? role("uiTextDim") : role("uiText")}
			TextSize={props.size ?? V.textSize}
			TextWrapped={true}
			TextXAlignment={Enum.TextXAlignment.Left}
			Font={DEV_TEXT_FONT}
		/>
	);
}

/** A text box that reports its text when focus is lost (Enter or a click away). */
function Field(props: { text: string; order: number; width: number; onCommit: (text: string) => void }) {
	return (
		<textbox
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width, 0, V.rowHeight)}
			BackgroundColor3={role("uiPanel")}
			BackgroundTransparency={0}
			Text={props.text}
			ClearTextOnFocus={false}
			TextColor3={role("uiText")}
			TextSize={V.textSize}
			Font={DEV_MONO_FONT}
			Event={{ FocusLost: (box) => props.onCommit(box.Text) }}
		>
			<Corner />
			<uistroke Color={role("uiTextDim")} />
		</textbox>
	);
}

function Row(props: { order: number; children?: React.ReactNode }) {
	return (
		<frame LayoutOrder={props.order} Size={new UDim2(1, 0, 0, V.rowHeight)} BackgroundTransparency={HIDDEN}>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				Padding={new UDim(0, V.rowGap)}
				VerticalAlignment={Enum.VerticalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{props.children}
		</frame>
	);
}

/** The width left in a row of `n` fixed `w`-wide items (and n + 1 gaps) for one flexible item. */
function rest(n: number, w: number): number {
	return V.panelWidth - 2 * V.pad - n * w - n * V.rowGap;
}

/**
 * Developer mode's chip and panel (docs/DEV_MODE.md): a small "DEV" chip on the left edge (tap / click or F2 opens the
 * panel; during a dev run it shows the floor and GOD), and the panel under it: floor stepper, seed, god mode, Both
 * weapons, Go (the character screen first) and Restart. Only mounted for players the server allowed (DevModeController).
 */
export function DevPanel(props: DevPanelProps) {
	const chipText =
		props.runFloor !== undefined
			? string.format(S.chipRun, props.runFloor) + (props.god ? ` · ${S.chipGod}` : "")
			: S.chip;
	const godText = props.godPending ? S.godPending : props.god ? S.godOn : S.godOff;
	const stepW = V.rowHeight + V.rowGap;
	const floorLabel = props.floorIsBoss ? `${S.floor} (${S.bossFloor})` : S.floor;
	return (
		<frame
			key="Dev"
			AnchorPoint={new Vector2(0, HALF)}
			Position={new UDim2(0, V.edgeInset, HALF, 0)}
			Size={new UDim2(0, V.panelWidth, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout Padding={new UDim(0, V.gap)} SortOrder={Enum.SortOrder.LayoutOrder} />
			<textbutton
				key="Chip"
				LayoutOrder={1}
				Size={new UDim2(0, 0, 0, V.chipHeight)}
				AutomaticSize={Enum.AutomaticSize.X}
				BackgroundColor3={props.runFloor !== undefined ? role("uiAccent") : role("uiPanel")}
				BackgroundTransparency={V.panelTransparency}
				Text={chipText}
				TextColor3={role("uiText")}
				TextSize={V.textSize}
				Font={DEV_TEXT_FONT}
				Event={{ Activated: props.onToggleOpen }}
			>
				<Corner />
				<uipadding PaddingLeft={new UDim(0, V.chipPadX)} PaddingRight={new UDim(0, V.chipPadX)} />
			</textbutton>
			<frame
				key="Panel"
				LayoutOrder={2}
				Visible={props.open}
				Size={new UDim2(1, 0, 0, 0)}
				AutomaticSize={Enum.AutomaticSize.Y}
				BackgroundColor3={role("uiPanel")}
				BackgroundTransparency={V.panelTransparency}
			>
				<Corner />
				<uipadding
					PaddingLeft={new UDim(0, V.pad)}
					PaddingRight={new UDim(0, V.pad)}
					PaddingTop={new UDim(0, V.pad)}
					PaddingBottom={new UDim(0, V.pad)}
				/>
				<uilistlayout Padding={new UDim(0, V.rowGap)} SortOrder={Enum.SortOrder.LayoutOrder} />
				<Label order={1} text={S.title} size={V.titleSize} />
				<Label order={2} text={S.hint} dim={true} />
				<Label order={3} text={floorLabel} />
				<Row order={4}>
					<Button
						order={1}
						width={V.rowHeight}
						text={`-${V.floorBigStep}`}
						onClick={() => props.onFloorDelta(-V.floorBigStep)}
					/>
					<Button order={2} width={V.rowHeight} text="-" onClick={() => props.onFloorDelta(-V.floorStep)} />
					<Field
						order={3}
						width={rest(4, V.rowHeight)}
						text={tostring(props.floor)}
						onCommit={props.onFloorText}
					/>
					<Button order={4} width={V.rowHeight} text="+" onClick={() => props.onFloorDelta(V.floorStep)} />
					<Button
						order={5}
						width={V.rowHeight}
						text={`+${V.floorBigStep}`}
						onClick={() => props.onFloorDelta(V.floorBigStep)}
					/>
				</Row>
				<Label order={5} text={S.seed} dim={true} />
				<Row order={6}>
					<Field
						order={1}
						width={rest(1, stepW * 2)}
						text={tostring(props.seed)}
						onCommit={props.onSeedText}
					/>
					<Button order={2} width={stepW * 2} text={S.reroll} onClick={props.onReroll} />
				</Row>
				<Button order={7} text={godText} accent={props.god} onClick={props.onToggleGod} />
				<Button
					order={8}
					text={props.bothWeapons ? S.bothOn : S.bothOff}
					accent={props.bothWeapons}
					onClick={props.onToggleBothWeapons}
				/>
				<Button order={9} text={string.format(S.go, props.floor)} accent={true} onClick={props.onGo} />
				{props.runFloor !== undefined ? (
					<Button order={10} text={S.restart} onClick={props.onRestart} />
				) : undefined}
				<Label
					order={11}
					dim={true}
					text={props.runFloor !== undefined ? string.format(S.inDevRun, props.runFloor) : S.notInDevRun}
				/>
				<Label order={11} text={S.rollbackTag} dim={true} />
				<Row order={12}>
					<Field order={1} width={rest(0, 0)} text={props.rollbackTag} onCommit={props.onRollbackTagText} />
				</Row>
			</frame>
		</frame>
	);
}
