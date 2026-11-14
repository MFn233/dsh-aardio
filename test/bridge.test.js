/**
 * The IDE bridge protocol, exercised against an in-process fake bridge.
 *
 * The real bridge is aardio code that only runs inside the IDE, so the Node
 * side is tested the way the plugin actually talks to it: a directory, a
 * handshake file, one request file, one response file.
 */
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, beforeEach, describe, it } from 'node:test'

import {
	BRIDGE_PROTOCOL_VERSION, bridgeInfoPath, isProcessAlive, readBridgeInfo, runBridgeCode,
} from '../lib/bridge.js'
import { defineExecTool } from '../lib/tools.js'

const TOKEN = 'deadbeefcafe'
let directory
let savedEnvironment

/**
 * Write a handshake file for a live or dead bridge.
 * @param options - pid and version overrides.
 */
async function writeHandshake(options = {}) {
	await writeFile(bridgeInfoPath(), JSON.stringify({
		version: options.version ?? BRIDGE_PROTOCOL_VERSION,
		token: options.token ?? TOKEN,
		pid: options.pid ?? process.pid,
		startedAt: Date.now(),
		dir: directory,
	}))
}

/**
 * Start a fake bridge that answers request.json the way the aardio script does.
 * @param respond - builds the response payload from the request.
 * @returns a stop function.
 */
function startFakeBridge(respond) {
	let timer
	let busy = false
	let handled = 0
	const tick = async () => {
		if (busy) return
		const requestPath = join(directory, 'request.json')
		const responsePath = join(directory, 'response.json')
		if (!existsSync(requestPath)) return
		busy = true
		try {
			let request
			try {
				request = JSON.parse(await readFile(requestPath, 'utf8'))
			} catch {
				return
			}
			await rm(requestPath, { force: true })
			handled += 1
			const payload = await respond(request, handled)
			if (payload === undefined) return
			await writeFile(responsePath, JSON.stringify({
				token: request.token,
				nonce: request.nonce,
				compileError: '',
				error: '',
				result: '',
				resultType: '',
				print: [],
				durationMs: 1,
				phase: request.mode === 'check' ? 'check' : 'run',
				ok: true,
				...payload,
			}))
		} finally {
			busy = false
		}
	}
	timer = setInterval(() => { void tick() }, 20)
	return () => { clearInterval(timer) }
}

before(async () => {
	savedEnvironment = process.env.DSH_AARDIO_BRIDGE_DIR
	directory = await mkdtemp(join(tmpdir(), 'dsh-aardio-bridge-'))
	process.env.DSH_AARDIO_BRIDGE_DIR = directory
})

after(async () => {
	if (savedEnvironment === undefined) delete process.env.DSH_AARDIO_BRIDGE_DIR
	else process.env.DSH_AARDIO_BRIDGE_DIR = savedEnvironment
	await rm(directory, { recursive: true, force: true })
})

beforeEach(async () => {
	for (const name of ['bridge.json', 'request.json', 'response.json']) {
		await rm(join(directory, name), { force: true })
	}
})

describe('isProcessAlive', () => {
	it('accepts this process and rejects impossible pids', () => {
		assert.equal(isProcessAlive(process.pid), true)
		assert.equal(isProcessAlive(0), false)
		assert.equal(isProcessAlive(-1), false)
		assert.equal(isProcessAlive(Number.NaN), false)
	})
})

describe('readBridgeInfo', () => {
	it('refuses to run without a handshake and names the bridge script', async () => {
		await assert.rejects(readBridgeInfo({ hint: 'C:\\plugin\\bridge\\aardioBridge.aardio' }), (error) => {
			assert.match(error.message, /the IDE bridge is not running/u)
			assert.match(error.message, /aardioBridge\.aardio/u)
			return true
		})
	})

	it('rejects a stale handshake whose process is gone', async () => {
		await writeHandshake({ pid: 999_999 })
		await assert.rejects(readBridgeInfo(), /stale/u)
	})

	it('rejects an unsupported protocol version', async () => {
		await writeHandshake({ version: 99 })
		await assert.rejects(readBridgeInfo(), /unsupported format/u)
	})

	it('reads a live handshake', async () => {
		await writeHandshake()
		const info = await readBridgeInfo()
		assert.equal(info.token, TOKEN)
		assert.equal(info.pid, process.pid)
		assert.equal(info.directory, directory)
	})
})

