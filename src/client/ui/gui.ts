/**
 * Root GUI factories (docs/LOCALIZATION.md design 5, task L5). Every ScreenGui / SurfaceGui / BillboardGui the client
 * creates in code comes from here, so each one has `AutoLocalize = false`: Roblox's automatic translation never
 * rewrites our text (we translate ourselves). JSX roots set `AutoLocalize={false}` instead.
 * `scripts/check-autolocalize.js` (part of verify) fails on a bare `new Instance("ScreenGui" | "SurfaceGui" |
 * "BillboardGui")` outside this file.
 *
 * @module
 */

type KvGuiClass = "ScreenGui" | "SurfaceGui" | "BillboardGui";

/** Optional properties, applied after the name (Parent last). `AutoLocalize` is always set false after them. */
export type KvGuiProps<T extends Instance> = Partial<WritableInstanceProperties<T>>;

function createKvGui<C extends KvGuiClass>(
	className: C,
	name: string,
	props?: KvGuiProps<CreatableInstances[C]>,
): CreatableInstances[C] {
	const gui = new Instance(className);
	gui.Name = name;
	gui.AutoLocalize = false;
	if (props !== undefined) {
		let parent: unknown;
		const target = gui as unknown as Record<string, unknown>;
		// A ReadonlyMap view (pairs() on a Record trips roblox-ts/no-array-pairs; CLAUDE.md).
		for (const [key, value] of props as unknown as ReadonlyMap<string, unknown>) {
			if (key === "Parent") parent = value;
			else target[key] = value;
		}
		gui.AutoLocalize = false;
		if (parent !== undefined) gui.Parent = parent as Instance;
	}
	return gui;
}

/** A ScreenGui named `name` with AutoLocalize off. */
export function createKvScreenGui(name: string, props?: KvGuiProps<ScreenGui>): ScreenGui {
	return createKvGui("ScreenGui", name, props);
}

/** A SurfaceGui named `name` with AutoLocalize off. */
export function createKvSurfaceGui(name: string, props?: KvGuiProps<SurfaceGui>): SurfaceGui {
	return createKvGui("SurfaceGui", name, props);
}

/** A BillboardGui named `name` with AutoLocalize off. */
export function createKvBillboardGui(name: string, props?: KvGuiProps<BillboardGui>): BillboardGui {
	return createKvGui("BillboardGui", name, props);
}
