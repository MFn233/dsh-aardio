/**
 * The Config schema contract.
 *
 * The host projects a settings form only from volatile parts of a plugin's
 * Config (`volatileForm`), so a non-volatile field silently produces no
 * configuration page at all. These tests pin that down, along with the
 * reference unwrapping the plugin does on every tool call.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CONFIG_DEFAULTS, createConfig, loadSchemastery, readField, readRoot, withDefaults } from '../lib/config.js'

/** A stand-in for the host's volatile config reference. */
function reference(value) {
	return { get: () => value }
}

describe('readRoot', () => {
	it('unwraps the volatile reference the host supplies', () => {
		assert.equal(readRoot({ aardioRoot: reference('C:\\aardio') }), 'C:\\aardio')
	})

	it('accepts a plain value, a missing field, and a foreign value', () => {
		assert.equal(readRoot({ aardioRoot: 'D:/Develop/aardio' }), 'D:/Develop/aardio')
		assert.equal(readRoot({}), '')
		assert.equal(readRoot(undefined), '')
		assert.equal(readRoot({ aardioRoot: reference(undefined) }), '')
		assert.equal(readRoot({ aardioRoot: 42 }), '')
	})

	it('unwraps any field, not only the root', () => {
		assert.equal(readField({ other: reference('x') }, 'other'), 'x')
	})

	it('keeps defaults stable for callers without a schema', () => {
		assert.deepEqual(CONFIG_DEFAULTS, { aardioRoot: '' })
		assert.deepEqual(withDefaults({}), { aardioRoot: '' })
		assert.deepEqual(withDefaults({ aardioRoot: reference('C:\\aardio') }), { aardioRoot: 'C:\\aardio' })
	})
})

describe('Config schema', () => {
	const Schema = loadSchemastery()

	it('declares exactly one editable field named aardioRoot', (t) => {
		if (Schema === null) {
			t.skip('no schemastery copy is resolvable here')
			return
		}
		const config = createConfig()
		assert.notEqual(config, undefined)
		assert.deepEqual(Object.keys(config.dict), ['aardioRoot'])
	})

	it('marks the field volatile so the host offers a configuration form', (t) => {
		if (Schema === null) {
			t.skip('no schemastery copy is resolvable here')
			return
		}
		const json = createConfig().toJSON()
		const field = Object.values(json.refs).find((node) => node.type === 'string')
		assert.equal(field.meta.volatile, true)
		assert.equal(field.meta.default, '')
	})

	it('resolves the field into a reference with a current value', (t) => {
		if (Schema === null) {
			t.skip('no schemastery copy is resolvable here')
			return
		}
		const resolved = createConfig()({ aardioRoot: 'D:/Develop/aardio' })
		assert.equal(typeof resolved.aardioRoot.get, 'function')
		assert.equal(readRoot(resolved), 'D:/Develop/aardio')
	})
})
