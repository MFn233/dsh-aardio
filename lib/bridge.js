/**
 * Client side of the aardio IDE bridge.
 *
 * aardio has no headless entry point: `loadcode`/`loadcodex` only exist inside
 * an aardio process, and `aardio.exe script.aardio` just opens the IDE. The
 * bridge (`bridge/aardioBridge.aardio`, started by the user with F5) closes
 * that gap by polling a request file, running the code in a thread, and writing
 * the result back as JSON.
 *
 * The protocol is deliberately boring — two JSON files in one directory — so
 * the aardio side never needs a socket, a port, a firewall exception, or a
 * third-party library. Each request carries a nonce and the bridge's one-time
 * token; each response echoes both, so a stale or foreign file is ignored.
 *
 * @module dsh-aardio/bridge
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

/** Directory the bridge and the plugin share, under the user's temp folder. */
export const BRIDGE_DIRECTORY_NAME = 'dsh-aardio-bridge'

/** Protocol version the bridge writes into `bridge.json`. */
export const BRIDGE_PROTOCOL_VERSION = 1

/** Bounds for one request. */
export const BRIDGE_LIMITS = {
	maxCodeBytes: 512 * 1024,
	pollIntervalMs: 50,
	defaultTimeoutMs: 15000,
	maxTimeoutMs: 120000,
}

/** Requests are serialized: the bridge handles one file at a time. */
let tail = Promise.resolve()

/**
 * @returns the shared bridge directory.
 *
 * `DSH_AARDIO_BRIDGE_DIR` overrides it so tests and debugging can point both
 * sides at one folder; the bridge script always uses `%TEMP%\dsh-aardio-bridge`.
 */
export function bridgeDirectory() {
	const override = process.env.DSH_AARDIO_BRIDGE_DIR
	if (typeof override === 'string' && override !== '') return override
	return join(tmpdir(), BRIDGE_DIRECTORY_NAME)
}

/**
 * @returns where the bridge publishes its token and pid.
 */
export function bridgeInfoPath() {
	return join(bridgeDirectory(), 'bridge.json')
}

/**
 * @returns whether a pid belongs to a live process.
 * @param pid - process id from `bridge.json`.
 */
export function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		// EPERM means the process exists but belongs to someone else.
		return error?.code === 'EPERM'
	}
}

/**
 * Read and validate the bridge's handshake file.
 * @param options - optional hint naming the bridge script, used in errors.
 * @returns the validated bridge description.
 * @throws when the bridge is not running or the handshake is unusable.
 */
export async function readBridgeInfo(options = {}) {
	const path = bridgeInfoPath()
	const hint = options.hint === undefined ? '' : `\nStart the bridge in the aardio IDE: open ${options.hint} and press F5.`

	if (!existsSync(path)) {
		throw new Error(`dsh-aardio: the IDE bridge is not running.${hint}`)
	}

	let info
	try {
		info = JSON.parse(await readFile(path, 'utf8'))
	} catch {
		throw new Error(`dsh-aardio: ${path} is unreadable; start the bridge again.${hint}`)
	}

	if (info?.version !== BRIDGE_PROTOCOL_VERSION || typeof info.token !== 'string') {
		throw new Error(`dsh-aardio: ${path} has an unsupported format; update the bridge script and start it again.`)
	}
	if (!isProcessAlive(info.pid)) {
		throw new Error(`dsh-aardio: the IDE bridge is stale (pid ${String(info.pid)} is gone); start it again.${hint}`)
	}
	return {
		version: info.version,
		token: info.token,
		pid: info.pid,
		startedAt: Number(info.startedAt ?? 0) || 0,
		directory: typeof info.dir === 'string' && info.dir !== '' ? info.dir : bridgeDirectory(),
		path,
	}
}

/**
 * Queue one request behind the previous one.
 * @param task - work to run once the queue is free.
 * @returns the task's result.
 */
function serialize(task) {
	const run = tail.then(task, task)
	tail = run.then(() => undefined, () => undefined)
	return run
}

/**
 * Write the request atomically so the bridge never reads a partial file.
 * @param path - request path.
 * @param request - request payload.
 */
async function writeRequest(path, request) {
	const temporary = `${path}.tmp`
	await writeFile(temporary, JSON.stringify(request), 'utf8')
	await rename(temporary, path)
}

/**
 * Wait for a response that matches this request.
 * @param path - response path.
 * @param nonce - request nonce the response must echo.
 * @param token - bridge token the response must echo.
 * @param deadline - epoch milliseconds to stop waiting.
 * @returns the response payload, or undefined on timeout.
 */
async function waitForResponse(path, nonce, token, deadline) {
	for (;;) {
		if (existsSync(path)) {
			let response
			try {
				response = JSON.parse(await readFile(path, 'utf8'))
			} catch {
				response = undefined
			}
			if (response !== undefined && response.nonce === nonce && response.token === token) {
				return response
			}
			// A response for another request, or a partial write: discard it and keep waiting.
			if (response !== undefined) await rm(path, { force: true })
		}
		if (Date.now() >= deadline) return undefined
		await new Promise((resolve) => { setTimeout(resolve, BRIDGE_LIMITS.pollIntervalMs) })
	}
}

/**
 * Run aardio code through the IDE bridge.
 * @param options - code, mode, timeout, and an optional hint for error messages.
 * @returns the bridge's normalized answer.
 * @throws when the bridge is unavailable, the request times out, or it is invalid.
 */
export function runBridgeCode(options) {
	const { code, mode = 'run', hint, timeoutMs } = options
	if (typeof code !== 'string' || code.trim() === '') throw new Error('dsh-aardio: code must not be empty')

	const bytes = Buffer.byteLength(code, 'utf8')
	if (bytes > BRIDGE_LIMITS.maxCodeBytes) {
		throw new Error(`dsh-aardio: code is ${String(bytes)} bytes; the bridge accepts up to ${String(BRIDGE_LIMITS.maxCodeBytes)}`)
	}

	const timeout = Math.min(
		Math.max(Number(timeoutMs ?? BRIDGE_LIMITS.defaultTimeoutMs) || BRIDGE_LIMITS.defaultTimeoutMs, 250),
		BRIDGE_LIMITS.maxTimeoutMs,
	)

	return serialize(async () => {
		const info = await readBridgeInfo({ hint })
		const directory = info.directory
		const requestPath = join(directory, 'request.json')
		const responsePath = join(directory, 'response.json')
		const nonce = randomUUID()

		await rm(responsePath, { force: true })
		await writeRequest(requestPath, { nonce, token: info.token, mode, code })

		const response = await waitForResponse(responsePath, nonce, info.token, Date.now() + timeout)
		if (response === undefined) {
			await rm(requestPath, { force: true })
			throw new Error(
				`dsh-aardio: the IDE bridge did not answer within ${String(timeout)} ms. It handles one request at a time and the IDE may be busy; retry, or raise timeoutMs (max ${String(BRIDGE_LIMITS.maxTimeoutMs)}).`,
			)
		}
		await rm(responsePath, { force: true })

		const printed = Array.isArray(response.print) ? response.print.filter((line) => typeof line === 'string') : []
		return {
			ok: response.ok === true,
			phase: typeof response.phase === 'string' ? response.phase : 'run',
			compileError: typeof response.compileError === 'string' ? response.compileError : '',
			error: typeof response.error === 'string' ? response.error : '',
			result: typeof response.result === 'string' ? response.result : '',
			resultType: typeof response.resultType === 'string' ? response.resultType : '',
			print: printed,
			durationMs: Number(response.durationMs ?? 0) || 0,
			bridgePid: info.pid,
		}
	})
}
