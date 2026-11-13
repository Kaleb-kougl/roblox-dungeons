/**
 * Presentation tunables of a secret room on screen (docs/SECRET_ROOMS.md SR6, Player experience; logic in look.ts /
 * knock.ts / shout.ts / cues.ts, drawing in the client's SecretRenderController, Track V2). Presentation only: where the
 * secret is, what opens it and what the chest gives live in shared/dungeon secretsData.ts and shared/sim
 * secretsData.ts, so nothing here can change a replay. Roblox-port choices, no web source. Every time is seconds of SIM
 * time (the views' clock: it holds during pause and the hitstop freeze) unless named otherwise; distances are tiles.
 *
 * The open's timeline (t = 0 on the open's tick, SecretLook.t):
 *   0 .. burst.sec       the crack bursts into rubble (shards, dust, the `stamp` nudge, the solo freeze), SECRET! shouts
 *   0 .. sink.sec        the void rock over the chamber (VoidPlan.held) sinks; the chamber (built hidden) shows under it
 *   reveal.jingleSec     the discovery jingle (`sfx.jingle.secret`), the torches light
 *   openingSec           SecretLook leaves OPENING for OPEN (every step above is over)
 * Reduced motion: no dust, no sink (the chamber cuts in at the open), no shards; the shout and the sounds stay.
 */
import { TREASURE_VIEW } from "../treasure/config";

const BURST_SEC = 0.35;
const SINK_SEC = 0.5;
const JINGLE_SEC = 0.4;

export const SECRET_VIEW = {
	/** Workspace folder, render step and profiler label of SecretRenderController (Track V2). */
	folderName: "KV_Secret",
	renderStep: "KV_Secret",
	profileLabel: "KV Secret",

	// --- before the open (SRD4: crack + dust, nothing else) ------------------------------------------------------------
	/**
	 * The dust trickle from the crack's joints: one pass every `everySec` while the crack is hidden, on the crack's cells
	 * in turn (pass k on cell k mod cells), `frames` frames at `fps` (the `fx.secret.dust` flipbook's; one-shot), sim
	 * time with no phase: every client shows the same pass. None under reduced motion. SR15 tunes the cadence.
	 */
	dust: { everySec: 4, frames: 6, fps: 10 },
	/**
	 * A knock (a wrong-way hit, the sim's per-tick knock feed): a dust puff on the face and the hollow knock, at most one
	 * per `throttleSec` per crack (KnockThrottle: a stream of arrows is a few taps a second, not a drum roll; one swing's
	 * pass over both cells is one knock); the puff lasts `puffSec`. 0.2 s, not the plan's 0.25: the sword's swings 1 and
	 * 2 land 14 ticks (0.233 s) apart (SWORD_DATA's port tempo), and each must knock (SR15 tunes it).
	 */
	knock: { throttleSec: 0.2, puffSec: 0.3 },

	// --- the open -------------------------------------------------------------------------------------------------------
	/**
	 * The burst: `sec` long (shards fly, dust, the wall Part gone at once, rubble on the two cells), `shards` pieces, a
	 * solo `freezeMs` freeze (freezeFrameOn, docs/FEEL.md) for an open by the view player, and the `stamp` nudge.
	 */
	burst: { sec: BURST_SEC, shards: 12, freezeMs: TREASURE_VIEW.open.freezeMs },
	/** The void rock over the chamber (VoidPlan.held's columns) sinks `depthTiles` over `sec` from the open (ease in). */
	sink: { sec: SINK_SEC, depthTiles: 3 },
	/** The reveal: the jingle and the two torches lighting at `jingleSec` after the open. */
	reveal: { jingleSec: JINGLE_SEC },
	/** OPENING lasts until every step of the timeline is over. */
	openingSec: math.max(BURST_SEC, SINK_SEC, JINGLE_SEC),

	// --- the news -------------------------------------------------------------------------------------------------------
	/**
	 * SECRET! (`fx.secret.text`, the combo shout's construction, FLOOR_SHOUT_PRIORITY.secret): for the view player when
	 * they opened it or stand within `nearTiles` of the crack (a far teammate's open is the toast's news), `lifeSec` long.
	 */
	shout: { lifeSec: 1.4, nearTiles: 9 },
	/** The co-op toast `Secret found by {name}` (`hud.toast.secret`): every member but the finder, `seconds` long. */
	toast: { seconds: 3 },
	/**
	 * The sounds (shared/view/audio): the open and the jingle at full volume for an open by the local player or within
	 * `nearTiles` of them, else at the teammate's volume (AUDIO_VIEW.teammateVolume) a rank lower; a knock likewise.
	 */
	audio: { nearTiles: 9 },
} as const;