describe('runBridgeCode', () => {
	it('sends code and returns the bridge answer', async () => {
		await writeHandshake()
		const stop = startFakeBridge(() => ({
			ok: true,
			phase: 'run',
			result: '42',
			resultType: 'number',
			print: ['hello', 'world'],
			durationMs: 7,
		}))
		try {
			const value = await runBridgeCode({ code: 'print("hello")', timeoutMs: 4000 })
			assert.equal(value.ok, true)
			assert.equal(value.result, '42')
			assert.equal(value.resultType, 'number')
			assert.deepEqual(value.print, ['hello', 'world'])
			assert.equal(value.durationMs, 7)
			assert.equal(value.bridgePid, process.pid)
		} finally {
			stop()
		}
	})

	it('passes a compile error through unchanged', async () => {
		await writeHandshake()
		const stop = startFakeBridge(() => ({
			ok: false,
			phase: 'compile',
			compileError: '第 3 行：意外的符号',
		}))
		try {
			const value = await runBridgeCode({ code: 'x', timeoutMs: 4000 })
			assert.equal(value.ok, false)
			assert.equal(value.phase, 'compile')
			assert.match(value.compileError, /第 3 行/u)
		} finally {
			stop()
		}
	})

	it('forwards check mode to the bridge', async () => {
		await writeHandshake()
		let seenMode
		const stop = startFakeBridge((request) => {
			seenMode = request.mode
			return { ok: true, phase: 'check' }
		})
		try {
			const value = await runBridgeCode({ code: 'var a = 1', mode: 'check', timeoutMs: 4000 })
			assert.equal(value.phase, 'check')
			assert.equal(seenMode, 'check')
		} finally {
			stop()
		}
	})

	it('times out when the bridge never answers, and leaves no request behind', async () => {
		await writeHandshake()
		await assert.rejects(
			runBridgeCode({ code: 'var a = 1', timeoutMs: 300 }),
			/did not finish within 300 ms/u,
		)
		assert.equal(existsSync(join(directory, 'request.json')), false)
	})

	it('follows a pending job by polling until it answers', async () => {
		await writeHandshake()
		const actions = []
		const stop = startFakeBridge((request) => {
			actions.push(request.action)
			if (request.action === 'run') return { pending: true, jobId: 'job-1' }
			return { ok: true, result: 'finished', resultType: 'string' }
		})
		try {
			const value = await runBridgeCode({ code: 'x', timeoutMs: 5000 })
			assert.equal(value.result, 'finished')
			assert.deepEqual(actions, ['run', 'poll'])
		} finally {
			stop()
		}
	})

	it('resumes a job from its id without new code', async () => {
		await writeHandshake()
		let seen
		const stop = startFakeBridge((request) => {
			seen = request
			return { ok: true, result: 'resumed', resultType: 'string' }
		})
		try {
			const value = await runBridgeCode({ jobId: 'job-9', timeoutMs: 5000 })
			assert.equal(value.result, 'resumed')
			assert.equal(seen.action, 'poll')
			assert.equal(seen.jobId, 'job-9')
		} finally {
			stop()
		}
	})

	it('reports the job id when a run outlives the deadline', async () => {
		await writeHandshake()
		const stop = startFakeBridge(() => ({ pending: true, jobId: 'job-slow' }))
		try {
			await assert.rejects(
				runBridgeCode({ code: 'x', timeoutMs: 400 }),
				/still running after 400 ms \(job job-slow\)/u,
			)
		} finally {
			stop()
		}
	})

	it('passes in-memory replacements to the bridge', async () => {
		await writeHandshake()
		let seen
		const stop = startFakeBridge((request) => {
			seen = request
			return { ok: true, result: 'ok' }
		})
		try {
			await runBridgeCode({
				code: 'win.loopMessage();',
				replacements: [{ old: 'win.loopMessage();', new: 'winform.close();' }],
				timeoutMs: 5000,
			})
			assert.deepEqual(seen.replacements, [{ old: 'win.loopMessage();', new: 'winform.close();' }])
			assert.equal(seen.mode, 'run')
		} finally {
			stop()
		}
	})

	it('serializes concurrent calls so one request file is never shared', async () => {
		await writeHandshake()
		const seen = []
		const stop = startFakeBridge(async (request) => {
			seen.push(request.code)
			await new Promise((resolve) => { setTimeout(resolve, 80) })
			return { ok: true, result: request.code }
		})
		try {
			const [first, second] = await Promise.all([
				runBridgeCode({ code: 'first', timeoutMs: 5000 }),
				runBridgeCode({ code: 'second', timeoutMs: 5000 }),
			])
			assert.equal(first.result, 'first')
			assert.equal(second.result, 'second')
			assert.deepEqual(seen, ['first', 'second'])
		} finally {
			stop()
		}
	})

	it('cleans up both request and response files', async () => {
		await writeHandshake()
		const stop = startFakeBridge(() => ({ ok: true }))
		try {
			await runBridgeCode({ code: 'x', timeoutMs: 4000 })
		} finally {
			stop()
		}
		const left = await readdir(directory)
		assert.deepEqual(left.filter((name) => name !== 'bridge.json'), [])
	})

	it('rejects empty and oversized code before contacting the bridge', () => {
		assert.throws(() => runBridgeCode({ code: '  ' }), /code must not be empty/u)
		assert.throws(() => runBridgeCode({ code: 'x'.repeat(600 * 1024) }), /accepts up to/u)
	})
})

