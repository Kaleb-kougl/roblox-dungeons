import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { clientStore, selectBulletSpike, selectCameraSpike } from "client/store";
import { BULLET_SPIKE, CAMERA_SPIKE, STUDS_PER_TILE } from "shared/config";

const TEXT_SIZE = 16;
const ROW_HEIGHT = 22;
const BUTTON_WIDTH = 72;
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

function Button(props: { text: string; order: number; active?: boolean; onClick: () => void }) {
	return (
		<textbutton
			LayoutOrder={props.order}
			Size={new UDim2(0, BUTTON_WIDTH, 0, ROW_HEIGHT)}
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
	return (
		<>
			<Label order={1} text={`SPIKE A  bullets ${s.live}/${count}  pattern ${spike.pattern}  (keys 1-4, P)`} />
			<Label
				order={2}
				text={`fps ${string.format(DECIMALS_FPS, s.fps)}   update ${string.format(
					DECIMALS_MS,
					s.computeMs + s.moveMs,
				)} ms`}
			/>
			<Label
				order={3}
				text={`  compute ${string.format(DECIMALS_MS, s.computeMs)}  BulkMoveTo ${string.format(
					DECIMALS_MS,
					s.moveMs,
				)}  worst ${string.format(DECIMALS_MS, s.worstMs)} ms`}
			/>
			<Row order={4}>
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

/** Readouts and touch-friendly controls for whichever spikes are running (docs/SPIKES.md). */
export function SpikeHud() {
	const bulletsActive = useSelector((state) => selectBulletSpike(state).active);
	const cameraActive = useSelector((state) => selectCameraSpike(state).active);
	if (!bulletsActive && !cameraActive) {
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
		</frame>
	);
}
