/**
 * Locating the user's aardio installation.
 *
 * aardio ships as a portable folder, so there is no package registry to ask.
 * The folder is resolved in a fixed order: the plugin's own configuration, then
 * an environment variable, then a probe of the usual install locations. Every
 * step is descriptive rather than eager, so a wrong value produces an
 * actionable tool error instead of a plugin that fails to load.
 *
 * Only Node built-ins are used: a profile-installed plugin must not depend on
 * Harness packages.
 *
 * @module dsh-aardio/installation
 */

import { existsSync, statSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import process from 'node:process'

/** Environment variables read before any disk probe, in this order. */
export const ROOT_ENVIRONMENT_VARIABLES = ['AARDIO_ROOT', 'AARDIO_HOME']

/** Executable that identifies an aardio installation folder. */
export const AARDIO_EXECUTABLE = 'aardio.exe'

/** Folders an aardio installation is expected to contain. */
const INSTALLATION_MARKERS = ['lib', 'docs', 'examples']

/**
 * Sub-paths probed under every fixed drive, in the order they are reported.
 * These cover a standalone `aardio` folder, a development folder, and the
 * default locations of a normal Windows install.
 */
const DRIVE_SUBPATHS = [
	'aardio',
	'Develop\\aardio',
	'Program Files\\aardio',
	'Program Files (x86)\\aardio',
	'Applications\\aardio',
	'software\\aardio',
	'tools\\aardio',
]

/** Result cache for the probe; a process cannot gain a new aardio folder mid-run. */
let probeCache

/**
 * Trim a user-supplied path into the folder that should contain aardio.
 *
 * Accepts the shapes users actually paste: surrounding quotes, forward slashes,
 * a trailing separator, the `aardio.exe` file itself, or a `.aproj` project
 * path that happens to live inside the installation.
 * @param input - raw configured or typed value.
 * @returns normalised absolute folder, or an empty string for no input.
 */
export function normalizeRoot(input) {
	if (typeof input !== 'string') return ''
	let value = input.trim()
	if (value.length === 0) return ''

	// Shells and file dialogs commonly wrap Windows paths in quotes.
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		value = value.slice(1, -1).trim()
	}
	if (value.length === 0) return ''

	value = normalize(value)
	if (value.toLowerCase().endsWith('.exe')) {
		value = dirname(value)
	} else if (value.endsWith(sep) && value.length > 3) {
		value = value.slice(0, -1)
	}
	return value
}

/**
 * Describe one candidate folder without throwing.
 * @param folder - candidate absolute path.
 * @param exists - injectable existence check, for tests.
 * @returns whether it is an aardio folder and which markers were found.
 */
export function describeRoot(folder, exists = existsSync) {
	const executable = join(folder, AARDIO_EXECUTABLE)
	const markers = {}
	for (const marker of INSTALLATION_MARKERS) markers[marker] = exists(join(folder, marker))

	let isDirectory = false
	try {
		isDirectory = exists(folder) && statSync(folder).isDirectory()
	} catch {
		isDirectory = false
	}

	return {
		path: folder,
		isDirectory,
		executable: exists(executable),
		markers,
		valid: isDirectory && exists(executable),
	}
}

/**
 * Build the ordered list of folders probed when nothing is configured.
 *
 * Environment hints come first (they are cheap and often deliberate), then the
 * well-known Windows locations, then one sweep across present drives. The list
 * is de-duplicated case-insensitively so Windows aliases do not repeat.
 * @param options - injectable environment and existence check.
 * @returns candidate entries, existing folders only, each described.
 */
export function probeCandidates(options = {}) {
	const env = options.env ?? process.env
	const exists = options.exists ?? existsSync
	if (options.env === undefined && probeCache !== undefined) return probeCache

	/** @type {string[]} */
	const folders = []
	const push = (folder) => {
		const normalized = normalizeRoot(folder)
		if (normalized !== '') folders.push(normalized)
	}

	for (const variable of ROOT_ENVIRONMENT_VARIABLES) push(env[variable])
	if (env.ProgramFiles !== undefined) push(join(env.ProgramFiles, 'aardio'))
	if (env.LOCALAPPDATA !== undefined) push(join(env.LOCALAPPDATA, 'aardio'))
	if (env.APPDATA !== undefined) push(join(env.APPDATA, 'aardio'))

	for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code += 1) {
		const drive = `${String.fromCharCode(code)}:${sep}`
		if (!exists(drive)) continue
		for (const subPath of DRIVE_SUBPATHS) push(join(drive, subPath))
	}

	const seen = new Set()
	const candidates = []
	for (const folder of folders) {
		const key = folder.toLowerCase()
		if (seen.has(key)) continue
		seen.add(key)
		const described = describeRoot(folder, exists)
		if (described.isDirectory) candidates.push(described)
	}

	if (options.env === undefined) probeCache = candidates
	return candidates
}

