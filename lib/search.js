/**
 * Keyword search over an aardio installation, tuned for an agent rather than a
 * person reading a results page.
 *
 * What makes it useful to a model:
 *   - a small query language instead of a single substring: bare terms,
 *     `"quoted phrases"`, and `-excluded` terms;
 *   - file-level gating (all terms, or any) plus line-level ranking, so a
 *     query like `winform add` still finds a file where the two words live on
 *     different lines;
 *   - context lines around every hit, so one call usually carries enough of
 *     the signature to act on;
 *   - score boosts for the cases that matter: the term is the file's name,
 *     it appears at the start of a line (a definition), it is in an `index.md`
 *     page, or it is a path segment;
 *   - a bounded read of any file inside the installation, because an agent's
 *     file tool may be restricted to another sandbox.
 *
 * @module dsh-aardio/search
 */

import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, isAbsolute, join, normalize, relative, sep } from 'node:path'

/** Search scopes and the installation folders each one covers. */
export const SCOPE_DIRS = {
	docs: ['docs'],
	examples: ['examples'],
	lib: ['lib'],
	all: ['docs', 'examples', 'lib'],
}

/** Extensions treated as searchable text. `.aar` files index a documentation folder. */
export const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.aardio', '.txt', '.yml', '.yaml', '.json', '.aar'])

/** Budgets for one search or read. */
export const SEARCH_LIMITS = {
	maxFiles: 12000,
	maxBytes: 256 * 1024 * 1024,
	maxFileBytes: 2 * 1024 * 1024,
	maxDepth: 12,
	snippetWidth: 400,
	contextLines: 1,
	maxMatches: 40,
	maxPerFile: 3,
	proximityLines: 20,
	readLines: 400,
	listTtlMs: 30_000,
}

/** Directory names that are never searched. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.res', '__pycache__', '.build'])

/** Cached file lists per `<root>|<scope>`, refreshed on a short TTL. */
const fileLists = new Map()

/** Drop cached file lists; used by tests and after a known installation change. */
export function resetFileListCache() {
	fileLists.clear()
}

/**
 * Recursively walk a directory, yielding file paths.
 * @param directory - folder to walk.
 * @param options - depth budget and current depth.
 */
export async function* walkFiles(directory, options = {}) {
	const maxDepth = options.maxDepth ?? SEARCH_LIMITS.maxDepth
	const depth = options.depth ?? 0
	if (depth > maxDepth) return

	let entries
	try {
		entries = await readdir(directory, { withFileTypes: true })
	} catch {
		return
	}

	for (const entry of entries) {
		if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue
		const path = join(directory, entry.name)
		if (entry.isDirectory()) {
			yield* walkFiles(path, { maxDepth, depth: depth + 1 })
		} else if (entry.isFile()) {
			yield path
		}
	}
}

/**
 * Parse a query into terms, phrases, and exclusions.
 *
 * Supports `term`, `"exact phrase"`, and `-excluded` / `-"excluded phrase"`.
 * Unbalanced quotes are tolerated: the rest of the query becomes the phrase.
 * @param text - the raw query.
 * @returns the parsed parts, still in their original case.
 */
export function parseQuery(text) {
	const terms = []
	const phrases = []
	const excludes = []
	const source = String(text ?? '')
	let index = 0

	while (index < source.length) {
		while (index < source.length && /\s/u.test(source[index])) index += 1
		if (index >= source.length) break

		let negated = false
		if (source[index] === '-') {
			negated = true
			index += 1
		}

		let token = ''
		if (source[index] === '"') {
			index += 1
			while (index < source.length && source[index] !== '"') {
				token += source[index]
				index += 1
			}
			if (index < source.length) index += 1
			const phrase = token.trim()
			if (phrase === '') continue
			;(negated ? excludes : phrases).push(phrase)
			continue
		}

		while (index < source.length && !/\s/u.test(source[index])) {
			token += source[index]
			index += 1
		}
		if (token === '') continue
		;(negated ? excludes : terms).push(token)
	}

	return { terms, phrases, excludes }
}

/**
 * Whether a character continues an ASCII identifier, which is how a dotted API
 * name gets glued to a longer one (`string.save` vs `string.saveFiles`).
 * @param character - one character, or an empty string past either end.
 * @returns whether it is an identifier character.
 */
function isIdentifierCharacter(character) {
	if (character === '') return false
	return character === '_' || character === '$' || /[A-Za-z0-9]/u.test(character)
}

/**
 * Count occurrences of a needle, separating standalone uses from prefixes of a
 * longer identifier.
 * @param haystack - lowercased text.
 * @param needle - lowercased needle; empty returns zero counts.
 * @returns the total and the boundary-aligned counts.
 */
