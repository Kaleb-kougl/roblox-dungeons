import { Controller, OnStart } from "@flamework/core";
import { RunService, Workspace } from "@rbxts/services";
import {
	AiState,
	NO_KIND,
	archetypeAt,
	roomAt,
	solidCells,
	type ActorState,
	type EncounterConfig,
	type EncounterRoom,
} from "shared/sim";
import { TELEGRAPH_VISUAL } from "shared/theme";
import {
	MARKING_VIEW,
	RENDER_ORDER,
	actorFxMarkings,
	bossTelegraphMarkings,
	clipToSolidCells,
	genericWindupMarkings,
	lerp,
	rect,
	roarMarkings,
	slamMarkings,
	type ActorFxHintsView,
	type AimClip,
} from "shared/view";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { bossAct1 } from "./bossAct1";
import { DashLayer } from "./DashLayer";

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
 *     expanding shockwave ring with its gap. The aim line stops where it first enters an intact breakable's cell
 *     (shared/view clipToSolidCells over shared/sim solidCells): a crate stops the shot, though not the sniper's sight
 *     (docs/DECOR.md B2)
 *   - any other actor winding up (aiState TELEGRAPH) without a preview: a ring around it
 *   - Mother Bramble (boss.act1) while winding up: exactly where the attack's bullets will go (fan lanes, ring arcs
 *     with gaps, spiral arms, the slam lane + impact + shockwave), dim early, bright late, blinking at the end; the
 *     slam lane while charging; the roar rings during intro / phase transitions
 *   - the arena seal: while a boss fight is on, a translucent dashed fence around the boss's room
 */
@Controller({})
export class TelegraphController implements OnStart {
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
		const clip: AimClip | undefined =
			solid !== undefined ? (x, z, dx, dz, len) => clipToSolidCells(solid, x, z, dx, dz, len) : undefined;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			const def = archetypeAt(a.kind);
			const x = lerp(a.prevX, a.x, alpha);
			const z = lerp(a.prevZ, a.z, alpha);
			if (def.data.boss === true) {
				this.drawBoss(def.id, def.data as RoarData, a, ctx.config.encounter, s.tick, bright, dim, roar, seal);
				continue;
			}
			const fx = (def.data as { fx?: ActorFxHintsView }).fx;
			const drew = fx !== undefined && actorFxMarkings(bright, dim, a, fx, x, z, alpha, clip);
			if (!drew && a.aiState === AiState.TELEGRAPH) genericWindupMarkings(dim, x, z, a.radius);
		}
	}

	private drawBoss(
		id: string,
		data: RoarData,
		a: Readonly<ActorState>,
		enc: EncounterConfig | undefined,
		tick: number,
		bright: DashLayer,
		dim: DashLayer,
		roar: DashLayer,
		seal: DashLayer,
	): void {
		if (a.phase <= 0) return; // dormant: no fight yet
		const room = enc !== undefined ? arenaOf(enc, a) : undefined;
		if (room !== undefined) rect(seal, room.minX, room.minZ, room.maxX, room.maxZ);
		const act1 = bossAct1();
		if (act1 === undefined || act1.id !== id) {
			if (a.aiState === AiState.TELEGRAPH) genericWindupMarkings(dim, a.x, a.z, a.radius);
			return;
		}
		const c = act1.consts;
		if (a.aiState === AiState.TELEGRAPH) {
			bossTelegraphMarkings(bright, dim, a, c, tick);
		} else if (a.aiState === c.state.ACTIVE && a.attack === c.attack.SLAM && a.v[c.slots.mark] === 0) {
			slamMarkings(dim, dim, a, c); // the charge in progress
		} else if (a.aiState === c.state.TRANSITION) {
			const total = (a.phase <= 1 ? data.introTicks : data.transitionTicks) ?? 0;
			const t = total > 0 ? 1 - a.aiTicks / total : 1;
			roarMarkings(roar, a.x, a.z, t);
		}
	}
}
