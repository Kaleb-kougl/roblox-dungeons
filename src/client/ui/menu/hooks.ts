import { useEffect, useMemo, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import { selectServerPlayers } from "client/store";
import { str } from "client/ui/theme";
import { MENU_VIEW, type NameOf, type StringSpec } from "shared/view/menu";

/** A player's display name from the players in this server (LobbyController keeps the list), else "#<UserId>". */
export function useNameOf(): NameOf {
	const players = useSelector(selectServerPlayers);
	return useMemo(() => {
		const names = new Map<number, string>();
		for (const p of players) names.set(p.userId, p.name);
		return (id: number) => names.get(id) ?? `#${id}`;
	}, [players]);
}

/** A theme string from a StringSpec (shared/view/menu view models). */
export function spec(s: StringSpec): string {
	return str(s.key, s.vars);
}

/** os.clock(), refreshed every MENU_VIEW.refreshSeconds while `active` (countdowns, invite expiry). */
export function useClock(active: boolean): number {
	const [now, setNow] = useState(os.clock());
	useEffect(() => {
		if (!active) return;
		let acc = 0;
		const conn = RunService.Heartbeat.Connect((dt) => {
			acc += dt;
			if (acc < MENU_VIEW.refreshSeconds) return;
			acc = 0;
			setNow(os.clock());
		});
		setNow(os.clock());
		return () => conn.Disconnect();
	}, [active]);
	return now;
}
