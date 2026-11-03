import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { NO_KIND, SIM_HZ } from "shared/sim";
import { ENEMY_AURA_ROLE } from "shared/theme";
import {
	AURA_VIEW,
	DIZZY_VIEW,
	RENDER_ORDER,
	auraRingSegments,
	dizzyMarked,
	dizzyStarSegments,
	lerp,
	newEnemyKinds,
} from "shared/view";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { DashLayer } from "./DashLayer";

const RENDER_STEP = "KV_NewEnemyMarks";

/**
 * Floor marks of the second endless set (docs/NEW_ENEMIES.md NE8; rules in shared/view newEnemies.ts), from sim state
 * only:
 *   - the Warbanner's aura (NED8): a dashed ring of the sim's auraRadius around every LIVING Warbanner in `enemyAura`
 *     (AURA_VIEW: over the goo and the strike flashes, under the affix rings and every marking). The tint on the actors
 *     it buffs is ActorRenderController's (never a Highlight, EVD12).
 *   - the stun / dizzy stars: a Charger in CHARGER_STUN and a Reaper in REAPER_DIZZY (the punish window) get
 *     DIZZY_VIEW.stars small crosses circling them on the floor, turning with sim time (a placeholder for an fx; over
 *     the markings, DIZZY_VIEW.liftStuds).
 * One DashLayer each (pooled fixed-size Parts, one BulkMoveTo per frame). A corpse loses both the frame it dies.
 */
@Controller({})
export class NewEnemyMarksController implements OnStart {
	private readonly janitor = new Janitor();

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = this.janitor.Add(new Instance("Folder"));
		folder.Name = AURA_VIEW.folderName;
		folder.Parent = Workspace;
		const ring = AURA_VIEW.ringDash;
		const aura = new DashLayer(folder, "AuraRing", {
			width: ring.width,
			height: ring.height,
			length: ring.length,
			gap: ring.gap,
			color: pack.color(ENEMY_AURA_ROLE),
			material: Enum.Material.Neon,
			transparency: AURA_VIEW.ringTransparency,
			liftStuds: AURA_VIEW.ringLiftStuds,
		});
		const star = DIZZY_VIEW.dash;
		const stars = new DashLayer(folder, "DizzyStars", {
			width: star.width,
			height: star.height,
			length: DIZZY_VIEW.starTiles * STUDS_PER_TILE,
			gap: 0,
			color: pack.color(DIZZY_VIEW.role),
			material: Enum.Material.Neon,
			transparency: DIZZY_VIEW.transparency,
			liftStuds: DIZZY_VIEW.liftStuds,
		});
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => {
				aura.begin();
				stars.begin();
				this.draw(aura, stars);
				aura.finish();
				stars.finish();
			},
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private draw(aura: DashLayer, stars: DashLayer): void {
		const state = this.sim.getState();
		if (state === undefined) return;
		const banner = newEnemyKinds().warbanner;
		const alpha = this.sim.getAlpha();
		const simSec = (state.tick + alpha) / SIM_HZ;
		const actors = state.combat.actors;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			const x = lerp(a.prevX, a.x, alpha);
			const z = lerp(a.prevZ, a.z, alpha);
			if (a.kind === banner) auraRingSegments(aura, x, z);
			else if (dizzyMarked(a)) dizzyStarSegments(stars, x, z, a.radius, simSec);
		}
	}
}
