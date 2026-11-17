import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import type { SolidCells } from "shared/dungeon";
import {
	AiState,
	BossFightState,
	NO_KIND,
	archetypeAt,
	roomAt,
	solidCells,
	type ActorState,
	type EncounterConfig,
	type EncounterRoom,
	type SimState,
} from "shared/sim";
import { TELEGRAPH_VISUAL } from "shared/theme";
import {
	MARKING_VIEW,
	RENDER_ORDER,
	actorFxMarkings,
	mortarCorpseFlying,
	bossTelegraphMarkings,
	clipToSolidCells,
	demonlordActiveMarkings,
	demonlordTelegraphMarkings,
	enemyBulletSpeedScale,
	genericWindupMarkings,
	lerp,
	rect,
	roarMarkings,
	slamMarkings,
	viewFxHints,
	type ActorFxHintsView,
	type AimClip,
} from "shared/view";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { bossAct1 } from "./bossAct1";
import { DashLayer } from "./DashLayer";
import { demonlordView } from "./demonlord";

const RENDER_STEP = "KV_Telegraphs";

interface RoarData {
	readonly introTicks?: number;
	readonly transitionTicks?: number;
}

/** The boss's arena: the boss room when it stands in it, else whichever room it stands in (web BossView arenaOf). */
function arenaOf(enc: EncounterConfig, a: Readonly<ActorState>): EncounterRoom | undefined {
	const r = enc.rooms[enc.bossRoom];
	if (r !== undefined && a.x >= r.minX && a.x <= r.maxX && a.z >= r.minZ && a.z <= r.maxZ) return r;
	return roomAt(enc, a.x, a.z);
}

/**
 * Attack warnings and the boss arena, drawn as dashed floor markings (theme TELEGRAPH_VISUAL dashes in the
 * `telegraph` role; the seal and the roar in the `boss` role). From sim state only (web ActorsView ActorFx +
 * BossView):
 *   - room enemies with data.fx: the sniper's aim line while it winds up (bold once the aim locks), the bruiser's
 *     expanding shockwave ring with its gap, the enemy variants' filling floor rings (docs/ENEMY_VARIANTS.md EV9: the
 *     imp's landing spot during its blink wind-up, the summoner's casting circle during its summon; a hint's `attack`
 *     picks which of two telegraphs it belongs to, so the imp's aim line shows only during its landing aim). The aim line stops where it first enters an intact breakable's cell
 *     (shared/view clipToSolidCells over shared/sim solidCells): a crate stops the shot, though not the sniper's sight
 *     (docs/DECOR.md B2)
 *   - the second endless set (docs/NEW_ENEMIES.md NE8) through the same hints: the Bomber's fuse ring and the Reaper's
 *     wind ring at their feet (`ring`, filling), the Charger's lane (`aimLine`, its chargeRange, bold from the start,
 *     never clipped by breakables: its charge breaks them, viewFxHints), the Stormcaller's three strike circles
 *     (`strikeRow`, filling, centred where the strikes land); the Warbanner's panic gets the generic ring
 *   - any other actor winding up (aiState TELEGRAPH) without a preview: a ring around it
 *   - Mother Mayhem (boss.act1) while winding up: exactly where the attack's bullets will go (fan lanes, ring arcs
 *     with gaps, spiral arms, the slam lane + impact + shockwave), dim early, bright late, blinking at the end; the
 *     slam lane while charging
 *   - the Demon Lord (boss.demonlord; docs/BOSS_DEMONLORD.md D6) the same way: the cleave lanes to their reach (and
 *     the double cleave's second arc from the lunge's end), the 3-gap hellfire ring, the charge lane + impact +
 *     shockwave, the adds' landing spots; the charge lane while charging, the second cleave arc during the lunge.
 *     Nothing while he chases (no direction is locked yet)
 *   - any boss (data.boss): the roar rings during the intro / phase transitions, a generic ring while an unknown
 *     boss winds up, and the arena seal: while its fight is on, a translucent dashed fence around its room
 */
