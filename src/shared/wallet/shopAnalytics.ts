/**
 * The Silver shop's funnel telemetry (docs/SILVER_SHOP.md SH7). Pure.
 *
 * The client reports its steps on the remote `silverShopReport` (SilverShopReport); the server re-reads each with
 * `readSilverShopReport` (types, the step / source / pack lists, finite seconds), rate limits it (SILVER_SHOP.reportRate)
 * and logs `silverShopReportEvent`. It is analytics only: nothing grants, refuses or counts Silver from it. The server
 * logs `granted` itself, from the receipt (`silverShopGrantedEvent`).
 *
 * Event `SilverShop` (WALLET_ANALYTICS_EVENT.silverShop):
 *   field01  the step: opened / prompted / bought / cancelled / settled / pricesFailed (client), granted (server)
 *   field02  where the panel was opened from: armory / mainMenu (absent on `granted`)
 *   field03  the pack (prompted / bought / cancelled / settled / granted)
 *   value    `settled`: seconds from the prompt to the grant's push (0.1 s); `granted`: the Silver; otherwise 1
 *
 * @module
 */
import type { AnalyticsEventSpec } from "shared/run";
import { SILVER_SHOP } from "./config";
import { SILVER_PACK_IDS, isSilverPackId, type SilverPackId, type SilverPurchaseGrant } from "./shop";
import { WALLET_ANALYTICS_EVENT } from "./analytics";

/** Where Get Silver was opened from (docs/SILVER_SHOP.md OC3). */
export type SilverShopFrom = "armory" | "mainMenu";

/**
 * Every `from` value a client report may carry: the list the server checks a report's source against
 * (`readSilverShopReport`), the shop panel's entry points in the menus, and the `SilverShop` event's field02 values.
 */
export const SILVER_SHOP_FROMS: ReadonlyArray<SilverShopFrom> = ["armory", "mainMenu"];

/** The steps the client reports. */
export type SilverShopClientStep = "opened" | "prompted" | "bought" | "cancelled" | "settled" | "pricesFailed";

/**
 * Every step a client report may carry: the list the server checks a report's step against (`readSilverShopReport`).
 * `granted` is not among them, since only the server logs it.
 */
export const SILVER_SHOP_CLIENT_STEPS: ReadonlyArray<SilverShopClientStep> = [
	"opened",
	"prompted",
	"bought",
	"cancelled",
	"settled",
	"pricesFailed",
];

/** The step the server logs from a granted receipt. */
export const SILVER_SHOP_GRANTED_STEP = "granted";

/** Every field01 value of `SilverShop`. */
export const SILVER_SHOP_STEPS: ReadonlyArray<string> = [...SILVER_SHOP_CLIENT_STEPS, SILVER_SHOP_GRANTED_STEP];

/** The client steps that name a pack. */
const PACK_STEPS: ReadonlyArray<SilverShopClientStep> = ["prompted", "bought", "cancelled", "settled"];

/** The `silverShopReport` payload (client -> server). */
export interface SilverShopReport {
	step: SilverShopClientStep;
	from: SilverShopFrom;
	/** The pack (required on prompted / bought / cancelled / settled). */
	pack?: SilverPackId;
	/** `settled` only: seconds from the prompt to the grant's push. */
	seconds?: number;
}

function isFinite(v: unknown): v is number {
	return typeIs(v, "number") && v === v && v !== math.huge && v !== -math.huge;
}

/** The report re-read on the server (undefined: refused whole). Seconds are clamped and rounded. */
export function readSilverShopReport(v: unknown): SilverShopReport | undefined {
	if (!typeIs(v, "table")) return undefined;
	const t = v as Record<string, unknown>;
	const step = t.step;
	const from = t.from;
	if (!typeIs(step, "string") || !SILVER_SHOP_CLIENT_STEPS.includes(step as SilverShopClientStep)) return undefined;
	if (!typeIs(from, "string") || !SILVER_SHOP_FROMS.includes(from as SilverShopFrom)) return undefined;
	const out: SilverShopReport = { step: step as SilverShopClientStep, from: from as SilverShopFrom };
	if (PACK_STEPS.includes(out.step)) {
		if (!isSilverPackId(t.pack)) return undefined;
		out.pack = t.pack;
	}
	if (out.step === "settled") {
		const s = t.seconds;
		if (!isFinite(s) || s < 0) return undefined;
		const unit = SILVER_SHOP.reportSecondsStep;
		out.seconds = math.floor(math.min(s, SILVER_SHOP.maxReportSeconds) / unit + 0.5) * unit;
	}
	return out;
}

/** The custom event of one client report (already re-read). */
export function silverShopReportEvent(r: Readonly<SilverShopReport>): AnalyticsEventSpec {
	const fields: { field01: string; field02: string; field03?: string } = { field01: r.step, field02: r.from };
	if (r.pack !== undefined) fields.field03 = r.pack;
	return {
		kind: "custom",
		name: WALLET_ANALYTICS_EVENT.silverShop,
		value: r.step === "settled" && r.seconds !== undefined ? r.seconds : 1,
		fields,
	};
}

/** The server's `granted` event of one receipt (value = the Silver). */
export function silverShopGrantedEvent(g: Readonly<SilverPurchaseGrant>): AnalyticsEventSpec {
	return {
		kind: "custom",
		name: WALLET_ANALYTICS_EVENT.silverShop,
		value: g.silver,
		fields: { field01: SILVER_SHOP_GRANTED_STEP, field03: g.packId },
	};
}

/** SilverShop's field value sets (the analytics catalogue counts them). */
export function silverShopFieldValues(): {
	readonly steps: ReadonlyArray<string>;
	readonly froms: ReadonlyArray<string>;
	readonly packs: ReadonlyArray<string>;
} {
	return { steps: SILVER_SHOP_STEPS, froms: SILVER_SHOP_FROMS, packs: SILVER_PACK_IDS };
}
