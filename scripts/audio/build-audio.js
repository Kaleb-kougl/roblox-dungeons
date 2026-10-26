#!/usr/bin/env node
/*
 * Audio pipeline (docs/FX_AUDIO.md task A1): vendor clips -> Roblox-ready OGG files + a generated layout module.
 *
 *   art/audio.json          (config, committed)   logical sound ID -> source clip(s), variants, gain, trim, pitch,
 *                                                 minInterval, volume, category (sfx | jingle | music | ambience)
 *   art/audio.lock.json     (committed)           every source clip the config builds: path, sha256, bytes
 *   art/vendor/**           (gitignored)          the raw packs (art/README.md says where to get them)
 *
 *   -> art/build/audio/<file>.ogg                   one file per clip, to upload (Roblox audio: private assets)
 *   -> src/shared/theme/packs/vale/audioLayout.ts   generated (committed): per sound ID its built files (the clip
 *                                                   pool: first file = assetId, the rest = variants), volume, pitch,
 *                                                   minInterval; per file its length, sample rate and channels
 *   -> art/audio-audition.html                      (--audition) the listening page: each ID's pick(s) next to the
 *                                                   alternates, with the raw clips' measured length and loudness
 *
 * Per clip (ffmpeg): [mix layers] -> [explicit trim window] -> [low-pass] -> [silence trim: sfx and jingles, never the
 * music / ambience loops] -> [mono downmix: categories with channels 1] -> loudness normalisation per category (peak:
 * a gain to the category's sample-peak target, measured on the chain's output; loudnorm: two-pass EBU R128 to the
 * category's integrated-LUFS target, linear) -> resample (<= 48 kHz) -> Vorbis OGG at a fixed quality.
 *
 * Deterministic: same inputs and the same ffmpeg build -> byte-identical outputs (sorted iteration, measured values
 * printed at fixed precision, `-map_metadata -1`, `-fflags +bitexact`, `-flags:a +bitexact`, one thread, no
 * timestamps; the OGG stream serial is fixed by +bitexact). The layout module holds no encoder bytes, so it only
 * changes when the config (or a clip's length) does. Stale .ogg files in art/build/audio are removed.
 *
 * Hard checks that fail the build (Roblox audio upload limits, config `limits`): every output under 20 MB, under
 * 7 minutes, sample rate <= 48 kHz. The log ends with an ebur128 loudness summary per category; a file outside its
 * category's loudness window is flagged (a warning, not a failure: the mix pass A5 tunes it by ear).
 *
 * Usage: node scripts/audio/build-audio.js             build (refuses if a source is missing or differs from the lock)
 *        node scripts/audio/build-audio.js --lock      rewrite art/audio.lock.json from the files on disk
 *        node scripts/audio/build-audio.js --audition  rewrite art/audio-audition.html (measures picks + alternates)
 * Plain Node plus ffmpeg / ffprobe on the PATH.
 */
"use strict";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const ART = path.join(ROOT, "art");
const VENDOR = path.join(ART, "vendor");
const CONFIG_FILE = path.join(ART, "audio.json");
const LOCK_FILE = path.join(ART, "audio.lock.json");
const BUILD = path.join(ART, "build", "audio");
const AUDITION_FILE = path.join(ART, "audio-audition.html");
const LAYOUT_FILE = path.join(ROOT, "src", "shared", "theme", "packs", "vale", "audioLayout.ts");

const CATEGORIES = ["sfx", "jingle", "music", "ambience"];
/** ffmpeg flags that keep the output free of anything but the audio (determinism). */
const BITEXACT = ["-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-threads", "1"];
/** Theme contract SOUND_PITCH_LIMITS (shared/theme contract.ts). */
const PITCH_MIN = 0.5;
const PITCH_MAX = 2;
/** Fixed precision of the gains handed to ffmpeg (dB) and of the lengths in the layout (seconds). */
const GAIN_DECIMALS = 4;
const SECONDS_DECIMALS = 3;
/** ebur128 reports this integrated loudness when a clip is too short to gate (< 400 ms): "no reading". */
const UNGATED_LUFS = -70;
/** Audition page analysis: a clip this much below the silence threshold for most of its length is "mostly silence". */
const MOSTLY_SILENT_RATIO = 0.5;
/** Audition page analysis: leading silence longer than this is worth a note (the build trims it on sfx / jingles). */
const LEAD_NOTE_SEC = 0.03;
/** Audition page analysis: a sound effect (not a jingle) audible for longer than this is flagged as long. */
const LONG_SFX_SEC = 1.5;
const PRINT_WIDTH = 120;
const TAB_WIDTH = 4;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const ID_PATTERN = /^(sfx|music|amb)\.[a-z0-9]+(\.[a-z0-9]+)*$/;

