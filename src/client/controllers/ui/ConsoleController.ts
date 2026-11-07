import { Controller, OnStart } from "@flamework/core";
import { Janitor } from "@rbxts/janitor";
import { TextChatService } from "@rbxts/services";
import { isTenFootInterface } from "client/ui";

/** TextChatService's chat window and input bar configurations (absent under the legacy chat or before they load). */
const CHAT_CONFIGS = ["ChatWindowConfiguration", "ChatInputBarConfiguration"] as const;

/**
 * Console readiness (docs/GAMEPAD_MENUS.md GM12): on a ten-foot interface (client/ui isTenFootInterface) the chat
 * window and its input bar are turned off, as the Roblox console guidelines recommend (TextChatService
 * ChatWindowConfiguration / ChatInputBarConfiguration `Enabled` false; behind pcall, waiting for a configuration that
 * is not there yet). Nothing at all on a PC or a phone. The previous values come back on cleanup (Janitor).
 */
@Controller({})
export class ConsoleController implements OnStart {
	private readonly janitor = new Janitor();

	onStart(): void {
		if (!isTenFootInterface()) return;
		for (const name of CHAT_CONFIGS) {
			const found = TextChatService.FindFirstChild(name);
			if (found !== undefined) this.disable(found);
			else {
				this.janitor.Add(
					TextChatService.ChildAdded.Connect((child) => {
						if (child.Name === name) this.disable(child);
					}),
				);
			}
		}
	}

	private disable(config: Instance): void {
		if (!config.IsA("ChatWindowConfiguration") && !config.IsA("ChatInputBarConfiguration")) return;
		const before = config.Enabled;
		const [ok] = pcall(() => {
			config.Enabled = false;
		});
		if (ok) {
			this.janitor.Add(() => {
				pcall(() => {
					config.Enabled = before;
				});
			}, true);
		}
	}
}
