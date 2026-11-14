/**
 * The always-on project rules: the text the agent must be told, and the
 * optional system-prompt section that carries it.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PROMPT_SECTION_NAME, PROMPT_SECTION_ORDER, PROMPT_TEXT, registerPromptSection } from '../lib/prompt.js'

describe('prompt rules', () => {
	it('forbids creating projects and writing default.aproj', () => {
		assert.match(PROMPT_TEXT, /新建 aardio 工程由用户手动完成/u)
		assert.match(PROMPT_TEXT, /不要手写、手改或生成 `default\.aproj`/u)
	})

	it('requires an IDE-side refresh after touching dlg/ or lib/', () => {
		assert.match(PROMPT_TEXT, /`dlg\/` 或 `lib\/`/u)
		assert.match(PROMPT_TEXT, /手动同步\/刷新/u)
	})

	it('points at the bundled skills for the full workflow', () => {
		assert.match(PROMPT_TEXT, /aardio-project/u)
		assert.match(PROMPT_TEXT, /aardio-library/u)
	})
})

describe('registerPromptSection', () => {
	/**
	 * A context whose only service is a recording system-prompt registry.
	 * @returns the context and the recorded sections.
	 */
	function fakeContext() {
		const sections = []
		const ctx = {
			get(name) {
				if (name !== 'systemPrompt') return undefined
				return {
					section(definition) {
						sections.push(definition)
						return () => { sections.pop() }
					},
				}
			},
		}
		return { ctx, sections }
	}

	it('registers a literal, late section so the first-party prefix stays cacheable', () => {
		const { ctx, sections } = fakeContext()
		const dispose = registerPromptSection(ctx)
		assert.equal(typeof dispose, 'function')
		assert.equal(sections.length, 1)
		assert.equal(sections[0].name, PROMPT_SECTION_NAME)
		assert.equal(sections[0].order, PROMPT_SECTION_ORDER)
		assert.equal(sections[0].interpolate, false)
		assert.equal(sections[0].text, PROMPT_TEXT)
	})

	it('stays out of the way when the composition has no system prompt', () => {
		assert.equal(registerPromptSection({}), undefined)
		assert.equal(registerPromptSection(undefined), undefined)
		assert.equal(registerPromptSection({ get: () => ({}) }), undefined)
	})
})
