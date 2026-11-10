import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { clientStore, selectBulletSpike, selectCameraSpike, selectInviteSpike } from "client/store";
import { BULLET_SPIKE, CAMERA_SPIKE, InviteSpikeAction, SPIKE_ATTRIBUTES, STUDS_PER_TILE } from "shared/config";

const TEXT_SIZE = 16;
const ROW_HEIGHT = 22;
const BUTTON_WIDTH = 72;
/** The invites spike's buttons carry longer labels. */
const WIDE_BUTTON_WIDTH = 120;
/** The invites spike's log lines: smaller and wrapped, so a server dump stays readable on a phone. */
const LOG_TEXT_SIZE = 12;
const LOG_COLOR = Color3.fromRGB(200, 215, 235);
const PANEL_WIDTH = 460;
const PADDING = 8;
const PANEL_COLOR = Color3.fromRGB(16, 18, 24);
const PANEL_TRANSPARENCY = 0.25;
const TEXT_COLOR = Color3.fromRGB(235, 235, 235);
const BUTTON_COLOR = Color3.fromRGB(60, 66, 84);
const ACTIVE_COLOR = Color3.fromRGB(90, 160, 110);
const DECIMALS_FPS = "%.1f";
const DECIMALS_MS = "%.2f";

function Label(props: { text: string; order: number }) {
	return (
		<textlabel
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, ROW_HEIGHT)}
			BackgroundTransparency={1}
			Font={Enum.Font.Code}
			TextSize={TEXT_SIZE}
			TextColor3={TEXT_COLOR}
			TextXAlignment={Enum.TextXAlignment.Left}
			Text={props.text}
		/>
	);
}

function Button(props: { text: string; order: number; active?: boolean; width?: number; onClick: () => void }) {
	return (
		<textbutton
			LayoutOrder={props.order}
			Size={new UDim2(0, props.width ?? BUTTON_WIDTH, 0, ROW_HEIGHT)}
			BackgroundColor3={props.active ? ACTIVE_COLOR : BUTTON_COLOR}
			Font={Enum.Font.Code}
			TextSize={TEXT_SIZE}
			TextColor3={TEXT_COLOR}
			Text={props.text}
			Event={{ Activated: props.onClick }}
		/>
	);
}

function Row(props: { order: number; children?: React.ReactNode }) {
	return (
		<frame LayoutOrder={props.order} Size={new UDim2(1, 0, 0, ROW_HEIGHT)} BackgroundTransparency={1}>
			<uilistlayout
				FillDirection={Enum.FillDirection.Horizontal}
				Padding={new UDim(0, PADDING / 2)}
				SortOrder={Enum.SortOrder.LayoutOrder}
			/>
			{props.children}
		</frame>
	);
}

function BulletPanel() {
	const spike = useSelector(selectBulletSpike);
	const s = spike.stats;
	const count = BULLET_SPIKE.counts[spike.countIndex];
	const mode = BULLET_SPIKE.modes[spike.modeIndex];
	const ms = (value: number) => string.format(DECIMALS_MS, value);
	const art = mode.id === "neon" ? "-" : mode.id === "decal" ? "engine" : s.art;
	return (
		<>
			<Label order={1} text={`SPIKE A  bullets ${s.live}/${count} +${s.players}  ${spike.pattern}`} />
			<Label order={2} text={`  mode ${mode.short}  art ${art}  (1-4, P, 5-8, 0)`} />
			<Label
				order={3}
				text={`fps ${string.format(DECIMALS_FPS, s.fps)}   update ${ms(
					s.computeMs + s.moveMs + s.frameMs,
				)} ms  worst ${ms(s.worstMs)}`}
			/>
			<Label
				order={4}
				text={`  compute ${ms(s.computeMs)}  ${mode.move} ${ms(s.moveMs)}  flip ${ms(s.frameMs)}`}
			/>
			<Row order={5}>
				{BULLET_SPIKE.counts.map((n, i) => (
					<Button
						key={`count${n}`}
						order={i}
						text={tostring(n)}
						active={i === spike.countIndex}
						onClick={() => clientStore.setBulletCountIndex(i)}
					/>
				))}
				<Button
					order={BULLET_SPIKE.counts.size()}
					text={spike.pattern}
					onClick={() => clientStore.toggleBulletPattern()}
				/>
			</Row>
			<Row order={6}>
				{BULLET_SPIKE.modes.map((m, i) => (
					<Button
						key={`mode${m.id}`}
						order={i}
						text={m.short}
						active={i === spike.modeIndex}
						onClick={() => clientStore.setBulletModeIndex(i)}
					/>
				))}
				<Button
					order={BULLET_SPIKE.modes.size()}
					text={`+${BULLET_SPIKE.players.count}`}
					active={spike.playerBullets}
					onClick={() => clientStore.toggleBulletPlayers()}
				/>
			</Row>
		</>
	);
}