function fail(message) {
	console.error(`audio:build: ${message}`);
	process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// ffmpeg

function run(cmd, args) {
	const r = childProcess.spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	if (r.error) fail(`${cmd} could not run (${r.error.message}); install ffmpeg (brew install ffmpeg)`);
	if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed:\n${(r.stderr || "").split("\n").slice(-15).join("\n")}`);
	return r;
}

function ffmpegVersion() {
	return run("ffmpeg", ["-hide_banner", "-version"]).stdout.split("\n")[0];
}

function probe(file) {
	const r = run("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format=duration,size:stream=sample_rate,channels",
		"-of",
		"json",
		file,
	]);
	const j = JSON.parse(r.stdout);
	const s = j.streams[0];
	return {
		seconds: Number(j.format.duration),
		bytes: Number(j.format.size),
		sampleRate: Number(s.sample_rate),
		channels: Number(s.channels),
	};
}

/** Last "key: number" of a log, as a number (or NaN). */
function lastNumber(log, re) {
	let m;
	let out = NaN;
	const g = new RegExp(re.source, "g");
	while ((m = g.exec(log)) !== null) out = Number(m[1]);
	return out;
}

/**
 * Sample peak (astats, dBFS), integrated loudness and true peak (ebur128) and the silences (silencedetect at the
 * config threshold) of `inputArgs` through the filter graph `graph` (labels: the graph's output is `[out]`).
 */
function measure(inputArgs, graph, thresholdDb) {
	const chain = `${graph};[out]silencedetect=n=${thresholdDb}dB:d=0.01,astats=measure_perchannel=none,ebur128=peak=true:framelog=quiet[m]`;
	const r = run("ffmpeg", ["-nostdin", "-hide_banner", "-nostats", ...inputArgs, "-filter_complex", chain, "-map", "[m]", "-f", "null", "-"]);
	const log = r.stderr;
	const silences = [];
	const re = /silence_(start|end): (-?[0-9.e+-]+)/g;
	let m;
	let open = null;
	while ((m = re.exec(log)) !== null) {
		const t = Math.max(0, Number(m[2]));
		if (m[1] === "start") open = t;
		else if (open !== null) {
			silences.push([open, t]);
			open = null;
		}
	}
	const summary = log.slice(log.lastIndexOf("Summary:"));
	return {
		peakDb: lastNumber(log, /Peak level dB: (-?[0-9.]+|-inf)/),
		lufs: lastNumber(summary, /I:\s+(-?[0-9.]+) LUFS/),
		truePeakDb: lastNumber(summary, /Peak:\s+(-?[0-9.]+|-inf) dBFS/),
		silences,
		openSilence: open,
	};
}

// ---------------------------------------------------------------------------------------------
// Config

function clipSpec(entryId, clip) {
	const c = typeof clip === "string" ? { src: clip } : clip;
	if (!c || typeof c.src !== "string") fail(`${entryId}: a clip needs "src" (a path under art/vendor/)`);
	for (const k of Object.keys(c)) {
		if (!["src", "gainDb", "trim", "mix", "lowpassHz"].includes(k)) fail(`${entryId}: unknown clip key "${k}"`);
	}
	if (c.trim !== undefined) {
		const ok = Array.isArray(c.trim) && c.trim.length >= 1 && c.trim.length <= 2 && c.trim.every((x) => typeof x === "number" && x >= 0);
		if (!ok || (c.trim.length === 2 && c.trim[1] <= c.trim[0])) fail(`${entryId}: clip trim must be [startSec] or [startSec, endSec]`);
	}
	if (c.mix !== undefined && !(Array.isArray(c.mix) && c.mix.every((x) => typeof x === "string"))) fail(`${entryId}: clip mix must list paths`);
	if (c.gainDb !== undefined && typeof c.gainDb !== "number") fail(`${entryId}: clip gainDb must be a number`);
	if (c.lowpassHz !== undefined && !(typeof c.lowpassHz === "number" && c.lowpassHz > 0)) fail(`${entryId}: clip lowpassHz must be > 0`);
	return { src: c.src, gainDb: c.gainDb ?? 0, trim: c.trim, mix: c.mix ?? [], lowpassHz: c.lowpassHz };
}

const ENTRY_KEYS = ["category", "clips", "volume", "pitch", "minInterval", "gainDb", "silent", "confirmed", "alternates", "notes"];

function loadConfig() {
	const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
	for (const name of CATEGORIES) if (!config.categories[name]) fail(`categories.${name} is missing`);
	const sounds = [];
	for (const id of Object.keys(config.sounds).sort()) {
		const e = config.sounds[id];
		if (!ID_PATTERN.test(id)) fail(`${id}: not a sound ID (sfx.* / music.* / amb.*)`);
		for (const k of Object.keys(e)) if (!ENTRY_KEYS.includes(k) && !k.startsWith("$")) fail(`${id}: unknown key "${k}"`);
		const alternates = (e.alternates ?? []).map((a) => clipSpec(id, a));
		if (e.silent === true) {
			const category = e.category ?? (id.startsWith("music.") ? "music" : id.startsWith("amb.") ? "ambience" : "sfx");
			sounds.push({ id, silent: true, alternates, notes: e.notes ?? "", confirmed: e.confirmed === true, category });
			continue;
		}
		if (!CATEGORIES.includes(e.category)) fail(`${id}: category must be one of ${CATEGORIES.join(", ")}`);
		if (!Array.isArray(e.clips) || e.clips.length === 0) fail(`${id}: "clips" must list at least one clip (or set "silent": true)`);
		const volume = e.volume ?? 1;
		if (!(typeof volume === "number" && volume >= 0 && volume <= 1)) fail(`${id}: volume must be in [0, 1]`);
		if (e.pitch !== undefined) {
			const p = e.pitch;
			const ok = Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "number") && PITCH_MIN <= p[0] && p[0] <= p[1] && p[1] <= PITCH_MAX;
			if (!ok) fail(`${id}: pitch must be [min, max] with ${PITCH_MIN} <= min <= max <= ${PITCH_MAX}`);
		}
		if (e.minInterval !== undefined && !(typeof e.minInterval === "number" && e.minInterval >= 0)) fail(`${id}: minInterval must be >= 0`);
		if (e.gainDb !== undefined && typeof e.gainDb !== "number") fail(`${id}: gainDb must be a number`);
		const clips = e.clips.map((c) => clipSpec(id, c));
		const base = id.replace(/\./g, "-");
		const files = clips.map((_, k) => (clips.length > 1 ? `${base}-${k + 1}.ogg` : `${base}.ogg`));
		sounds.push({
			id,
			silent: false,
			category: e.category,
			clips,
			files,
			volume,
			pitch: e.pitch,
			minInterval: e.minInterval,
			gainDb: e.gainDb ?? 0,
			alternates,
			notes: e.notes ?? "",
			confirmed: e.confirmed === true,
		});
	}
	return { config, sounds };
}

/** Every source file the build reads (picks and their mix layers; not the alternates), sorted. */
function sourceFiles(sounds) {
	const files = new Set();
	for (const s of sounds) {
		if (s.silent) continue;
		for (const c of s.clips) {
			files.add(c.src);
			for (const m of c.mix) files.add(m);
		}
	}
	return [...files].sort();
}

// ---------------------------------------------------------------------------------------------
// The lock

function hashFile(rel) {
	const bytes = fs.readFileSync(path.join(VENDOR, rel));
	return { path: rel, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

function missingHint(rel) {
	return `art/vendor/${rel} is missing. Download the packs into art/vendor/ as art/README.md describes.`;
}

function writeLock(sounds) {
	const entries = sourceFiles(sounds).map((rel) => {
		if (!fs.existsSync(path.join(VENDOR, rel))) fail(missingHint(rel));
		return hashFile(rel);
	});
	const lock = {
		$comment: "Generated by `npm run audio:lock` from art/audio.json: every source clip the audio pipeline builds (paths relative to art/vendor/).",
		files: entries,
	};
	fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, "\t") + "\n");
	console.log(`audio:lock: ${entries.length} file(s) -> ${path.relative(ROOT, LOCK_FILE)}`);
}

function checkLock(sounds) {
	if (!fs.existsSync(LOCK_FILE)) fail("art/audio.lock.json is missing; run `npm run audio:lock` once the packs are in art/vendor/.");
	const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
	const locked = new Map(lock.files.map((e) => [e.path, e]));
	const problems = [];
	for (const rel of sourceFiles(sounds)) {
		const entry = locked.get(rel);
		if (!entry) {
			problems.push(`${rel}: read by art/audio.json but not in art/audio.lock.json (run \`npm run audio:lock\` if the config changed on purpose)`);
			continue;
		}
		if (!fs.existsSync(path.join(VENDOR, rel))) {
			problems.push(missingHint(rel));
			continue;
		}
		const actual = hashFile(rel);
		if (actual.sha256 !== entry.sha256 || actual.bytes !== entry.bytes) {
			problems.push(`${rel}: differs from the lock (sha256 ${actual.sha256.slice(0, 12)}.., ${actual.bytes} bytes; locked ${entry.sha256.slice(0, 12)}.., ${entry.bytes} bytes)`);
		}
	}
	if (problems.length > 0) fail(`source audio does not match art/audio.lock.json:\n  ${problems.join("\n  ")}`);
}

