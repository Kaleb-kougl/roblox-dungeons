/**
 * Bastion's brace feedback tunables (docs/LEGENDARIES.md LG6) beyond the floor ring (BUILD_FX_VIEW.brace): the floor
 * shout (the combo shout's slot, ComboController.requestShout at FLOOR_SHOUT_PRIORITY.brace), the armor row's pulse in
 * the status panel and the toast. Real seconds; px are HUD reference px. Data only: braceFx.ts applies them, the
 * client's BraceFxController draws them. Presentation only.
 *
 * @module
 */
import type { ColorRole } from "shared/theme";

export const BRACE_VIEW = {
	/** BRACED on the floor (`fx.brace.text`, capitals in the string): its life in the shout slot and its colour. */
	shout: {
		lifeSec: 0.9,
		role: "uiMana" as ColorRole,
	},
	/**
	 * The armor row's pulse on a pip restored: a stroke round the armor pips in the pip colour, thickness t0Px -> t1Px
	 * (eased out) while it fades out over `sec`; under reduced motion it stays at t1Px and only fades.
	 */
	pulse: {
		sec: 0.45,
		t0Px: 4,
		t1Px: 1,
		role: "uiMana" as ColorRole,
	},
	/** The toast (top centre, ToastPanel): how long it shows; ids count down from idBase (apart from every other base). */
	toast: {
		seconds: 2.5,
		idBase: -(2 ** 23),
	},
	/** Theme string keys (LG5, BUILD_STRING_KEYS). */
	strings: {
		shout: "fx.brace.text",
		toastPip: "hud.toast.brace",
		toastHeal: "hud.toast.braceHeal",
	},
} as const;
