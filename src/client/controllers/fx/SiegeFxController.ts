import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import { clientStore, selectDisplay } from "client/store";
import { STUDS_PER_TILE } from "shared/config";
import type { BuildFxLevel, JuiceSettings } from "shared/settings";
import { NO_KIND, partySize, type SimState } from "shared/sim";
import type { ColorRole } from "shared/theme";
import { floorStudsY, lerp, studsX, studsZ } from "shared/view";
import {
	BUILDS_V2_FX,
	BowFx,
	PinHoldMask,
	SIEGE_DRAW,
	comboQuiet,
	floorShoutText,
	ownerOpacity,
	pinStreak,
	slamNudge,
	waveOneChordTiles,
	waveOneSegmentAngle,
	type BowFxFrame,
	type PinStreak,
	type WaveOneRingView,
} from "shared/view/fx";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { ActorRenderController } from "../render/ActorRenderController";
import { FxPartPool } from "./BuildFxController";
import { ComboController } from "./ComboController";
import { FreezeFrameController } from "./FreezeFrameController";
import { FxTrackerController } from "./FxTrackerController";
import { fxFolder } from "./fxHelpers";

/**
 * Ballista and Siege Bolt on screen (docs/BUILDS_V2.md BV11c; Studio checklist 5, 6, 11, 12). The ONE BowFx of the
 * client (shared/view/fx siegeFx.ts), stepped once per rendered frame as an FxTrackerController frame handler (after
 * the frame's sim ticks, before the actor renderer's render step) with the run view's `builds` source (RunView.builds,
 * collected per tick), the live state, the view player, comboQuiet over the stage cover and the run's end, the juice
 * settings plus Options > Display > Build effects and the run view's alpha; then it draws the frame:
 *
 *   - rings: every Ballista burst flash (the last pierce's ring, a wall's back fan) and the slam's shock ring (Full
 *     only: BowFx drops it under Reduced) as pooled flat Neon chords, the build rings' construction
 *     (BuildFxController.drawRing; a fan's chords over its facing +- halfAngleRad, shared/view/fx siegeDraw.ts), sized
 *     by the ring's block, transparency 1 - fade (fade carries a teammate's opacity). The bolts themselves are ordinary
 *     BulletKind.BURST bullets: the player bullet pool draws them in Volatile's look (playerBulletLookOf), nothing here.
 *   - pins: the pin hold (PinHoldMask, handed to ActorRenderController once: a pinned actor's sprite holds its frame
 *     while its arrow carries it) and the drag streak behind the body (pinStreak from where it was pinned toward its
 *     drawn position, lerped by alpha like the body), ONE straight Neon segment, the Overkill streak's construction,
 *     in BUILDS_V2_FX.pin.role at pin.liftStuds, a teammate's at BUILDS_V2_FX.teammateOpacity.
 *   - the view player's slam: BowFx's freezeMs (solo, freezeFrameOn: the Goldling catch's 40 ms) through the
 *     SimController's hitstop clock, and the `stamp` nudge (slamNudge; FreezeFrameController.requestNudge: Screen shake).
 *   - PINNED / SLAM: BowFx's shout in the combo shout's slot (ComboController.requestShout at its FLOOR_SHOUT_PRIORITY
 *     entry: the shout's construction keeps it under every bullet, CD9).
 * With no run, quiet, or on the run's exit the planner and the mask reset and every part is parked. One BulkMoveTo per
 * frame. The sounds are the audio cue mapper's (sfx.build.pin / .slam). Presentation only: read-only on the sim.
 */
