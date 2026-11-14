/**
 * The always-on project rules this plugin adds to the agent's system prompt.
 *
 * The bundled skills teach the full workflow, but a skill is only read when it
 * is loaded. These two rules are constraints on what the agent may do at all,
 * so they ride a prompt section instead: new projects belong to the user, and
 * `dlg/`/`lib/` edits need an IDE-side refresh.
 *
 * `interpolate: false` keeps the text literal, so braces in paths or code
 * snippets can never be mistaken for prompt variables.
 *
 * @module dsh-aardio/prompt
 */

/** Stable section name; also what a future replacement would shadow. */
export const PROMPT_SECTION_NAME = 'dsh-aardio:project-rules'

/**
 * High order so the first-party prompt prefix stays unchanged and cacheable;
 * this section is appended after the environment guidance.
 */
export const PROMPT_SECTION_ORDER = 10500

/** The rules, in the language of the bundled skills. */
export const PROMPT_TEXT = [
	'aardio 工程协作规则（由 dsh-aardio 插件提供）：',
	'1. 新建 aardio 工程由用户手动完成：不要手写、手改或生成 `default.aproj`。需要新工程时，请用户先在 aardio IDE 里「新建工程」，然后只修改 `main.aardio`、资源文件和代码；工程属性（图标、版本号、输出名）也让用户在 IDE 里改。',
	'2. 改过工程里的 `dlg/` 或 `lib/` 之后，明确提醒用户回到 aardio IDE 手动同步/刷新（重新打开工程或重启 IDE），否则 IDE 会沿用旧缓存，验证结论会失真。',
	'3. 验证优先无头测试：IDE 里开着 dsh-aardio bridge 时，直接用 `aardio_exec` 编译/运行代码，拿回 `print`、`return` 与 `util.testRunner` 报告；桥接没开时，写 `*.test.aardio` 并请用户按 F5，把 `print(JSON.stringify($.report()))` 的输出贴回。不要把截图识别、模拟鼠标键盘当作首选验证；GUI 冒烟不要进入 `win.loopMessage()`。',
	'详细工作流见本插件的 `aardio`、`aardio-project`、`aardio-library` 技能。',
].join('\n')

/**
 * Register the rules as a system-prompt section when the service exists.
 *
 * The section is optional: a composition without `dsh-system-prompt` keeps the
 * plugin working, it just carries no prompt text.
 * @param ctx - the Host plugin context.
 * @returns the section disposer, or undefined when the service is absent.
 */
export function registerPromptSection(ctx) {
	const systemPrompt = typeof ctx?.get === 'function' ? ctx.get('systemPrompt') : undefined
	if (systemPrompt === undefined || typeof systemPrompt.section !== 'function') return undefined
	return systemPrompt.section({
		name: PROMPT_SECTION_NAME,
		order: PROMPT_SECTION_ORDER,
		interpolate: false,
		text: PROMPT_TEXT,
	})
}
