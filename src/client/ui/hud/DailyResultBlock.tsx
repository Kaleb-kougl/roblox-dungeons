import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectDailyStatus, selectRunInfo, selectSnapshot, selectVerdict } from "client/store";
import { str } from "client/ui/theme";
import { DAILY_WORLD_KIND } from "shared/daily";
import type { ColorRole } from "shared/theme";
import { DAILY_STRINGS, HUD_VIEW, dailyResultBlock, dailyText, type DailyResultStatus } from "shared/view/hud";
import { useDailyClock } from "./dailyHooks";
import { Row, Text } from "./primitives";

const HIDDEN = 1;

/**
 * The run-over panel's daily block (docs/DAILY.md DS11), daily runs only (nothing otherwise: the endless panel is
 * unchanged). Lines (shared/view/hud dailyResultBlock): `Daily #304`; the standing (`#38 today`, `Top 14%`, `#3 of 12
 * today`) and `of 1,240 players`; `Best today 23,410 -> 26,870` (accent when improved; left out when new best's block
 * draws a best line this run, its record rows or its target line: `bestLineShown`); the run's ONE save chip, from
 * `verdict.daily.posted` (`Saved` accent / `Not saved` uiHealth; nothing while the verdict is out: the server may
 * wait up to 15 s for the post; new best's block draws none on a daily run); the countdown
 * (`New daily in 5:10:02`, a per-second binding). Retry Daily is the panel's first exit button (RunOverPanel).
 */
export function DailyResultBlock(props: { order: number; bestLineShown: boolean }) {
	const info = useSelector(selectRunInfo);
	const verdict = useSelector(selectVerdict);
	const snapshot = useSelector(selectSnapshot);
	const status = useSelector(selectDailyStatus);
	const clock = useDailyClock(status?.resetsAt);
	if (info.world !== DAILY_WORLD_KIND) return undefined;
	const current = verdict.run === info.run;
	const verdictStatus: DailyResultStatus =
		!current || verdict.status === "none" || verdict.status === "pending" ? "pending" : verdict.status;
	const accepted = verdictStatus === "accepted";
	const block = dailyResultBlock({
		daily: true,
		status: verdictStatus,
		result: current ? verdict.daily : undefined,
		score: (accepted ? verdict.serverScore : undefined) ?? snapshot.score,
		label: status?.label,
		bestLineShown: props.bestLineShown,
	});
	if (block === undefined) return undefined;
	// Three short rows so the panel grows by little (a desktop panel is never scaled to fit): the day and the
	// countdown; the standing and the entrants; the best-today line and the save chip.
	const piece = (
		key: string,
		order: number,
		text: string | React.Binding<string>,
		size: number,
		color: ColorRole,
	) => <Text key={key} order={order} size={size} color={color} text={text} />;
	const head = (
		<Row key="Head" order={1} align={Enum.HorizontalAlignment.Center}>
			{block.title !== undefined
				? piece("Title", 1, dailyText(block.title, str), HUD_VIEW.smallText, "uiTextDim")
				: undefined}
			{piece("Countdown", 2, clock.countdown, HUD_VIEW.smallText, "uiTextDim")}
		</Row>
	);
	const standing =
		block.standing !== undefined ? (
			<Row key="Standing" order={2} align={Enum.HorizontalAlignment.Center}>
				{piece("Rank", 1, dailyText(block.standing, str), HUD_VIEW.titleText, "uiAccent")}
				{block.entrants !== undefined
					? piece("Entrants", 2, dailyText(block.entrants, str), HUD_VIEW.smallText, "uiTextDim")
					: undefined}
			</Row>
		) : undefined;
	const savedKey =
		block.saved === undefined
			? undefined
			: block.saved === "saved"
			? DAILY_STRINGS.resultSaved
			: DAILY_STRINGS.resultUnsaved;
	const result =
		block.best !== undefined || savedKey !== undefined ? (
			<Row key="Result" order={3} align={Enum.HorizontalAlignment.Center}>
				{block.best !== undefined
					? piece(
							"BestToday",
							1,
							dailyText(block.best, str),
							HUD_VIEW.textSize,
							block.improved ? "uiAccent" : "uiText",
					  )
					: undefined}
				{savedKey !== undefined
					? piece(
							"Saved",
							2,
							str(savedKey),
							HUD_VIEW.smallText,
							block.saved === "saved" ? "uiAccent" : "uiHealth",
					  )
					: undefined}
			</Row>
		) : undefined;
	return (
		<frame
			key="Daily"
			LayoutOrder={props.order}
			Size={new UDim2(1, 0, 0, 0)}
			AutomaticSize={Enum.AutomaticSize.Y}
			BackgroundTransparency={HIDDEN}
		>
			<uilistlayout
				FillDirection={Enum.FillDirection.Vertical}
				HorizontalAlignment={Enum.HorizontalAlignment.Center}
				SortOrder={Enum.SortOrder.LayoutOrder}
				Padding={new UDim(0, HUD_VIEW.gap)}
			/>
			{head}
			{standing}
			{result}
		</frame>
	);
}
