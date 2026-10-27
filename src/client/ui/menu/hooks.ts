import React, { useEffect, useMemo, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, RunService } from "@rbxts/services";
import { selectAnyPanelOpen, selectInputDevice, selectServerPlayers, selectStageCovered } from "client/store";
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

/**
 * With a gamepad, selects `ref`'s button whenever the screen (re)appears: on mount, when `key` changes, and when a
 * panel over it (juice settings, leaderboards) or the stage loader's cover (docs/STAGE_LOADER.md: a lobby start's
 * server wait, a party start's first frames) goes. Never under that cover (pad A would press a hidden button). Clears
 * the selection it set on cleanup.
 */
export function useGamepadFocus(ref: React.RefObject<TextButton>, key: string, enabled = true): void {
	const device = useSelector(selectInputDevice);
	const panelOpen = useSelector(selectAnyPanelOpen);
	const covered = useSelector(selectStageCovered);
	useEffect(() => {
		if (!enabled || panelOpen || covered || device !== "gamepad") return;
		const button = ref.current;
		if (button !== undefined) GuiService.SelectedObject = button;
		return () => {
			if (GuiService.SelectedObject === button) GuiService.SelectedObject = undefined;
		};
	}, [device, panelOpen, covered, key, enabled]);
}
