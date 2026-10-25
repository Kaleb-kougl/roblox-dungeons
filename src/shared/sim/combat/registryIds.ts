/**
 * Helpers shared by the archetype and weapon registries: id validation (the source's
 * `/^[a-z][a-z0-9]*(\.[a-z0-9]+)*$/`) and the id order that numbers registered defs.
 *
 * The web build sorts ids with JS string `<` (UTF-16 code-unit order). Valid ids are ASCII, so comparing bytes gives
 * the same order without depending on Luau's string comparison (fixtures/README.md porting note 5); the resulting
 * index tables are checked against constants.json (`archetypes[]`, `weapons[]`).
 */

/** True for a lowercase dot-separated id: a letter first, then segments of [a-z0-9]+ joined by single dots. */
export function isValidRegistryId(id: unknown): id is string {
	if (!typeIs(id, "string") || id.size() === 0) return false;
	const [first] = string.find(id, "^[a-z]");
	if (first === undefined) return false;
	for (const segment of string.split(id, ".")) {
		const [ok] = string.find(segment, "^[a-z0-9]+$");
		if (ok === undefined) return false;
	}
	return true;
}

/** JS `a < b ? -1 : a > b ? 1 : 0` for ASCII strings (code-unit order). */
export function compareIds(a: string, b: string): number {
	const n = math.min(a.size(), b.size());
	for (let i = 1; i <= n; i++) {
		const ca = string.byte(a, i)[0];
		const cb = string.byte(b, i)[0];
		if (ca !== cb) return ca < cb ? -1 : 1;
	}
	return a.size() < b.size() ? -1 : a.size() > b.size() ? 1 : 0;
}
