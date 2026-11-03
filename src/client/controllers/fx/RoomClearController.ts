import { Controller, OnStart } from "@flamework/core";
import { clientStore, selectStageCovered } from "client/store";
import { ROOM_CLEAR_UI as UI } from "client/ui";
import type { JuiceSettings } from "shared/settings";
import { isPartyWiped, partySize, playerAt, type SimState } from "shared/sim";
import type { StringVars } from "shared/theme";
import { StateWatch } from "shared/view";
import { SFX, roomClearChipJingle, roomClearStampJingle } from "shared/view/audio";
import {
	ROOM_CLEAR,
	RoomClearSequence,
	TEAM_MOMENTS_VIEW,
	ScoreRoller,
	applyRoomClearSlowMo,
	burstSeed,
	freezeFrameOn,
	hurtKindLanded,
	motionScale,
	roomClearStyle,
	stampNudgeFor,
	teamPulsePlayers,
	type RoomClearLook,
} from "shared/view/fx";
import {
	ROOM_CLEAR_STRINGS,
	roomClearFoldPellets,
	roomClearStampText,
	roomClearTallyText,
	type RoomClearStr,
} from "shared/view/hud";
import { AudioController } from "../audio/AudioController";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { ActorRenderController } from "../render/ActorRenderController";
import { FreezeFrameController } from "./FreezeFrameController";
import { FX_FRAME_PHASE, FxTrackerController } from "./FxTrackerController";
import { ParticleController } from "./ParticleController";
import { TeamMomentsController } from "./TeamMomentsController";

/**
 * Called once per frame on a scored run with the score panel's shown score (the roller's), the juice settings and
 * the frame's step (real seconds, 0 while a solo run is paused), after the roll and BEFORE this frame's celebration
 * sounds (docs/NEW_BEST.md NB7: NewBestController's tracker).
 */
export type ShownScoreHandler = (shown: number, settings: Readonly<JuiceSettings>, dt: number) => void;

/**
 * The room clear celebration (docs/ROOM_CLEAR.md): once per frame it reads the run's room clears (RunView.roomClears),
 * collapses a running sequence on danger or a transition (the view player hurt, a room engaging, the stage cover, a
 * wipe), starts a full sequence or a corner chip per clear (Room clear On), asks the solo slow motion, the co-op
 * last-kill hold and the spark ring, plays the stamp / tick / land sounds and the stamp kick, rolls the score and
 * writes the HUD bindings (client/ui ROOM_CLEAR_UI). Real time, stopped while a solo run is paused; not slowed by
 * hitstop. Presentation only.
 *
 * Frame order (docs/NEW_BEST.md NB7): this is a FX_FRAME_PHASE.scoreRoll frame handler, so it runs before every normal
 * one (AudioController's cue mapper among them). Each frame it rolls the score, then hands the shown score to its
 * onShownScore subscribers (NewBestController steps the new-best tracker there), then plays its sounds: a subscriber
 * that calls dropClearJingle on that frame (the new-best fanfare, NBD7) silences this frame's clear / perfect / chip
 * jingle (the stamp, its kick and the tally still play).
 *
 * Co-op team perfects (docs/RUN_RECAP.md CM2, CMD1 / CMD2): TeamMomentsController steps the frame's TEAM PERFECTs in an
 * earlier phase (FX_FRAME_PHASE.teamMoments); a clear that is one starts its stamp reading TEAM PERFECT (its streak from
 * TEAM_MOMENTS.streakShowFrom) or a far client's chip reading TEAM PERFECT, and pulses a gold spark ring on every
 * living party member (ParticleController.teamPulse, near or far); its jingle is sfx.room.teamperfect, on the stamp at
 * full volume and on a far chip at the chip's (shared/view/audio roomClearStampJingle / roomClearChipJingle, CM4).
 * Solo is unchanged.
 */
