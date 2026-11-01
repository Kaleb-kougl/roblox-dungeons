import React, { useEffect } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, Players } from "@rbxts/services";
import { selectLocaleCode } from "client/store";

/**
 * Live locale switching for React (docs/LOCALIZATION.md design 8, L6): every root that shows player-facing text (HUD
 * and menus, loading screen, stage card) renders its tree under a LocaleRoot, keyed by the locale code, so a switch
 * remounts the tree once and every `str()` runs again in the new locale (simpler than threading the locale through
 * every call). A remount costs a frame; it happens from Options (a menu) or on a Roblox language change.
 *
 * The gamepad selection survives it: LocaleController calls rememberSelection() just before it dispatches the new
 * locale, and the LocaleRoot that remounted puts the selection back on the button at the same place in the new tree
 * (the Options > Language buttons, typically), after the tree's own focus effects ran.
 */

/** One step from a parent to a child: the child's name and its rank among same-named siblings. */
interface PathStep {
	readonly name: string;
	readonly nth: number;
}

let pendingSelection: PathStep[] | undefined;

/** The path of `obj` from PlayerGui, or undefined when it is not under it. */
function pathFromPlayerGui(obj: Instance): PathStep[] | undefined {
	const playerGui = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui");
	if (playerGui === undefined) return undefined;
	const steps = new Array<PathStep>();
	let node: Instance = obj;
	while (node !== playerGui) {
		const parent = node.Parent;
		if (parent === undefined) return undefined;
		let nth = 0;
		for (const sibling of parent.GetChildren()) {
			if (sibling === node) break;
			if (sibling.Name === node.Name) nth++;
		}
		steps.unshift({ name: node.Name, nth });
		node = parent;
	}
	return steps;
}

function findPath(steps: ReadonlyArray<PathStep>): Instance | undefined {
	let node: Instance | undefined = Players.LocalPlayer.FindFirstChildOfClass("PlayerGui");
	for (const step of steps) {
		if (node === undefined) return undefined;
		let nth = 0;
		let found: Instance | undefined;
		for (const child of node.GetChildren()) {
			if (child.Name !== step.name) continue;
			if (nth === step.nth) {
				found = child;
				break;
			}
			nth++;
		}
		node = found;
	}
	return node;
}

/** Remember where the gamepad selection is, to put it back after the locale remount (LocaleController). */
export function rememberSelection(): void {
	const selected = GuiService.SelectedObject;
	pendingSelection = selected !== undefined ? pathFromPlayerGui(selected) : undefined;
}

/** Put the remembered selection back on the object now at its place (no-op when nothing was remembered). */
function restoreSelection(): void {
	const steps = pendingSelection;
	if (steps === undefined) return;
	const target = findPath(steps);
	if (target === undefined || !target.IsA("GuiObject") || !target.Selectable) return;
	pendingSelection = undefined;
	GuiService.SelectedObject = target;
}

/** Remounts its children when the locale code changes (see above). */
export function LocaleRoot(props: { children?: React.ReactNode }) {
	const code = useSelector(selectLocaleCode);
	useEffect(() => restoreSelection(), [code]);
	return <React.Fragment key={code}>{props.children}</React.Fragment>;
}
