import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectRunInfo, type RunInfo, type VerdictView } from "client/store";
import { str } from "client/ui/theme";
import type { ColorRole } from "shared/theme";
import { HUD_STRINGS, HUD_VIEW, endingKey, leaderboardPostKey, shortHash, verdictKey } from "shared/view/hud";
import { Text } from "./primitives";

const HIDDEN = 1;

/** The run's info line: title · biome · seed · dungeon name (theme string `HUD_STRINGS.info`). */
export function runInfoText(info: Readonly<RunInfo>): string {
	const place = info.placeKey !== "" ? str(info.placeKey) : info.world;
	return str(HUD_STRINGS.info, {
		title: str(HUD_STRINGS.title),
		place,
		seed: str(HUD_STRINGS.seed, { seed: info.seed }),
		dungeon: info.dungeonName,
	});
}

/** The fallback notice when the requested world could not start ("" when there is none). */
export function noticeText(info: Readonly<RunInfo>): string {
	return info.notice !== "" ? str(HUD_STRINGS.noticeFallback, { reason: info.notice }) : "";
}

/** The server's verdict on this run's submission as one status line ("" when there is none). */
export function verdictLine(v: VerdictView): string {
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
	return posted !== undefined ? str(HUD_STRINGS.verdictWithPost, { verdict: line, posted: str(posted) }) : line;
}

/** The verdict line's colour role: rejected in uiHealth, accepted in uiText, the rest dim. */
export function verdictColor(v: VerdictView): ColorRole {
	return v.status === "rejected" ? "uiHealth" : v.status === "accepted" ? "uiText" : "uiTextDim";
}

/**
 * The run's info line and, when the requested world could not start, the fallback notice under it (docs/HUD_LAYOUT.md
 * H6, HD6: never on screen during play; the PauseOverlay and the RunOverPanel show it). Fills the parent's width and
 * wraps; `align` the text (default centre).
 */
export function RunInfoLine(props: { order: number; align?: Enum.TextXAlignment }) {
	const info = useSelector(selectRunInfo);
	const align = props.align ?? Enum.TextXAlignment.Center;
	const notice = noticeText(info);
	return (
		<frame
			key="RunInfo"
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			<Text
				order={1}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				align={align}
				wrap={true}
				text={runInfoText(info)}
			/>
			{notice !== "" ? (
				<Text order={2} size={HUD_VIEW.smallText} color="telegraph" align={align} wrap={true} text={notice} />
			) : undefined}
		</frame>
	);
}