/**
 * Explain every probed folder in one line each, for tool errors.
 * @param candidates - entries from {@link probeCandidates}.
 * @returns multi-line summary.
 */
export function describeCandidates(candidates) {
	if (candidates.length === 0) return '  (no aardio folder found in the usual locations)'
	return candidates
		.map((candidate) => `  ${candidate.path}${candidate.valid ? ' (valid)' : ' (missing aardio.exe)'}`)
		.join('\n')
}

/** Diagnostic text that tells the user how to point the plugin at their install. */
export const CONFIGURATION_HINT = [
	'Point the plugin at the folder that contains aardio.exe:',
	'  Plugins -> aardio Aardio toolchain -> Configure, then set "aardio installation folder"; or',
	'  set the AARDIO_ROOT environment variable; or',
	'  add aardioRoot to the dsh-aardio row in the profile patch.',
].join('\n')

/**
 * Resolve the installation once per plugin activation.
 *
 * Detection runs on the first tool call, so activation stays cheap. The
 * configured value may change while the plugin runs (a volatile setting applies
 * in place), so `resolve()` re-reads it and redoes the work only when the value
 * actually moved.
 * @param source - a function returning the configured folder, or a config object.
 * @param options - injectable environment, existence check, and probe, for tests.
 * @returns an installation handle whose `resolve()` is memoised per value.
 */
export function createInstallation(source = {}, options = {}) {
	const env = options.env ?? process.env
	const exists = options.exists ?? existsSync
	const probe = options.probe ?? (() => probeCandidates({ env, exists }))
	const read = typeof source === 'function' ? source : () => source?.aardioRoot
	let cachedFor
	let resolved

	/**
	 * @param configured - the normalised configured folder.
	 * @returns {{ root: string | null, source: 'config' | 'environment' | 'detected' | 'unconfigured', valid: boolean, candidates: Array<ReturnType<typeof describeRoot>> }}
	 */
	function detect(configured) {
		const candidates = () => probe()

		if (configured !== '') {
			const described = describeRoot(configured, exists)
			return {
				root: configured,
				source: 'config',
				valid: described.valid,
				candidates: candidates(),
				markers: described.markers,
				executable: described.executable,
			}
		}

		for (const variable of ROOT_ENVIRONMENT_VARIABLES) {
			const fromEnvironment = normalizeRoot(env[variable])
			if (fromEnvironment === '') continue
			const described = describeRoot(fromEnvironment, exists)
			return {
				root: fromEnvironment,
				source: 'environment',
				valid: described.valid,
				candidates: candidates(),
				variable,
				markers: described.markers,
				executable: described.executable,
			}
		}

		const probed = candidates()
		const found = probed.find((candidate) => candidate.valid)
		if (found !== undefined) {
			return {
				root: found.path,
				source: 'detected',
				valid: true,
				candidates: probed,
				markers: found.markers,
				executable: true,
			}
		}

		return { root: null, source: 'unconfigured', valid: false, candidates: probed }
	}

	/** @returns the current normalised configured folder. */
	function configuredValue() {
		return normalizeRoot(read())
	}

	return {
		/** @returns the resolution for the value that is configured right now. */
		resolve() {
			const configured = configuredValue()
			if (cachedFor !== configured) {
				cachedFor = configured
				resolved = detect(configured)
			}
			return resolved
		},
		/** @returns the folder to read, or null when nothing was found. */
		root() {
			return this.resolve().root
		},
		/** @returns the folder confirmed to contain aardio.exe. */
		rootOrThrow() {
			const resolution = this.resolve()
			if (resolution.root === null) {
				const probed = resolution.candidates ?? []
				throw new Error(`dsh-aardio: aardio installation not found.\n${CONFIGURATION_HINT}\nProbed:\n${describeCandidates(probed)}`)
			}
			if (!resolution.valid) {
				throw new Error(
					`dsh-aardio: "${resolution.root}" (from ${resolution.source}) does not contain ${AARDIO_EXECUTABLE}.\n${CONFIGURATION_HINT}`,
				)
			}
			return resolution.root
		},
		/** @returns the configured value as written, for diagnostics. */
		configured() {
			return configuredValue()
		},
	}
}
