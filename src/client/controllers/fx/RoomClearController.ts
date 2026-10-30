import { Controller, OnStart } from "@flamework/core";
import { clientStore, selectStageCovered } from "client/store";
import { ROOM_CLEAR_UI as UI } from "client/ui";
import type { JuiceSettings } from "shared/settings";
import { isPartyWiped, partySize, playerAt } from "shared/sim";
import type { StringVars } from "shared/theme";
import { StateWatch } from "shared/view";
import { SFX } from "shared/view/audio";
import {
	ROOM_CLEAR,
	RoomClearSequence,
	ScoreRoller,
	applyRoomClearSlowMo,
	burstSeed,
	freezeFrameOn,
	hurtKindLanded,
	motionScale,
	roomClearStyle,
	stampNudgeFor,
	type RoomClearLook,
} from "shared/view/fx";
import { ROOM_CLEAR_STRINGS, roomClearStampText, roomClearTallyText } from "shared/view/hud";
import { AudioController } from "../audio/AudioController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { ActorRenderController } from "../render/ActorRenderController";
import { FreezeFrameController } from "./FreezeFrameController";
import { FxTrackerController } from "./FxTrackerController";
import { ParticleController } from "./ParticleController";

/**
 * The room clear celebration (docs/ROOM_CLEAR.md): once per frame it reads the run's room clears (RunView.roomClears),
 * collapses a running sequence on danger or a transition (the view player hurt, a room engaging, the stage cover, a
 * wipe), starts a full sequence or a corner chip per clear (Room clear On), asks the solo slow motion, the co-op
 * last-kill hold and the spark ring, plays the stamp / tick / land sounds and the stamp kick, rolls the score and
 * writes the HUD bindings (client/ui ROOM_CLEAR_UI). Real time, stopped while a solo run is paused; not slowed by
 * hitstop. Presentation only.
 */
@Controller({})
export class RoomClearController implements OnStart {
	private readonly seq = new RoomClearSequence();
	private readonly roller = new ScoreRoller();
	private readonly watch = new StateWatch();

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly audio: AudioController,
		private readonly freeze: FreezeFrameController,
		private readonly particles: ParticleController,
		private readonly actors: ActorRenderController,
	) {}

	onStart(): void {
		this.sim.onRunStarted(() => this.newRun());
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt));
	}

	private newRun(): void {
		this.seq.clear();
		this.watch.reset();
		this.roller.reset(this.sim.getState()?.score?.total ?? 0);
		this.hideAll();
	}

	/** Nothing of a celebration on screen: the module-level bindings outlive runs and HUD remounts. */
	private hideAll(): void {
		UI.visible.set(false);
		UI.flyProgress.set(-1);
		for (const t of UI.chipTransparency) t.set(1);
	}

	private frame(settings: Readonly<JuiceSettings>, rawDt: number): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const state = ctx.run.state;
		const score = state.score;
		if (score === undefined) {
			this.hideAll();
			return;
		}
		const paused = ctx.live?.isPaused() === true;
		const dt = paused ? 0 : math.min(math.max(rawDt, 0), ROOM_CLEAR.maxFrameDtSec);
		const seq = this.seq;
		seq.beginFrame();

		const view = this.sim.getViewPlayerIndex();
		this.watch.update(state, view);
		const hurt =
			view < this.watch.players() &&
			hurtKindLanded(this.watch.hurtKind[view], this.sim.getFrameEvents()?.playerHits) !== "none";
		const clears = ctx.run.roomClears;
		const danger = hurt || clears.engaged > 0 || isPartyWiped(state) || selectStageCovered(clientStore.getState());
		if (danger) seq.collapse();

		if (settings.roomClear) {
			const solo = partySize(state) <= 1;
			const me = playerAt(state, view);
			for (const c of clears.clears) {
				const style = roomClearStyle(c, me.x, me.z, solo);
				seq.start(c, style, motionScale(settings));
				if (solo) applyRoomClearSlowMo(c, this.sim.hitstop, settings);
				else if (freezeFrameOn(settings) && c.slot >= 0) {
					this.actors.holdActor(c.slot, c.actorId, ROOM_CLEAR.coopHoldSec);
				}
				if (style === "full") {
					this.particles.roomClearBurst(
						c.x,
						c.z,
						c.perfect,
						burstSeed(c.room, c.tick, ROOM_CLEAR.burstSeedSalt),
					);
				}
			}
		}

		// A hurt, a wipe or the stage cover on the clear's own frame collapses the new sequence too. Not `engaged`: a room
		// that engaged and cleared on the same tick counts there.
		if (danger && (hurt || isPartyWiped(state) || selectStageCovered(clientStore.getState()))) seq.collapse();
		const look = seq.frame(dt);
		this.cues(look, settings);
		const shown = this.roller.frame(dt, score.total, look.held, look.bonusLanded > 0);
		this.write(look, shown);
	}

	private cues(look: Readonly<RoomClearLook>, settings: Readonly<JuiceSettings>): void {
		if (look.landed) {
			this.audio.play(look.perfect ? SFX.roomPerfect : SFX.roomClear, 1);
			this.freeze.requestNudge(stampNudgeFor(settings));
		}
		if (look.ticks > 0) this.audio.play(SFX.scoreTick, 1);
		if (look.chipsStarted > 0) this.audio.play(SFX.roomClear, ROOM_CLEAR.chip.jingleVolume);
		if (look.bonusLanded > 0) this.audio.play(SFX.scoreLand, 1);
	}

	private write(look: Readonly<RoomClearLook>, shown: number): void {
		const pack = this.theme.getPack();
		const s = (key: string, vars?: StringVars) => pack.str(key, vars);
		UI.visible.set(look.active);
		if (look.active) {
			UI.stampText.set(roomClearStampText(look.perfect, look.rooms, s));
			UI.perfect.set(look.perfect);
			UI.stampScale.set(look.stampScale);
			UI.stampTransparency.set(look.stampTransparency);
			UI.shineOffset.set(look.shineOffset);
			UI.tallyText.set(roomClearTallyText(look, s));
			UI.tallyTransparency.set(look.tallyTransparency);
		}
		UI.flyProgress.set(look.flyProgress);
		if (look.flyProgress >= 0) UI.flyText.set(s(ROOM_CLEAR_STRINGS.fly, { points: look.flyPoints }));
		for (let i = 0; i < look.chips.size(); i++) {
			const c = look.chips[i];
			UI.chipTransparency[i].set(c.shown ? c.transparency : 1);
			if (!c.shown) continue;
			const stamp = roomClearStampText(c.perfect, c.rooms, s);
			UI.chipText[i].set(s(ROOM_CLEAR_STRINGS.chip, { stamp, points: c.points }));
			UI.chipPerfect[i].set(c.perfect);
			UI.chipOffset[i].set(c.offsetPx);
		}
		UI.scoreText.set(tostring(shown));
	}
}
