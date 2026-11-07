import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { GuiService, RunService, UserInputService } from "@rbxts/services";
import {
	clientStore,
	selectDisplay,
	selectGameActive,
	selectMenuOpen,
	selectSnapshot,
	selectTooltipShown,
} from "client/store";
import { cornerFadeValue, cornerFrame, tooltipTargetRegistered, tooltipTargets, type TooltipTarget } from "client/ui";
import { RENDER_ORDER } from "shared/view";
import {
	HoverTracker,
	ITEM_TOOLTIP,
	type HoverFrame,
	type HoverShown,
	type ScreenRect,
	type TooltipTargetHit,
} from "shared/view/hud";
import { InputController } from "../game/InputController";

const RENDER_STEP = "KV_ItemTooltips";

/** HoverFrame with writable fields: ONE object, refilled every frame (no allocation on a quiet frame). */
type MutableHoverFrame = { -readonly [K in keyof HoverFrame]: HoverFrame[K] };

/** A target's hit as last built, and what it was built from (a change builds a new hit object). */
interface CachedHit {
	hit: TooltipTargetHit;
	version: number;
	x: number;
	y: number;
	w: number;
	h: number;
	px: number;
	py: number;
	pw: number;
	ph: number;
}

/** A touch in progress (tap detection). */
interface TouchStart {
	readonly x: number;
	readonly y: number;
	readonly at: number;
}

function inside(px: number, py: number, x: number, y: number, w: number, h: number): boolean {
	return px >= x && px < x + w && py >= y && py < y + h;
}

/** `obj`'s rect in GUI space contains (px, py); undefined `obj`: true. */
function insideObject(obj: GuiObject | undefined, px: number, py: number): boolean {
	if (obj === undefined) return true;
	const p = obj.AbsolutePosition;
	const s = obj.AbsoluteSize;
	return inside(px, py, p.X, p.Y, s.X, s.Y);
}

/**
 * The item tooltips' input (docs/ITEM_TOOLTIPS.md IT4): a render step that builds one HoverFrame a frame and steps the
 * pure HoverTracker (shared/view/hud tooltip.ts), writing what it shows to the store's `tooltip` slice only when the
 * tracker hands back a different object; ItemTooltip (client/ui/hud) draws it.
 *
 * - Pointer: UserInputService:GetMouseLocation() minus GuiService:GetGuiInset() (GUI space, where every
 *   AbsolutePosition lives; HudOcclusionController's note), only while the aim device is the mouse
 *   (InputController.getAimDevice: a stick or touch user has no hover).
 * - Hit: the registered targets (client/ui/hud tooltipTargets) by AbsolutePosition / AbsoluteSize, a scrolling list's
 *   rows only inside their ScrollingFrame; a `menu` target wins over a `hud` one, and `hud` targets are skipped while
 *   live tooltips are not allowed. No GuiButton, no Active, no MouseEnter anywhere (ITD2).
 * - Focus: GuiService.SelectedObject when it is a registered `menu` target (the gamepad on a Build list row).
 * - Tap: a touch on a `menu` target that ends within ITEM_TOOLTIP.tapMaxSec, moved under tapMaxMovePx (InputObject
 *   positions are GUI space); any other tap is "elsewhere".
 * - weaponHeld / weaponPressed: Attack or Alt in InputController's last sampled frame (the player's bindings).
 * - panelFaded: the hit's corner panel transparency (client/ui/hud cornerFade, HudOcclusionController) above 0.
 * - hudAllowed: a run is active, no menu owns the input (pause, party overlay, Options, leaderboards, stage cover,
 *   loading, outro: selectMenuOpen), the run is playing and not paused, no open draft, and Options > Display > Item
 *   tooltips in combat on.
 *
 * A shown or pinned target that unmounted resets the tracker, and so does every close of a menu (selectMenuOpen
 * true -> false: the pause overlay resumed, the run-over panel gone), so no pin outlives its list.
 */
