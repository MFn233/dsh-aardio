/**
 * dsh-aardio — the aardio toolchain for DeepSeek Harness.
 *
 * Provides:
 *   - three bundled skills: `aardio`, `aardio-project`, `aardio-library`
 *   - `aardio_docs`: keyword search over the local docs, examples, and libraries,
 *     plus a bounded read of any file inside the installation
 *   - `aardio_exec`: compile or run code inside the user's IDE through a bridge
 *   - `aardio_open`: hand a file or project to the aardio IDE
 *   - `aardio_env`: report which installation was resolved and what was probed
 *   - one system-prompt section with the project and verification rules
 *
 * The installation folder is a setting, not a constant: it comes from the row's
 * `aardioRoot`, then `AARDIO_ROOT`/`AARDIO_HOME`, then auto-detection. Users
 * edit it in Plugins → this bundle → Configure.
 *
 * Only Node built-ins are imported, so the plugin loads from a linked checkout,
 * a packed tarball, or the npm registry without a dependency install.
 *
 * @module dsh-aardio
 */

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createConfig, readRoot } from './lib/config.js'
import { createInstallation } from './lib/installation.js'
import { registerPromptSection } from './lib/prompt.js'
import { createSkillProvider } from './lib/skills.js'
import { defineDocsTool, defineEnvTool, defineExecTool, defineOpenTool } from './lib/tools.js'

/** Cordis plugin name. */
export const name = 'dsh-aardio'

/** Services this plugin registers into. */
export const inject = ['tools', 'skills']

/**
 * Editable row configuration. Undefined when no schemastery copy is reachable
 * (a linked checkout without the peer installed); Cordis then passes the raw
 * row config through, and the plugin still works from environment detection.
 */
export const Config = createConfig()

/** Package root, used to locate the bundled skills. */
const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * Register the bundled skills, the always-on project rules, and the three tools.
 * @param ctx - Cordis context with `tools` and `skills` injected.
 * @param config - live row configuration; `aardioRoot` is a volatile reference.
 * @returns a disposer removing every registration.
 */
export function apply(ctx, config = {}) {
	// The setting is volatile: it changes in place, so every tool call re-reads it.
	const installation = createInstallation(() => readRoot(config))

	const disposers = [
		ctx.tools.register(defineDocsTool(installation)),
		ctx.tools.register(defineOpenTool(installation)),
		ctx.tools.register(defineEnvTool(installation)),
		ctx.tools.register(defineExecTool()),
		ctx.skills.registerProvider(() => createSkillProvider({ pluginRoot: PLUGIN_ROOT })),
	]

	const promptSection = registerPromptSection(ctx)
	if (promptSection !== undefined) disposers.push(promptSection)

	return () => {
		for (const dispose of disposers) {
			try {
				dispose?.()
			} catch {
				// One failed disposal must not strand the rest.
			}
		}
	}
}
