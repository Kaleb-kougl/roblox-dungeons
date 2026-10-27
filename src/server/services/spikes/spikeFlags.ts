import { Workspace } from "@rbxts/services";
import { SPIKE_ATTRIBUTES, SPIKE_DEFAULTS, SpikeName } from "shared/config";

/**
 * The server's copy of client/controllers/spikes spikeFlags (client and server never import each other): true when
 * the spike is on, from the Workspace attribute if it is a boolean, else SPIKE_DEFAULTS.
 */
export function isServerSpikeEnabled(name: SpikeName): boolean {
	const value = Workspace.GetAttribute(SPIKE_ATTRIBUTES[name]);
	return typeIs(value, "boolean") ? value : SPIKE_DEFAULTS[name];
}

/** Calls `onChange` with the current state now and on every change of the spike's attribute; returns the connection. */
export function watchServerSpikeFlag(name: SpikeName, onChange: (enabled: boolean) => void): RBXScriptConnection {
	const connection = Workspace.GetAttributeChangedSignal(SPIKE_ATTRIBUTES[name]).Connect(() =>
		onChange(isServerSpikeEnabled(name)),
	);
	onChange(isServerSpikeEnabled(name));
	return connection;
}