@Controller({})
export class TooltipController implements OnStart {
	private readonly janitor = new Janitor();
	private readonly tracker = new HoverTracker();
	private readonly cache = new Map<TooltipTarget, CachedHit>();
	private readonly owners = new Map<TooltipTargetHit, TooltipTarget>();
	private readonly pointer = { x: 0, y: 0 };
	private readonly frameIn: MutableHoverFrame = {
		nowSec: 0,
		pointer: undefined,
		hit: undefined,
		focus: undefined,
		tap: undefined,
		weaponHeld: false,
		weaponPressed: false,
		panelFaded: false,
		hudAllowed: false,
	};
	private readonly touches = new Map<InputObject, TouchStart>();
	private tapPending = false;
	private tapX = 0;
	private tapY = 0;
	private wasHeld = false;
	private menuWasOpen = false;
	private shown: HoverShown | undefined;

	constructor(private readonly input: InputController) {}

	onStart(): void {
		this.janitor.Add(
			UserInputService.InputBegan.Connect((io) => {
				if (io.UserInputType !== Enum.UserInputType.Touch) return;
				this.touches.set(io, { x: io.Position.X, y: io.Position.Y, at: os.clock() });
			}),
		);
		this.janitor.Add(
			UserInputService.InputEnded.Connect((io) => {
				if (io.UserInputType !== Enum.UserInputType.Touch) return;
				const start = this.touches.get(io);
				this.touches.delete(io);
				if (start === undefined) return;
				const dx = io.Position.X - start.x;
				const dy = io.Position.Y - start.y;
				const T = ITEM_TOOLTIP;
				if (os.clock() - start.at > T.tapMaxSec || dx * dx + dy * dy >= T.tapMaxMovePx * T.tapMaxMovePx) return;
				this.tapPending = true;
				this.tapX = io.Position.X;
				this.tapY = io.Position.Y;
			}),
		);
		RunService.BindToRenderStep(RENDER_STEP, Enum.RenderPriority.Camera.Value + RENDER_ORDER.viewsAfterCamera, () =>
			this.frame(),
		);
		this.janitor.Add(() => RunService.UnbindFromRenderStep(RENDER_STEP), true);
	}

	private frame(): void {
		const state = clientStore.getState();
		const menuOpen = selectMenuOpen(state);
		if (this.menuWasOpen && !menuOpen) this.tracker.reset();
		this.menuWasOpen = menuOpen;
		const s = selectSnapshot(state);
		const active = selectGameActive(state);
		const hudAllowed =
			active &&
			!menuOpen &&
			s.outcome === "playing" &&
			!s.paused &&
			!s.draftOpen &&
			selectDisplay(state).hudTooltips;
		const f = this.frameIn;
		f.nowSec = os.clock();
		f.hudAllowed = hudAllowed;
		const held = this.input.weaponHeld();
		f.weaponHeld = held;
		f.weaponPressed = held && !this.wasHeld;
		this.wasHeld = held;
		this.prune();

		// The pointer (GUI space) and the target under it.
		f.pointer = undefined;
		f.hit = undefined;
		f.panelFaded = false;
		if (this.input.getAimDevice() === "mouse" && active) {
			const mouse = UserInputService.GetMouseLocation();
			const inset = GuiService.GetGuiInset()[0];
			this.pointer.x = mouse.X - inset.X;
			this.pointer.y = mouse.Y - inset.Y;
			f.pointer = this.pointer;
			const owner = this.targetAt(this.pointer.x, this.pointer.y, hudAllowed, false);
			if (owner !== undefined) {
				f.hit = this.hitOf(owner);
				f.panelFaded = owner.panel !== undefined && cornerFadeValue(owner.panel) > 0;
			}
		}
		// The gamepad selection.
		f.focus = undefined;
		const selected = GuiService.SelectedObject;
		if (selected !== undefined) {
			for (const t of tooltipTargets()) {
				if (t.source === "menu" && t.instance === selected) {
					f.focus = this.hitOf(t);
					break;
				}
			}
		}
		// A touch tap.
		f.tap = undefined;
		if (this.tapPending) {
			this.tapPending = false;
			const owner = this.targetAt(this.tapX, this.tapY, false, true);
			f.tap = owner !== undefined ? this.hitOf(owner) : "elsewhere";
		}

		let shown = this.tracker.step(f);
		if (shown !== undefined) {
			const owner = this.owners.get(shown.target);
			if (owner === undefined || !tooltipTargetRegistered(owner)) {
				this.owners.delete(shown.target);
				this.tracker.reset();
				shown = undefined;
			}
		}
		if (shown !== this.shown) {
			const old = this.shown;
			this.shown = shown;
			if (old !== undefined && old.target !== shown?.target) this.forgetStale(old.target);
			if (selectTooltipShown(state) !== shown) clientStore.setTooltip(shown);
		}
	}

