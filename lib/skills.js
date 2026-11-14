/**
 * The skills bundled with this plugin.
 *
 * DSH discovers skills either from a skills directory or from a provider
 * registered on `ctx.skills`. Bundling them here means a fresh install already
 * knows how to write aardio projects, libraries, and code without the user
 * copying Markdown files by hand.
 *
 * A user-directory skill of the same name ranks higher (400 against 600), so a
 * local copy still wins when the user wants to experiment.
 *
 * @module dsh-aardio/skills
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, sep } from 'node:path'

/** Priority of a bundled skill; a user-directory skill outranks it. */
export const BUNDLED_SKILL_RANK = 600

/** Skill folders shipped in `skills/`. */
export const BUNDLED_SKILL_NAMES = ['aardio', 'aardio-project', 'aardio-library']

/** Provider id reported for every bundled skill. */
export const SKILL_PROVIDER = 'dsh-aardio'

/**
 * Split a SKILL.md into frontmatter fields and body.
 *
 * Only top-level `key: value` pairs are read, which is all a skill header may
 * contain here; nested YAML would need a parser this plugin deliberately does
 * not ship.
 * @param raw - full file text.
 * @param path - file path used in error messages.
 * @returns the parsed description, body, and any other scalar fields.
 */
export function parseSkillDocument(raw, path) {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(raw)
	if (frontmatter?.[1] === undefined) throw new Error(`dsh-aardio: ${path} has no YAML frontmatter`)

	/** @type {Record<string, string>} */
	const fields = {}
	for (const line of frontmatter[1].split(/\r?\n/u)) {
		const trimmed = line.trim()
		if (trimmed === '' || trimmed.startsWith('#')) continue
		const separator = trimmed.indexOf(':')
		if (separator <= 0) continue
		const key = trimmed.slice(0, separator).trim()
		let value = trimmed.slice(separator + 1).trim()
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1)
		}
		fields[key] = value
	}

	const description = fields.description
	if (typeof description !== 'string' || description.trim() === '') {
		throw new Error(`dsh-aardio: ${path} has no description in its frontmatter`)
	}

	return {
		description: description.trim(),
		content: raw.slice(frontmatter[0].length).trim(),
		fields,
	}
}

/**
 * Build the skill provider Cordis registers on `ctx.skills`.
 * @param options - the plugin root and the skill folders to expose.
 * @returns a provider with `list` and `get`.
 */
export function createSkillProvider(options) {
	const { pluginRoot, names = BUNDLED_SKILL_NAMES } = options

	const candidates = names.map((name) => {
		const directory = join(pluginRoot, 'skills', name)
		const locator = join(directory, 'SKILL.md')
		const { description } = parseSkillDocument(readFileSync(locator, 'utf8'), locator)
		return {
			name,
			description,
			invocation: { modelInvocable: true, userInvocable: true },
			provider: SKILL_PROVIDER,
			source: 'bundled',
			rank: BUNDLED_SKILL_RANK,
			resourceBase: { kind: 'directory', path: directory.split(sep).join('/') },
			locator,
		}
	})

	return {
		name: SKILL_PROVIDER,
		list() {
			return Promise.resolve(candidates)
		},
		async get(candidate, options = {}) {
			const locator = candidate?.locator
			if (typeof locator !== 'string') throw new Error('dsh-aardio: unknown bundled skill')
			const { description, content } = parseSkillDocument(
				await readFile(locator, { encoding: 'utf8', signal: options.signal }),
				locator,
			)
			return {
				name: candidate.name,
				description,
				invocation: candidate.invocation,
				provider: SKILL_PROVIDER,
				source: 'bundled',
				resourceBase: candidate.resourceBase,
				content,
			}
		},
	}
}
