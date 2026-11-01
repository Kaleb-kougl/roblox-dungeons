import React from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { selectDailyPassed, selectDailyPassedRun, selectRunInfo } from "client/store";
import { role, str, useNameFont } from "client/ui/theme";
import { DAILY_WORLD_KIND } from "shared/daily";
import {
	DAILY_RANK,
	DAILY_RANK_STRINGS,
	FOOTPRINT_ESTIMATE,
	HUD_VIEW,
	dailyPassedMoreText,
	dailyPassedView,
	type DailyRankEntry,
} from "shared/view/hud";
import { useHeadshot } from "./headshots";
import { Row, Text } from "./primitives";

const HIDDEN = 1;
const FULL_ROUND = new UDim(1, 0);

/** One friend passed: the headshot (blank until it loads, or when it fails) over the name. */
function PassedFriend(props: { readonly order: number; readonly friend: DailyRankEntry }) {
	const nameFont = useNameFont(); // a display name (LD13)
	const image = useHeadshot(props.friend.userId);
	const px = DAILY_RANK.passedHeadshotPx;
	const nameH = HUD_VIEW.smallText + FOOTPRINT_ESTIMATE.lineSlack;
	return (
		<frame
			LayoutOrder={props.order}
			Size={new UDim2(0, DAILY_RANK.passedCellPx, 0, px + nameH)}
			BackgroundTransparency={HIDDEN}
		>
			<imagelabel
				key="Headshot"
				AnchorPoint={new Vector2(1 / 2, 0)}
				Position={UDim2.fromScale(1 / 2, 0)}
				Size={UDim2.fromOffset(px, px)}
				BackgroundTransparency={HUD_VIEW.panelTransparency}
				BackgroundColor3={role("background")}
				BorderSizePixel={0}
				Image={image}
			>
				<uicorner CornerRadius={FULL_ROUND} />
			</imagelabel>
			<textlabel
				key="Name"
				Position={UDim2.fromOffset(0, px)}
				Size={new UDim2(1, 0, 0, nameH)}
				BackgroundTransparency={HIDDEN}
				Font={nameFont}
				TextScaled={true}
				TextSize={HUD_VIEW.smallText}
				TextXAlignment={Enum.TextXAlignment.Center}
				Text={props.friend.name}
				TextColor3={role("uiText")}
				TextStrokeColor3={role("background")}
				TextStrokeTransparency={HUD_VIEW.panelTransparency}
			>
				<uitextsizeconstraint MaxTextSize={HUD_VIEW.smallText} />
			</textlabel>
		</frame>
	);
}

/**
 * The run-over panel's row of friends a daily run passed (docs/DAILY.md DS10 / DS11): `You passed`, up to
 * DAILY_RANK.passedShown headshots with names (dailyPassedView), then `+{n} more`. Only for the daily run on screen
 * (RunInfo.world daily and the dailyRank slice's run is this one) that passed at least one friend; nothing otherwise.
 * DailyRankController fills the slice as the run passes friends (the in-run prediction from the board at run start;
 * only the server's verdict saves the run).
 */
export function DailyPassedRow(props: { readonly order: number }) {
	const info = useSelector(selectRunInfo);
	const passed = useSelector(selectDailyPassed);
	const run = useSelector(selectDailyPassedRun);
	if (info.world !== DAILY_WORLD_KIND || run !== info.run || passed.size() === 0) return undefined;
	const v = dailyPassedView(passed);
	const more = dailyPassedMoreText(v.more, str);
	return (
		<Row key="DailyPassed" order={props.order} align={Enum.HorizontalAlignment.Center}>
			<Text
				key="Label"
				order={0}
				size={HUD_VIEW.smallText}
				color="uiTextDim"
				text={str(DAILY_RANK_STRINGS.passedLabel)}
			/>
			{v.shown.map((f, i) => (
				<PassedFriend key={`f${f.userId}`} order={i + 1} friend={f} />
			))}
			{more !== "" ? (
				<Text key="More" order={v.shown.size() + 1} size={HUD_VIEW.smallText} color="uiTextDim" text={more} />
			) : undefined}
		</Row>
	);
}
