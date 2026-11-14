/**
 * Test support for specs (never imported by the game). Importing this barrel registers the test archetypes
 * (`test.dummy`, `test.chaser`, `test.boss`) in that spec's module world; see testArchetypes.ts.
 */
export * from "./testArchetypes";
export * from "./secretArena";
