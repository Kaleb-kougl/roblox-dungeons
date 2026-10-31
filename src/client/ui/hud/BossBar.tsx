import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { role, str, themePack } from "client/ui/theme";
import {
	HUD_SKIN,
	HUD_STRINGS,
	HUD_VIEW,
	bossFraction,
	fillClip,
	pillFit,
	romanPhase,
	skinFor,
	skinHasOf,
} from "shared/view/hud";
import { Panel, Row, SlicedImage, Text } from "./primitives";
import { HighlightRing } from "./TutorialFx";
import { useHudScale } from "./useHudScale";

const HALF = 0.5;
const HIDDEN = 1;
const STROKE = 1;
const NAME_WIDTH_SHARE = 0.7;
/** Inside the bar: the track, the fill over it, the phase notches on top. */
const BAR_Z = { track: 1, fill: 2, notches: 3 } as const;

/** The phase notches: a thin uiText line at every threshold, dimmed once the hp is below it. */
function notches(marks: ReadonlyArray<number>, frac: number) {
	return marks.map((m, i) => (
		<frame
			key={`n${i}`}
			AnchorPoint={new Vector2(HALF, 0)}
			Position={UDim2.fromScale(m, 0)}
			Size={new UDim2(0, HUD_VIEW.bossNotchWidth, 1, 0)}
			BackgroundColor3={role("uiText")}
			BackgroundTransparency={frac <= m ? HALF : 0}
			BorderSizePixel={0}
			ZIndex={BAR_Z.notches}
		/>
	));
}

/** Today's flat bar: a uiPanel track with a dim outline, the `boss` fill, the notches. */
function FlatBar(props: { frac: number; marks: ReadonlyArray<number> }) {
	return (
		<frame
			LayoutOrder={2}
			Size={new UDim2(1, 0, 0, HUD_VIEW.bossBarHeight)}
			BackgroundColor3={role("uiPanel")}
			BorderSizePixel={0}
		>
			<uistroke Thickness={STROKE} Color={role("uiTextDim")} />
			<frame
				Size={UDim2.fromScale(props.frac, 1)}
				BackgroundColor3={role("boss")}
				BorderSizePixel={0}
				ZIndex={BAR_Z.fill}
			/>
			{notches(props.marks, props.frac)}
		</frame>
	);
}

/**
 * The pill bar (docs/UI_ART.md UA11): ui.bar.track at the largest whole screen px per art px that fits the
 * HUD_VIEW.bossBarHeight row (pillFit; its end caps at the same scale), centred in the row; the white ui.bar.fill tinted
 * `boss` drawn at the track's full size inside a ClipsDescendants frame as wide as the hp fraction (fillClip), so the
 * fill's right end is cut, never squashed; without the fill art, a flat `boss` fill in the same clip. Notches on top.
 */
function PillBar(props: { frac: number; marks: ReadonlyArray<number>; trackId: string; fillId: string | undefined }) {
	const uiScale = useHudScale();
	const track = themePack()?.image(props.trackId);
	const pill = pillFit(track?.h ?? HUD_VIEW.bossBarHeight, HUD_SKIN.bossBarBox, uiScale);
	const clip = fillClip(props.frac);
	const fillSize = UDim2.fromScale(clip.inner, 1);
	return (
		<frame
			LayoutOrder={2}
			Size={new UDim2(1, 0, 0, HUD_VIEW.bossBarHeight)}
			BackgroundTransparency={HIDDEN}
			BorderSizePixel={0}
		>
			<frame
				key="Pill"
				AnchorPoint={new Vector2(0, HALF)}
				Position={UDim2.fromScale(0, HALF)}
				Size={new UDim2(1, 0, 0, pill.h)}
				BackgroundTransparency={HIDDEN}
				BorderSizePixel={0}
			>
				<SlicedImage
					key="Track"
					name="Track"
					id={props.trackId}
					sliceScale={pill.sliceScale}
					zIndex={BAR_Z.track}
				/>
				<frame
					key="Clip"
					Size={UDim2.fromScale(clip.clip, 1)}
					Visible={clip.visible}
					ClipsDescendants={true}
					BackgroundTransparency={HIDDEN}
					BorderSizePixel={0}
					ZIndex={BAR_Z.fill}
				>
					{props.fillId !== undefined ? (
						<SlicedImage
							key="Fill"
							name="Fill"
							id={props.fillId}
							sliceScale={pill.sliceScale}
							size={fillSize}
							color={role("boss")}
							zIndex={BAR_Z.fill}
						/>
					) : (
						<frame
							key="Fill"
							Size={fillSize}
							BackgroundColor3={role("boss")}
							BorderSizePixel={0}
							ZIndex={BAR_Z.fill}
						/>
					)}
				</frame>
				{notches(props.marks, props.frac)}
			</frame>
		</frame>
	);
}

/**
 * Top centre (web BossHud): while a live boss is engaged, its name (theme string `<boss id>.name`) and phase (Roman
 * numerals, `boss.hud.phase`), and an hp bar in the `boss` role with a notch at every phase threshold (boss.act1:
 * 66 % / 33 %, from the archetype's phaseHp). Hidden otherwise; the victory line is the run-over panel's.
 * `highlight`: the tutorial's ring (the boss lesson, the phase callouts). With the UI art (docs/UI_ART.md UA11) the
 * panel is the in-run (hud) frame and the bar a pill (PillBar); without, the flat panel and bar.
 */
export function BossBar(props: { readonly highlight?: boolean }) {
	const s = useSelector(selectSnapshot);
	if (!s.bossVisible) return undefined;
	const frac = bossFraction(s.bossHp, s.bossHpMax);
	const width = HUD_VIEW.bossWidth;
	const nameWidth = math.floor((width - HUD_VIEW.pad * 2) * NAME_WIDTH_SHARE);
	const pack = themePack();
	const has = pack !== undefined ? skinHasOf(pack) : undefined;
	const trackId = has !== undefined ? skinFor(has, "bar", "track") : undefined;
	const fillId = has !== undefined ? skinFor(has, "bar", "fill") : undefined;
	return (
		<Panel
			position={new UDim2(HALF, 0, 0, HUD_VIEW.margin)}
			anchor={new Vector2(HALF, 0)}
			width={width}
			name="BossBar"
			skin="hud"
		>
			<Row order={1}>
				<Text order={1} width={nameWidth} size={HUD_VIEW.titleText} text={str(`${s.bossId}.name`)} />
				<Text
					order={2}
					width={width - HUD_VIEW.pad * 2 - nameWidth - HUD_VIEW.gap}
					size={HUD_VIEW.titleText}
					color="uiAccent"
					align={Enum.TextXAlignment.Right}
					text={str(HUD_STRINGS.bossPhase, { phase: romanPhase(s.bossPhase) })}
				/>
			</Row>
			{trackId !== undefined ? (
				<PillBar frac={frac} marks={s.bossPhaseMarks} trackId={trackId} fillId={fillId} />
			) : (
				<FlatBar frac={frac} marks={s.bossPhaseMarks} />
			)}
			{props.highlight === true ? <HighlightRing /> : undefined}
		</Panel>
	);
}
