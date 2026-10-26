import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectReplayCheck, selectRunInfo, selectSnapshot, selectVerdict, type VerdictView } from "client/store";
import { str } from "client/ui/theme";
import { REPLAY_CHECK_KEYS } from "shared/play";
import { HUD_STRINGS, HUD_VIEW, endingKey, leaderboardPostKey, shortHash, verdictKey } from "shared/view/hud";
import { Panel, Text } from "./primitives";

const INFO_WIDTH = 600;

/** The server's verdict on this run's submission as one status line ("" when there is none). */
function verdictLine(v: VerdictView): string {
	const key = verdictKey(v.status, v.code); // a tutorial run: "Practice: not submitted (tutorial)"
	if (key === "") return "";
	const line = str(key, {
		run: v.run ?? 0,
		ending: str(endingKey(v.ending)),
		hash: shortHash(v.serverHash),
		code: v.code ?? "?",
		reason: v.reason ?? "",
	});
	// Ranked runs: where the run went on the leaderboards.
	const posted = leaderboardPostKey(v.leaderboard);
	return posted !== undefined ? `${line} · ${str(posted)}` : line;
}

/**
 * Bottom right: the run's info line (title, biome, seed, dungeon name), the fallback notice when the requested world
 * could not start, the server's verdict as a small status line, and (KV_Debug only) the debug line with the replay
 * check. Every text from the theme string table.
 */
export function InfoPanel() {
	const info = useSelector(selectRunInfo);
	const verdict = useSelector(selectVerdict);
	const replay = useSelector(selectReplayCheck);
	const s = useSelector(selectSnapshot);
	const place = info.placeKey !== "" ? str(info.placeKey) : info.world;
	const verdictText = verdictLine(verdict);
	let replayText = str(HUD_STRINGS.replayHint, { key: REPLAY_CHECK_KEYS.join(" / ") });
	if (replay !== undefined) {
		replayText = str(replay.match ? HUD_STRINGS.replayMatch : HUD_STRINGS.replayMismatch, { ticks: replay.ticks });
	}
	return (
		<Panel
			position={new UDim2(1, -HUD_VIEW.margin, 1, -HUD_VIEW.margin)}
			anchor={new Vector2(1, 1)}
			width={INFO_WIDTH}
			name="Info"
		>
			<Text
				order={1}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={Enum.TextXAlignment.Right}
				text={str(HUD_STRINGS.info, {
					title: str(HUD_STRINGS.title),
					place,
					seed: str(HUD_STRINGS.seed, { seed: info.seed }),
					dungeon: info.dungeonName,
				})}
			/>
			{info.notice !== "" ? (
				<Text
					order={2}
					size={HUD_VIEW.smallText}
					color="telegraph"
					align={Enum.TextXAlignment.Right}
					wrap={true}
					text={str(HUD_STRINGS.noticeFallback, { reason: info.notice })}
				/>
			) : undefined}
			{verdictText !== "" ? (
				<Text
					order={3}
					size={HUD_VIEW.smallText}
					color={
						verdict.status === "rejected"
							? "uiHealth"
							: verdict.status === "accepted"
							? "uiText"
							: "uiTextDim"
					}
					align={Enum.TextXAlignment.Right}
					wrap={true}
					text={verdictText}
				/>
			) : undefined}
			{info.debug ? (
				<Text
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
		</Panel>
	);
}
