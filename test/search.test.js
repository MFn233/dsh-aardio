/**
 * The search engine: query parsing, ranking, scopes, budgets, and the bounded
 * read of a file inside the installation.
 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

import {
	SCOPE_DIRS, parseQuery, readInstallationFile, resetFileListCache, resolveInsideInstallation, searchInstallation,
} from '../lib/search.js'

let root

before(async () => {
	resetFileListCache()
	root = await mkdtemp(join(tmpdir(), 'dsh-aardio-search-'))
	await mkdir(join(root, 'docs', 'library', 'win'), { recursive: true })
	await mkdir(join(root, 'examples', 'console'), { recursive: true })
	await mkdir(join(root, 'lib', 'win', 'ui', 'ctrl'), { recursive: true })
	await writeFile(join(root, 'docs', 'library', 'win', 'listview.md'), [
		'# listview',
		'',
		'listview.checked 返回所有已勾选的行索引。',
		'必须先启用复选框。',
	].join('\n'))
	await writeFile(join(root, 'docs', 'unrelated.md'), '# other\n\nnothing to see\n')
	await writeFile(join(root, 'examples', 'console', 'save.aardio'), 'string.save("out.txt", "hi")\n')
	await writeFile(join(root, 'lib', 'win', 'ui', 'ctrl', 'listview.aardio'), [
		'namespace win.ui.ctrl;',
		'// listview.checked = 获取或设置所有已勾选项',
		'// 注意 selected 与 checked 的区别',
	].join('\n'))
	await writeFile(join(root, 'lib', 'ignored.bin'), 'listview.checked inside a binary-named file\n')
})

after(async () => {
	resetFileListCache()
	await rm(root, { recursive: true, force: true })
})

beforeEach(() => {
	resetFileListCache()
})

describe('parseQuery', () => {
	it('splits bare terms', () => {
		assert.deepEqual(parseQuery('listview checked'), { terms: ['listview', 'checked'], phrases: [], excludes: [] })
	})

	it('reads quoted phrases and negated terms', () => {
		const parsed = parseQuery('"win.form" add -dialog')
		assert.deepEqual(parsed.phrases, ['win.form'])
		assert.deepEqual(parsed.terms, ['add'])
		assert.deepEqual(parsed.excludes, ['dialog'])
	})

	it('tolerates an unbalanced quote by taking the remainder', () => {
		assert.deepEqual(parseQuery('"string.save').phrases, ['string.save'])
	})

	it('ignores empty input and stray dashes', () => {
		assert.deepEqual(parseQuery('   '), { terms: [], phrases: [], excludes: [] })
		assert.deepEqual(parseQuery('-  x'), { terms: ['x'], phrases: [], excludes: [] })
	})
})

describe('searchInstallation', () => {
	it('requires every term by default and ranks the documented property first', async () => {
		const result = await searchInstallation(root, { query: 'listview checked', scope: 'all', limit: 10 })
		assert.equal(result.scope, 'all')
		assert.ok(result.matches.length >= 2)
		// The documentation page states the property signature, so it outranks the source comment.
		assert.equal(result.matches[0].path.endsWith(join('docs', 'library', 'win', 'listview.md')), true)
		assert.equal(result.matches.some((match) => match.path.endsWith(join('lib', 'win', 'ui', 'ctrl', 'listview.aardio'))), true)
		for (const match of result.matches) assert.ok(match.score > 0)
	})

	it('accepts a file with only one of the terms in any mode', async () => {
		const all = await searchInstallation(root, { query: 'listview selected', scope: 'lib', limit: 10 })
		assert.ok(all.matchedFiles >= 1)
		const any = await searchInstallation(root, { query: 'listview selected', scope: 'lib', limit: 10, mode: 'any' })
		assert.ok(any.matchedFiles >= all.matchedFiles)
	})

	it('matches phrases only where they are adjacent', async () => {
		const result = await searchInstallation(root, { query: '"注意 selected"', scope: 'lib', limit: 10 })
		assert.equal(result.matches.length, 1)
		assert.match(result.matches[0].snippet, /注意 selected/u)
	})

	it('drops files containing an excluded term', async () => {
		const result = await searchInstallation(root, { query: 'listview.checked -返回', scope: 'all', limit: 10 })
		assert.equal(result.matches.length, 1)
		assert.equal(result.matches[0].path.endsWith(join('lib', 'win', 'ui', 'ctrl', 'listview.aardio')), true)
	})

	it('includes context lines when asked', async () => {
		const result = await searchInstallation(root, { query: '"listview.checked"', scope: 'docs', limit: 5, context: 2 })
		assert.equal(result.matches.length, 1)
		assert.match(result.matches[0].snippet, /# listview/u)
		assert.match(result.matches[0].snippet, /必须先启用复选框/u)
	})

	it('honours the per-file cap and the global limit', async () => {
		const result = await searchInstallation(root, { query: 'listview', scope: 'all', limit: 1, perFile: 5 })
		assert.equal(result.matches.length, 1)
		assert.equal(result.truncated, true)
	})

	it('skips extensions that are not text', async () => {
		const result = await searchInstallation(root, { query: 'listview.checked', scope: 'lib', limit: 10 })
		assert.equal(result.matches.some((match) => match.path.endsWith('ignored.bin')), false)
	})

	it('reports only the scopes that exist', async () => {
		const alone = await mkdtemp(join(tmpdir(), 'dsh-aardio-partial-'))
		try {
			await mkdir(join(alone, 'docs'), { recursive: true })
			await writeFile(join(alone, 'docs', 'a.md'), 'needle here\n')
			const result = await searchInstallation(alone, { query: 'needle', scope: 'all', limit: 5 })
			assert.equal(result.matches.length, 1)
			assert.deepEqual(SCOPE_DIRS.docs, ['docs'])
		} finally {
			await rm(alone, { recursive: true, force: true })
		}
	})

	it('returns an empty result rather than throwing when nothing matches', async () => {
		const result = await searchInstallation(root, { query: 'zzz-not-present', limit: 5 })
		assert.deepEqual(result.matches, [])
		assert.equal(result.matchedFiles, 0)
	})
})

describe('readInstallationFile', () => {
	it('reads a window of numbered lines', async () => {
		const file = await readInstallationFile(root, join('lib', 'win', 'ui', 'ctrl', 'listview.aardio'), { offset: 2, lines: 2 })
		assert.equal(file.total, 3)
		assert.equal(file.offset, 2)
		assert.deepEqual(file.lines.map((line) => line.number), [2, 3])
		assert.match(file.lines[0].text, /listview\.checked/u)
		assert.equal(file.truncated, false)
	})

	it('accepts an absolute path inside the installation', async () => {
		const file = await readInstallationFile(root, join(root, 'docs', 'unrelated.md'), { lines: 1 })
		assert.equal(file.lines[0].text, '# other')
		assert.equal(file.truncated, true)
	})

	it('refuses paths outside the installation', async () => {
		await assert.rejects(readInstallationFile(root, join(root, '..', 'outside.md')), /outside the aardio installation/u)
		if (process.platform === 'win32') {
			assert.throws(() => resolveInsideInstallation(root, 'C:\\Windows\\win.ini'), /outside the aardio installation/u)
		}
	})

	it('refuses a file that is not text', async () => {
		await assert.rejects(readInstallationFile(root, join('lib', 'ignored.bin')), /not a text file/u)
	})
})
