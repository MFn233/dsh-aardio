/**
 * The plugin's Config schema.
 *
 * Harness settings, the Plugin Manager configuration page, and CLI
 * `--dump-config` all read this schema, so the row's editable fields are
 * declared here rather than parsed out of JSON by hand.
 *
 * `@deepseek-ai/schemastery` is a peer of this package and normally resolves
 * from the profile that installed it. A linked development checkout has no
 * `node_modules`, so the loader also anchors on the running Harness
 * installation before giving up: without a schema the plugin still works from
 * its environment variable and detection, it just has no configuration page.
 *
 * @module dsh-aardio/config
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import process from 'node:process'

/** Peer package that owns the Config schema language. */
const SCHEMA_PACKAGE = '@deepseek-ai/schemastery'

/** Environment variables naming a directory that can resolve Harness peers. */
const RESOLUTION_ANCHORS = ['DSH_INSTALL_DIR', 'DSH_PROFILE_DIR', 'DSH_HOME']

let cached

/**
 * Resolve schemastery, trying this package first and then the running Harness.
 * @returns the schema factory, or null when no usable copy exists.
 */
export function loadSchemastery() {
	if (cached !== undefined) return cached

	const attempts = [createRequire(import.meta.url)]
	for (const variable of RESOLUTION_ANCHORS) {
		const anchor = process.env[variable]
		if (anchor === undefined || anchor === '') continue
		try {
			attempts.push(createRequire(join(anchor, 'package.json')))
		} catch {
			// A missing or malformed anchor is not fatal; the next one may work.
		}
	}

	for (const require of attempts) {
		try {
			const loaded = require(SCHEMA_PACKAGE)
			const Schema = loaded?.default ?? loaded
			if (typeof Schema === 'function' && typeof Schema.object === 'function') {
				cached = Schema
				return cached
			}
		} catch {
			// Try the next anchor.
		}
	}

	cached = null
	return cached
}

/**
 * Build the exported Config schema.
 *
 * `aardioRoot` is declared `.volatile()`, which is what makes the field appear
 * in the Settings/Plugins configuration form at all: the host projects a form
 * only from volatile nodes, and a volatile field applies in place without
 * restarting the plugin. Its runtime value is a reference with `get()`, read by
 * {@link readRoot} on every tool call.
 * @returns a schemastery object schema, or undefined without a schema runtime.
 */
export function createConfig() {
	const Schema = loadSchemastery()
	if (Schema === null) return undefined

	return Schema.object({
		aardioRoot: Schema.string()
			.default('')
			.volatile()
			.description(
				'Folder that contains aardio.exe. Leave empty to auto-detect the installation, or set the AARDIO_ROOT environment variable.',
			),
	})
}

/** Config fields with their defaults, for callers that must not depend on the schema. */
export const CONFIG_DEFAULTS = { aardioRoot: '' }

/**
 * Read one config field, unwrapping the host's volatile reference.
 *
 * A volatile field's value is `{ get() }` rather than the value itself, and the
 * reference is updated in place when the user saves, so it must be read per use
 * instead of captured during activation.
 * @param config - the row's live `config` object.
 * @param field - field name.
 * @returns the current plain value, or undefined.
 */
export function readField(config, field) {
	const value = config?.[field]
	if (value !== null && typeof value === 'object' && typeof value.get === 'function') return value.get()
	return value
}

/**
 * Read the live `aardioRoot` setting.
 * @param config - the row's live `config` object.
 * @returns the configured folder, or an empty string.
 */
export function readRoot(config) {
	const value = readField(config, 'aardioRoot')
	return typeof value === 'string' ? value : ''
}

/**
 * Apply defaults to a raw row configuration.
 * @param config - the row's `config` object, possibly partial.
 * @returns every field defined, with volatile references unwrapped.
 */
export function withDefaults(config = {}) {
	return { aardioRoot: readRoot(config) }
}