// ---------------------------------------------------------------------------------------------
// Filter graphs

function fixed(x, decimals) {
	const s = x.toFixed(decimals);
	return s === `-${(0).toFixed(decimals)}` ? (0).toFixed(decimals) : s;
}

/** ffmpeg input args and the filter graph of a clip up to (not including) the normalisation: output label [out]. */
function preChain(config, category, clip) {
	const cat = config.categories[category];
	const sr = config.output.sampleRate;
	const inputs = [clip.src, ...clip.mix];
	const inputArgs = [];
	for (const rel of inputs) inputArgs.push("-i", path.join(VENDOR, rel));
	const parts = [];
	// Every input as float stereo at the output rate, so layers mix and mono sources downmix the same way.
	inputs.forEach((_, i) => parts.push(`[${i}:a]aformat=sample_fmts=fltp:channel_layouts=stereo,aresample=${sr}[in${i}]`));
	const chain = [];
	let label = "[in0]";
	if (inputs.length > 1) {
		parts.push(`${inputs.map((_, i) => `[in${i}]`).join("")}amix=inputs=${inputs.length}:duration=longest:normalize=0[mixed]`);
		label = "[mixed]";
	}
	if (clip.trim) {
		const [start, end] = clip.trim;
		chain.push(`atrim=start=${start}${end !== undefined ? `:end=${end}` : ""}`, "asetpts=PTS-STARTPTS");
	}
	if (clip.lowpassHz !== undefined) chain.push(`lowpass=f=${clip.lowpassHz}`);
	if (cat.trimSilence) {
		const s = config.silence;
		const remove = (keep) =>
			`silenceremove=start_periods=1:start_threshold=${s.thresholdDb}dB:start_silence=${keep}:detection=peak`;
		chain.push(remove(s.keepStartSec), "areverse", remove(s.keepEndSec), "areverse");
	}
	if (cat.channels === 1) chain.push("pan=mono|c0=0.5*c0+0.5*c1");
	else if (cat.channels !== 2) fail(`categories.${category}.channels must be 1 or 2`);
	parts.push(`${label}${chain.length > 0 ? chain.join(",") : "anull"}[out]`);
	return { inputArgs, graph: parts.join(";") };
}