describe('aardio_exec tool', () => {
	const BRIDGE_SCRIPT = 'C:\\plugin\\bridge\\aardioBridge.aardio'

	it('reports a missing bridge with the script to start', async () => {
		const tool = defineExecTool({ bridgeScript: BRIDGE_SCRIPT })
		await assert.rejects(tool.execute({ code: 'var a = 1' }), (error) => {
			assert.match(error.message, /the IDE bridge is not running/u)
			assert.match(error.message, /aardioBridge\.aardio/u)
			return true
		})
	})

	it('runs inline code and returns exactly the declared fields', async () => {
		await writeHandshake()
		const stop = startFakeBridge(() => ({
			ok: true,
			phase: 'run',
			result: '{"total":2,"failed":0}',
			resultType: 'table',
			print: ['print line'],
			durationMs: 12,
		}))
		try {
			const tool = defineExecTool({ bridgeScript: BRIDGE_SCRIPT })
			const value = await tool.execute({ code: 'return 1' })
			assert.deepEqual(Object.keys(value).sort(), Object.keys(tool.output.schema.properties).sort())
			assert.equal(value.ok, true)
			assert.equal(value.source, 'inline')
			assert.equal(value.resultType, 'table')
			const text = tool.output.render({}, value)[0].text
			assert.match(text, /print line/u)
			assert.match(text, /return \(table\)/u)
		} finally {
			stop()
		}
	})

	it('reads a file with path and renders a compile failure', async () => {
		await writeHandshake()
		const stop = startFakeBridge(() => ({ ok: false, phase: 'compile', compileError: '第 7 行：缺少右括号' }))
		const source = join(directory, 'sample.aardio')
		try {
			await writeFile(source, 'var a = 1')
			const tool = defineExecTool({ bridgeScript: BRIDGE_SCRIPT })
			const value = await tool.execute({ path: source })
			assert.equal(value.source, source)
			assert.equal(value.ok, false)
			const text = tool.output.render({}, value)[0].text
			assert.match(text, /Compile error/u)
			assert.match(text, /第 7 行/u)
		} finally {
			stop()
			await rm(source, { force: true })
		}
	})

	it('renders aardio error placeholders as readable lines', () => {
		const tool = defineExecTool({ bridgeScript: BRIDGE_SCRIPT })
		const value = {
			ok: false,
			mode: 'run',
			phase: 'run',
			source: 'inline',
			compileError: '{File}:(loadcode)\n{Line}:#2\n{Error}:<unexpected symbol>',
			error: '\n{File}:(loadcode)\n{Line}:#2\n{Error}:boom',
			result: '',
			resultType: 'null',
			print: ['before error'],
			durationMs: 9,
			bridgePid: 1,
		}
		const text = tool.output.render({}, value)[0].text
		assert.match(text, /runtime error:\nline 2\nboom/u)
		assert.equal(text.includes('{Line}'), false)
		assert.equal(text.includes('{Error}'), false)
		const compile = tool.output.render({}, { ...value, phase: 'compile' })[0].text
		assert.match(compile, /Compile error in inline:\nline 2\n<unexpected symbol>/u)
	})

	it('renders a check result without a run summary', async () => {
		await writeHandshake()
		const stop = startFakeBridge(() => ({ ok: true, phase: 'check' }))
		try {
			const tool = defineExecTool({ bridgeScript: BRIDGE_SCRIPT })
			const value = await tool.execute({ code: 'var a = 1', mode: 'check' })
			assert.equal(value.mode, 'check')
			assert.match(tool.output.render({}, value)[0].text, /no syntax errors/u)
			assert.match(tool.output.render({}, { ...value, replaced: true })[0].text, /in-memory replacement/u)
		} finally {
			stop()
		}
	})

	it('maps replace to one in-memory replacement and flags it', async () => {
		await writeHandshake()
		let seen
		const stop = startFakeBridge((request) => {
			seen = request
			return { ok: true, result: 'smoke ok' }
		})
		try {
			const tool = defineExecTool({ bridgeScript: BRIDGE_SCRIPT })
			const value = await tool.execute({
				code: 'win.loopMessage();',
				replace: { oldCode: 'win.loopMessage();', newCode: 'winform.close();' },
			})
			assert.equal(value.replaced, true)
			assert.deepEqual(seen.replacements, [{ old: 'win.loopMessage();', new: 'winform.close();' }])
		} finally {
			stop()
		}
	})

	it('resumes a pending job through jobId', async () => {
		await writeHandshake()
		const stop = startFakeBridge(() => ({ ok: true, result: 'job done', resultType: 'string' }))
		try {
			const tool = defineExecTool({ bridgeScript: BRIDGE_SCRIPT })
			const value = await tool.execute({ jobId: 'job-7' })
			assert.equal(value.source, 'job')
			assert.equal(value.result, 'job done')
			assert.equal(value.replaced, false)
		} finally {
			stop()
		}
	})

	it('rejects ambiguous, empty, and missing inputs', async () => {
		const tool = defineExecTool({ bridgeScript: BRIDGE_SCRIPT })
		await assert.rejects(tool.execute({ code: 'x', path: join(directory, 'x.aardio') }), /not both/u)
		await assert.rejects(tool.execute({}), /provide code or path/u)
		await assert.rejects(tool.execute({ path: join(directory, 'missing.aardio') }), /does not exist/u)
	})
})
