import { Controller, OnStart } from "@flamework/core";
import { clientStore, selectJuice } from "client/store";
import { BRACE_UI, resetBraceUi } from "client/ui";
import { BRACE_VIEW, braceFeedbackOf, bracePulseLook, type BuildFxFrame } from "shared/view/fx";
import { FLOOR_SHOUT_PRIORITY, PROGRESSION_VIEW } from "shared/view/hud";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { BuildFxController } from "./BuildFxController";
import { ComboController } from "./ComboController";

/**
 * Bastion's brace feedback beyond its floor ring (docs/LEGENDARIES.md LG6), a BuildFxController subscriber: for each
 * brace of the frame (BuildFxFrame.braces) it applies shared/view/fx braceFeedbackOf:
 *
 *   - the view player's PIP / HEAL: BRACED (`fx.brace.text`) in the combo shout's slot (ComboController.requestShout at
 *     FLOOR_SHOUT_PRIORITY.brace, the lowest request: the shout's own placement keeps it off the bullets, CD9) in
 *     BRACE_VIEW.shout.role;
 *   - the view player's PIP: the armor row's pulse (BRACE_UI, StatusPanel's armor pips; bracePulseLook);
 *   - the local player's PIP / HEAL: the toast (`hud.toast.brace` / `hud.toast.braceHeal`, ToastPanel).
 * SPENT shows nothing here (its faint ring is the director's). The sound is the audio cue mapper's (sfx.build.brace).
 * A run exit clears the pulse. Presentation only: read-only on the sim.
 */
@Controller({})
export class BraceFxController implements OnStart {
	/** os.clock() of the view player's last pip restored (undefined: no pulse). */
	private pulseStart: number | undefined;
	private serial = 0;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly buildFx: BuildFxController,
		private readonly combo: ComboController,
	) {}

	onStart(): void {
		this.buildFx.onFrame((out) => this.frame(out));
		this.sim.onRunExited(() => this.clear());
	}

	private clear(): void {
		this.pulseStart = undefined;
		resetBraceUi();
	}

	private frame(out: Readonly<BuildFxFrame>): void {
		const now = os.clock();
		const view = this.sim.getViewPlayerIndex();
		const me = this.sim.getLocalPlayerIndex();
		for (const b of out.braces) {
			const feedback = braceFeedbackOf(b.kind);
			if (b.player === view) {
				if (feedback.shout) this.shout();
				if (feedback.pulse) this.pulseStart = now;
			}
			if (b.player === me && feedback.toastKey !== undefined) this.toast(feedback.toastKey, now);
		}
		this.drawPulse(now);
	}

	private shout(): void {
		const pack = this.theme.getPack();
		const s = BRACE_VIEW.shout;
		this.combo.requestShout(
			pack.str(BRACE_VIEW.strings.shout),
			pack.color(s.role),
			s.lifeSec,
			FLOOR_SHOUT_PRIORITY.brace,
		);
	}

	private toast(key: string, now: number): void {
		this.serial++;
		clientStore.pushToast(
			{ id: BRACE_VIEW.toast.idBase - this.serial, key, until: now + BRACE_VIEW.toast.seconds },
			PROGRESSION_VIEW.maxToasts,
		);
	}

	private drawPulse(now: number): void {
		const start = this.pulseStart;
		if (start === undefined) return;
		const look = bracePulseLook(now - start, selectJuice(clientStore.getState()).reducedMotion);
		if (!look.active) {
			this.clear();
			return;
		}
		BRACE_UI.pulseThickness.write(look.thicknessPx);
		BRACE_UI.pulseTransparency.write(look.transparency);
	}
}
