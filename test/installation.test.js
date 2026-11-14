/**
 * Installation resolution: normalisation, validity, and the config → env →
 * detection precedence. Fixtures are real folders under the OS temp directory,
 * because the resolver deliberately reads the real filesystem.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { createInstallation, normalizeRoot, probeCandidates } from '../lib/installation.js'

/** @type {string[]} */
const temporary = []

/**
 * Create a fake aardio installation inside a temp folder.
 * @param options - whether to include aardio.exe and the marker folders.
 * @returns the folder path.
 */
async function makeInstallation(options = {}) {
	const root = await mkdtemp(join(tmpdir(), 'dsh-aardio-install-'))
	temporary.push(root)
	if (options.executable !== false) await writeFile(join(root, 'aardio.exe'), '')
	for (const marker of options.markers ?? ['lib', 'docs', 'examples']) {
		await mkdir(join(root, marker), { recursive: true })
	}
	return root
}

after(async () => {
	await Promise.all(temporary.map((folder) => rm(folder, { recursive: true, force: true })))
})

describe('normalizeRoot', () => {
	it('returns an empty string for missing or blank input', () => {
		assert.equal(normalizeRoot(undefined), '')
		assert.equal(normalizeRoot(null), '')
		assert.equal(normalizeRoot('   '), '')
	})

	it('strips quotes a shell or file dialog may add', () => {
		assert.equal(normalizeRoot('"C:\\aardio"'), 'C:\\aardio')
		assert.equal(normalizeRoot("'C:\\aardio'"), 'C:\\aardio')
	})

	it('drops a trailing separator but keeps a drive root intact', () => {
		assert.equal(normalizeRoot('C:\\aardio\\'), 'C:\\aardio')
		assert.equal(normalizeRoot('C:\\'), 'C:\\')
	})

	it('accepts the executable itself and returns its folder', () => {
		assert.equal(normalizeRoot('D:/Develop/aardio/aardio.exe'), join('D:', 'Develop', 'aardio'))
	})
})

describe('createInstallation', () => {
	it('prefers the configured folder and reports its source', async () => {
		const root = await makeInstallation()
		const installation = createInstallation({ aardioRoot: root }, { env: {} })
		const resolution = installation.resolve()
		assert.equal(resolution.root, root)
		assert.equal(resolution.source, 'config')
		assert.equal(resolution.valid, true)
		assert.equal(installation.rootOrThrow(), root)
	})

	it('accepts a quoted path and an executable path from the settings page', async () => {
		const root = await makeInstallation()
		assert.equal(createInstallation({ aardioRoot: `"${root}"` }, { env: {} }).root(), root)
		assert.equal(createInstallation({ aardioRoot: join(root, 'aardio.exe') }, { env: {} }).root(), root)
	})

	it('falls back to AARDIO_ROOT before probing', async () => {
		const root = await makeInstallation()
		const installation = createInstallation({}, { env: { AARDIO_ROOT: root } })
		const resolution = installation.resolve()
		assert.equal(resolution.root, root)
		assert.equal(resolution.source, 'environment')
	})

	it('flags a configured folder without aardio.exe instead of silently probing elsewhere', async () => {
		const broken = await makeInstallation({ executable: false })
		const installation = createInstallation({ aardioRoot: broken }, { env: {} })
		assert.equal(installation.resolve().valid, false)
		assert.throws(() => installation.rootOrThrow(), /does not contain aardio\.exe/u)
	})

	it('re-resolves when the configured value changes in place', async () => {
		const first = await makeInstallation()
		const second = await makeInstallation()
		let current = first
		const installation = createInstallation(() => current, { env: {}, probe: () => [] })
		assert.equal(installation.root(), first)
		// A volatile setting is updated on the same reference, so the same handle must see it.
		current = second
		assert.equal(installation.root(), second)
		assert.equal(installation.configured(), second)
	})

	it('explains how to configure the plugin when nothing is found', () => {
		// The probe is stubbed so the assertion does not depend on which machines
		// running this suite happen to have an aardio installation on.
		const installation = createInstallation({}, { env: {}, probe: () => [] })
		const resolution = installation.resolve()
		assert.equal(resolution.root, null)
		assert.equal(resolution.source, 'unconfigured')
		assert.throws(() => installation.rootOrThrow(), /Plugins -> aardio Aardio toolchain -> Configure/u)
	})
})

describe('probeCandidates', () => {
	it('lists environment hints first and describes each folder', async () => {
		const root = await makeInstallation()
		const candidates = probeCandidates({ env: { AARDIO_ROOT: root } })
		assert.equal(candidates[0].path, root)
		assert.equal(candidates[0].valid, true)
		assert.deepEqual(Object.keys(candidates[0].markers), ['lib', 'docs', 'examples'])
	})

	it('drops folders that do not exist', () => {
		const candidates = probeCandidates({ env: { AARDIO_ROOT: join(tmpdir(), 'dsh-aardio-does-not-exist') } })
		assert.equal(candidates.some((candidate) => candidate.path.includes('dsh-aardio-does-not-exist')), false)
	})
})