@Controller({})
export class TelegraphController implements OnStart {
	/** This frame's intact breakable cells, read by `clip` (one closure for the controller's life, not one per frame). */
	private clipSolid: SolidCells | undefined;
	private readonly clip: AimClip = (x, z, dx, dz, len) => clipToSolidCells(this.clipSolid, x, z, dx, dz, len);

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = new Instance("Folder");
		folder.Name = `${MARKING_VIEW.folderName}_Telegraphs`;
		folder.Parent = Workspace;
		const [dw, dh, dl] = TELEGRAPH_VISUAL.size;
		const dash = TELEGRAPH_VISUAL.dash ?? { length: dl, gap: dl };
		const telegraphStyle = {
			width: dw,
			height: dh,
			length: dash.length,
			gap: dash.gap,
			color: pack.visualColor(TELEGRAPH_VISUAL.color),
			material: Enum.Material.Neon,
		};
		const bright = new DashLayer(folder, "TelegraphBright", { ...telegraphStyle, transparency: 0 });
		const dim = new DashLayer(folder, "TelegraphDim", {
			...telegraphStyle,
			transparency: MARKING_VIEW.dimTransparency,
		});
		const roar = new DashLayer(folder, "Roar", { ...telegraphStyle, color: pack.color("boss"), transparency: 0 });
		const seal = new DashLayer(folder, "ArenaSeal", {
			...MARKING_VIEW.sealDash,
			color: pack.color("boss"),
			material: Enum.Material.Neon,
			transparency: MARKING_VIEW.sealTransparency,
		});
		const layers = [bright, dim, roar, seal];

		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => {
				for (const l of layers) l.begin();
				this.draw(bright, dim, roar, seal);
				for (const l of layers) l.finish();
			},
		);
	}

	private draw(bright: DashLayer, dim: DashLayer, roar: DashLayer, seal: DashLayer): void {
		const ctx = this.sim.getContext();
		if (ctx === undefined) return;
		const s = ctx.run.state;
		const alpha = this.sim.getAlpha();
		const actors = s.combat.actors;
		const solid = solidCells(s);
		this.clipSolid = solid;
		const clip = solid !== undefined ? this.clip : undefined;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			// docs/NEW_ENEMIES_3.md NTD5 / NT7: a dead Mortar's shell still lands on time, so its ring stays drawn
			if (a.kind === NO_KIND || (a.alive === 0 && !mortarCorpseFlying(a))) continue;
			const def = archetypeAt(a.kind);
			const x = lerp(a.prevX, a.x, alpha);
			const z = lerp(a.prevZ, a.z, alpha);
			if (def.data.boss === true) {
				this.drawBoss(def.id, def.data as RoarData, a, ctx.config.encounter, s, bright, dim, roar, seal);
				continue;
			}
			// viewFxHints: the summoner's casting ring only during its summon (docs/ENEMY_VARIANTS.md EV9).
			const fx = viewFxHints(def.id, (def.data as { fx?: ActorFxHintsView }).fx);
			const drew = fx !== undefined && actorFxMarkings(bright, dim, a, fx, x, z, alpha, clip);
			if (!drew && a.aiState === AiState.TELEGRAPH) genericWindupMarkings(dim, x, z, a.radius);
		}
	}

	private drawBoss(
		id: string,
		data: RoarData,
		a: Readonly<ActorState>,
		enc: EncounterConfig | undefined,
		s: SimState,
		bright: DashLayer,
		dim: DashLayer,
		roar: DashLayer,
		seal: DashLayer,
	): void {
		if (a.phase <= 0) return; // dormant: no fight yet
		const room = enc !== undefined ? arenaOf(enc, a) : undefined;
		if (room !== undefined) rect(seal, room.minX, room.minZ, room.maxX, room.maxZ);
		// The roar: every boss on the fight skeleton (boss/shared.ts) roars in its TRANSITION state.
		if (a.aiState === BossFightState.TRANSITION) {
			const total = (a.phase <= 1 ? data.introTicks : data.transitionTicks) ?? 0;
			const t = total > 0 ? 1 - a.aiTicks / total : 1;
			roarMarkings(roar, a.x, a.z, t);
			return;
		}
		const act1 = bossAct1();
		if (act1 !== undefined && act1.id === id) {
			const c = act1.consts;
			if (a.aiState === AiState.TELEGRAPH) {
				bossTelegraphMarkings(bright, dim, a, c, s.tick);
			} else if (a.aiState === c.state.ACTIVE && a.attack === c.attack.SLAM && a.v[c.slots.mark] === 0) {
				slamMarkings(dim, dim, a, c); // the charge in progress
			}
			return;
		}
		const demon = demonlordView();
		if (demon.id === id) {
			const c = demon.consts;
			if (a.aiState === AiState.TELEGRAPH) {
				demonlordTelegraphMarkings(bright, dim, a, c, s.tick, enemyBulletSpeedScale(s));
			} else if (a.aiState === c.state.ACTIVE) {
				demonlordActiveMarkings(bright, dim, a, c, enemyBulletSpeedScale(s));
			}
			return;
		}
		if (a.aiState === AiState.TELEGRAPH) genericWindupMarkings(dim, a.x, a.z, a.radius);
	}
}
