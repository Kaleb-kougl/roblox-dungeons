import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { RunService, Workspace } from "@rbxts/services";
import { STUDS_PER_TILE } from "shared/config";
import { affixThemeIndex } from "shared/dungeon";
import { NO_KIND } from "shared/sim";
import { AFFIX_IDS, affixRole } from "shared/theme";
import { AFFIX_VIEW, RENDER_ORDER, affixRingRadius, affixRingSegments, lerp, viewAffix } from "shared/view";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { DashLayer } from "./DashLayer";

const RENDER_STEP = "KV_AffixRings";

/**
 * Elite affix floor rings (docs/ENEMY_VARIANTS.md EV9, EVD12): under every LIVING actor that carries an affix
 * (shared/view viewAffix: state.affixes with the actorId guard), a closed ring of short solid pieces (shared/view
 * affixRingSegments, radius = the actor's radius, Hulking included, + AFFIX_VIEW.ringMarginTiles) in the affix's colour
 * role (`affix.<id>`). One DashLayer per affix (fixed-size pooled Parts, gap 0, one BulkMoveTo each per frame), lifted
 * between the goo decals and the floor markings (AFFIX_VIEW.ringLiftStuds). Never a Highlight (docs/OUTLINE.md: the
 * engine draws at most 31). A corpse loses its ring the frame it dies. Read-only on the sim.
 */
@Controller({})
export class AffixRingController implements OnStart {
	private readonly janitor = new Janitor();

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		const pack = this.theme.getPack();
		const folder = this.janitor.Add(new Instance("Folder"));
		folder.Name = AFFIX_VIEW.folderName;
		folder.Parent = Workspace;
		const dash = AFFIX_VIEW.ringDash;
		const layers = AFFIX_IDS.map(
			(id) =>
				new DashLayer(folder, `AffixRing.${id}`, {
					width: dash.width,
					height: dash.height,
					length: AFFIX_VIEW.ringPieceTiles * STUDS_PER_TILE,
					gap: 0,
					color: pack.color(affixRole(id)),
					material: Enum.Material.Neon,
					transparency: AFFIX_VIEW.ringTransparency,
					liftStuds: AFFIX_VIEW.ringLiftStuds,
				}),
		);
		RunService.BindToRenderStep(
			RENDER_STEP,
			Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera,
			() => {
				for (const l of layers) l.begin();
				this.draw(layers);
				for (const l of layers) l.finish();
			},
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private draw(layers: ReadonlyArray<DashLayer>): void {
		const state = this.sim.getState();
		if (state === undefined || state.affixes === undefined) return;
		const alpha = this.sim.getAlpha();
		const actors = state.combat.actors;
		for (let i = 0; i < actors.size(); i++) {
			const a = actors[i];
			if (a.kind === NO_KIND || a.alive === 0) continue;
			const k = affixThemeIndex(viewAffix(state, i, a.id));
			if (k < 0 || k >= layers.size()) continue;
			affixRingSegments(
				layers[k],
				lerp(a.prevX, a.x, alpha),
				lerp(a.prevZ, a.z, alpha),
				affixRingRadius(a.radius),
			);
		}
	}
}