@Controller({})
export class SiegeFxController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly bow = new BowFx();
	private readonly mask = new PinHoldMask();
	private readonly streak: PinStreak = { visible: false, x1: 0, z1: 0, x2: 0, z2: 0, widthStuds: 0 };
	private readonly colors = new Map<ColorRole, Color3>();
	private readonly moveParts = new Array<BasePart>();
	private readonly moveCFrames = new Array<CFrame>();
	/** BowFx's settings, refreshed every frame (no allocation). */
	private settings: { juice: Readonly<JuiceSettings>; buildFx: BuildFxLevel } | undefined;
	private rings: FxPartPool | undefined;
	private streaks: FxPartPool | undefined;
	private hadRun = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
		private readonly combo: ComboController,
		private readonly freeze: FreezeFrameController,
		private readonly actors: ActorRenderController,
	) {}

	onStart(): void {
		const folder = this.janitor.Add(fxFolder(SIEGE_DRAW.folderName));
		this.rings = new FxPartPool(folder, "BowRing", Enum.PartType.Block);
		this.streaks = new FxPartPool(folder, "PinStreak", Enum.PartType.Block);
		this.actors.setPinHolds(this.mask.held);
		this.fx.onFrame((_, juice) => this.frame(juice));
		this.sim.onRunExited(() => this.off());
	}

	/** Pooled parts (ring chords, streak segments). */
	getPoolSizes(): [number, number] {
		return [this.rings?.size() ?? 0, this.streaks?.size() ?? 0];
	}

	private color(role: ColorRole): Color3 {
		let c = this.colors.get(role);
		if (c === undefined) {
			c = this.theme.getPack().color(role);
			this.colors.set(role, c);
		}
		return c;
	}

	/** Forget everything and park every part. */
	private off(): void {
		this.bow.resetAll();
		this.mask.clear();
		this.draw(undefined, undefined, 0, 0, "full");
	}

	private frame(juice: Readonly<JuiceSettings>): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) {
			if (this.hadRun) this.off();
			this.hadRun = false;
			return;
		}
		this.hadRun = true;
		const buildFx = selectDisplay(clientStore.getState()).buildFx;
		let settings = this.settings;
		if (settings === undefined) {
			settings = { juice, buildFx };
			this.settings = settings;
		}
		settings.juice = juice;
		settings.buildFx = buildFx;
		const state = ctx.run.state;
		const alpha = ctx.run.getAlpha();
		const view = this.sim.getViewPlayerIndex();
		const quiet = comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver());
		const source = ctx.run.builds;
		const out = this.bow.frame(source, state, view, quiet, settings, alpha);
		this.mask.update(out.pins);
		if (out.freezeMs > 0) this.sim.hitstop.request(out.freezeMs, juice);
		const nudge = slamNudge(source.slams, view, partySize(state), quiet);
		if (nudge !== "none") this.freeze.requestNudge(nudge);
		const s = out.shout;
		if (s !== undefined) {
			const pack = this.theme.getPack();
			this.combo.requestShout(floorShoutText(pack, s), pack.color(s.role), s.lifeSec, s.priority);
		}
		this.draw(out, state, view, alpha, buildFx);
	}

	private draw(
		out: Readonly<BowFxFrame> | undefined,
		state: Readonly<SimState> | undefined,
		view: number,
		alpha: number,
		level: BuildFxLevel,
	): void {
		const rings = this.rings;
		const streaks = this.streaks;
		if (rings === undefined || streaks === undefined) return;
		const mp = this.moveParts;
		const mc = this.moveCFrames;
		mp.clear();
		mc.clear();
		rings.begin();
		streaks.begin();
		if (out !== undefined && state !== undefined) {
			for (const r of out.rings) this.drawRing(r, rings);
			this.drawStreaks(out, state, view, alpha, level, streaks);
		}
		rings.end(mp, mc);
		streaks.end(mp, mc);
		if (mp.size() > 0) Workspace.BulkMoveTo(mp, mc, Enum.BulkMoveMode.FireCFrameChanged);
	}

	/** A ring or fan of `r.segments` flat chords at r.radius (siegeDraw's angles), sized by its block. */
	private drawRing(r: Readonly<WaveOneRingView>, pool: FxPartPool): void {
		const n = r.segments;
		const chord = waveOneChordTiles(r) * STUDS_PER_TILE;
		if (n <= 0 || chord <= 0) return;
		const b = r.block;
		const radius = r.radius * STUDS_PER_TILE;
		const y = floorStudsY() + b.liftStuds;
		const cx = studsX(r.x);
		const cz = studsZ(r.z);
		const size = new Vector3(b.widthStuds, b.thicknessStuds, chord);
		const color = this.color(r.role);
		const transparency = 1 - r.fade;
		for (let i = 0; i < n; i++) {
			const angle = waveOneSegmentAngle(r, i);
			const c = math.cos(angle);
			const s = math.sin(angle);
			// The chord runs along the tangent: look along (-sin, cos).
			const cf = CFrame.lookAlong(new Vector3(cx + radius * c, y, cz + radius * s), new Vector3(-s, 0, c));
			pool.place(cf, size, color, transparency, this.moveParts, this.moveCFrames);
		}
	}

	/** Each pinned body's drag streak: one straight segment from behind it to its drawn position. */
	private drawStreaks(
		out: Readonly<BowFxFrame>,
		state: Readonly<SimState>,
		view: number,
		alpha: number,
		level: BuildFxLevel,
		pool: FxPartPool,
	): void {
		const p = BUILDS_V2_FX.pin;
		const y = floorStudsY() + p.liftStuds;
		const color = this.color(p.role);
		const actors = state.combat.actors;
		for (const pin of out.pins) {
			const a = actors[pin.slot];
			if (a === undefined || a.kind === NO_KIND || a.alive === 0) continue;
			const x = lerp(a.prevX, a.x, alpha);
			const z = lerp(a.prevZ, a.z, alpha);
			const t = pinStreak(pin.x0, pin.z0, x, z, level, this.streak);
			if (!t.visible) continue;
			const from = new Vector3(studsX(t.x1), y, studsZ(t.z1));
			const to = new Vector3(studsX(t.x2), y, studsZ(t.z2));
			const len = from.sub(to).Magnitude;
			if (len <= 0) continue;
			const w = t.widthStuds;
			pool.place(
				CFrame.lookAt(from.add(to).mul(0.5), to),
				new Vector3(w, w, len),
				color,
				1 - ownerOpacity(pin.owner, view),
				this.moveParts,
				this.moveCFrames,
			);
		}
	}
}
