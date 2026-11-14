/**
 * Tool definitions registered on `ctx.tools`.
 *
 * The definitions are written by hand instead of imported from
 * `@deepseek-ai/dsh-tools` because a profile-installed plugin cannot rely on
 * that package resolving; the shape below is the same contract
 * (`name`, `description`, `parameters`, `output.schema`, `output.render`,
 * `execute`).
 *
 * @module dsh-aardio/tools
 */

import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { BRIDGE_LIMITS, runBridgeCode } from './bridge.js'
import { AARDIO_EXECUTABLE, CONFIGURATION_HINT, describeCandidates } from './installation.js'
import { SCOPE_DIRS, readInstallationFile, searchInstallation } from './search.js'

/** Package root, needed to name the bridge script in error messages. */
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Ceiling for `path` input; the bridge enforces the same limit on code. */
const MAX_SOURCE_BYTES = BRIDGE_LIMITS.maxCodeBytes

/** Bounds accepted by `aardio_docs`, mirrored in the parameter descriptions. */
const DEFAULT_MATCHES = 12
const MAX_MATCHES = 40
const MAX_CONTEXT = 4
const MAX_PER_FILE = 6

/** Output shape shared by the search and read behaviours. */
const EMPTY_FILE = { path: '', offset: 0, total: 0, truncated: false, lines: [] }

/**
 * Construct the `aardio_docs` tool: one keyword search engine over the local
 * installation, plus a bounded read of any file it points at.
 * @param installation - the resolved installation handle.
 * @returns a tool definition.
 */
