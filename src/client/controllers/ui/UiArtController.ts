import { Controller, OnInit } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { bindUiArtReadiness } from "client/ui";
import { PreloadController } from "../game/PreloadController";

/**
 * Binds the UI's art readiness (docs/STAGE_ASSETS.md "Revision 2", SA18; client/ui artReady.ts) to PreloadController's
 * feed, so every ui image draws its flat "without the art" look until its content has downloaded and swaps on the
 * flip. Bound in onInit, before any root mounts in onStart. The feed is read live (`isArtReady` and `getReadiness()`
 * on each call), so it does not matter whether PreloadController's onInit (which builds its readiness) ran first: a
 * stale starting epoch only lists more flips once, and the first change re-renders whatever asked.
 */
@Controller({ loadOrder: 1 })
export class UiArtController implements OnInit {
	private readonly janitor = new Janitor();

	constructor(private readonly preload: PreloadController) {}

	onInit(): void {
		this.janitor.Add(bindUiArtReadiness(this.preload, this.preload.getReadiness().epoch()), true);
	}
}
