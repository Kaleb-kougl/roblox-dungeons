import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectSnapshot } from "client/store";
import { role, str } from "client/ui/theme";
import { HUD_STRINGS, HUD_VIEW, bossFraction, romanPhase } from "shared/view/hud";
import { Panel, Row, Text } from "./primitives";

const HALF = 0.5;
const STROKE = 1;
const NAME_WIDTH_SHARE = 0.7;

/**
 * Top centre (web BossHud): while a live boss is engaged, its name (theme string `<boss id>.name`) and phase (Roman
 * numerals, `boss.hud.phase`), and an hp bar in the `boss` role with a notch at every phase threshold (boss.act1:
 * 66 % / 33 %, from the archetype's phaseHp). Hidden otherwise; the victory line is the run-over panel's.
 */
export function BossBar() {
	const s = useSelector(selectSnapshot);
	if (!s.bossVisible) return undefined;
	const frac = bossFraction(s.bossHp, s.bossHpMax);
	const width = HUD_VIEW.bossWidth;
	const nameWidth = math.floor((width - HUD_VIEW.pad * 2) * NAME_WIDTH_SHARE);
	const notches = s.bossPhaseMarks.map((m, i) => (
		<frame
			key={`n${i}`}
			AnchorPoint={new Vector2(HALF, 0)}
			Position={UDim2.fromScale(m, 0)}
			Size={new UDim2(0, HUD_VIEW.bossNotchWidth, 1, 0)}
			BackgroundColor3={role("uiText")}
			BackgroundTransparency={frac <= m ? HALF : 0}
			BorderSizePixel={0}
			ZIndex={3}
		/>
	));
	return (
		<Panel
			position={new UDim2(HALF, 0, 0, HUD_VIEW.margin)}
			anchor={new Vector2(HALF, 0)}
			width={width}
			name="BossBar"
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
			<frame
				LayoutOrder={2}
				Size={new UDim2(1, 0, 0, HUD_VIEW.bossBarHeight)}
				BackgroundColor3={role("uiPanel")}
				BorderSizePixel={0}
			>
				<uistroke Thickness={STROKE} Color={role("uiTextDim")} />
				<frame Size={UDim2.fromScale(frac, 1)} BackgroundColor3={role("boss")} BorderSizePixel={0} ZIndex={2} />
				{notches}
			</frame>
		</Panel>
	);
}
