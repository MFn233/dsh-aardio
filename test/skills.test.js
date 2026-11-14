/**
 * Bundled skills: frontmatter parsing, the provider contract DSH consumes, and
 * the three skill folders this package ships.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import { BUNDLED_SKILL_NAMES, BUNDLED_SKILL_RANK, createSkillProvider, parseSkillDocument } from '../lib/skills.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

describe('parseSkillDocument', () => {
	it('reads the description and keeps the body without frontmatter', () => {
		const parsed = parseSkillDocument('---\nname: demo\ndescription: "Shown in the catalog"\n---\n\nBody text\n', 'demo')
		assert.equal(parsed.description, 'Shown in the catalog')
		assert.equal(parsed.content, 'Body text')
		assert.equal(parsed.fields.name, 'demo')
	})

	it('rejects a file without frontmatter or without a description', () => {
		assert.throws(() => parseSkillDocument('# no header\n', 'x'), /no YAML frontmatter/u)
		assert.throws(() => parseSkillDocument('---\nname: x\n---\nbody\n', 'x'), /no description/u)
	})
})

describe('bundled skill provider', () => {
	const provider = createSkillProvider({ pluginRoot: PLUGIN_ROOT })

	it('lists the three skills with a bundled rank', async () => {
		const skills = await provider.list()
		assert.deepEqual(skills.map((skill) => skill.name), BUNDLED_SKILL_NAMES)
		for (const skill of skills) {
			assert.equal(skill.provider, 'dsh-aardio')
			assert.equal(skill.source, 'bundled')
			assert.equal(skill.rank, BUNDLED_SKILL_RANK)
			assert.equal(skill.invocation.modelInvocable, true)
			assert.ok(skill.description.length > 20)
			assert.equal(skill.resourceBase.kind, 'directory')
		}
	})

	it('loads each skill body and hides internal fields', async () => {
		for (const candidate of await provider.list()) {
			const skill = await provider.get(candidate, {})
			assert.equal(skill.name, candidate.name)
			assert.equal('locator' in skill, false)
			assert.equal('rank' in skill, false)
			assert.ok(skill.content.length > 500, `${skill.name} body looks empty`)
			assert.match(skill.content, /\S/u)
		}
	})

	it('keeps the skill folders free of a hard-coded installation path', () => {
		for (const name of BUNDLED_SKILL_NAMES) {
			const text = readFileSync(join(PLUGIN_ROOT, 'skills', name, 'SKILL.md'), 'utf8')
			assert.equal(/Develop[\\/]aardio/u.test(text), false, `${name} hard-codes an installation path`)
			assert.match(text, /aardio_env/u, `${name} should tell the model how to locate the installation`)
		}
	})

	it('tells the model not to build projects and to ask for an IDE refresh', () => {
		const project = readFileSync(join(PLUGIN_ROOT, 'skills', 'aardio-project', 'SKILL.md'), 'utf8')
		assert.match(project, /不新建工程、不写 `default\.aproj`/u)
		assert.match(project, /手动同步\/刷新/u)
		const code = readFileSync(join(PLUGIN_ROOT, 'skills', 'aardio', 'SKILL.md'), 'utf8')
		assert.match(code, /手动同步\/刷新/u)
		const library = readFileSync(join(PLUGIN_ROOT, 'skills', 'aardio-library', 'SKILL.md'), 'utf8')
		assert.match(library, /重开工程或重启 IDE/u)
	})
})
