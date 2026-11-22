/**
 * The client's one door to the output window: every client log line goes through this module, and ESLint forbids the
 * globals `print` and `warn` everywhere else under `src/client` (`.eslintrc.json`). The functions add nothing: no
 * prefix, no level filter, no buffering, so a line reads in the Studio output exactly as its call site wrote it (the
 * docs' Studio checks quote many of them). The server's twin is `server/log`.
 *
 * @module
 */

/** One-line client logs with a stable `[source] EVENT_CODE: message` shape (greppable in the Studio output). */
export interface ClientLogger {
	/** Prints `[source] event: message`. */
	info: (event: string, message: string) => void;
	/** Warns `[source] event: message`. */
	warn: (event: string, message: string) => void;
}

/**
 * Prints `message` as it is, as the global `print` would. For lines whose text is already fixed (the `KV_*` debug
 * lines, the spikes' reports); the caller builds the string, so a line gated by a debug switch costs nothing while
 * the switch is off only if the call itself sits inside the gate.
 */
export function logInfo(message: string): void {
	print(message);
}

/** Warns `message` as it is, as the global `warn` would (the output's warning colour, no prefix added). */
export function logWarn(message: string): void {
	warn(message);
}

/**
 * A logger for one client module: `info` prints and `warn` warns a line `[source] EVENT_CODE: message`, the shape of
 * the server's `serverLogger`. For new lines; an existing line keeps its text through {@link logInfo} /
 * {@link logWarn}.
 */
export function clientLogger(source: string): ClientLogger {
	return {
		info: (event, message) => logInfo(`[${source}] ${event}: ${message}`),
		warn: (event, message) => logWarn(`[${source}] ${event}: ${message}`),
	};
}