	/**
	 * The registered target at (x, y), GUI space: `menu` before `hud` (a list over the HUD), `hud` only when
	 * `withHud`; `menuOnly` for taps (touch has no live HUD tooltips, ITD9).
	 */
	private targetAt(x: number, y: number, withHud: boolean, menuOnly: boolean): TooltipTarget | undefined {
		let hud: TooltipTarget | undefined;
		for (const t of tooltipTargets()) {
			const obj = t.instance;
			if (obj === undefined || !obj.Visible) continue;
			if (t.source === "hud" && (menuOnly || !withHud || hud !== undefined)) continue;
			const p = obj.AbsolutePosition;
			const sz = obj.AbsoluteSize;
			if (!inside(x, y, p.X, p.Y, sz.X, sz.Y) || !insideObject(t.clip, x, y)) continue;
			if (t.source === "menu") return t;
			hud = t;
		}
		return hud;
	}

	/** The target's hit: the cached object while its rect, panel rect and version are unchanged, else a new one. */
	private hitOf(t: TooltipTarget): TooltipTargetHit | undefined {
		const obj = t.instance;
		if (obj === undefined) return undefined;
		const p = obj.AbsolutePosition;
		const s = obj.AbsoluteSize;
		const panelObj = t.panel !== undefined ? cornerFrame(t.panel) : undefined;
		let px = 0;
		let py = 0;
		let pw = 0;
		let ph = 0;
		if (panelObj !== undefined) {
			const pp = panelObj.AbsolutePosition;
			const ps = panelObj.AbsoluteSize;
			px = pp.X;
			py = pp.Y;
			pw = ps.X;
			ph = ps.Y;
		}
		const c = this.cache.get(t);
		if (
			c !== undefined &&
			c.version === t.version &&
			c.x === p.X &&
			c.y === p.Y &&
			c.w === s.X &&
			c.h === s.Y &&
			c.px === px &&
			c.py === py &&
			c.pw === pw &&
			c.ph === ph
		) {
			return c.hit;
		}
		const panel: ScreenRect | undefined = panelObj !== undefined ? { x: px, y: py, w: pw, h: ph } : undefined;
		const hit: TooltipTargetHit = {
			ref: t.ref,
			rect: { x: p.X, y: p.Y, w: s.X, h: s.Y },
			source: t.source,
			panel,
			more: t.more,
		};
		if (c !== undefined) {
			// The tracker may still show the old hit (a pin keeps the rect of its tap): forget it once it is not shown.
			if (this.shown === undefined || this.shown.target !== c.hit) this.owners.delete(c.hit);
			c.hit = hit;
			c.version = t.version;
			c.x = p.X;
			c.y = p.Y;
			c.w = s.X;
			c.h = s.Y;
			c.px = px;
			c.py = py;
			c.pw = pw;
			c.ph = ph;
		} else {
			this.cache.set(t, { hit, version: t.version, x: p.X, y: p.Y, w: s.X, h: s.Y, px, py, pw, ph });
		}
		this.owners.set(hit, t);
		return hit;
	}

	/** Forgets an old shown hit that is no longer its target's current one. */
	private forgetStale(hit: TooltipTargetHit): void {
		const owner = this.owners.get(hit);
		if (owner === undefined) return;
		if (this.cache.get(owner)?.hit !== hit) this.owners.delete(hit);
	}

	/** Drops the cached hits of targets that unregistered (their hit objects stay valid for the shown check). */
	private prune(): void {
		for (const [t, c] of this.cache) {
			if (tooltipTargetRegistered(t)) continue;
			this.cache.delete(t);
			// Keep the owner while it is the shown target: the frame's check resets the tracker on it.
			if (this.shown === undefined || this.shown.target !== c.hit) this.owners.delete(c.hit);
		}
	}
}
