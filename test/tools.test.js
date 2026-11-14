/**
 * Tool contract: the schemas DSH accepts, the output each tool renders, and the
 * registration/disposal behaviour of `apply`.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, describe, it } from 'node:test'

import { apply } from '../index.js'
import { defineDocsTool, defineEnvTool, defineExecTool, defineOpenTool } from '../lib/tools.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Keywords the DSH tool schema projection accepts. */
const ALLOWED_SCHEMA_KEYWORDS = new Set([
	'type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title',
])

let root

before(async () => {
	root = await mkdtemp(join(tmpdir(), 'dsh-aardio-tools-'))
	await mkdir(join(root, 'docs'), { recursive: true })
	await writeFile(join(root, 'docs', 'index.md'), '# index\n\nstring.save writes a file.\n')
	await writeFile(join(root, 'aardio.exe'), '')
})

after(async () => {
	await rm(root, { recursive: true, force: true })
})

/**
 * Build a resolved-installation stub for tool tests.
 * @param folder - folder the stub reports.
 * @returns the stub.
 */
function installationFor(folder) {
	return {
		resolve: () => ({
			root: folder,
			source: 'config',
			valid: true,
			executable: true,
			markers: { lib: true, docs: true, examples: true },
			candidates: [{ path: folder, valid: true }],
		}),
		root: () => folder,
		rootOrThrow: () => folder,
		configured: () => folder,
	}
}

/**
 * Walk a schema and collect unsupported keywords.
 * @param node - schema node.
 * @param path - location for messages.
 * @param found - accumulator.
 */
function collectUnsupported(node, path, found) {
	for (const key of Object.keys(node)) {
		if (!ALLOWED_SCHEMA_KEYWORDS.has(key)) found.push(`${path}.${key}`)
	}
	for (const [key, child] of Object.entries(node.properties ?? {})) collectUnsupported(child, `${path}.${key}`, found)
	if (node.items !== undefined) collectUnsupported(node.items, `${path}[]`, found)
	for (const [index, child] of (node.oneOf ?? []).entries()) collectUnsupported(child, `${path}|${index}`, found)
	if (Array.isArray(node.required)) {
		for (const key of node.required) {
			if (node.properties === undefined || !(key in node.properties)) found.push(`${path}.required:${key}`)
		}
	}
}

describe('tool schemas', () => {
	const installation = installationFor(PLUGIN_ROOT)
	const tools = [defineDocsTool(installation), defineOpenTool(installation), defineEnvTool(installation), defineExecTool()]

	it('exposes the four documented tool names', () => {
		assert.deepEqual(tools.map((tool) => tool.name), ['aardio_docs', 'aardio_open', 'aardio_env', 'aardio_exec'])
	})

	it('uses only schema keywords the tool layer accepts', () => {
		const found = []
		for (const tool of tools) {
			collectUnsupported(tool.parameters, `${tool.name}.parameters`, found)
			collectUnsupported(tool.output.schema, `${tool.name}.output`, found)
		}
		assert.deepEqual(found, [])
	})

	it('declares every required parameter and every required output field', () => {
		for (const tool of tools) {
			assert.equal(tool.parameters.type, 'object')
			assert.equal(tool.parameters.additionalProperties, false)
			assert.equal(tool.output.schema.additionalProperties, false)
			assert.equal(typeof tool.output.render, 'function')
			assert.equal(typeof tool.execute, 'function')
		}
	})
})

describe('aardio_docs', () => {
	it('returns exactly the fields its output schema declares', async () => {
		const tool = defineDocsTool(installationFor(root))
		const value = await tool.execute({ query: 'string.save' })
		const declared = Object.keys(tool.output.schema.properties).sort()
		assert.deepEqual(Object.keys(value).sort(), declared)
		assert.deepEqual(Object.keys(value.file).sort(), Object.keys(tool.output.schema.properties.file.properties).sort())
		for (const match of value.matches) {
			assert.deepEqual(Object.keys(match).sort(), ['line', 'path', 'score', 'snippet'])
		}
	})

	it('searches by keyword and renders the file, line, and snippet', async () => {
		const tool = defineDocsTool(installationFor(root))
		const value = await tool.execute({ query: 'string.save' })
		assert.equal(value.kind, 'search')
		assert.equal(value.root, root)
		assert.equal(value.matches.length, 1)
		assert.equal(value.matches[0].line, 3)
		const text = tool.output.render({}, value)[0].text
		assert.match(text, /docs\\index\.md:3/u)
		assert.match(text, /string\.save writes a file/u)
	})

	it('reads a file by path instead of searching', async () => {
		const tool = defineDocsTool(installationFor(root))
		const value = await tool.execute({ path: 'docs/index.md', offset: 2, lines: 2 })
		assert.equal(value.kind, 'read')
		assert.deepEqual(value.matches, [])
		assert.equal(value.file.path, join(root, 'docs', 'index.md'))
		assert.deepEqual(value.file.lines.map((line) => line.number), [2, 3])
		const text = tool.output.render({}, value)[0].text
		assert.match(text, /lines 2-3 of 3/u)
		assert.match(text, /3: string\.save writes a file\./u)
	})

	it('relaxes a multi-term query that has no exact hits', async () => {
		const tool = defineDocsTool(installationFor(root))
		const value = await tool.execute({ query: 'string.save definitely-not-in-the-file' })
		assert.equal(value.relaxed, true)
		assert.equal(value.matches.length, 1)
	})

	it('rejects a request with neither query nor path, and explains a missing installation', async () => {
		await assert.rejects(defineDocsTool(installationFor(root)).execute({}), /provide a query to search, or a path to read/u)
		const missing = { rootOrThrow: () => { throw new Error('dsh-aardio: aardio installation not found.') } }
		await assert.rejects(defineDocsTool(missing).execute({ query: 'x' }), /installation not found/u)
	})

	it('renders an empty result as a sentence, not an empty list', async () => {
		const tool = defineDocsTool(installationFor(root))
		const value = await tool.execute({ query: 'nothing-matches-this' })
		assert.equal(tool.output.render({}, value)[0].text.startsWith('No match'), true)
	})
})

