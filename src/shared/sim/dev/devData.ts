/**
 * Developer mode's sim tunables (docs/DEV_MODE.md). Data only: dev.ts and the client read these. Kept apart from dev.ts
 * so input.ts can import DEV_GOD_BUTTON without a require cycle.
 */

/**
 * Dev input bit (developer mode only, docs/DEV_MODE.md): a press edge toggles the run's invulnerability
 * (state.dev.invulnerable). The client pulses it for one frame when the dev panel's God mode toggle changes. Only a run
 * with SimConfig.dev reads it (nothing else does). A Roblox-port bit beyond the web build's table, like
 * DEBUG_FLOOR_BUTTON: it is in PORT_BUTTONS / SIM_BUTTONS (input.ts), so the co-op relay strips it and run validation
 * flags it like the other debug bits.
 */
export const DEV_GOD_BUTTON = 65536;
