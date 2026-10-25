import { Workspace } from "@rbxts/services";
import { SPIKE_ATTRIBUTES, SPIKE_DEFAULTS, SpikeName } from "shared/config";

/** True when the spike is on: the Workspace attribute if it is a boolean, else SPIKE_DEFAULTS. */
export function isSpikeEnabled(name: SpikeName): boolean {
	const value = Workspace.GetAttribute(SPIKE_ATTRIBUTES[name]);
	return typeIs(value, "boolean") ? value : SPIKE_DEFAULTS[name];
}

/**
 * Calls `onChange` with the current state now, and again whenever the spike's Workspace
 * attribute changes. Returns the connection so the caller can disconnect it.
 */
export function watchSpikeFlag(name: SpikeName, onChange: (enabled: boolean) => void): RBXScriptConnection {
	const connection = Workspace.GetAttributeChangedSignal(SPIKE_ATTRIBUTES[name]).Connect(() =>
		onChange(isSpikeEnabled(name)),
	);
	onChange(isSpikeEnabled(name));
	return connection;
}
