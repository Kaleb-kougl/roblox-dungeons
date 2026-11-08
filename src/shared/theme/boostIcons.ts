/**
 * Roblox port (docs/BOOSTS.md B7, the HUD's boost row): the boost icons, optional free-form ui images (the UI slot's
 * `ui.` prefix, like the boon / relic / curse icons, boonIcons.ts / itemIcons.ts), one per temporary boost:
 * `ui.boost.<kind>` for every BOOST_KINDS entry (kinds are lowercase already: "fury" -> "ui.boost.fury"). A pack may
 * draw any of them; a boost without one keeps its colour square and short text label (`boost.<kind>.icon`). The vale
 * pack packs them into a sheet of their own (packs/vale boostIconLayout.ts, scripts/art/gen-boost-icons.js), each an
 * `image` of the sheet with its `rect`.
 * In its own module: contract.ts sits near Luau's 200-locals-per-function limit.
 */
import type { BoostKind } from "./contract";

/** Every boost icon id starts with this. */
export const BOOST_ICON_PREFIX = "ui.boost.";

/** The icon id of boost kind `kind` ("fury" -> "ui.boost.fury"). */
export function boostIconId(kind: BoostKind): string {
	return `${BOOST_ICON_PREFIX}${kind}`;
}
