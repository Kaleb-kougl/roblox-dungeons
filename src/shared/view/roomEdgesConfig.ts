/**
 * Room edges (docs/ROOM_EDGES.md §3): presentation tunables (ROOM_EDGE_VIEW, all starting values for the RE8
 * playtest) and the per-frame look of one room's line (roomEdgeLook). The state ids are fixed here so roomEdgeState.ts
 * and the look helper share them. Presentation only: nothing here reaches the sim, the lockstep wire or a hash.
 * Roblox-port feature, no web source.
 */
import { STUDS_PER_TILE } from "shared/config";

/** A room's edge state (docs/ROOM_EDGES.md §2): no enemies or cleared / enemies not engaged yet / fight on. */
export const RoomEdgeState = { SAFE: 0, WAITING: 1, LIVE: 2 } as const;
export type RoomEdgeState = (typeof RoomEdgeState)[keyof typeof RoomEdgeState];

const TAU = 2 * math.pi;
const HALF = 0.5;

export const ROOM_EDGE_VIEW = {
	/**
	 * One dash Part, studs: `width` across the line, `height` its thickness, `length` along it, `gap` between dashes.
	 * Longer gaps than the telegraph and weapon dashes, so the rhythm differs too.
	 */
	dash: {
		/** Across the line, studs (its inner edge lies on the room edge: roomEdgeInsetTiles). */
		width: 0.25,
		/** Thickness, studs. */
		height: 0.025,
		/** Along the line, studs. */
		length: 1.0,
		/** Between two dashes, studs. */
		gap: 0.7,
	},
	/**
	 * Dash bottom above the floor, studs: under the tutorial arrow (0.06-0.10) and the markings (from 0.16), so the line
	 * spans 0.03-0.055.
	 */
	liftStuds: 0.03,
	/** Part material (the client maps the name to Enum.Material). Not Neon: Neon stays the telegraph / weapon language. */
	material: "SmoothPlastic",
	/** Transparency per state, indexed by RoomEdgeState (SAFE, WAITING, LIVE): safe recedes, live is solid. */
	transparency: [0.55, 0.15, 0],
	/** The live line's slow pulse: up to `amount` more transparency, once per `periodSeconds`, x the juice motionScale. */
	livePulse: {
		/** Peak extra transparency of the pulse (0 at the start of each period). */
		amount: 0.3,
		/** Seconds per pulse. */
		periodSeconds: 1.0,
	},
	/** Seconds of the colour and transparency lerp on every state change (a clear reads as the door cooling down). */
	stateFadeSeconds: 0.35,
	/** Dash budget per floor (all rooms), asserted on real floors by roomEdges.spec. */
	maxDashes: 1200,
	/** Workspace folder of the client's room-edge dash layers. */
	folderName: "KV_RoomEdges",
	/**
	 * Theme colour role id per state, indexed by RoomEdgeState (SAFE, WAITING, LIVE). Plain strings: the client casts
	 * them to the theme's ColorRole.
	 */
	roles: ["roomEdge.safe", "roomEdge.waiting", "roomEdge.live"],
} as const;

/** The line's offset from the room edge, tiles: half a dash width, so the dash's inner edge is the room edge. */
export function roomEdgeInsetTiles(): number {
	return ROOM_EDGE_VIEW.dash.width / 2 / STUDS_PER_TILE;
}

/** One room's line this frame. */
export interface RoomEdgeLook {
	/**
	 * 0..1: how far the colour has gone from the `from` state's role colour to the `to` state's (the caller lerps the
	 * two ROOM_EDGE_VIEW.roles colours by it).
	 */
	mix: number;
	/** 0..1: the dash Parts' transparency. */
	transparency: number;
}

/**
 * The look of a room's line fading from state `from` to state `to`: `fade` is the fade's progress (0..1, clamped;
 * elapsed / stateFadeSeconds), `timeSec` any clock (seconds) for the live pulse, `motion` the juice motionScale (1
 * normal, 0 reduced motion; clamped to 0..1). Transparency lerps between the two states' values by the mix; when
 * `to` is LIVE a pulse of 0..livePulse.amount ((1 - cos) / 2 over the period) is added, scaled by motion and by the
 * mix; the result is clamped to 0..1. Writes into `out` when given (no allocation per frame), else a new object.
 */
export function roomEdgeLook(
	from: RoomEdgeState,
	to: RoomEdgeState,
	fade: number,
	timeSec: number,
	motion: number,
	out?: RoomEdgeLook,
): RoomEdgeLook {
	const v = ROOM_EDGE_VIEW;
	const mix = math.clamp(fade, 0, 1);
	const a = v.transparency[from];
	let t = a + (v.transparency[to] - a) * mix;
	if (to === RoomEdgeState.LIVE) {
		const p = v.livePulse;
		const wave = HALF - HALF * math.cos((timeSec / p.periodSeconds) * TAU);
		t += p.amount * wave * math.clamp(motion, 0, 1) * mix;
	}
	const look = out ?? { mix: 0, transparency: 0 };
	look.mix = mix;
	look.transparency = math.clamp(t, 0, 1);
	return look;
}
