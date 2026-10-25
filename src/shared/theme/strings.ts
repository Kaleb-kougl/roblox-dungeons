/**
 * Pure string-table helpers: `{name}` interpolation and template checks.
 *
 * Ported from project-kaleb-vale `src/theme/strings.ts` @ 42897e2. The RegExp
 * `/\{([a-zA-Z0-9_]+)\}/g` becomes the Lua pattern `{([%w_]+)}` (%w is ASCII letters and digits).
 */

export type StringVars = Readonly<Record<string, string | number>>;

const PLACEHOLDER_PATTERN = "{([%w_]+)}";

/**
 * Replace {name} placeholders with vars.name. Placeholders with no matching var are left as-is,
 * so a missing var shows up on screen instead of silently vanishing.
 */
export function interpolate(template: string, vars?: StringVars): string {
	if (vars === undefined) {
		return template;
	}
	// Returning undefined from a gsub callback keeps the whole match.
	const [out] = template.gsub(PLACEHOLDER_PATTERN, (name: string) => {
		const v = vars[name];
		return v === undefined ? undefined : tostring(v);
	});
	return out;
}

/** Placeholder names used by a template, e.g. "Lv {level}" -> ["level"]. */
export function placeholders(template: string): Array<string> {
	const out = new Array<string>();
	for (const [name] of template.gmatch(PLACEHOLDER_PATTERN)) {
		out.push(name as string);
	}
	return out;
}

/** A readable problem with a template's braces, or undefined if it is well-formed. */
export function templateProblem(template: string): string | undefined {
	const [stripped] = template.gsub(PLACEHOLDER_PATTERN, "");
	if (stripped.find("{", 1, true)[0] !== undefined || stripped.find("}", 1, true)[0] !== undefined) {
		return "has a malformed placeholder (use {name} with letters, digits or _)";
	}
	return undefined;
}
