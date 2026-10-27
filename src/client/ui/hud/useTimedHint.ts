import { useBinding, useEffect, useState } from "@rbxts/react";
import { useSelector } from "@rbxts/react-reflex";
import { RunService } from "@rbxts/services";
import { selectJuice } from "client/store";
import { motionScale } from "shared/view/fx";
import { HUD_HINTS, hintVisible } from "shared/view/hud";

export interface TimedHint {
	/** True once the hint has faded out: render nothing (no layout space). */
	readonly hidden: boolean;
	/** Text transparency while shown / fading (0 = fully shown). */
	readonly fade: React.Binding<number>;
}

/**
 * A timed HUD hint (docs/HUD_LAYOUT.md H5 / H6): shown for `showSeconds` after mount and after any of `triggers`
 * changes, then faded out over HUD_HINTS.fadeSeconds (shared/view/hud hintVisible on a binding; Heartbeat runs only
 * during the fade). Under reduced motion (juice motionScale 0) it hides at once when its time is up.
 */
export function useTimedHint(showSeconds: number, triggers: ReadonlyArray<unknown>): TimedHint {
	const motion = motionScale(useSelector(selectJuice));
	const [hidden, setHidden] = useState(false);
	const [fade, setFade] = useBinding(0);
	useEffect(() => {
		setHidden(false);
		setFade(0);
		const start = os.clock();
		let connection: RBXScriptConnection | undefined;
		const timer = task.delay(showSeconds, () => {
			if (motion <= 0) {
				setHidden(true);
				return;
			}
			connection = RunService.Heartbeat.Connect(() => {
				const t = hintVisible(os.clock() - start, showSeconds, HUD_HINTS.fadeSeconds);
				setFade(t);
				if (t >= 1) {
					connection?.Disconnect();
					connection = undefined;
					setHidden(true);
				}
			});
		});
		return () => {
			task.cancel(timer);
			connection?.Disconnect();
		};
	}, [showSeconds, motion, ...triggers]);
	return { hidden, fade };
}
