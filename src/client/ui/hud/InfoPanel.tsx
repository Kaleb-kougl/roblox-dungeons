import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectLatencyProbe, selectReplayCheck, selectRunInfo, selectSnapshot, selectVerdict } from "client/store";
import { str } from "client/ui/theme";
import { REPLAY_CHECK_KEYS } from "shared/play";
import { latencyProbeVars } from "shared/view";
import { HUD_HINTS, HUD_STRINGS, HUD_TRANSIENT, HUD_VIEW, VERDICT_BOX } from "shared/view/hud";
import { Panel, Text } from "./primitives";
import { noticeText, verdictColor, verdictLine } from "./RunInfoLine";
import { useTimedHint } from "./useTimedHint";

const RIGHT = 1;
const BOTTOM = 1;

/**
 * Bottom right, transient (docs/HUD_LAYOUT.md H6): the fallback notice when the requested world could not start and
 * the server's verdict as a small status line, each shown for HUD_HINTS.verdictSeconds after its text changes and then
 * faded out (useTimedHint), and (KV_Debug only) the debug line with the replay check, which never fades, and in a
 * co-op run the latency probe's line under it (input lead, press -> stepped tick; docs/FEEL.md J9). The run's
 * info line (title, biome, seed, dungeon) is not here: it lives in the PauseOverlay and the RunOverPanel (RunInfoLine,
 * HD6). Nothing at all, not even the panel, when no line shows. Width: the footprint's verdict box (HUD_TRANSIENT).
 * Once the run is over the verdict line stays off: the RunOverPanel shows it in the centre. It sits above the corner
 * minimap (docs/MINIMAP.md M8: VERDICT_BOX.edge from the safe area's bottom, HUD_VIEW.margin from its right) and is not
 * a corner panel (the bottom-right corner's occlusion slot belongs to the minimap).
 */
export function InfoPanel() {
	const info = useSelector(selectRunInfo);
	const verdict = useSelector(selectVerdict);
	const replay = useSelector(selectReplayCheck);
	const probe = useSelector(selectLatencyProbe);
	const s = useSelector(selectSnapshot);
	const notice = noticeText(info);
	const verdictText = verdictLine(verdict);
	const noticeHint = useTimedHint(HUD_HINTS.verdictSeconds, [notice]);
	const verdictHint = useTimedHint(HUD_HINTS.verdictSeconds, [verdictText]);
	const showNotice = notice !== "" && !noticeHint.hidden;
	const showVerdict = verdictText !== "" && !verdictHint.hidden && s.outcome === "playing";
	if (!showNotice && !showVerdict && !info.debug) return undefined;
	let replayText = str(HUD_STRINGS.replayHint, { key: REPLAY_CHECK_KEYS.join(" / ") });
	if (replay !== undefined) {
		replayText = str(replay.match ? HUD_STRINGS.replayMatch : HUD_STRINGS.replayMismatch, { ticks: replay.ticks });
	}
	return (
		<Panel
			position={new UDim2(RIGHT, -HUD_VIEW.margin, BOTTOM, -VERDICT_BOX.edge)}
			anchor={new Vector2(RIGHT, BOTTOM)}
			width={HUD_TRANSIENT.verdict.width}
			name="Info"
		>
			{showNotice ? (
				<Text
					order={2}
					size={HUD_VIEW.smallText}
					color="telegraph"
					align={Enum.TextXAlignment.Right}
					wrap={true}
					transparency={noticeHint.fade}
					text={notice}
				/>
			) : undefined}
			{showVerdict ? (
				<Text
					order={3}
					size={HUD_VIEW.smallText}
					color={verdictColor(verdict)}
					align={Enum.TextXAlignment.Right}
					wrap={true}
					transparency={verdictHint.fade}
					text={verdictText}
				/>
			) : undefined}
			{info.debug ? (
				<Text
					fill={true}
					order={4}
					size={HUD_VIEW.smallText}
					mono={true}
					color="uiTextDim"
					align={Enum.TextXAlignment.Right}
					text={str(HUD_STRINGS.debug, {
						tick: s.tick,
						rec: s.recordedTicks,
						enemies: s.enemiesAlive,
						enemyBullets: s.enemyBullets,
						playerBullets: s.playerBullets,
						replay: replayText,
					})}
				/>
			) : undefined}
			{info.debug && probe !== undefined ? (
				<Text
					wrap={true}
					order={5}
					size={HUD_VIEW.smallText}
					mono={true}
					color="uiTextDim"
					align={Enum.TextXAlignment.Right}
					text={str(HUD_STRINGS.netProbe, latencyProbeVars(probe))}
				/>
			) : undefined}
		</Panel>
	);
}