export function defineDocsTool(installation) {
	return {
		name: 'aardio_docs',
		description:
			'Search the local aardio installation (official docs, examples, standard-library sources) and read the files it finds. '
			+ 'Query syntax: bare terms (all must appear in a file), "quoted phrase" for adjacency, -term to exclude. '
			+ 'Results are ranked and carry surrounding lines. Pass `path` (absolute, or relative to the installation) instead of `query` to read a file directly, '
			+ 'which works even when your file tool cannot reach the installation folder. Use this before writing any aardio API you are not certain exists.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				query: {
					type: 'string',
					description: 'Search terms; supports "exact phrase" and -excluded terms. Provide this or `path`.',
				},
				path: {
					type: 'string',
					description: 'File to read instead of searching: an absolute path inside the installation, or a path relative to it, e.g. lib/win/ui/ctrl/listview.aardio.',
				},
				scope: {
					type: 'string',
					enum: ['docs', 'examples', 'lib', 'all'],
					description: 'docs = official documentation, examples = runnable samples, lib = standard-library sources, all = every scope (default).',
				},
				mode: {
					type: 'string',
					enum: ['all', 'any'],
					description: 'all (default) requires every term in a file; any accepts a file with one of them. A multi-term search with no hits retries with any automatically.',
				},
				context: {
					type: 'integer',
					description: `Lines of context around each hit, 0-${MAX_CONTEXT}; default 1.`,
				},
				limit: {
					type: 'integer',
					description: `Maximum matches to return; default ${DEFAULT_MATCHES}, maximum ${MAX_MATCHES}.`,
				},
				perFile: {
					type: 'integer',
					description: `Maximum matches kept from one file; default 2, maximum ${MAX_PER_FILE}.`,
				},
				offset: {
					type: 'integer',
					description: 'First line to read (1-based) when `path` is given; default 1.',
				},
				lines: {
					type: 'integer',
					description: 'How many lines to read when `path` is given; default 120, maximum 400.',
				},
			},
			required: [],
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					kind: { type: 'string', enum: ['search', 'read'] },
					root: { type: 'string' },
					query: { type: 'string' },
					scope: { type: 'string' },
					scanned: { type: 'integer' },
					matchedFiles: { type: 'integer' },
					relaxed: { type: 'boolean' },
					truncated: { type: 'boolean' },
					matches: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								path: { type: 'string' },
								line: { type: 'integer' },
								score: { type: 'integer' },
								snippet: { type: 'string' },
							},
							required: ['path', 'line', 'score', 'snippet'],
						},
					},
					file: {
						type: 'object',
						additionalProperties: false,
						properties: {
							path: { type: 'string' },
							offset: { type: 'integer' },
							total: { type: 'integer' },
							truncated: { type: 'boolean' },
							lines: {
								type: 'array',
								items: {
									type: 'object',
									additionalProperties: false,
									properties: {
										number: { type: 'integer' },
										text: { type: 'string' },
									},
									required: ['number', 'text'],
								},
							},
						},
						required: ['path', 'offset', 'total', 'truncated', 'lines'],
					},
				},
				required: [
					'kind', 'root', 'query', 'scope', 'scanned', 'matchedFiles', 'relaxed', 'truncated', 'matches', 'file',
				],
			},
			render: (_args, value) => {
				if (value.kind === 'read') {
					const last = value.file.lines.length === 0
						? value.file.offset
						: value.file.lines[value.file.lines.length - 1].number
					const head = `${value.file.path} — lines ${value.file.offset}-${last} of ${value.file.total}${value.file.truncated ? ' (more follows)' : ''}`
					const body = value.file.lines.map((line) => `${line.number}: ${line.text}`).join('\n')
					return [{ type: 'text', text: `${head}\n${body}` }]
				}

				if (value.matches.length === 0) {
					const relaxed = value.relaxed ? ' (all terms relaxed to any)' : ''
					return [{
						type: 'text',
						text: `No match for "${value.query}" in ${value.scope}${relaxed} (scanned ${value.scanned} files under ${value.root}).`,
					}]
				}

				const blocks = value.matches.map((match) => {
					const snippet = match.snippet.split('\n').map((line) => `    ${line}`).join('\n')
					return `${match.path}:${match.line}  (score ${match.score})\n${snippet}`
				})
				const tail = value.truncated ? `\n(results truncated; narrow the scope or add a -term)` : ''
				const relaxed = value.relaxed ? ' (relaxed to any term)' : ''
				return [{
					type: 'text',
					text: `aardio ${value.scope} — ${value.matches.length} match(es) in ${value.matchedFiles} file(s) for "${value.query}"${relaxed}:\n\n${blocks.join('\n\n')}${tail}`,
				}]
			},
		},
		async execute(args) {
			const root = installation.rootOrThrow()
			const path = typeof args.path === 'string' ? args.path.trim() : ''

			if (path !== '') {
				const file = await readInstallationFile(root, path, { offset: args.offset, lines: args.lines })
				return {
					kind: 'read',
					root,
					query: '',
					scope: '',
					scanned: 0,
					matchedFiles: 0,
					relaxed: false,
					truncated: file.truncated,
					matches: [],
					file,
				}
			}

			const query = String(args.query ?? '').trim()
			if (query === '') throw new Error('aardio_docs: provide a query to search, or a path to read')
			const scope = typeof args.scope === 'string' && args.scope in SCOPE_DIRS ? args.scope : 'all'
			const mode = args.mode === 'any' ? 'any' : 'all'
			const limit = Math.min(Math.max(Number(args.limit ?? DEFAULT_MATCHES) || DEFAULT_MATCHES, 1), MAX_MATCHES)
			const perFile = Math.min(Math.max(Number(args.perFile ?? 2) || 2, 1), MAX_PER_FILE)
			const context = Math.min(Math.max(Number(args.context ?? 1) || 0, 0), MAX_CONTEXT)

			const first = await searchInstallation(root, { query, scope, mode, limit, perFile, context })
			const multiPart = first.queryParts.terms.length + first.queryParts.phrases.length > 1
			const relaxed = first.matches.length === 0 && mode === 'all' && multiPart
			const result = relaxed
				? await searchInstallation(root, { query, scope, mode: 'any', limit, perFile, context })
				: first

			// Only fields the output schema declares: the harness validates the result against it.
			return {
				kind: 'search',
				root,
				query,
				scope,
				scanned: result.scanned,
				matchedFiles: result.matchedFiles,
				relaxed,
				truncated: result.truncated,
				matches: result.matches,
				file: EMPTY_FILE,
			}
		},
	}
}

/**
 * Construct the `aardio_exec` tool: compile or run aardio code inside the
 * user's running IDE through the bridge.
 *
 * This is the only way the harness can verify aardio code: `loadcode` exists
 * only inside an aardio process, so the bridge is what turns "please press F5"
 * into a tool call.
 * @param options - injectable bridge script path, for tests.
 * @returns a tool definition.
 */
