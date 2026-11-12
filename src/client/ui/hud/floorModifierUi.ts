import { ComboUiValue } from "./comboUi";

/**
 * The floor modifier chip's payoff pulse (docs/FLOOR_MODIFIERS.md FM6): module-level React bindings the client's
 * FloorModifierController writes once per rendered frame (shared/view/modifiers chipPulse) and FloorModifierChip reads
 * (a UIScale on the chip and a highlight in the kind's colour under its name). Each value is written only when it
 * changed, so a chip at rest costs no property writes.
 */
export const FLOOR_MODIFIER_UI = {
	/** The chip's UIScale (1: at rest). */
	pulseScale: new ComboUiValue(1),
	/** The highlight's transparency (1: invisible, at rest). */
	pulseTransparency: new ComboUiValue(1),
};

/** No pulse (a new floor, a new run, a run exit). */
export function resetFloorModifierUi(): void {
	FLOOR_MODIFIER_UI.pulseScale.reset();
	FLOOR_MODIFIER_UI.pulseTransparency.reset();
}
