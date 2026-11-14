/**
 * The Archer unlock on the client (docs/SILVER.md SV18, "The Archer unlock"), pure: the character screen's card states,
 * which cards it offers, whether Confirm may start a pick, and the one-time card for accounts that played before the
 * update (OC12). The server decides (startRun and the lobby Ready check ownership against the wallet); these only keep
 * the client from offering what the server would refuse. Headlessly tested (characterLock.spec.ts).
 *
 *   card state   open (the Knight, or owned) / locked: its unlock's price, the balance, buyable now or `Need N more` /
 *                unavailable (the wallet not loaded this session: only the Knight is offered, `Characters unavailable`)
 *   welcome      the returning-player card shows once (DisplaySettings.silverNoticeSeen), only with a loaded wallet that
 *                has never earned (no run of this account paid yet) and personal records that predate it (the server
 *                writes records only from accepted endless runs, and every such run since the update also pays, so
 *                records with an empty wallet mean runs from before the update); a new account has no records
 */
import { CHARACTER_IDS, DEFAULT_CHARACTER, type CharacterId } from "shared/characters";
import type { RecordsStatus } from "shared/records";
import { characterUnlock, itemPrice, type WalletStatus } from "shared/wallet";
import { statusBalance, statusOwns, walletShown } from "shared/view/silver";

export type CharacterLockState =
	| { readonly kind: "open" }
	| {
			readonly kind: "locked";
			/** The unlock's catalogue id (what the hold buys). */
			readonly itemId: string;
			readonly price: number;
			/** The balance covers the price: the card's button buys it in place. */
			readonly canBuy: boolean;
			/** Silver still needed (0 when canBuy). */
			readonly need: number;
	  }
	| { readonly kind: "unavailable" };

/** Character `id`'s card on the character screen for `status`. */
export function characterLockState(id: CharacterId, status: Readonly<WalletStatus> | undefined): CharacterLockState {
	if (id === DEFAULT_CHARACTER || statusOwns(status, id)) return { kind: "open" };
	if (walletShown(status) !== "loaded") return { kind: "unavailable" };
	const unlock = characterUnlock(id);
	const price = unlock !== undefined ? itemPrice(unlock.id, 1) : undefined;
	if (unlock === undefined || price === undefined) return { kind: "unavailable" };
	const need = math.max(0, price - statusBalance(status));
	return { kind: "locked", itemId: unlock.id, price, canBuy: need === 0, need };
}

/** The characters the screen offers: every one with a loaded wallet; else the Knight alone (`Characters unavailable`). */
export function offeredCharacters(status: Readonly<WalletStatus> | undefined): ReadonlyArray<CharacterId> {
	if (walletShown(status) === "loaded") return CHARACTER_IDS;
	const out: CharacterId[] = [];
	for (const id of CHARACTER_IDS) if (statusOwns(status, id)) out.push(id);
	return out;
}

/** Confirm may start `id`: the player owns it (the Knight always). */
export function characterPickAllowed(id: CharacterId, status: Readonly<WalletStatus> | undefined): boolean {
	return statusOwns(status, id);
}

/** What the returning-player card reads (see the file comment). */
export interface SilverWelcomeFacts {
	readonly wallet: Readonly<WalletStatus> | undefined;
	readonly records: Readonly<RecordsStatus> | undefined;
	/** DisplaySettings.silverNoticeSeen. */
	readonly seen: boolean;
}

/** The one-time card shows now (see the file comment). */
export function silverWelcomeShown(f: Readonly<SilverWelcomeFacts>): boolean {
	if (f.seen) return false;
	const w = f.wallet;
	if (w === undefined || !w.loaded || (w.earned ?? 0) > 0) return false;
	const r = f.records;
	if (r === undefined || !r.loaded) return false;
	return r.solo !== undefined || r.coop !== undefined;
}
