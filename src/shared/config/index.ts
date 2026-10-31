/**
 * Barrel for shared configuration: every tunable lives here or in the module that owns it,
 * never as a literal in logic (CLAUDE.md, "No magic numbers").
 *
 * Import through the directory (`shared/config`), never the file.
 */
export * from "./spikes";
export * from "./view";
export * from "./mode";
export * from "./theme";
export * from "./tutorial";
export * from "./touch";
export * from "./devMode";
