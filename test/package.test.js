/**
 * Packaging: the manifest fields DSH reads, this bundle's display metadata, the
 * detail document and its single image, and the browser half's constraints.
 */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { describe, it } from 'node:test'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (relative) => readFileSync(join(PLUGIN_ROOT, relative), 'utf8')
const manifest = JSON.parse(read('package.json'))

describe('manifest', () => {
	it('declares a bundle patch and a web client half', () => {
		assert.equal(manifest.name, 'dsh-aardio')
		assert.equal(manifest.type, 'module')
		assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
		assert.equal(manifest.dsh.client.platform, 'web')
		assert.equal(manifest.exports['./client'], './client.js')
		assert.equal(statSync(join(PLUGIN_ROOT, manifest.dsh.bundle.patch)).isFile(), true)
	})

	it('exports the display resources Plugin Manager reads without activating the plugin', () => {
		assert.equal(manifest.exports['./locale/*.json'], './locale/*.json')
		assert.equal(manifest.exports['./icon'], './icon.svg')
		assert.equal(manifest.icon, './icon.svg')
	})

	it('publishes every runtime file', () => {
		for (const entry of ['index.js', 'client.js', 'cordis.patch.yml', 'lib', 'bridge', 'skills', 'locale/*.json', 'docs', 'icon.svg', 'LICENSE']) {
			assert.equal(manifest.files.includes(entry), true, `files is missing ${entry}`)
		}
		assert.equal(statSync(join(PLUGIN_ROOT, 'bridge', 'aardioBridge.aardio')).isFile(), true)
	})

	it('points at the public repository', () => {
		assert.equal(manifest.repository.url, 'git+https://github.com/MFn233/dsh-aardio.git')
		assert.equal(manifest.homepage, 'https://github.com/MFn233/dsh-aardio#readme')
		assert.equal(manifest.bugs.url, 'https://github.com/MFn233/dsh-aardio/issues')
	})

	it('ships no install script and no runtime dependency', () => {
		assert.equal(manifest.scripts?.preinstall, undefined)
		assert.equal(manifest.scripts?.postinstall, undefined)
		assert.deepEqual(manifest.dependencies ?? {}, {})
	})

	it('declares the schemastery peer as optional so a linked checkout still loads', () => {
		assert.equal(typeof manifest.peerDependencies['@deepseek-ai/schemastery'], 'string')
		assert.equal(manifest.peerDependenciesMeta['@deepseek-ai/schemastery'].optional, true)
	})
})

describe('display metadata', () => {
	const locales = ['en', 'zh']

	it('describes the capability in every locale', () => {
		for (const locale of locales) {
			const meta = JSON.parse(read(`locale/${locale}.json`)).meta
			assert.equal(typeof meta.title, 'string')
			assert.ok(meta.description.length > 60, `${locale} description is too short`)
			assert.equal(typeof meta.detail, 'string')
		}
	})

	it('points every detail document at a file inside the package', () => {
		for (const locale of locales) {
			const { detail } = JSON.parse(read(`locale/${locale}.json`)).meta
			assert.match(detail, /^docs\/.+\.md$/u)
			assert.equal(statSync(join(PLUGIN_ROOT, detail)).isFile(), true)
			const lines = read(detail).trim().split(/\r?\n/u).filter((line) => line.trim() !== '')
			assert.equal(lines.length, 1, `${detail} should be exactly one image line`)
			assert.match(lines[0], /^!\[[^\]]+\]\(preview\.svg\)$/u)
		}
	})

	it('draws a theme-neutral, text-free preview at the documented size', () => {
		const svg = read('docs/preview.svg')
		assert.match(svg, /width="640"/u)
		assert.match(svg, /height="300"/u)
		assert.match(svg, /viewBox="0 0 640 300"/u)
		assert.equal(/<text[\s>]/u.test(svg), false)
		assert.equal(/<script[\s>]/u.test(svg), false)
		assert.equal(/<foreignObject[\s>]/u.test(svg), false)
		// The only absolute URL may be the SVG namespace declaration itself.
		assert.deepEqual(svg.match(/https?:\/\/[^"']+/gu) ?? [], ['http://www.w3.org/2000/svg'])
		assert.ok(Buffer.byteLength(svg) < 1024 * 1024)
	})

	it('ships an icon within the icon limits', () => {
		const icon = read('icon.svg')
		assert.match(icon, /^<svg[\s>]/u)
		assert.ok(Buffer.byteLength(icon) <= 256 * 1024)
	})
})

describe('browser half', () => {
	const source = read('client.js')

	it('is syntactically valid script source', () => {
		assert.doesNotThrow(() => new vm.Script(source, { filename: 'client.js' }))
	})

	it('registers under the package name and both configuration slots', () => {
		assert.match(source, /id:\s*'dsh-aardio'/u)
		assert.match(source, /plugins\.row\.config/u)
		assert.match(source, /plugins\.bundle\.config/u)
		assert.match(source, /'dsh-aardio#dsh-aardio'/u)
	})

	it("asks the settings service for the bundle page's form", () => {
		// The bundle-level slot carries no `form` prop; the entry must resolve it itself.
		assert.match(source, /get\('configForms'\)/u)
		assert.match(source, /useSyncExternalStore/u)
	})

	it('imports no Harness client package and uses theme tokens instead of literal colours', () => {
		assert.equal(/@deepseek-ai\//u.test(source), false)
		assert.equal(/#[0-9a-fA-F]{3,8}\b/u.test(source), false)
	})

	it('requests only modules the shell seed provides', () => {
		const requests = [...source.matchAll(/require\('([^']+)'\)/gu)].map((match) => match[1])
		assert.deepEqual(requests, ['react'])
	})
})

describe('bundle patch', () => {
	it('inserts exactly one row named after the package', () => {
		const patch = read('cordis.patch.yml')
		assert.match(patch, /- insert:\n\s+- id: dsh-aardio\n\s+name: dsh-aardio/u)
		assert.equal((patch.match(/^\s+- id:/gmu) ?? []).length, 1)
	})
})
