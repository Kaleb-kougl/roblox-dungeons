import { createBinding, type Binding } from "@rbxts/react";
import { ROOM_CLEAR_VIEW } from "shared/view/hud";

/**
 * One per-frame HUD value of the room clear celebration (docs/ROOM_CLEAR.md RC7): a React binding RoomClearController
 * writes, only on change. A binding update changes the one property it is bound to and never re-renders the tree.
 */
export class RoomClearValue<T> {
	readonly binding: Binding<T>;
	private readonly setter: (v: T) => void;
	private last: T;

	constructor(initial: T) {
		const [binding, setter] = createBinding(initial);
		this.binding = binding;
		this.setter = setter;
		this.last = initial;
	}

	set(v: T): void {
		if (v === this.last) return;
		this.last = v;
		this.setter(v);
	}
}

function perChip<T>(initial: T): RoomClearValue<T>[] {
	const out: RoomClearValue<T>[] = [];
	for (let i = 0; i < ROOM_CLEAR_VIEW.maxChips; i++) out.push(new RoomClearValue(initial));
	return out;
}

/** Everything RoomClearStamp, RoomClearChips and ScorePanel bind to. */
export const ROOM_CLEAR_UI = {
	visible: new RoomClearValue(false),
	stampText: new RoomClearValue(""),
	perfect: new RoomClearValue(false),
	stampScale: new RoomClearValue(1),
	stampTransparency: new RoomClearValue(1),
	shineOffset: new RoomClearValue(-1),
	tallyText: new RoomClearValue(""),
	tallyTransparency: new RoomClearValue(1),
	/** docs/FORTUNE.md FO7: the tally row's scale (the Horde segment's slam). */
	tallyScale: new RoomClearValue(1),
	flyText: new RoomClearValue(""),
	flyProgress: new RoomClearValue(-1),
	chipText: perChip(""),
	chipPerfect: perChip(false),
	chipOffset: perChip(0),
	chipTransparency: perChip(1),
	/** The score panel's rolling number (ScoreRoller), as text. */
	scoreText: new RoomClearValue("0"),
};