function countOccurrences(haystack, needle) {
	if (needle === '') return { total: 0, boundary: 0 }
	let total = 0
	let boundary = 0
	let index = 0
	for (;;) {
		const found = haystack.indexOf(needle, index)
		if (found < 0) return { total, boundary }
		total += 1
		const before = found === 0 ? '' : haystack[found - 1]
		const after = haystack[found + needle.length] ?? ''
		if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after)) boundary += 1
		index = found + needle.length
	}
}

/**
 * List the searchable files of one scope, reusing a short-lived cache.
 * @param root - installation folder.
 * @param scope - docs | examples | lib | all.
 * @returns absolute file paths.
 */
async function listFiles(root, scope) {
	const key = `${root}|${scope}`
	const now = Date.now()
	const cached = fileLists.get(key)
	if (cached !== undefined && now - cached.at < SEARCH_LIMITS.listTtlMs) return cached.files

	const files = []
	for (const name of SCOPE_DIRS[scope] ?? SCOPE_DIRS.all) {
		const base = join(root, name)
		if (!existsSync(base)) continue
		for await (const file of walkFiles(base)) {
			if (!TEXT_EXTENSIONS.has(extname(file).toLowerCase())) continue
			files.push(file)
		}
	}

	fileLists.set(key, { at: now, files })
	return files
}

/**
 * Describe a file's contribution to the ranking.
 * @param file - absolute path.
 * @param needles - lowercased terms and phrases being searched.
 * @returns a constant score bonus for that file.
 */
function fileBoost(file, needles) {
	const path = file.toLowerCase()
	const base = path.slice(path.lastIndexOf(sep) + 1)
	const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
	let score = 0
	for (const needle of needles) {
		if (path.includes(needle)) score += 15
		if (stem === needle) score += 25
	}
	// A documentation page states the signature; a source file shows the implementation.
	if (path.endsWith('.md') || path.endsWith('.markdown')) score += 4
	if (path.endsWith(`${sep}index.md`) || path.endsWith(`${sep}index.markdown`)) score += 8
	return score
}

/**
 * Whether a file is really binary despite its text extension.
 *
 * `lib/ide/*.aardio` and a few shipped data files carry NUL bytes and long runs
 * of control characters; their "matches" are noise for an agent.
 * @param text - decoded file content.
 * @returns whether the content should be skipped.
 */
function looksBinary(text) {
	if (text.includes('\u0000')) return true
	const sample = text.slice(0, 8192)
	let control = 0
	for (let index = 0; index < sample.length; index += 1) {
		const code = sample.charCodeAt(index)
		if (code < 9 || (code > 13 && code < 32)) control += 1
	}
	return sample.length > 0 && control / sample.length > 0.05
}

/**
 * Build the snippet around one line.
 * @param lines - all lines of the file.
 * @param index - zero-based matching line.
 * @param context - lines of context on each side.
 * @returns the snippet text.
 */
function snippetAround(lines, index, context) {
	const start = Math.max(0, index - context)
	const end = Math.min(lines.length - 1, index + context)
	const width = SEARCH_LIMITS.snippetWidth
	return lines.slice(start, end + 1).map((line) => line.trim().slice(0, width)).join('\n')
}

/**
 * Search one or more scopes of an installation.
 * @param root - aardio installation folder.
 * @param options - query, scope, match mode, limits, and context width.
 * @returns ranked matches with the scan statistics.
 */
