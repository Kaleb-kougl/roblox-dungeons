import React, { useEffect, useRef, useState } from "@rbxts/react";
import { RunService, Workspace } from "@rbxts/services";
import { str } from "client/ui/theme";
import { dailyDay } from "shared/daily";
import { dailyCountdownLine, dailySecondsLeft, dailyText } from "shared/view/hud";

/** The Daily's clock on the menu / run-over screens: today's day index and the countdown line. */
export interface DailyClock {
	/** dailyDay(Workspace:GetServerTimeNow()): re-renders only when the UTC day changes. */
	readonly today: number;
	/** `New daily in 5:12:33`, written once per second as a binding (never a re-render). */
	readonly countdown: React.Binding<string>;
}

function countdownAt(resetsAt: number | undefined): string {
	return dailyText(dailyCountdownLine(Workspace.GetServerTimeNow(), resetsAt), str);
}

/**
 * The Daily's countdown (docs/DAILY.md DS9 / DS11) on the server clock (the clock the server counts days with), from
 * the status's `resetsAt` while it is ahead, else the next UTC midnight (shared/view/hud dailySecondsLeft). A Heartbeat
 * writes the binding only when the whole second changes; the component re-renders only when the day does.
 */
export function useDailyClock(resetsAt: number | undefined): DailyClock {
	const [today, setToday] = useState(() => dailyDay(Workspace.GetServerTimeNow()));
	const [countdown, setCountdown] = React.useBinding(countdownAt(resetsAt));
	const todayRef = useRef(today);
	useEffect(() => {
		let shown = -1;
		const tick = () => {
			const now = Workspace.GetServerTimeNow();
			const left = dailySecondsLeft(now, resetsAt);
			if (left !== shown) {
				shown = left;
				setCountdown(dailyText(dailyCountdownLine(now, resetsAt), str));
			}
			const d = dailyDay(now);
			if (d !== todayRef.current) {
				todayRef.current = d;
				setToday(d);
			}
		};
		tick();
		const conn = RunService.Heartbeat.Connect(tick);
		return () => conn.Disconnect();
	}, [resetsAt]);
	return { today, countdown };
}
