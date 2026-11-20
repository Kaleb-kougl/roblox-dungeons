/**
 * Spec helper (docs/CODEBASE_SCALE.md DX4): where a feature's ids sit in one of the theme's shared lists
 * (PORT_AUDIO_EVENTS, REQUIRED_STRING_KEYS, COLOR_ROLES, ...).
 *
 * `runOf(list, ids)` is the stretch of `list` that starts at its first `ids[0]` and is as long as `ids` (shorter at
 * the list's end; empty when `ids[0]` is absent or `ids` is empty). So
 *
 *     expect(runOf(PORT_AUDIO_EVENTS, CODEX_AUDIO_IDS)).toEqual([...CODEX_AUDIO_IDS]);
 *
 * holds exactly when the feature's ids are in the list, together and in order, wherever they sit. It replaces the
 * specs' `tail(list, n, skip)` pins, which named a position from the list's end and so had to be edited in every
 * earlier feature's spec whenever a later feature appended (DXD3: nothing reads these lists by position).
 */
export function runOf(list: ReadonlyArray<string>, ids: ReadonlyArray<string>): string[] {
	const out = new Array<string>();
	if (ids.size() === 0) return out;
	const start = list.indexOf(ids[0]);
	if (start < 0) return out;
	const last = math.min(list.size(), start + ids.size());
	for (let i = start; i < last; i++) out.push(list[i]);
	return out;
}