export function defineExecTool(options = {}) {
	const bridgeScript = options.bridgeScript ?? join(PLUGIN_ROOT, 'bridge', 'aardioBridge.aardio')

	return {
		name: 'aardio_exec',
		description:
			'Compile or run aardio code inside the user\'s running aardio IDE through the dsh-aardio bridge. '
			+ '`mode: "check"` only compiles (fast syntax/semantic check with line numbers); `mode: "run"` (default) executes and returns everything printed with `print(...)`, the value passed to `return`, and any compile or runtime error. '
			+ 'Use it to verify code and to run `util.testRunner` suites instead of asking the user to press F5. '
			+ `It requires the user to have started the bridge once: open ${bridgeScript} in the aardio IDE and press F5; the bridge window stays open while it serves requests. `
			+ 'Provide either `code` or `path`, not both.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				code: {
					type: 'string',
					description: 'aardio source to compile or run.',
				},
				path: {
					type: 'string',
					description: 'Absolute path of an .aardio file to read and run instead of `code`.',
				},
				mode: {
					type: 'string',
					enum: ['run', 'check'],
					description: 'check compiles without executing; run (default) executes and captures print/return/errors.',
				},
				timeoutMs: {
					type: 'integer',
					description: `How long to wait for the IDE bridge; default ${BRIDGE_LIMITS.defaultTimeoutMs}, maximum ${BRIDGE_LIMITS.maxTimeoutMs}.`,
				},
			},
			required: [],
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					ok: { type: 'boolean' },
					mode: { type: 'string' },
					phase: { type: 'string' },
					source: { type: 'string' },
					compileError: { type: 'string' },
					error: { type: 'string' },
					result: { type: 'string' },
					resultType: { type: 'string' },
					print: { type: 'array', items: { type: 'string' } },
					durationMs: { type: 'integer' },
					bridgePid: { type: 'integer' },
				},
				required: [
					'ok', 'mode', 'phase', 'source', 'compileError', 'error', 'result', 'resultType', 'print', 'durationMs', 'bridgePid',
				],
			},
			render: (_args, value) => {
				if (value.phase === 'compile') {
					return [{ type: 'text', text: `Compile error in ${value.source}:\n${value.compileError}` }]
				}
				if (value.mode === 'check') {
					return [{ type: 'text', text: `Compiled ${value.source}: no syntax errors.` }]
				}

				const lines = []
				if (value.print.length > 0) {
					lines.push('print:')
					for (const line of value.print) lines.push(`  ${line}`)
				}
				if (value.resultType !== 'null') {
					lines.push(`return (${value.resultType}): ${value.result}`)
				}
				if (value.error !== '') lines.push(`runtime error: ${value.error}`)
				lines.push(value.ok ? `ok in ${String(value.durationMs)} ms` : `failed in ${String(value.durationMs)} ms`)
				return [{ type: 'text', text: `${value.source}\n${lines.join('\n')}` }]
			},
		},
		async execute(args) {
			const path = String(args.path ?? '').trim()
			const inline = typeof args.code === 'string' ? args.code : ''
			if (path !== '' && inline.trim() !== '') {
				throw new Error('aardio_exec: provide either code or path, not both')
			}

			let code = inline
			let source = 'inline'
			if (path !== '') {
				if (!existsSync(path)) throw new Error(`aardio_exec: file does not exist: ${path}`)
				const size = statSync(path).size
				if (size > MAX_SOURCE_BYTES) {
					throw new Error(`aardio_exec: ${path} is ${String(size)} bytes; the bridge accepts up to ${String(MAX_SOURCE_BYTES)}`)
				}
				code = await readFile(path, 'utf8')
				source = path
			}
			if (code.trim() === '') throw new Error('aardio_exec: provide code or path')

			const mode = args.mode === 'check' ? 'check' : 'run'
			const value = await runBridgeCode({ code, mode, timeoutMs: args.timeoutMs, hint: bridgeScript })

			return {
				ok: value.ok,
				mode,
				phase: value.phase,
				source,
				compileError: value.compileError,
				error: value.error,
				result: value.result,
				resultType: value.resultType,
				print: value.print,
				durationMs: value.durationMs,
				bridgePid: value.bridgePid,
			}
		},
	}
}

/**
 * Construct the `aardio_open` tool.
 * @param installation - the resolved installation handle.
 * @param options - injectable launcher and platform, for tests.
 * @returns a tool definition.
 */
