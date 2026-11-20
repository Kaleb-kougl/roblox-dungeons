import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { clientStore, selectDisplay } from "client/store";
import { createKvSurfaceGui, currentNameFont, onLocaleChanged } from "client/ui";
import { STUDS_PER_TILE } from "shared/config";
import { MAX_PARTY_SIZE, partySize, playerAt } from "shared/sim";
import { FX_SPRITE_VIEW, FX_VIEW, comboQuiet } from "shared/view/fx";
import {
	NAME_TAGS,
	NameTagLook,
	lerp,
	nameTagAboveClear,
	nameTagCanvasSize,
	nameTagCentre,
	nameTagDucked,
	nameTagNear,
	nameTagShown,
	nameTagTextSize,
	studsX,
	studsZ,
} from "shared/view";
import { floorAxes } from "shared/view/hud";
import { SimController } from "../game/SimController";
import { ThemeController } from "../game/ThemeController";
import { FLOOR_CANVAS_YAW, floorCanvasPartSize } from "../render/floorCanvas";
import { renderPart } from "../render/placeholders";
import { FxTrackerController } from "./FxTrackerController";
import { floorTextTopStuds, fxFolder } from "./fxHelpers";

const HIDDEN = 1;
const PARKED = new CFrame(FX_VIEW.parkedStuds[0], FX_VIEW.parkedStuds[1], FX_VIEW.parkedStuds[2]);
const AXES = floorAxes();
const CENTRE = new Vector2(0.5, 0.5);

/** One teammate's tag (built once on first use, reused for player index `index`) and what it last showed. */
interface TagSlot {
	readonly part: Part;
	readonly surface: SurfaceGui;
	readonly label: TextLabel;
	readonly look: NameTagLook;
	visible: boolean;
	shownName: string;
	shownOpacity: number;
}

/**
 * Co-op name tags (docs/PLAYER_NAMES.md): once per rendered frame (an FxTracker frame handler), each living teammate's
 * display name (RunContext.memberNames, the spectate bar's) lies on the floor just above their character's head on
 * screen, on the floor shouts' layer (fxHelpers floorTextTopStuds): under every bullet, telegraph, marking, effect and
 * body, so a tag can never hide a threat (PND1). A Top-face SurfaceGui on a thin invisible Part turned by
 * FLOOR_CANVAS_YAW (the combo shout's construction), the text at one fixed size in the name font, truncated at the box.
 *
 * Rules (shared/view nameTags): party runs only, never the watched player (yourself, or whom you spectate), never a
 * dead or departed teammate, only while DisplaySettings.playerNames is on; below the feet instead when a wall or the
 * void would stand in front of the tag (nameTagAboveClear, with a hold so it never flickers); dimmed near the watched
 * player and ducked under an enemy bullet in its box (NameTagLook). Quiet (the stage cover, run over), a run start /
 * exit or no run hides them. Presentation only, read-only on the sim.
 */
@Controller({})
export class NameTagController implements OnStart {
	private readonly janitor = new Janitor();
	/** By player index (built on first use). */
	private readonly slots = new Map<number, TagSlot>();
	private readonly centre = { x: 0, z: 0 };
	private folder: Folder | undefined;
	private settingOn = true;
	private anyVisible = false;

	constructor(
		private readonly sim: SimController,
		private readonly theme: ThemeController,
		private readonly fx: FxTrackerController,
	) {}

	onStart(): void {
		this.folder = this.janitor.Add(fxFolder(NAME_TAGS.folderName));
		this.settingOn = selectDisplay(clientStore.getState()).playerNames;
		this.janitor.Add(
			clientStore.subscribe(selectDisplay, (d) => {
				this.settingOn = d.playerNames;
			}),
		);
		this.sim.onRunStarted(() => this.hideAll());
		this.sim.onRunExited(() => this.hideAll());
		this.fx.onFrame((_, __, dt) => this.frame(dt));
		// A locale switch (docs/LOCALIZATION.md L6): the name font may change with the script.
		this.janitor.Add(
			onLocaleChanged(() => {
				const font = currentNameFont();
				for (const [, slot] of this.slots) slot.label.Font = font;
			}),
		);
	}

