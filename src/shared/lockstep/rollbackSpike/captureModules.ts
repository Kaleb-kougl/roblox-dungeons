/**
 * Spec support for the rollback spike (docs/ROLLBACK_SPIKE.md R2 / R4): the captured runs scripts/gen-fixtures.js turns
 * from the gitignored `captures/<runId>.json` (written by scripts/rollback/receive-captures.js) into the gitignored
 * modules `shared/fixtures-generated/captures/<runId>` = { runId, meta, chunks }, found at run time (none: an empty
 * list, so specs skip) and decoded with shared/spikes decodeCapture. Needs the module tree (headless Lune or Studio);
 * the model itself never calls it.
 */
import { decodeCapture, type DecodedCapture } from "shared/spikes";

/** The generated folder under the shared root (ReplicatedStorage.TS) and its captures sub-folder. */
const FIXTURES_FOLDER = "fixtures-generated";
const CAPTURES_FOLDER = "captures";

export interface CaptureModule {
	readonly name: string;
	readonly capture: DecodedCapture;
}

/** The shared root (ReplicatedStorage.TS) of a module at shared/lockstep/rollbackSpike/<file>. */
export function sharedRootOf(moduleScript: LuaSourceContainer): Instance | undefined {
	return moduleScript.Parent?.Parent?.Parent;
}

/**
 * Every capture module under `sharedRoot` decoded, in name order; one that does not decode is reported through `log`
 * and skipped.
 */
export function loadCaptureModules(sharedRoot: Instance | undefined, log: (line: string) => void): CaptureModule[] {
	const out: CaptureModule[] = [];
	const folder = sharedRoot?.FindFirstChild(FIXTURES_FOLDER)?.FindFirstChild(CAPTURES_FOLDER);
	if (folder === undefined) return out;
	const children = folder.GetChildren().filter((c) => c.IsA("ModuleScript"));
	children.sort((a, b) => a.Name < b.Name);
	for (const child of children) {
		const mod = require(child as ModuleScript) as { default?: { meta?: unknown; chunks?: unknown } };
		const data = mod.default;
		const capture = data !== undefined ? decodeCapture(data.meta, data.chunks) : undefined;
		if (capture === undefined) {
			log(`[R2] capture ${child.Name}: does not decode, skipped`);
			continue;
		}
		out.push({ name: child.Name, capture });
	}
	return out;
}
