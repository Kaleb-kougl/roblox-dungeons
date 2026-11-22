import { RunService, Workspace } from "@rbxts/services";
import { SPIKE_ATTRIBUTES, SPIKE_DEFAULTS, SpikeName } from "shared/config";
import { serverSpikeAllowed } from "shared/spikes";

/**
 * The server's copy of client/controllers/spikes spikeFlags (client and server never import each other): true when
 * the spike is on, from the Workspace attribute if it is a boolean, else SPIKE_DEFAULTS. Always false on a published
 * server whose place is not in SPIKE_TEST_PLACES (shared/spikes `serverSpikeAllowed`, docs/SERVER_FINDINGS.md SFD2):
 * the live place never runs a server spike.
 */
export function isServerSpikeEnabled(name: SpikeName): boolean {
	if (!serverSpikeAllowed(RunService.IsStudio(), game.PlaceId)) return false;
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