	private frame(dt: number): void {
		const ctx = this.sim.getContext();
		if (
			ctx === undefined ||
			ctx.coop === undefined ||
			!this.settingOn ||
			comboQuiet(this.sim.isInputCovered(), this.sim.isRunOver())
		) {
			this.hideAll();
			return;
		}
		const state = ctx.run.state;
		const alpha = this.sim.getAlpha();
		const n = math.min(partySize(state), MAX_PARTY_SIZE);
		const view = this.sim.getViewPlayerIndex();
		const me = this.sim.getDrawnPlayer(state, math.clamp(view, 0, math.max(n - 1, 0)));
		const vx = lerp(me.prevX, me.x, alpha);
		const vz = lerp(me.prevZ, me.z, alpha);
		const grid = ctx.dungeon;
		let any = false;
		for (let i = 0; i < n; i++) {
			const p = playerAt(state, i);
			const name = ctx.memberNames[i] ?? "";
			// A teammate who left is dead too (shared/sim party: `left` set with `dead`).
			if (!nameTagShown(n, i, view, p.dead !== 0, name, true)) {
				this.hideSlot(i);
				continue;
			}
			const slot = this.slotFor(i);
			if (slot === undefined) continue;
			if (!slot.visible) slot.look.reset();
			const x = lerp(p.prevX, p.x, alpha);
			const z = lerp(p.prevZ, p.z, alpha);
			const clear = nameTagAboveClear(grid, x, z, AXES);
			// The duck and the near test read the side the tag shows now (the look's), stepped with this frame's facts.
			nameTagCentre(x, z, slot.look.side, AXES, this.centre);
			const ducked = nameTagDucked(this.centre.x, this.centre.z, AXES, state.combat.enemyBullets);
			slot.look.step(dt, clear, ducked, nameTagNear(x, z, vx, vz));
			nameTagCentre(x, z, slot.look.side, AXES, this.centre);
			this.drawSlot(slot, name);
			any = true;
		}
		for (const [i] of this.slots) if (i >= n) this.hideSlot(i);
		this.anyVisible = any;
	}

	private drawSlot(slot: TagSlot, name: string): void {
		if (name !== slot.shownName) {
			slot.shownName = name;
			slot.label.Text = name;
		}
		const opacity = slot.look.opacity;
		if (opacity !== slot.shownOpacity) {
			slot.shownOpacity = opacity;
			slot.label.TextTransparency = HIDDEN - opacity;
			slot.label.TextStrokeTransparency = HIDDEN - opacity * (HIDDEN - NAME_TAGS.strokeTransparency);
		}
		const y = floorTextTopStuds() - FX_SPRITE_VIEW.thicknessStuds / 2;
		slot.part.CFrame = new CFrame(studsX(this.centre.x), y, studsZ(this.centre.z)).mul(FLOOR_CANVAS_YAW);
		if (!slot.visible) {
			slot.visible = true;
			slot.surface.Enabled = true;
		}
	}

	private hideAll(): void {
		if (!this.anyVisible) return;
		this.anyVisible = false;
		for (const [i] of this.slots) this.hideSlot(i);
	}

	private hideSlot(index: number): void {
		const slot = this.slots.get(index);
		if (slot === undefined || !slot.visible) return;
		slot.visible = false;
		slot.shownOpacity = -1;
		slot.surface.Enabled = false;
		slot.part.CFrame = PARKED;
	}

	/** Player `index`'s tag, built on first use (at most MAX_PARTY_SIZE). */
	private slotFor(index: number): TagSlot | undefined {
		if (index < 0 || index >= MAX_PARTY_SIZE) return undefined;
		const have = this.slots.get(index);
		if (have !== undefined) return have;
		const pack = this.theme.getPack();
		const folder = this.folder;
		if (folder === undefined) return undefined;
		const T = NAME_TAGS;
		const part = renderPart("Part", false);
		part.Name = `NameTag${index}`;
		part.Transparency = HIDDEN;
		part.Size = floorCanvasPartSize(
			T.widthTiles * STUDS_PER_TILE,
			FX_SPRITE_VIEW.thicknessStuds,
			T.depthTiles * STUDS_PER_TILE,
		);
		part.CFrame = PARKED;
		const [w, h] = nameTagCanvasSize();
		const surface = createKvSurfaceGui("NameTag");
		surface.Face = Enum.NormalId.Top;
		surface.SizingMode = Enum.SurfaceGuiSizingMode.FixedSize;
		surface.CanvasSize = new Vector2(w, h);
		surface.AlwaysOnTop = false;
		surface.LightInfluence = T.lightInfluence;
		surface.ResetOnSpawn = false;
		surface.Enabled = false;
		const label = new Instance("TextLabel");
		label.Name = "Name";
		label.AnchorPoint = CENTRE;
		label.Position = UDim2.fromScale(CENTRE.X, CENTRE.Y);
		label.Size = UDim2.fromScale(1, 1);
		label.BackgroundTransparency = HIDDEN;
		label.BorderSizePixel = 0;
		label.Font = currentNameFont();
		label.TextScaled = false;
		label.TextSize = nameTagTextSize();
		label.TextWrapped = false;
		label.TextTruncate = Enum.TextTruncate.AtEnd;
		label.TextXAlignment = Enum.TextXAlignment.Center;
		label.TextColor3 = pack.color(T.role);
		label.TextStrokeColor3 = pack.color(T.strokeRole);
		label.TextTransparency = HIDDEN;
		label.TextStrokeTransparency = HIDDEN;
		label.Parent = surface;
		surface.Parent = part;
		part.Parent = folder;
		const slot: TagSlot = {
			part,
			surface,
			label,
			look: new NameTagLook(),
			visible: false,
			shownName: "",
			shownOpacity: -1,
		};
		this.slots.set(index, slot);
		return slot;
	}
}
