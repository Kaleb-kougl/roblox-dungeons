/**
 * SimController's listener fan-out (docs/SIM_CONTROLLER.md step 4; moved out of SimController.ts unchanged, the controller's
 * `debug` now the parameter `timed`) and the KV_Debug stage timing lines' units (docs/STAGE_LOADER.md SL0).
 *
 * @module
 */
import { logInfo } from "client/log";
import { formatListenerTimes, listenerLabel, type ListenerTime } from "shared/view";
import type { RunContext, RunListener } from "./context";

/** Milliseconds per second (the timing lines print ms from os.clock seconds). */
export const MS_PER_SECOND = 1000;

/** The KV_Debug stage timing lines' millisecond format (SL0). */
export const MS_FORMAT = "%.1f";

/**
 * Calls `list` in order with `ctx`. `timed` (KV_Debug, docs/STAGE_LOADER.md SL0): each call timed with os.clock and
 * printed in one line, labelled by the listener's script (`debug.info(f, "s")`: "World" for WorldController); nothing extra
 * otherwise.
 */
export function callListeners(list: ReadonlyArray<RunListener>, ctx: RunContext, what: string, timed: boolean): void {
	if (!timed) {
		for (const listener of list) listener(ctx);
		return;
	}
	const times = new Array<ListenerTime>();
	const start = os.clock();
	for (const listener of list) {
		const t0 = os.clock();
		listener(ctx);
		const [source] = debug.info(listener, "s");
		times.push({ label: listenerLabel(source ?? "?"), ms: (os.clock() - t0) * MS_PER_SECOND });
	}
	const total = string.format(MS_FORMAT, (os.clock() - start) * MS_PER_SECOND);
	logInfo(`[Stage] listeners (${what}, ${total} ms): ${formatListenerTimes(times)}`);
}
