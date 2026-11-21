/** One-line server logs with a stable `[source] EVENT_CODE: message` shape (greppable in the Studio / server output). */
export interface ServerLogger {
	info: (event: string, message: string) => void;
	warn: (event: string, message: string) => void;
}

/**
 * A logger for one server module: `info` prints and `warn` warns a line `[source] EVENT_CODE: message`. Each service
 * makes one with its own name as `source`.
 */
export function serverLogger(source: string): ServerLogger {
	return {
		info: (event, message) => print(`[${source}] ${event}: ${message}`),
		warn: (event, message) => warn(`[${source}] ${event}: ${message}`),
	};
}
