/**
 * The run-over panel's main line in a solo run (client/ui/hud RunOverPanel; a party run's is
 * shared/view/menu partyRunOverLine). Pure, headlessly tested (runOverLine.spec.ts).
 *
 * @module
 */
import { HUD_STRINGS } from "./strings";

/**
 * The theme string key: the boss defeated, the run left with Leave run (`left`: its forfeit counts as a death), or a
 * death. Every one takes `{key}` (the restart key); the victory line also `{name}` (the boss).
 */
export function soloRunOverLineKey(victory: boolean, left: boolean): string {
	if (victory) return HUD_STRINGS.victory;
	return left ? HUD_STRINGS.left : HUD_STRINGS.dead;
}