export async function searchInstallation(root, options) {
	const parsed = parseQuery(options.query)
	const scope = options.scope ?? 'all'
	const limit = options.limit ?? 12
	const perFile = options.perFile ?? SEARCH_LIMITS.maxPerFile
	const context = options.context ?? 0
	const mode = options.mode === 'any' ? 'any' : 'all'

	const needles = [...parsed.terms, ...parsed.phrases].map((needle) => needle.toLowerCase())
	const excludes = parsed.excludes.map((needle) => needle.toLowerCase())

	const files = await listFiles(root, scope)
	const results = []
	let scanned = 0
	let matchedFiles = 0
	let bytes = 0
	let truncated = false

	outer: for (const file of files) {
		if (scanned >= SEARCH_LIMITS.maxFiles) {
			truncated = true
			break
		}
		scanned += 1

		let text
		try {
			text = await readFile(file, 'utf8')
		} catch {
			continue
		}
		if (text.length > SEARCH_LIMITS.maxFileBytes) continue
		bytes += text.length
		if (bytes > SEARCH_LIMITS.maxBytes) {
			truncated = true
			break
		}

		const lower = text.toLowerCase()
		if (looksBinary(text)) continue
		if (excludes.some((needle) => lower.includes(needle))) continue
		const matched = mode === 'all'
			? needles.every((needle) => lower.includes(needle))
			: needles.some((needle) => lower.includes(needle))
		if (!matched) continue
		matchedFiles += 1

		const boost = fileBoost(file, needles)
		const lines = text.split('\n')
		const hits = []
		// Gate multi-term `all` queries on proximity: a file that mentions every
		// term a thousand lines apart is not evidence about any one of them.
		const lastSeen = needles.map(() => -1)
		let coherent = needles.length <= 1
		for (let index = 0; index < lines.length; index += 1) {
			const lineLower = lines[index].toLowerCase()
			let matchedCount = 0
			let boundary = 0
			let total = 0
			for (const [needleIndex, needle] of needles.entries()) {
				const counts = countOccurrences(lineLower, needle)
				if (counts.total > 0) {
					matchedCount += 1
					boundary += counts.boundary
					total += counts.total
					lastSeen[needleIndex] = index
				}
			}

			if (!coherent && lastSeen.every((line) => line >= 0)) {
				coherent = Math.max(...lastSeen) - Math.min(...lastSeen) <= SEARCH_LIMITS.proximityLines
			}
			if (matchedCount === 0) continue

			let score = matchedCount * 10 + boundary * 8 + Math.min(total, 10)
			const trimmed = lineLower.trimStart()
			for (const needle of needles) {
				// A definition starts with the name itself, not with a longer identifier
				// that merely begins the same way (`string.saveFiles` for `string.save`).
				if (!trimmed.startsWith(needle)) continue
				if (isIdentifierCharacter(trimmed[needle.length] ?? '')) continue
				score += 12
			}
			hits.push({ line: index + 1, score: score + boost, snippet: snippetAround(lines, index, context) })
		}

		if (mode === 'all' && needles.length > 1 && !coherent) continue
		if (hits.length === 0) continue
		hits.sort((left, right) => right.score - left.score || left.line - right.line)
		// Overlapping snippets carry the same text; keep the best one from each block.
		const kept = []
		for (const hit of hits) {
			if (kept.length >= perFile) break
			if (kept.some((other) => Math.abs(other.line - hit.line) <= context * 2 + 1)) continue
			kept.push(hit)
		}
		for (const hit of kept) results.push({ path: file, ...hit })
	}

	// Rank everything that matched: stopping early would favour whichever files
	// the directory walk happens to reach first, not the best evidence.
	results.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path) || left.line - right.line)
	const limited = results.slice(0, limit)
	if (limited.length < results.length) truncated = true

	return {
		query: options.query,
		scope,
		mode,
		queryParts: parsed,
		scanned,
		matchedFiles,
		truncated,
		matches: limited,
	}
}

/**
 * Resolve a path and prove it stays inside the installation.
 * @param root - installation folder.
 * @param target - absolute path, or a path relative to the installation root.
 * @returns the absolute path.
 */
export function resolveInsideInstallation(root, target) {
	const absolute = normalize(isAbsolute(target) ? target : join(root, target))
	const rootNormal = normalize(root)
	const relation = relative(rootNormal, absolute)
	const outside = relation === '' ? false : relation.startsWith('..') || isAbsolute(relation)
	// Windows paths are case-insensitive, so a differently cased drive letter still counts as inside.
	const insideByCase = absolute.toLowerCase() === rootNormal.toLowerCase()
		|| absolute.toLowerCase().startsWith(`${rootNormal.toLowerCase()}${sep}`)
	if (outside && !insideByCase) {
		throw new Error(`dsh-aardio: "${target}" is outside the aardio installation "${root}"`)
	}
	return absolute
}

/**
 * Read part of one file inside the installation.
 * @param root - installation folder.
 * @param target - absolute path or a path relative to the root.
 * @param options - one-based first line and how many lines to return.
 * @returns the window of numbered lines.
 */
export async function readInstallationFile(root, target, options = {}) {
	const path = resolveInsideInstallation(root, target)
	if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) {
		throw new Error(`dsh-aardio: "${path}" is not a text file this plugin can read`)
	}

	const text = await readFile(path, 'utf8')
	const all = text.split('\n')
	// A file ending in a newline has one empty trailing element; it is not a line to report.
	if (all.length > 1 && all[all.length - 1] === '') all.pop()
	const total = all.length
	const first = Math.min(Math.max(Number(options.offset ?? 1) || 1, 1), Math.max(total, 1))
	const count = Math.min(Math.max(Number(options.lines ?? 120) || 120, 1), SEARCH_LIMITS.readLines)
	const start = first - 1
	const end = Math.min(total, start + count)

	return {
		path,
		offset: start + 1,
		total,
		truncated: end < total,
		lines: all.slice(start, end).map((line, index) => ({ number: start + index + 1, text: line })),
	}
}
