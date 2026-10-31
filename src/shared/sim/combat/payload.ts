/**
 * The bullet payload: one integer per bullet, packed bit fields (source: `src/sim/patterns.ts` BulletPayload, built
 * with r3f-projectiles' `definePayload`; layout in fixtures/hashed-fields.md and constants.json `payloadLayout`).
 *
 * Fields, lowest bits first (fixed: recordings and hashes depend on it; APPEND fields, never reorder or resize):
 *   damage  6 bits  enemy bullets: half hearts passed to damagePlayer(); player bullets: enemy hit points
 *   kind    4 bits  BulletKind: what it looks like / sounds like
 *   source  8 bits  enemy bullets = archetype index + 1, player bullets = weapon index + 1, 0 = unknown
 *   pierce  3 bits  player bullets: actors it may still pass through
 *   lastHit 7 bits  player bullets: actor slot + 1 of the last actor a piercing bullet hit (0 = none)
 *
 * `get(p, f) = (p >>> shift) & mask`; `with(p, f, v) = (p & ~(mask << shift) | (v & mask) << shift) & 0x7fffffff`;
 * `pack` ORs `(v & mask) << shift` in field order. Every payload is a non-negative integer < 2^28 (stored as a double).
 *
 * Built with the ported `definePayload` (./projectilePatterns.ts); the pool is ./bullets.ts.
 */

import { definePayload } from "./projectilePatterns";

export type PayloadField = "damage" | "kind" | "source" | "pierce" | "lastHit";

/** Field order and widths, lowest bits first. */
export const PAYLOAD_FIELDS: ReadonlyArray<readonly [PayloadField, number]> = [
	["damage", 6],
	["kind", 4],
	["source", 8],
	["pierce", 3],
	["lastHit", 7],
];

export type PayloadValues = { [K in PayloadField]?: number };

/**
 * `definePayload({ damage: 6, kind: 4, source: 8, pierce: 3, lastHit: 7 })`. Field values are checked like the
 * library's dev build (integers in range, known fields): an out-of-range value errors instead of being masked.
 */
export const BulletPayload = definePayload<PayloadField>(PAYLOAD_FIELDS);

function fieldValueCount(field: PayloadField): number {
	for (const [name, bits] of PAYLOAD_FIELDS) {
		if (name !== field) continue;
		let n = 1;
		for (let b = 0; b < bits; b++) n *= 2;
		return n;
	}
	return error(`payload field '${field}' is not in PAYLOAD_FIELDS`, 0);
}

/** Distinct values the payload's `kind` field holds (2^its width = 16): BulletKind values fit in 0 .. this - 1. */
export const BULLET_KIND_COUNT = fieldValueCount("kind");

/** Total bits used (28). */
export const PAYLOAD_BITS = BulletPayload.bits;
