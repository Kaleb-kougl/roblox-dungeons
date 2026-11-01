import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { Workspace } from "@rbxts/services";
import type { Dungeon } from "shared/dungeon";
import { BIOMES, DEFAULT_BIOME_MATERIAL, hexToColor3 } from "shared/theme";
import {
	DECOR_DEPTH,
	VOID_DEPTH,
	VOID_VIEW,
	VoidLayer,
	planVoidCached,
	voidBandOf,
	voidColumnOf,
	voidLayerStyle,
	voidRunInput,
} from "shared/view";
import { SimController, type RunContext } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { renderPart } from "./placeholders";

const MS = 1000;

/**
 * The void's geometry (docs/VOID_DECOR.md VD3, VD9): the rock shoulder along every wall and corridor, its ledges and
 * the outcrops standing in the abyss, one anchored render-only Part per greedy rectangle of the floor's void plan
 * (`planVoidCached`, shared/view/voidDecor), in Workspace `KV_Void`. WorldController draws the abyss under them (the
 * backdrop, VOID.abyssDepthTiles down, in the biome's abyss colour).
 *
 *   per floor  on run start and every floor change (inside those listeners, so behind the stage cover like the world
 *              and decor builds, docs/STAGE_LOADER.md), and when KV_DecorBand / KV_VoidOff / KV_VoidDebug change:
 *              voidRunInput (the same floor seed / floor / Depth / forced band DecorController plans its decor with,
 *              so both read one cached plan) -> planVoidCached -> one Part per rect (voidColumnOf: from the rect's top
 *              down past the abyss plane into the backdrop slab, so near-side cliff faces show and meet the abyss).
 *              Skipped when nothing changed (a restart on the same seed reuses the Dungeon object). Output:
 *              `[Void] built P parts (floor F, band, biome.N: shoulder S / ledge L / outcrop O), plan X ms, T ms`.
 *   look       shoulder: the biome's shoulderColor and `materials.shoulder`; ledge and outcrop: ledgeColor
 *              (voidLedgeColor, what voidReport validates) and `materials.cliff` (voidLayerStyle; SmoothPlastic when
 *              the pack names none). The biome is matched like WorldController's (`themeKey` -> BIOMES forgeTheme); an
 *              unmatched theme (none today: every Forge theme has a biome) gets no void.
 *   debug      Workspace KV_VoidOff (boolean): no void Parts. KV_VoidDebug (boolean): every layer in its flat
 *              VOID_VIEW.debugColors tint (SmoothPlastic). Both off by default and toggle at once.
 *
 * The greybox world gets none (VDD7). Like the world, the void stays when the run is left (the menu sits over it).
 */
@Controller({})
export class VoidController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly floorJanitor = new Janitor();
	private partCount = 0;
	/** What the current build was made from (undefined: nothing built yet). */
	private builtDungeon: Dungeon | undefined;
	private builtKey = "";

	constructor(private readonly sim: SimController, private readonly theme: ThemeController) {}

	onStart(): void {
		this.sim.onRunStarted((ctx) => this.build(ctx));
		this.sim.onFloorChanged((ctx) => this.build(ctx));
		const rebuild = () => {
			const ctx = this.sim.getContext();
			if (ctx !== undefined) this.build(ctx);
		};
		for (const attribute of [DECOR_DEPTH.forceBandAttribute, VOID_VIEW.offAttribute, VOID_VIEW.debugAttribute])
			this.janitor.Add(Workspace.GetAttributeChangedSignal(attribute).Connect(rebuild));
		this.janitor.Add(this.floorJanitor, "Cleanup");
	}

	/** Parts in the current void (for budgets / the smoke test). */
	getPartCount(): number {
		return this.partCount;
	}

	private build(ctx: RunContext): void {
		const d = ctx.dungeon;
		const off = Workspace.GetAttribute(VOID_VIEW.offAttribute) === true;
		const debug = Workspace.GetAttribute(VOID_VIEW.debugAttribute) === true;
		const layout =
			d !== undefined && ctx.endlessFloor !== undefined && ctx.floor > 0
				? ctx.endlessFloor(ctx.floor).layout
				: undefined;
		const depth = ctx.run.state.endless?.depth ?? 1;
		const input =
			d !== undefined
				? voidRunInput(d, layout, depth, Workspace.GetAttribute(DECOR_DEPTH.forceBandAttribute))
				: undefined;
		const band = input !== undefined ? voidBandOf(input) : -1;
		const key = `${input?.floorSeed ?? d?.seed ?? 0}|${band}|${off}|${debug}`;
		if (d === this.builtDungeon && key === this.builtKey && d !== undefined) return;
		this.builtDungeon = d;
		this.builtKey = key;
		this.floorJanitor.Cleanup();
		this.partCount = 0;
		if (d === undefined || input === undefined || off) return; // greybox, or KV_VoidOff
		const biome = BIOMES.find((b) => b.forgeTheme === d.params.themeKey);
		if (biome === undefined) {
			print(`[Void] no biome for theme ${d.params.themeKey}: no void drawn`);
			return;
		}
		const started = os.clock();
		const plan = planVoidCached(input);
		const planned = os.clock();
		const colors = this.theme.getPack().biome(biome.id);
		const folder = new Instance("Folder");
		folder.Name = VOID_VIEW.folderName;
		this.floorJanitor.Add(folder);
		let shoulder = 0;
		let ledge = 0;
		let outcrop = 0;
		for (const r of plan.rects) {
			const style = voidLayerStyle(r.layer);
			if (style === undefined) continue;
			if (r.layer === VoidLayer.SHOULDER) shoulder++;
			else if (r.layer === VoidLayer.LEDGE) ledge++;
			else outcrop++;
			const c = voidColumnOf(r);
			const part = renderPart("Part", VOID_VIEW.castShadow);
			part.Name = style.name;
			part.Size = new Vector3(c.sizeX, c.sizeY, c.sizeZ);
			part.CFrame = new CFrame(c.x, c.y, c.z);
			if (debug) {
				part.Color = hexToColor3(style.debugHex);
				part.Material = Enum.Material[DEFAULT_BIOME_MATERIAL];
			} else {
				part.Color = style.color === "shoulder" ? colors.shoulderColor : colors.ledgeColor;
				part.Material = Enum.Material[colors.materials?.[style.material] ?? DEFAULT_BIOME_MATERIAL];
			}
			part.Parent = folder;
		}
		this.partCount = shoulder + ledge + outcrop;
		folder.Parent = Workspace;
		print(
			`[Void] built ${this.partCount} parts (floor ${input.floor ?? 1}, ${VOID_DEPTH.bands[plan.band].name}, ` +
				`${biome.id}: shoulder ${shoulder} / ledge ${ledge} / outcrop ${outcrop}${
					debug ? ", debug tints" : ""
				}), ` +
				`plan ${string.format("%.1f", (planned - started) * MS)} ms, ` +
				`${string.format("%.1f", (os.clock() - started) * MS)} ms`,
		);
	}
}
