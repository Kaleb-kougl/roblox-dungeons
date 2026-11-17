import { Service } from "@flamework/core";
import { serverLogger } from "server/log";
import { cosmeticLookOf, type CosmeticLook } from "shared/cosmetics";
import {
	LOCKED_SILVER_ACCESS,
	accessEquipped,
	accessOwnsCharacter,
	accessUpgrades,
	type SilverAccess,
} from "shared/run";
import type { CharacterId, UpgradeLevels } from "shared/characters";

const log = serverLogger("SilverAccess");

/**
 * The Silver wallet seam for run starts and lobbies (docs/SILVER.md SV6 / SV17; pure rules in shared/run
 * silverAccess.ts). RunSessionService reads each member's upgrade levels at a start and checks the characters they
 * play; LobbyService checks a Ready's pick and re-checks at the countdown's end. The wallet (WalletService) wires itself
 * in once with `setSilverAccess`, at its construction; until then LOCKED_SILVER_ACCESS (no upgrades, the starters
 * only), so a wiring mistake locks the Archer rather than giving her away. No DataStore work of its own: never yields.
 *
 * Looks (docs/COSMETICS.md CS4): run starts and lobby views read each member's equipped cosmetics here
 * (`equippedFor` / `lookOf`); the wallet calls `lookChanged` after an equip or a load, and LobbyService refreshes that
 * member's lobby (`onLookChanged`).
 */
@Service({})
export class SilverAccessService {
	private access: SilverAccess = LOCKED_SILVER_ACCESS;
	private wired = false;
	private readonly lookListeners = new Set<(userId: number) => void>();

	/** Wires the wallet in. Once: a second call is refused (logged) and keeps the first. */
	setSilverAccess(access: SilverAccess): void {
		if (this.wired) {
			log.warn("ALREADY_SET", "setSilverAccess called twice; keeping the first");
			return;
		}
		this.access = access;
		this.wired = true;
	}

	/** The member's effective upgrade levels, or undefined when their wallet is unknown (accessUpgrades). */
	upgradesFor(userId: number): UpgradeLevels | undefined {
		return accessUpgrades(this.access, userId);
	}

	/** The member may play `characterId` (the Knight always; accessOwnsCharacter). */
	ownsCharacter(userId: number, characterId: CharacterId): boolean {
		return accessOwnsCharacter(this.access, userId, characterId);
	}

	/** The member's equipped cosmetics (slot -> item id), or undefined when their wallet is unknown (accessEquipped). */
	equippedFor(userId: number): Map<string, string> | undefined {
		return accessEquipped(this.access, userId);
	}

	/** The member's look playing `character` (cosmeticLookOf; an unknown wallet: the default look). */
	lookOf(userId: number, character: CharacterId): CosmeticLook {
		return cosmeticLookOf(this.equippedFor(userId), character);
	}

	/** The wallet: `userId`'s look may have changed (an equip, a load). Listeners run now, in order; errors are logged. */
	lookChanged(userId: number): void {
		for (const listener of this.lookListeners) {
			const [ok, err] = pcall(() => listener(userId));
			if (!ok) log.warn("LOOK_LISTENER", tostring(err));
		}
	}

	/** Hears every `lookChanged` (LobbyService). Returns the disconnect. */
	onLookChanged(listener: (userId: number) => void): () => void {
		this.lookListeners.add(listener);
		return () => this.lookListeners.delete(listener);
	}
}
