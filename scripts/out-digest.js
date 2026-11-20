// A digest of the compiled code with its comments removed (docs/DOC_COMMENTS.md Design 4, DC3). rbxtsc copies
// source comments into out/**/*.luau, so a commit that only edits comments still changes out/. This tool proves such
// a commit changed nothing else: digest before and after, then `cmp` the two files.
//
//   npm run build && npm run out:digest -- --out build/out.before.txt
//   ... edit comments ...
//   npm run build && npm run out:digest -- --out build/out.after.txt && cmp build/out.before.txt build/out.after.txt
//
//   node scripts/out-digest.js [--out <file>] [outDir]
//
// One line per .luau file under outDir (default out), sorted: `<sha256 of the stripped text>  <path>`. Stripping
// removes `--` line comments and `--[[ ]]` / `--[=[ ]=]` block comments, then trailing whitespace and blank lines.
// Strings are kept byte for byte: a `--` inside "..." , '...', `...` or a long bracket string is not a comment.
// Indentation is kept, so a statement that moves into or out of a block still changes the digest.
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

/** The level of a long bracket opening at `i` (`[[` is 0, `[=[` is 1), or -1 when there is none. */
function longBracketLevel(source, i) {
	if (source[i] !== "[") return -1;
	let j = i + 1;
	while (source[j] === "=") j += 1;
	return source[j] === "[" ? j - i - 1 : -1;
}

/** The index just past the long bracket of `level` that closes after `from` (the end of the text if it never does). */
function longBracketEnd(source, from, level) {
	const close = `]${"=".repeat(level)}]`;
	const at = source.indexOf(close, from);
	return at === -1 ? source.length : at + close.length;
}

/** The index just past the quoted string that opens at `i` (escapes skipped; a backtick string may span lines). */
function quotedEnd(source, i) {
	const quote = source[i];
	let j = i + 1;
	while (j < source.length) {
		const ch = source[j];
		if (ch === "\\") j += 2;
		else if (ch === quote) return j + 1;
		else if (ch === "\n" && quote !== "`") return j;
		else j += 1;
	}
	return source.length;
}

/** A Luau source without its comments, trailing whitespace and blank lines. */
function stripComments(source) {
	let out = "";
	let i = 0;
	while (i < source.length) {
		const ch = source[i];
		if (ch === "-" && source[i + 1] === "-") {
			const level = longBracketLevel(source, i + 2);
			if (level >= 0) {
				i = longBracketEnd(source, i + 2, level);
			} else {
				const eol = source.indexOf("\n", i);
				i = eol === -1 ? source.length : eol;
			}
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			const end = quotedEnd(source, i);
			out += source.slice(i, end);
			i = end;
			continue;
		}
		const level = longBracketLevel(source, i);
		if (level >= 0) {
			const end = longBracketEnd(source, i, level);
			out += source.slice(i, end);
			i = end;
			continue;
		}
		out += ch;
		i += 1;
	}
	return out
		.split("\n")
		.map((line) => line.replace(/[ \t\r]+$/, ""))
		.filter((line) => line !== "")
		.join("\n");
}

function digestOf(source) {
	return crypto.createHash("sha256").update(stripComments(source)).digest("hex");
}

/** Every .luau file under dir as sorted `/`-separated paths relative to it. */
function listLuau(dir) {
	const found = [];
	const walk = (d) => {
		for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
			const full = path.join(d, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile() && entry.name.endsWith(".luau")) found.push(path.relative(dir, full).split(path.sep).join("/"));
		}
	};
	walk(dir);
	return found.sort();
}

/** The digest file's text for outDir. */
function digestTree(outDir) {
	return listLuau(outDir)
		.map((file) => `${digestOf(fs.readFileSync(path.join(outDir, file), "utf8"))}  ${file}\n`)
		.join("");
}

function main(argv) {
	let outFile;
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--out") outFile = argv[++i];
		else rest.push(argv[i]);
	}
	const outDir = rest[0] ?? "out";
	if (!fs.existsSync(outDir)) {
		console.error(`out-digest: ${outDir} does not exist. Run \`npm run build\` first.`);
		return 1;
	}
	const text = digestTree(outDir);
	if (outFile === undefined) {
		process.stdout.write(text);
		return 0;
	}
	fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
	fs.writeFileSync(outFile, text);
	console.log(`out-digest: ${text.split("\n").length - 1} modules -> ${outFile}`);
	return 0;
}

module.exports = { digestOf, digestTree, listLuau, stripComments };

if (require.main === module) process.exit(main(process.argv.slice(2)));
