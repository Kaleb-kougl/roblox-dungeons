/**
 * The Respite level the vault's lock reads (docs/TREASURE.md TRD10, docs/DIFFICULTY.md). A LEAF: Respite is planned,
 * not built (no SimConfig.respite, no state.respite), so this is the one place that will read it once it lands; until
 * then every vault sees TREASURE_RESPITE_NONE and its tables' level-0 entries (no eased lock).
 *
 * @module
 */
import type { SimState } from "../state";
import { TREASURE_RESPITE_NONE } from "./treasureData";

/** The party's Respite level for the vault's lock: TREASURE_RESPITE_NONE (0) until Respite exists. */
export function treasureRespiteLevel(_state: Readonly<SimState>): number {
	return TREASURE_RESPITE_NONE;
}