describe('aardio_open', () => {
	it('rejects an empty or missing path', () => {
		const tool = defineOpenTool(installationFor(root), { platform: 'win32', launch: () => {} })
		assert.throws(() => tool.execute({ path: ' ' }), /must not be empty/u)
		assert.throws(() => tool.execute({ path: join(root, 'nope.aardio') }), /does not exist/u)
	})

	it('opens a project folder through its default.aproj, without launching anything', async () => {
		const project = await mkdtemp(join(tmpdir(), 'dsh-aardio-project-'))
		try {
			await writeFile(join(project, 'default.aproj'), '<project/>')
			const launched = []
			const tool = defineOpenTool(installationFor(root), {
				platform: 'win32',
				launch: (executable, target) => { launched.push({ executable, target }) },
			})
			const value = tool.execute({ path: project })
			assert.equal(value.target, join(project, 'default.aproj'))
			assert.equal(value.executable, join(root, 'aardio.exe'))
			assert.deepEqual(launched, [{ executable: join(root, 'aardio.exe'), target: join(project, 'default.aproj') }])
		} finally {
			await rm(project, { recursive: true, force: true })
		}
	})

	it('explains that the IDE is Windows-only', () => {
		const tool = defineOpenTool(installationFor(root), { platform: 'linux', launch: () => {} })
		assert.throws(() => tool.execute({ path: join(root, 'docs', 'index.md') }), /only runs on Windows/u)
	})
})

describe('aardio_env', () => {
	it('reports the resolved folder, its source, and the probed folders', async () => {
		const tool = defineEnvTool(installationFor(root))
		const value = await tool.execute({})
		assert.equal(value.root, root)
		assert.equal(value.source, 'config')
		assert.equal(value.valid, true)
		assert.deepEqual(value.candidates, [{ path: root, valid: true }])
		const text = tool.output.render({}, value)[0].text
		assert.match(text, /aardio installation:/u)
	})

	it('explains what to do when nothing resolved', async () => {
		const tool = defineEnvTool({
			resolve: () => ({ root: null, source: 'unconfigured', valid: false, candidates: [] }),
			configured: () => '',
		})
		const value = await tool.execute({})
		assert.equal(value.root, '')
		assert.equal(value.valid, false)
		assert.match(value.hint, /Plugins -> aardio Aardio toolchain -> Configure/u)
	})
})

describe('apply', () => {
	it('registers four tools, the bundled skill provider, and the prompt rules, then disposes all of them', async () => {
		const registered = []
		const sections = []
		let disposed = 0
		let provider
		const ctx = {
			tools: {
				register(definition) {
					registered.push(definition)
					return () => { disposed += 1 }
				},
			},
			skills: {
				registerProvider(factory) {
					provider = factory()
					return () => { disposed += 1 }
				},
			},
			get(name) {
				if (name !== 'systemPrompt') return undefined
				return { section(definition) { sections.push(definition); return () => { disposed += 1 } } }
			},
		}

		const dispose = apply(ctx, { aardioRoot: root })
		assert.deepEqual(registered.map((tool) => tool.name), ['aardio_docs', 'aardio_open', 'aardio_env', 'aardio_exec'])
		const skills = await provider.list()
		assert.deepEqual(skills.map((skill) => skill.name), ['aardio', 'aardio-project', 'aardio-library'])
		assert.equal(sections.length, 1)
		dispose()
		assert.equal(disposed, 6)
	})

	it('works without config when the row has none', () => {
		const ctx = { tools: { register: () => () => {} }, skills: { registerProvider: () => () => {} } }
		assert.doesNotThrow(() => apply(ctx))
	})
})
