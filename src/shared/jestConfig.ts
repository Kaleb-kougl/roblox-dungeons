import type { Config } from "@rbxts/jest";

/**
 * Jest configuration for the Studio test runner (plugin/RunTestsPlugin.server.lua).
 *
 * Named `jestConfig.ts`, not `jest.config.ts`: Rojo treats the first dot in a file name as the
 * extension separator, so no file can produce an Instance named `jest.config`. The plugin
 * clones this ModuleScript under the name Jest looks for. Jest discovers specs under this
 * module's parent (ReplicatedStorage.TS = src/shared).
 *
 * The headless runner (`npm test`, scripts/lune/run-tests.luau) does not read this file; it
 * runs every `*.spec` under out/shared with the same JestCircus + Expect modules.
 */
export = identity<Config>({
	testMatch: ["**/*.spec"],
	testPathIgnorePatterns: ["/node_modules/"],
});
