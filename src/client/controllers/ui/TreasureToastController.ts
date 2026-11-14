import { Controller, OnStart } from "@flamework/core";
import { RunService } from "@rbxts/services";
import { clientStore } from "client/store";
import { isDraftOpen, type SimState } from "shared/sim";
import { RENDER_ORDER } from "shared/view";
import { PROGRESSION_VIEW } from "shared/view/hud";
import { SECRET_VIEW, secretToast, type SecretOpenedEvent } from "shared/view/secrets";
import { TREASURE_VIEW, VaultToastTracker } from "shared/view/treasure";
import { SimController } from "../game/SimController";

const RENDER_STEP = "KV_TreasureToasts";

/**
 * The vault's toasts (docs/TREASURE.md TR8): once per rendered frame, after the frame's ticks (the run view's
 * `treasure` events are this frame's), the pure shared/view/treasure VaultToastTracker says which lines to push into
 * the HUD's toast store (ToastPanel, top centre, ToastPanel's styling): the floor reveal's `hud.toast.vault` once per
 * floor (only once the stage cover is gone, no boon draft is open and the solo run is not paused, so it never stacks on
 * the stairwell card's new-best line; only while the vault is sealed) and one arm toast per lock as its room engages
 * (`hud.toast.vaultLock.*`: solo UNTOUCHED, the party's allowance, the SWIFT countdown). Never in the tutorial (it has
 * no vaults) or after the run is over. A run exit forgets the settled floor. Secret rooms (docs/SECRET_ROOMS.md SR9):
 * in a party run every member but the finder gets `Secret found by {name}` (`hud.toast.secret`, shared/view/secrets
 * secretToast, the finder's display name from the run's member names) the frame the crack opens; ids from
 * SECRET_VIEW.toast.idBase down. Presentation only.
 */
@Controller({})
export class TreasureToastController implements OnStart {
	private readonly tracker = new VaultToastTracker();
	private serial = 0;
	private secretSerial = 0;

	constructor(private readonly sim: SimController) {}

	onStart(): void {
		this.sim.onRunExited(() => this.tracker.reset());
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Input.Value + RENDER_ORDER.tutorialAfterFx, () =>
			this.frame(),
		);
	}

	private frame(): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined || ctx.tutorial || this.sim.isRunOver()) return;
		const state = ctx.run.state;
		this.secretToasts(ctx.run.secrets.opened, state, ctx.localIndex, ctx.memberNames);
		if (state.treasure === undefined) return;
		const canShow = !this.sim.isInputCovered() && !isDraftOpen(state) && ctx.live?.isPaused() !== true;
		const toasts = this.tracker.frame({ run: ctx.counter, state, frame: ctx.run.treasure, canShow });
		if (toasts.size() === 0) return;
		const now = os.clock();
		for (const t of toasts) {
			this.serial++;
			clientStore.pushToast(
				{ id: TREASURE_VIEW.toast.idBase - this.serial, key: t.key, args: t.args, until: now + t.seconds },
				PROGRESSION_VIEW.maxToasts,
			);
		}
	}

	/** The co-op toast of every open this frame (none solo, none for the finder: they have the SECRET! shout). */
	private secretToasts(
		opened: ReadonlyArray<SecretOpenedEvent>,
		state: Readonly<SimState>,
		localIndex: number,
		names: ReadonlyArray<string>,
	): void {
		if (opened.size() === 0) return;
		const now = os.clock();
		for (const o of opened) {
			const t = secretToast(o, state, localIndex, (player) => names[player]);
			if (t === undefined) continue;
			this.secretSerial++;
			clientStore.pushToast(
				{ id: SECRET_VIEW.toast.idBase - this.secretSerial, key: t.key, args: t.args, until: now + t.seconds },
				PROGRESSION_VIEW.maxToasts,
			);
		}
	}
}