export function defineOpenTool(installation, options = {}) {
	const platform = options.platform ?? process.platform
	const launch = options.launch ?? ((executable, target) => {
		const child = spawn(executable, [target], { detached: true, stdio: 'ignore' })
		child.unref()
	})

	return {
		name: 'aardio_open',
		description:
			'Open an .aardio source file or a project directory / .aproj file in the aardio IDE. Use it when the user must run or inspect the code, because this harness cannot compile aardio itself.',
		parameters: {
			type: 'object',
			additionalProperties: false,
			properties: {
				path: {
					type: 'string',
					description: 'Absolute path of an .aardio file, an .aproj file, or a project folder containing default.aproj.',
				},
			},
			required: ['path'],
		},
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					target: { type: 'string' },
					executable: { type: 'string' },
					opened: { type: 'boolean' },
				},
				required: ['target', 'executable', 'opened'],
			},
			render: (args, value) => [
				{ type: 'text', text: `Opened in the aardio IDE: ${value.target} (via ${value.executable})` },
			],
		},
		execute(args) {
			const target = String(args.path ?? '').trim()
			if (target === '') throw new Error('aardio_open: path must not be empty')
			if (!existsSync(target)) throw new Error(`aardio_open: path does not exist: ${target}`)
			if (platform !== 'win32') throw new Error('aardio_open: the aardio IDE only runs on Windows')

			// A project folder opens its default.aproj so the IDE restores the project, not a bare file.
			let resolved = target
			if (statSync(target).isDirectory()) {
				const project = join(target, 'default.aproj')
				resolved = existsSync(project) ? project : target
			}

			const root = installation.rootOrThrow()
			const executable = join(root, AARDIO_EXECUTABLE)
			launch(executable, resolved)
			return { target: resolved, executable, opened: true }
		},
	}
}

/**
 * Construct the `aardio_env` tool: which installation the plugin resolved, and
 * what it probed, so a model can diagnose a wrong path without guessing.
 * @param installation - the resolved installation handle.
 * @returns a tool definition.
 */
export function defineEnvTool(installation) {
	return {
		name: 'aardio_env',
		description:
			'Report which aardio installation this plugin resolved, where that value came from, whether aardio.exe is present, and which folders were probed. Use it when aardio_docs or aardio_open cannot find the installation.',
		parameters: { type: 'object', additionalProperties: false, properties: {} },
		output: {
			schema: {
				type: 'object',
				additionalProperties: false,
				properties: {
					root: { type: 'string' },
					source: { type: 'string' },
					configured: { type: 'string' },
					valid: { type: 'boolean' },
					executable: { type: 'boolean' },
					markers: {
						type: 'object',
						additionalProperties: false,
						properties: {
							lib: { type: 'boolean' },
							docs: { type: 'boolean' },
							examples: { type: 'boolean' },
						},
						required: ['lib', 'docs', 'examples'],
					},
					candidates: {
						type: 'array',
						items: {
							type: 'object',
							additionalProperties: false,
							properties: {
								path: { type: 'string' },
								valid: { type: 'boolean' },
							},
							required: ['path', 'valid'],
						},
					},
					hint: { type: 'string' },
				},
				required: ['root', 'source', 'configured', 'valid', 'executable', 'markers', 'candidates', 'hint'],
			},
			render: (_args, value) => {
				const lines = [
					value.root === '' ? 'No aardio installation resolved.' : `aardio installation: ${value.root}`,
					`source: ${value.source}${value.configured === '' ? '' : ` (configured: ${value.configured})`}`,
					`aardio.exe: ${value.executable ? 'present' : 'missing'}`,
					`folders: ${['lib', 'docs', 'examples'].map((name) => `${name}=${value.markers[name] ? 'yes' : 'no'}`).join(', ')}`,
				]
				if (value.candidates.length > 0) {
					lines.push('probed:', ...value.candidates.map((candidate) => `  ${candidate.path}${candidate.valid ? ' (valid)' : ''}`))
				}
				if (!value.valid) lines.push(value.hint)
				return [{ type: 'text', text: lines.join('\n') }]
			},
		},
		execute() {
			const resolution = installation.resolve()
			const candidates = resolution.candidates ?? []
			return {
				root: resolution.root ?? '',
				source: resolution.source,
				configured: installation.configured(),
				valid: resolution.valid,
				executable: resolution.executable === true,
				markers: {
					lib: resolution.markers?.lib === true,
					docs: resolution.markers?.docs === true,
					examples: resolution.markers?.examples === true,
				},
				candidates: candidates.map((candidate) => ({ path: candidate.path, valid: candidate.valid })),
				hint: resolution.valid ? '' : `${CONFIGURATION_HINT}\nProbed:\n${describeCandidates(candidates)}`,
			}
		},
	}
}
