import { createContext, useContext, useEffect, useMemo, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { GuiService, Workspace } from "@rbxts/services";
import { selectDisplay, selectGhostHeart, selectSnapshot, type ClientState } from "client/store";
import { themePack } from "client/ui/theme";
import {
	HUD_SKIN,
	TOUCH_STRIP,
	digitCount,
	skinFor,
	skinHasOf,
	touchStrip,
	type TouchStripArt,
	type TouchStripContent,
	type TouchStripGeometry,
	type TouchStripLayout,
} from "shared/view/hud";
import { pauseButtonSlot } from "shared/view/menu";

/**
 * Where the touch strip may go (docs/UI_ART.md "Phones"), measured by GameHud on touch and handed down: undefined off
 * touch (every HUD piece then draws its desktop layout, unchanged) and until the two ScreenGuis are measured.
 */
export const TouchStripGeometryContext = createContext<TouchStripGeometry | undefined>(undefined);

/** The art sizes (art px) of an image, or undefined when the pack lacks it. */
function artSize(id: string | undefined): { w: number; h: number } | undefined {
	if (id === undefined) return undefined;
	const ref = themePack()?.image(id);
	if (ref === undefined) return undefined;
	return { w: ref.rect?.w ?? ref.w, h: ref.rect?.h ?? ref.h };
}

/** The pack's icon sizes the strip fits (the flat look: none). */
function stripArt(): TouchStripArt | undefined {
	const pack = themePack();
	if (pack === undefined) return undefined;
	const has = skinHasOf(pack);
	return {
		heart: artSize(skinFor(has, "heart", "full")),
		flask: artSize(skinFor(has, "flask", "full")),
		candle: artSize(skinFor(has, "ember", "lit")),
		coin: artSize(HUD_SKIN.ids.coin),
		pip: artSize(skinFor(has, "pip", "armor")),
	};
}

/**
 * The strip's content from the snapshot, as primitive selections (each re-renders only when its number changes; the
 * score only when its digit count does).
 */
function useStripContent(): TouchStripContent {
	const heartsMax = useSelector((st: ClientState) => selectSnapshot(st).heartsMax);
	const pips = useSelector((st: ClientState) => {
		const s = selectSnapshot(st);
		return math.max(s.armorMax, s.armor) + s.aegisPips;
	});
	const flaskMax = useSelector((st: ClientState) => selectSnapshot(st).flaskMax);
	const emberMax = useSelector((st: ClientState) => selectSnapshot(st).emberMax);
	const scoring = useSelector((st: ClientState) => selectSnapshot(st).scoring);
	const digits = useSelector((st: ClientState) =>
		math.max(TOUCH_STRIP.minScoreDigits, digitCount(selectSnapshot(st).score)),
	);
	const ghost = useSelector(selectGhostHeart) > 0;
	return useMemo(() => {
		// The widest score with this many digits stands in for the score (only its digit count matters).
		const score = 10 ** digits - 1;
		return { heartsMax, ghost, pips, flaskMax, emberMax, scoring, score, art: stripArt() };
	}, [heartsMax, ghost, pips, flaskMax, emberMax, scoring, digits]);
}

/** The touch strip's layout (shared/view/hud touchStrip), or undefined off touch. */
export function useTouchStrip(): TouchStripLayout | undefined {
	const geometry = useContext(TouchStripGeometryContext);
	const content = useStripContent();
	return useMemo(() => (geometry !== undefined ? touchStrip(geometry, content) : undefined), [geometry, content]);
}

function rectKey(g: TouchStripGeometry): string {
	return `${g.viewportW},${g.viewportH},${g.hudPercent},${g.safe.x},${g.safe.y},${g.safe.w},${g.safe.h},${g.topbar.x},${g.topbar.y},${g.topbar.w},${g.topbar.h},${g.reserveLeft}`;
}

/**
 * Measures the strip's geometry while `on`: the HUD's safe area in screen px (KV_GameHud's AbsolutePosition less the
 * full-screen strip ScreenGui's: both read in the same GUI space, so the difference is the safe area's offset from the
 * screen's top left), the free top bar (GuiService.TopbarInset, screen px, as the pause button reads it) and the pause
 * button's slot (shared/view/menu pauseButtonSlot on touch: right of the allowance for Roblox's voice button). Follows
 * the top bar, both ScreenGuis and the viewport; a new object only when a number changed.
 */
export function useTouchStripGeometry(
	on: boolean,
	hud: ScreenGui | undefined,
	strip: ScreenGui | undefined,
): TouchStripGeometry | undefined {
	const percent = useSelector(selectDisplay).hudScale;
	const [geometry, setGeometry] = useState<TouchStripGeometry | undefined>(undefined);
	useEffect(() => {
		if (!on || hud === undefined || strip === undefined) {
			setGeometry(undefined);
			return undefined;
		}
		let last = "";
		const measure = () => {
			const camera = Workspace.CurrentCamera;
			const size = hud.AbsoluteSize;
			if (camera === undefined || !(size.X > 0 && size.Y > 0)) return;
			const o = strip.AbsolutePosition;
			const p = hud.AbsolutePosition;
			const inset = GuiService.TopbarInset;
			const inBar = inset.Width > 0 && inset.Height > 0;
			const topbar = { x: inset.Min.X, y: inset.Min.Y, w: inset.Width, h: inset.Height };
			const g: TouchStripGeometry = {
				viewportW: camera.ViewportSize.X,
				viewportH: camera.ViewportSize.Y,
				hudPercent: percent,
				safe: { x: p.X - o.X, y: p.Y - o.Y, w: size.X, h: size.Y },
				topbar: inBar ? topbar : { x: 0, y: 0, w: 0, h: 0 },
				reserveLeft: pauseButtonSlot(topbar, true).reserveLeft,
			};
			const key = rectKey(g);
			if (key === last) return;
			last = key;
			setGeometry(g);
		};
		const connections = [
			GuiService.GetPropertyChangedSignal("TopbarInset").Connect(measure),
			hud.GetPropertyChangedSignal("AbsolutePosition").Connect(measure),
			hud.GetPropertyChangedSignal("AbsoluteSize").Connect(measure),
			strip.GetPropertyChangedSignal("AbsolutePosition").Connect(measure),
			strip.GetPropertyChangedSignal("AbsoluteSize").Connect(measure),
		];
		let viewport: RBXScriptConnection | undefined;
		const bindCamera = () => {
			viewport?.Disconnect();
			viewport = Workspace.CurrentCamera?.GetPropertyChangedSignal("ViewportSize").Connect(measure);
			measure();
		};
		bindCamera();
		const cameraSwap = Workspace.GetPropertyChangedSignal("CurrentCamera").Connect(bindCamera);
		return () => {
			for (const c of connections) c.Disconnect();
			viewport?.Disconnect();
			cameraSwap.Disconnect();
		};
	}, [on, hud, strip, percent]);
	return geometry;
}
