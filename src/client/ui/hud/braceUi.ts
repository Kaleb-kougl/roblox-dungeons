import { ComboUiValue } from "./comboUi";

/**
 * Bastion's armor row pulse (docs/LEGENDARIES.md LG6): module-level React bindings the client's BraceFxController
 * writes once per rendered frame (shared/view/fx bracePulseLook) and StatusPanel's armor row reads (a stroke round the
 * armor pips). Each value is written only when it changed, so no pulse costs no property writes.
 */
export const BRACE_UI = {
	/** The stroke's thickness, px (0: none). */
	pulseThickness: new ComboUiValue(0),
	/** The stroke's transparency (1: gone). */
	pulseTransparency: new ComboUiValue(1),
};

/** No pulse (a run exit, no run). */
export function resetBraceUi(): void {
	BRACE_UI.pulseThickness.reset();
	BRACE_UI.pulseTransparency.reset();
}