/** The normalisation filter of a clip (after measuring the pre-chain's output), ending with the output resample. */
function normalisation(config, category, sound, clip, pre) {
	const n = config.categories[category].normalize;
	const sr = config.output.sampleRate;
	const offset = sound.gainDb + clip.gainDb;
	if (n.mode === "peak") {
		const m = measure(pre.inputArgs, pre.graph, config.silence.thresholdDb);
		if (!Number.isFinite(m.peakDb)) fail(`${sound.id}: ${clip.src} is silent after trimming`);
		const target = n.peakDb + offset;
		if (target > 0) fail(`${sound.id}: peak target ${target} dBFS (category peak ${n.peakDb} + gain ${offset}) would clip`);
		return { filter: `volume=${fixed(target - m.peakDb, GAIN_DECIMALS)}dB,aresample=${sr}`, target, note: `peak ${fixed(m.peakDb, 2)} -> ${target} dBFS` };
	}
	if (n.mode === "loudnorm") {
		const target = n.lufs + offset;
		const base = `loudnorm=I=${target}:TP=${n.truePeakDb}:LRA=${n.lra}`;
		const graph = `${pre.graph};[out]${base}:print_format=json[m]`;
		const r = run("ffmpeg", ["-nostdin", "-hide_banner", "-nostats", ...pre.inputArgs, "-filter_complex", graph, "-map", "[m]", "-f", "null", "-"]);
		const json = r.stderr.slice(r.stderr.lastIndexOf("{"), r.stderr.lastIndexOf("}") + 1);
		const j = JSON.parse(json);
		const measured = `measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}`;
		return {
			filter: `${base}:${measured}:linear=true:print_format=summary,aresample=${sr}`,
			target,
			note: `loudnorm ${j.input_i} LUFS -> ${target} LUFS`,
		};
	}
	return fail(`categories.${category}.normalize.mode must be "peak" or "loudnorm"`);
}

// ---------------------------------------------------------------------------------------------
// Build

/** Encodes `graph` (output label [final]) to `tmp`. */
function encode(config, category, inputArgs, graph, tmp) {
	run("ffmpeg", [
		"-nostdin",
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		...inputArgs,
		"-filter_complex",
		graph,
		"-map",
		"[final]",
		...BITEXACT,
		"-c:a",
		config.output.codec,
		"-q:a",
		String(config.output.quality),
		"-ar",
		String(config.output.sampleRate),
		"-ac",
		String(config.categories[category].channels),
		"-f",
		"ogg",
		tmp,
	]);
}

/**
 * Builds one clip. Lossy encoding overshoots sharp transients past the normalised peak, so the decoded output is
 * measured and, while its sample peak is above `output.maxDecodedPeakDb`, re-encoded with the gain lowered by the
 * overshoot (plus `output.peakStepDb`), at most `output.peakPasses` times. Deterministic: the same measurements give
 * the same gains.
 */