@Controller({})
export class RoomClearController implements OnStart {
	private readonly seq = new RoomClearSequence();
	private readonly roller = new ScoreRoller();
	private readonly watch = new StateWatch();
	private readonly shownHandlers = new Array<ShownScoreHandler>();
	/** teamPulsePlayers' output (reused). */
	private readonly pulsed = new Array<number>();
	private jingleDropped = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly audio: AudioController,
		private readonly freeze: FreezeFrameController,
		private readonly particles: ParticleController,
		private readonly actors: ActorRenderController,
		private readonly team: TeamMomentsController,
	) {}

	onStart(): void {
		this.sim.onRunStarted(() => this.newRun());
		this.fx.onFrame((_, settings, dt) => this.frame(settings, dt), FX_FRAME_PHASE.scoreRoll);
	}

	/** Every scored frame's shown score, after the roll and before this frame's sounds (see the class comment). */
	onShownScore(handler: ShownScoreHandler): void {
		this.shownHandlers.push(handler);
	}

	/** This frame's clear / perfect / chip jingle is dropped (NBD7). Only meaningful inside an onShownScore handler. */
	dropClearJingle(): void {
		this.jingleDropped = true;
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
			const pack = this.theme.getPack();
			const s: RoomClearStr = (key, vars) => pack.str(key, vars);
			for (const c of clears.clears) {
				const style = roomClearStyle(c, me.x, me.z, solo);
				// docs/RUN_RECAP.md CM2: a co-op team perfect (or the KV_TeamMomentsDebug fake one).
				const team = this.team.teamPerfectOf(c);
				// docs/PELLETS.md PL7: a row too long for the slot folds the pellet points into Kills.
				seq.start(c, style, motionScale(settings), roomClearFoldPellets(c, s), team);
				if (team !== undefined && c.perfect) this.teamPulse(state, c.tick);
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
		const shown = this.roller.frame(dt, score.total, look.held, look.bonusLanded > 0);
		this.jingleDropped = false;
		for (const handler of this.shownHandlers) handler(shown, settings, dt);
		this.cues(look, settings);
		this.write(look, shown);
	}

	/** CM2's team pulse: the room clear's spark ring, in gold, on every living party member. */
	private teamPulse(state: Readonly<SimState>, tick: number): void {
		for (const i of teamPulsePlayers(state, this.pulsed)) {
			const p = playerAt(state, i);
			this.particles.teamPulse(p.x, p.z, burstSeed(i, tick, TEAM_MOMENTS_VIEW.pulse.seedSalt));
		}
	}

	private cues(look: Readonly<RoomClearLook>, settings: Readonly<JuiceSettings>): void {
		const jingle = !this.jingleDropped;
		if (look.landed) {
			// docs/RUN_RECAP.md CM4: a team perfect's jingle replaces PERFECT's (falling back to it while silent).
			if (jingle) this.audio.play(roomClearStampJingle(look.perfect, look.team), 1);
			this.freeze.requestNudge(stampNudgeFor(settings));
		}
		if (look.ticks > 0) this.audio.play(SFX.scoreTick, 1);
		if (look.chipsStarted > 0 && jingle) {
			this.audio.play(roomClearChipJingle(look.teamChipsStarted), ROOM_CLEAR.chip.jingleVolume);
		}
		if (look.bonusLanded > 0) this.audio.play(SFX.scoreLand, 1);
	}

	private write(look: Readonly<RoomClearLook>, shown: number): void {
		const pack = this.theme.getPack();
		const s = (key: string, vars?: StringVars) => pack.str(key, vars);
		UI.visible.set(look.active);
		if (look.active) {
			UI.stampText.set(roomClearStampText(look.perfect, look.rooms, s, look.team, look.teamStreak));
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
			const stamp = roomClearStampText(c.perfect, c.rooms, s, c.team);
			UI.chipText[i].set(s(ROOM_CLEAR_STRINGS.chip, { stamp, points: c.points }));
			UI.chipPerfect[i].set(c.perfect);
			UI.chipOffset[i].set(c.offsetPx);
		}
		UI.scoreText.set(tostring(shown));
	}
}