function CameraPanel() {
	const spike = useSelector(selectCameraSpike);
	const fov = CAMERA_SPIKE.fovs[spike.fovIndex];
	const snap = spike.snapIndex >= 0 ? `${CAMERA_SPIKE.snapTexels[spike.snapIndex]} texel` : "off";
	return (
		<>
			<Label
				order={11}
				text={`SPIKE B  fov ${fov}  distance ${math.round(spike.distance)} studs  snap ${snap}  (F, G, T)`}
			/>
			<Label order={12} text={`  ${STUDS_PER_TILE} studs/tile  WASD walks the placeholder`} />
			<Row order={13}>
				<Button order={1} text={`fov ${fov}`} onClick={() => clientStore.cycleFov()} />
				<Button
					order={2}
					text={`snap ${spike.snapIndex >= 0 ? "on" : "off"}`}
					active={spike.snapIndex >= 0}
					onClick={() => clientStore.cycleSnap()}
				/>
				<Button order={3} text="auto" active={spike.autoWalk} onClick={() => clientStore.toggleAutoWalk()} />
			</Row>
		</>
	);
}

function LogLine(props: { text: string; order: number }) {
	return (
		<textlabel
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={1}
			Font={Enum.Font.Code}
			TextSize={LOG_TEXT_SIZE}
			TextColor3={LOG_COLOR}
			TextWrapped={true}
			TextXAlignment={Enum.TextXAlignment.Left}
			Text={props.text}
		/>
	);
}

/** The invites spike's buttons, two rows: [label, action]. */
const INVITE_BUTTONS: ReadonlyArray<ReadonlyArray<readonly [string, InviteSpikeAction]>> = [
	[
		["prompt (server)", "promptServer"],
		["prompt (client)", "promptClient"],
		["prompt 1 (srv)", "promptServerOne"],
	],
	[
		["can send (srv)", "canSendServer"],
		["can send (cli)", "canSendClient"],
		["dump both", "dump"],
	],
];

/** First LayoutOrder of the invites panel (after the bullet and camera panels). */
const INVITE_ORDER = 21;

function InvitePanel() {
	const spike = useSelector(selectInviteSpike);
	return (
		<>
			<Label
				order={INVITE_ORDER}
				text={`SPIKE I0  invites  (${SPIKE_ATTRIBUTES.invites}; published place only)`}
			/>
			{INVITE_BUTTONS.map((row, r) => (
				<Row key={`inviteRow${r}`} order={INVITE_ORDER + 1 + r}>
					{row.map(([text, action], i) => (
						<Button
							key={action}
							order={i}
							text={text}
							width={WIDE_BUTTON_WIDTH}
							onClick={() => clientStore.requestInviteSpike(action)}
						/>
					))}
				</Row>
			))}
			{spike.lines.map((text, i) => (
				<LogLine key={`inviteLine${i}`} order={INVITE_ORDER + 1 + INVITE_BUTTONS.size() + i} text={text} />
			))}
		</>
	);
}

/** Readouts and touch-friendly controls for whichever spikes are running (docs/SPIKES.md). */
export function SpikeHud() {
	const bulletsActive = useSelector((state) => selectBulletSpike(state).active);
	const cameraActive = useSelector((state) => selectCameraSpike(state).active);
	const invitesActive = useSelector((state) => selectInviteSpike(state).active);
	if (!bulletsActive && !cameraActive && !invitesActive) {
		return undefined;
	}
	return (
		<frame
			Position={new UDim2(0, PADDING, 0, PADDING)}
			Size={new UDim2(0, PANEL_WIDTH, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundColor3={PANEL_COLOR}
			BackgroundTransparency={PANEL_TRANSPARENCY}
		>
			<uipadding
				PaddingLeft={new UDim(0, PADDING)}
				PaddingRight={new UDim(0, PADDING)}
				PaddingTop={new UDim(0, PADDING)}
				PaddingBottom={new UDim(0, PADDING)}
			/>
			<uilistlayout Padding={new UDim(0, PADDING / 2)} SortOrder={Enum.SortOrder.LayoutOrder} />
			{bulletsActive && <BulletPanel />}
			{cameraActive && <CameraPanel />}
			{invitesActive && <InvitePanel />}
		</frame>
	);
}