function buildClip(config, sound, clip, file) {
	const pre = preChain(config, sound.category, clip);
	const norm = normalisation(config, sound.category, sound, clip, pre);
	const out = path.join(BUILD, file);
	const tmp = `${out}.tmp.ogg`;
	const o = config.output;
	let adjust = 0;
	let m;
	for (let pass = 0; ; pass++) {
		const extra = adjust !== 0 ? `,volume=${fixed(adjust, GAIN_DECIMALS)}dB` : "";
		encode(config, sound.category, pre.inputArgs, `${pre.graph};[out]${norm.filter}${extra}[final]`, tmp);
		m = measure(["-i", tmp], "[0:a]anull[out]", config.silence.thresholdDb);
		if (!(m.peakDb > o.maxDecodedPeakDb)) break;
		if (pass + 1 >= o.peakPasses) fail(`${file}: decoded peak ${m.peakDb} dBFS stays above ${o.maxDecodedPeakDb} dBFS`);
		adjust -= m.peakDb - o.maxDecodedPeakDb + o.peakStepDb;
	}
	// Only replace the output when its bytes changed (keeps mtimes of unchanged files).
	const bytes = fs.readFileSync(tmp);
	let changed = true;
	if (fs.existsSync(out) && Buffer.compare(fs.readFileSync(out), bytes) === 0) {
		fs.unlinkSync(tmp);
		changed = false;
	} else fs.renameSync(tmp, out);
	const info = probe(out);
	const note = `${norm.note}${adjust !== 0 ? ` (${fixed(adjust, 2)} dB for the decoded peak)` : ""}`;
	return {
		file,
		id: sound.id,
		category: sound.category,
		info,
		m,
		target: norm.target,
		note,
		changed,
		sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
	};
}

function checkLimits(config, r, problems) {
	const L = config.limits;
	if (!(r.info.bytes < L.maxBytes)) problems.push(`${r.file}: ${r.info.bytes} bytes (limit < ${L.maxBytes})`);
	if (!(r.info.seconds < L.maxSeconds)) problems.push(`${r.file}: ${r.info.seconds} s (limit < ${L.maxSeconds} s)`);
	if (!(r.info.sampleRate <= L.maxSampleRate)) problems.push(`${r.file}: ${r.info.sampleRate} Hz (limit <= ${L.maxSampleRate} Hz)`);
}

/** Is a built file's loudness inside its category's window? */
function inWindow(config, r) {
	const n = config.categories[r.category].normalize;
	if (n.mode === "peak") return Math.abs(r.m.peakDb - r.target) <= n.windowDb;
	return Math.abs(r.m.lufs - r.target) <= n.windowLu;
}

function loudnessSummary(config, results) {
	console.log("audio:build: loudness (ebur128 integrated, sample peak) per category:");
	let flagged = 0;
	for (const cat of CATEGORIES) {
		const rs = results.filter((r) => r.category === cat);
		if (rs.length === 0) continue;
		const n = config.categories[cat].normalize;
		const gated = rs.filter((r) => Number.isFinite(r.m.lufs) && r.m.lufs > UNGATED_LUFS);
		const lufs = gated.map((r) => r.m.lufs);
		const peaks = rs.map((r) => r.m.peakDb);
		const seconds = rs.reduce((a, r) => a + r.info.seconds, 0);
		const bytes = rs.reduce((a, r) => a + r.info.bytes, 0);
		const target = n.mode === "peak" ? `peak ${n.peakDb} dBFS +/- ${n.windowDb}` : `${n.lufs} LUFS +/- ${n.windowLu}`;
		const range = (xs) => (xs.length === 0 ? "n/a" : `${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}`);
		console.log(
			`  ${cat.padEnd(8)} ${String(rs.length).padStart(3)} file(s), ${seconds.toFixed(1)} s, ${(bytes / 1024).toFixed(0)} KiB; target ${target}; ` +
				`integrated ${range(lufs)} LUFS (${rs.length - gated.length} too short to gate), sample peak ${range(peaks)} dBFS`,
		);
		for (const r of rs) {
			if (!inWindow(config, r)) {
				flagged++;
				console.log(`    OUT OF WINDOW ${r.file}: ${r.m.lufs.toFixed(1)} LUFS, peak ${r.m.peakDb.toFixed(2)} dBFS`);
			}
		}
	}
	return flagged;
}

function removeStale(keep) {
	if (!fs.existsSync(BUILD)) return;
	for (const entry of fs.readdirSync(BUILD, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith(".ogg") && !keep.has(entry.name)) {
			fs.unlinkSync(path.join(BUILD, entry.name));
			console.log(`audio:build: removed stale ${path.relative(ROOT, path.join(BUILD, entry.name))}`);
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Layout module (prettier's layout, like scripts/art/build-atlases.js)

function tsKey(k) {
	return IDENT.test(k) ? k : JSON.stringify(k);
}

function isLeaf(v) {
	return v === null || typeof v !== "object";
}

function tsInline(v) {
	if (isLeaf(v)) return tsValue(v, 0, 0);
	if (Array.isArray(v)) {
		if (v.length > 1 && v.every((x) => !isLeaf(x) && !Array.isArray(x) && Object.keys(x).length > 0)) return null;
		const parts = v.map(tsInline);
		return parts.includes(null) ? null : `[${parts.join(", ")}]`;
	}
	const keys = Object.keys(v).filter((k) => v[k] !== undefined);
	if (!keys.every((k) => isLeaf(v[k]) || (Array.isArray(v[k]) && v[k].every(isLeaf)))) return null;
	return keys.length === 0 ? "{}" : `{ ${keys.map((k) => `${tsKey(k)}: ${tsInline(v[k])}`).join(", ")} }`;
}

function tsValue(v, depth, used) {
	const pad = "\t".repeat(depth);
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "number") {
		if (!Number.isFinite(v)) throw new Error("non-finite number in layout");
		return String(v);
	}
	if (typeof v === "boolean") return v ? "true" : "false";
	const inline = tsInline(v);
	if (inline !== null && used + inline.length + 1 <= PRINT_WIDTH) return inline;
	const inner = (depth + 1) * TAB_WIDTH;
	if (Array.isArray(v)) {
		if (v.length === 0) return "[]";
		return `[\n${v.map((x) => `${pad}\t${tsValue(x, depth + 1, inner)},\n`).join("")}${pad}]`;
	}
	const keys = Object.keys(v).filter((k) => v[k] !== undefined);
	const lines = keys.map((k) => `${pad}\t${tsKey(k)}: ${tsValue(v[k], depth + 1, inner + tsKey(k).length + 2)},\n`);
	return `{\n${lines.join("")}${pad}}`;
}

function layoutModule(sounds, results) {
	const layouts = {};
	for (const s of sounds) {
		if (s.silent) continue;
		layouts[s.id] = { files: s.files, volume: s.volume, pitch: s.pitch, minInterval: s.minInterval };
	}
	const files = {};
	for (const r of [...results].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
		files[r.file] = { seconds: Number(r.info.seconds.toFixed(SECONDS_DECIMALS)), sampleRate: r.info.sampleRate, channels: r.info.channels };
	}
	const text = [
		"// GENERATED by `npm run audio:build` (scripts/audio/build-audio.js) from art/audio.json. Do not edit.",
		"",
		"/**",
		" * Layout of the `vale` pack's sounds (docs/FX_AUDIO.md task A1). No asset IDs: `files` names the OGG files in",
		" * art/build/audio/ to upload; the pack manifest pairs each file with its uploaded `rbxassetid://` and turns a sound ID",
		" * on once every one of its files has one. `files[0]` becomes the SoundAsset's assetId, the rest its variants.",
		" * IDs art/audio.json leaves silent are not listed (they stay the placeholder pack's SILENT).",
		" */",
		"",
		'import type { PitchRange } from "../../types";',
		"",
		"/** One sound ID: its clip pool in art/build/audio/ and the SoundAsset fields art/audio.json sets. */",
		"export interface ValeSoundLayout {",
		"\tfiles: Array<string>;",
		"\tvolume: number;",
		"\tpitch?: PitchRange;",
		"\tminInterval?: number;",
		"}",
		"",
		"/** A built OGG file: its length (seconds), sample rate (Hz) and channels, as measured after the build. */",
		"export interface ValeAudioFile {",
		"\tseconds: number;",
		"\tsampleRate: number;",
		"\tchannels: number;",
		"}",
		"",
		`export const VALE_SOUND_LAYOUTS: Record<string, ValeSoundLayout> = ${tsValue(layouts, 0, PRINT_WIDTH)};`,
		"",
		`export const VALE_AUDIO_FILES: Record<string, ValeAudioFile> = ${tsValue(files, 0, PRINT_WIDTH)};`,
		"",
	].join("\n");
	for (const line of text.split("\n")) {
		if (line.replace(/\t/g, "    ").length > PRINT_WIDTH) throw new Error(`audioLayout.ts line over ${PRINT_WIDTH} columns: ${line}`);
	}
	return text;
}

function writeIfChanged(file, content) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return false;
	fs.writeFileSync(file, content);
	return true;
}

function build() {
	const { config, sounds } = loadConfig();
	checkLock(sounds);
	console.log(`audio:build: ${ffmpegVersion()}`);
	fs.mkdirSync(BUILD, { recursive: true });
	const results = [];
	const keep = new Set();
	for (const s of sounds) {
		if (s.silent) continue;
		s.clips.forEach((clip, k) => {
			const file = s.files[k];
			if (keep.has(file)) fail(`two outputs named ${file}`);
			keep.add(file);
			const r = buildClip(config, s, clip, file);
			results.push(r);
			console.log(`  ${file.padEnd(34)} ${r.info.seconds.toFixed(3).padStart(8)} s ${String(r.info.sampleRate).padStart(6)} Hz ${r.info.channels} ch ${String(r.info.bytes).padStart(8)} B  ${r.note}${r.changed ? "" : " (unchanged)"}`);
		});
	}
	removeStale(keep);
	const problems = [];
	for (const r of results) checkLimits(config, r, problems);
	if (problems.length > 0) fail(`Roblox upload limits exceeded:\n  ${problems.join("\n  ")}`);
	const layoutChanged = writeIfChanged(LAYOUT_FILE, layoutModule(sounds, results));
	const flagged = loudnessSummary(config, results);
	const total = results.reduce((a, r) => a + r.info.bytes, 0);
	const changed = results.filter((r) => r.changed).length;
	const silent = sounds.filter((s) => s.silent).map((s) => s.id);
	console.log(
		`audio:build: ${results.length} file(s), ${(total / (1024 * 1024)).toFixed(2)} MiB, ${changed} updated, ` +
			`${sounds.length - silent.length} sound ID(s) (${silent.length} silent: ${silent.join(", ") || "none"}), ` +
			`${flagged} outside their loudness window, layout ${layoutChanged ? "updated" : "unchanged"}`,
	);
}

// ---------------------------------------------------------------------------------------------
// Audition page

/** Measurements of a raw source clip (no processing), for the audition page. */
function analyse(config, rel) {
	const abs = path.join(VENDOR, rel);
	if (!fs.existsSync(abs)) return { rel, missing: true };
	const info = probe(abs);
	const m = measure(["-i", abs], "[0:a]anull[out]", config.silence.thresholdDb);
	const silences = [...m.silences];
	if (m.openSilence !== null) silences.push([m.openSilence, info.seconds]);
	const silent = silences.reduce((a, [s, e]) => a + Math.max(0, Math.min(e, info.seconds) - s), 0);
	const lead = silences.length > 0 && silences[0][0] <= 0.001 ? silences[0][1] : 0;
	const last = silences[silences.length - 1];
	const tail = last && last[1] >= info.seconds - 0.001 ? info.seconds - last[0] : 0;
	return {
		rel,
		seconds: info.seconds,
		audible: Math.max(0, info.seconds - lead - tail),
		lead,
		tail,
		silentRatio: info.seconds > 0 ? silent / info.seconds : 0,
		peakDb: m.peakDb,
		lufs: m.lufs > UNGATED_LUFS ? m.lufs : undefined,
		channels: info.channels,
		sampleRate: info.sampleRate,
	};
}

function flags(config, category, a) {
	if (a.missing) return ["missing from art/vendor"];
	const out = [];
	if (a.silentRatio > MOSTLY_SILENT_RATIO) out.push(`mostly silence (${Math.round(a.silentRatio * 100)} % below ${config.silence.thresholdDb} dB)`);
	if (a.lead > LEAD_NOTE_SEC) out.push(`${a.lead.toFixed(2)} s leading silence${category === "sfx" || category === "jingle" ? " (trimmed by the build)" : " (a loop: trim by hand)"}`);
	if (category === "sfx" && a.audible > LONG_SFX_SEC) out.push(`long for a sound effect (${a.audible.toFixed(2)} s audible)`);
	return out;
}

function esc(s) {
	return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A path under art/vendor as a URL relative to art/ (each segment percent-encoded: spaces, "&"). */
function vendorUrl(rel) {
	return ["vendor", ...rel.split("/")].map(encodeURIComponent).join("/");
}

function audition() {
	const { config, sounds } = loadConfig();
	const cache = new Map();
	const get = (rel) => {
		if (!cache.has(rel)) cache.set(rel, analyse(config, rel));
		return cache.get(rel);
	};
	const fmt = (x, d, unit) => (x === undefined || !Number.isFinite(x) ? "n/a" : `${x.toFixed(d)}${unit}`);
	const row = (kind, category, clip, built) => {
		const layers = [clip.src, ...clip.mix];
		const cells = layers.map((rel) => {
			const a = get(rel);
			const fl = flags(config, category, a).map((f) => `<span class="flag">${esc(f)}</span>`).join(" ");
			const stats = a.missing
				? ""
				: `${fmt(a.seconds, 2, " s")} (audible ${fmt(a.audible, 2, " s")}) &middot; peak ${fmt(a.peakDb, 1, " dBFS")} &middot; ${a.lufs === undefined ? "too short for LUFS" : fmt(a.lufs, 1, " LUFS")} &middot; ${a.channels} ch ${a.sampleRate} Hz`;
			return `<div class="clip"><button data-src="${esc(vendorUrl(rel))}">&#9654;</button> <code>${esc(rel.replace(/^ninja-adventure\/Audio\//, ""))}</code> <span class="stats">${stats}</span> ${fl}</div>`;
		});
		const opts = [];
		if (clip.trim) opts.push(`trim ${clip.trim.join("..")} s`);
		if (clip.lowpassHz !== undefined) opts.push(`low-pass ${clip.lowpassHz} Hz`);
		if (clip.gainDb !== 0) opts.push(`gain ${clip.gainDb} dB`);
		if (clip.mix.length > 0) opts.push("layers mixed");
		const builtButton = built ? `<div class="clip built"><button data-src="${esc(`build/audio/${built}`)}">&#9654;</button> built <code>${esc(built)}</code> <span class="stats">(after npm run audio:build)</span></div>` : "";
		return `<div class="${kind}">${cells.join("")}${opts.length > 0 ? `<div class="opts">${esc(opts.join(", "))}</div>` : ""}${builtButton}</div>`;
	};
	const sections = [];
	for (const s of sounds) {
		const category = s.category ?? "sfx";
		const head = `<h2 id="${esc(s.id)}"><code>${esc(s.id)}</code> <span class="cat">${esc(category)}</span> ${s.confirmed ? '<span class="ok">confirmed</span>' : '<span class="todo">not confirmed</span>'}</h2>`;
		const meta = s.silent
			? '<p class="meta"><b>silent for now</b></p>'
			: `<p class="meta">volume ${s.volume}${s.pitch ? `, pitch ${s.pitch.join("..")}` : ""}${s.minInterval !== undefined ? `, min interval ${s.minInterval} s` : ""}${s.gainDb !== 0 ? `, gain ${s.gainDb} dB` : ""}${s.clips.length > 1 ? `, ${s.clips.length} variants (round-robin)` : ""}</p>`;
		const picks = s.silent ? "" : `<h3>Pick${s.clips.length > 1 ? "s" : ""}</h3>${s.clips.map((c, k) => row("pick", category, c, s.files[k])).join("")}`;
		const alts = s.alternates.length > 0 ? `<h3>Alternates</h3>${s.alternates.map((c) => row("alt", category, c, undefined)).join("")}` : "";
		const notes = s.notes ? `<p class="notes">${esc(s.notes)}</p>` : "";
		sections.push(`<section>${head}${meta}${notes}${picks}${alts}</section>`);
	}
	const toc = sounds.map((s) => `<a href="#${esc(s.id)}">${esc(s.id)}</a>`).join(" ");
	const html = `<!doctype html>
<!-- GENERATED by \`npm run audio:audition\` (scripts/audio/build-audio.js --audition) from art/audio.json. Do not edit. -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audio audition</title>
<style>
:root { --bg: #f6f5f2; --fg: #1d1d1b; --dim: #6b6a66; --card: #ffffff; --line: #dedcd6; --flag: #a4461b; --ok: #2f7a3b; --todo: #8a6d00; --accent: #2b5fa8; }
@media (prefers-color-scheme: dark) { :root { --bg: #18181a; --fg: #e8e6e1; --dim: #9a9892; --card: #222225; --line: #36363a; --flag: #f08a5d; --ok: #7bc48a; --todo: #e3c04f; --accent: #7fa8e8; } }
body { background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 16px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 16px; margin: 0 0 4px; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--dim); margin: 10px 0 4px; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; margin: 12px 0; }
.toc { font-size: 12px; line-height: 1.9; }
.toc a { color: var(--accent); margin-right: 8px; text-decoration: none; }
.cat { font-size: 12px; color: var(--dim); font-weight: normal; }
.ok { font-size: 12px; color: var(--ok); } .todo { font-size: 12px; color: var(--todo); }
.meta, .notes { margin: 2px 0; color: var(--dim); } .notes { color: var(--fg); }
.clip { margin: 3px 0; overflow-wrap: anywhere; } .built { color: var(--dim); }
.stats { color: var(--dim); font-size: 12px; } .flag { color: var(--flag); font-size: 12px; }
.opts { font-size: 12px; color: var(--dim); margin-left: 34px; }
button { width: 28px; height: 24px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--fg); cursor: pointer; }
button.playing { background: var(--accent); color: #fff; }
code { font-size: 13px; }
</style>
</head>
<body>
<h1>Audio audition</h1>
<p>Open this file from <code>art/</code> (the raw clips are read from <code>art/vendor/</code>, the built ones from <code>art/build/audio/</code>). Each sound ID shows the current pick(s) from <code>art/audio.json</code> and the plan's alternates (docs/FX_AUDIO.md). Measurements are of the raw clips: length, audible length (above ${esc(config.silence.thresholdDb)} dB), sample peak, integrated loudness. Edit <code>art/audio.json</code>, set <code>"confirmed": true</code> once a pick is settled, then <code>npm run audio:lock</code>, <code>npm run audio:build</code> and <code>npm run audio:audition</code>.</p>
<p>${esc(sounds.length)} IDs. ${sounds.filter((s) => s.silent).length} silent. ${sounds.filter((s) => s.confirmed).length} confirmed.</p>
<div class="toc">${toc}</div>
${sections.join("\n")}
<script>
let current = null;
let currentButton = null;
function stop() {
	if (current) { current.pause(); current = null; }
	if (currentButton) { currentButton.classList.remove("playing"); currentButton = null; }
}
document.addEventListener("click", (e) => {
	const b = e.target.closest("button[data-src]");
	if (!b) return;
	const same = b === currentButton;
	stop();
	if (same) return;
	const a = new Audio(b.dataset.src);
	a.addEventListener("ended", stop);
	a.addEventListener("error", () => { b.title = "could not load " + b.dataset.src; stop(); });
	a.play();
	current = a;
	currentButton = b;
	b.classList.add("playing");
});
</script>
</body>
</html>
`;
	const changed = writeIfChanged(AUDITION_FILE, html);
	console.log(`audio:audition: ${sounds.length} sound ID(s), ${cache.size} clip(s) measured -> ${path.relative(ROOT, AUDITION_FILE)}${changed ? "" : " (unchanged)"}`);
}

function main() {
	if (process.argv.includes("--lock")) {
		writeLock(loadConfig().sounds);
		return;
	}
	if (process.argv.includes("--audition")) {
		audition();
		return;
	}
	build();
}

main();
