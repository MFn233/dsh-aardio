/**
 * dsh-aardio, browser half.
 *
 * Renders this bundle's configuration on the Plugins page: the folder that
 * contains `aardio.exe`, with a folder picker, save, and "clear → auto-detect".
 * The page opens from the bundle row's Configure control (Plugins → Aardio
 * toolchain → the `dsh-aardio` row).
 *
 * Rules followed here, because this file is served as a plain browser bundle:
 *   - React comes from the shell's module table; no Harness client package is
 *     imported, since those change without notice and would blank the slot.
 *   - Everything is styled with the host's `--dsw-alias-*` theme tokens, so the
 *     form follows light and dark themes without its own colour palette.
 *   - Writes go through the form the page supplies, never by editing
 *     `cordis.patch.yml` directly.
 */

window.__ModuleLoader__.load({
	id: 'dsh-aardio',
	factory(require) {
		const React = require('react')
		const h = React.createElement

		/** Locale namespace of this plugin's browser copy. */
		const NS = 'dshAardio'

		/** Slot key: `<package name>#<row id>`, matching `cordis.patch.yml` and `package.json`. */
		const ROW_CONFIG_KEY = 'dsh-aardio#dsh-aardio'

		/** Bundle-level slot key: the Host's configuration namespace for this plugin, which is the row id. */
		const ENTRY_ID = 'dsh-aardio'

		/** The Config field this page edits. */
		const FIELD = 'aardioRoot'

		const en = {
			summary: 'Where aardio lives: open Configure on this row and pick the folder, or leave it empty to find it automatically.',
			fieldLabel: 'aardio folder',
			fieldDescription: 'Pick the folder that contains aardio.exe (usually C:\\aardio, or wherever you installed it). Documentation search and open-in-IDE use this location.',
			placeholder: 'Empty = find it automatically',
			browse: 'Choose folder…',
			save: 'Save',
			saving: 'Saving…',
			reset: 'Find automatically',
			saved: 'Saved.',
			rejected: 'DSH did not accept this folder; the current setting was reloaded.',
			failed: "Couldn't save. Try again.",
			picked: 'Folder selected. Choose Save to apply it.',
			pickerUnavailable: 'No folder window here — paste the path above instead.',
			pickerFailed: "Couldn't open the folder window. Paste the path above instead.",
			readOnly: "This machine's settings are read-only right now.",
			loading: 'Reading the current setting…',
			unavailable: 'This plugin is not loaded right now, so it cannot be configured.',
			autoDetectHint: 'Nothing set yet, so the plugin searches the usual folders. Ask the assistant to run aardio_env to see which folder it picked.',
			exeHint: 'Pasting the full path to aardio.exe also works; the file name is dropped.',
			hint: 'Leave it empty and the plugin looks in the usual places. Saving takes effect right away.',
		}

		const zh = {
			summary: 'aardio 装在哪：点这一行的「配置」选文件夹，留空则自动查找。',
			fieldLabel: 'aardio 所在文件夹',
			fieldDescription: '选里面有 aardio.exe 的那个文件夹（通常在 C:\\aardio，或你安装时选的目录）。查 aardio 文档、用 aardio 打开文件都会用这个位置。',
			placeholder: '留空＝自动查找',
			browse: '选择文件夹…',
			save: '保存',
			saving: '正在保存…',
			reset: '改回自动查找',
			saved: '已保存。',
			rejected: 'DSH 没有接受这个位置，已重新读取当前设置。',
			failed: '没能保存，请再试一次。',
			picked: '已选择文件夹，点「保存」生效。',
			pickerUnavailable: '这里打不开文件夹选择窗口，请把路径粘贴到上面。',
			pickerFailed: '打不开文件夹选择窗口，请直接粘贴路径。',
			readOnly: '现在不能修改配置（本机设置是只读的）。',
			loading: '正在读取当前设置…',
			unavailable: '这个插件当前没有加载，暂时无法配置。',
			autoDetectHint: '还没有指定目录，插件会自动在常见位置查找。想知道实际用的是哪个，可以让助手运行 aardio_env。',
			exeHint: '粘贴 aardio.exe 的完整路径也可以，会自动去掉文件名。',
			hint: '留空时，插件会自动在常见位置查找 aardio。保存后立即生效。',
		}

		const CSS = `
.dsaardio-root { display: flex; flex-direction: column; gap: 10px; color: var(--dsw-alias-label-primary); font-size: 13px; }
.dsaardio-label { font-weight: 600; }
.dsaardio-description { margin: 0; color: var(--dsw-alias-label-secondary); line-height: 1.5; }
.dsaardio-note { margin: 0; color: var(--dsw-alias-label-tertiary); line-height: 1.5; }
.dsaardio-input-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsaardio-input { flex: 1 1 320px; min-width: 200px; height: 34px; padding: 0 12px;
  border: .5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px; line-height: 1.5; }
.dsaardio-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.dsaardio-input:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.dsaardio-input[aria-invalid='true'] { border-color: var(--dsw-alias-state-error-primary); }
.dsaardio-input:disabled { opacity: 0.4; }
.dsaardio-button { height: 36px; padding: 0 14px; border: none; border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }
.dsaardio-button:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsaardio-button:disabled { opacity: 0.4; cursor: default; }
.dsaardio-button-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
.dsaardio-link { height: 28px; padding: 0 6px; border: none; background: none; cursor: pointer;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 20px; border-radius: var(--dsw-radius-sm, 6px); }
.dsaardio-link:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dsaardio-link:disabled { opacity: 0.4; cursor: default; }
@media (hover: hover) {
  .dsaardio-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
  .dsaardio-button-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
  .dsaardio-link:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
}
.dsaardio-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dsaardio-status { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.5; }
.dsaardio-status[data-tone='error'] { color: var(--dsw-alias-state-error-primary); }
.dsaardio-status[data-tone='success'] { color: var(--dsw-alias-state-success-primary); }
.dsaardio-hint { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 1.5; }
`

		/**
		 * Turn whatever the user pasted into the folder an installation means.
		 *
		 * Windows offers many shapes of the same path: quoted paths from "Copy as
		 * path", `file:///` URLs from a browser, forward slashes, a trailing
		 * separator, or the `aardio.exe` file itself. Normalising here keeps a
		 * reasonable paste from becoming a silent tool failure, and the result is
		 * written back into the field so the stored value is visible.
		 * @param raw - the field text.
		 * @returns the folder to store, or an empty string for "auto-detect".
		 */
		function normalizeFolder(raw) {
			let value = typeof raw === 'string' ? raw.trim() : ''
			if (value === '') return ''
			if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1).trim()
			}
			if (/^file:\/\//iu.test(value)) {
				const stripped = value.replace(/^file:\/{2,3}/iu, '')
				try {
					value = decodeURIComponent(stripped)
				} catch {
					value = stripped
				}
			}
			value = value.split('/').join('\\')
			value = value.replace(/\\aardio\.exe$/iu, '')
			value = value.length > 3 ? value.replace(/\\+$/u, '') : value
			return value
		}

		/**
		 * Render the row's one-line description.
		 * @param props - the Plugins page view props.
		 * @returns the summary text.
		 */
		function Summary(props) {
			return props.t('summary')
		}

		/**
		 * Render the folder form.
		 * @param props - the Plugins page view props, including the staged form.
		 * @returns the form.
		 */
		function Form(props) {
			const { t, form, ctx } = props
			const state = form === undefined ? undefined : form.state
			const value = state === undefined || state.value === null || typeof state.value !== 'object' ? {} : state.value
			const savedPath = typeof value[FIELD] === 'string' ? value[FIELD] : ''
			const savedFolder = normalizeFolder(savedPath)

			const [draft, setDraft] = React.useState(null)
			const [busy, setBusy] = React.useState(false)
			const [notice, setNotice] = React.useState('')
			const [pickerBroken, setPickerBroken] = React.useState(false)
			const inputId = React.useId()
			const descId = `${inputId}-description`
			const hintId = `${inputId}-hint`
			const statusId = `${inputId}-status`
			const alive = React.useRef(true)
			const inflight = React.useRef(false)
			/** Revision read before the first edit, fenced on save so another writer is not overwritten silently. */
			const fence = React.useRef(undefined)

			React.useEffect(() => () => { alive.current = false }, [])

			// The Host value moved underneath us (another window saved, or our own save
			// was accepted): drop the local draft so the field shows what is in effect.
			React.useEffect(() => {
				setDraft(null)
				fence.current = undefined
			}, [savedPath])

			const status = state === undefined ? 'loading' : state.status
			const loading = status === 'loading'
			const unavailable = status === 'unavailable'
			const writable = status === 'ready' && state.writable === true
			const disabled = !writable || busy || loading

			const userLayer = state === undefined ? undefined : state.user
			const stored = userLayer !== null && typeof userLayer === 'object' && Object.hasOwn(userLayer, FIELD)

			const shown = draft === null ? savedPath : draft
			const dirty = normalizeFolder(shown) !== savedFolder

			/**
			 * Send one configuration edit through the page's form.
			 * @param ops - ordered settings operations.
			 * @param next - the text to show after an accepted write.
			 */
			function commit(ops, next) {
				if (form === undefined || inflight.current) return
				inflight.current = true
				setBusy(true)
				setNotice('')
				const revision = fence.current
				const submitted = shown
				Promise.resolve(form.mutate(ops, revision))
					.then((accepted) => {
						if (!alive.current) return
						if (!accepted) {
							// The Host refused the value; show the value that is actually stored.
							setDraft(null)
							fence.current = undefined
							setNotice('rejected')
							return
						}
						fence.current = undefined
						// Keep text typed while the write was in flight; otherwise show what was stored.
						setDraft((previous) => previous === null || previous === submitted ? next : previous)
						setNotice('saved')
					})
					.catch(() => {
						if (alive.current) setNotice('failed')
					})
					.then(() => {
						inflight.current = false
						if (alive.current) setBusy(false)
					})
			}

			/** Store the field, clearing it rather than writing an empty string. */
			function save() {
				const folder = normalizeFolder(shown)
				if (folder === '') {
					commit([{ op: 'unset', path: [FIELD] }], '')
					return
				}
				commit([{ op: 'set', path: [FIELD], value: folder }], folder)
			}

			/** Ask the host for a folder; typing the path stays possible when no picker exists. */
			function browse() {
				const ui = typeof ctx?.get === 'function' ? ctx.get('uiWorkspace') : undefined
				if (ui === undefined || typeof ui.pickDirectory !== 'function') {
					setNotice('pickerUnavailable')
					setPickerBroken(true)
					return
				}
				setNotice('')
				Promise.resolve(ui.pickDirectory())
					.then((picked) => {
						if (!alive.current) return
						const folder = normalizeFolder(picked)
						if (folder === '') return
						if (fence.current === undefined && state !== undefined) fence.current = state.revision
						setDraft(folder)
						setNotice('picked')
					})
					.catch(() => {
						if (!alive.current) return
						setNotice('pickerFailed')
						setPickerBroken(true)
					})
			}

			/** Record the revision the first edit was based on, so a concurrent write is detected. */
			function edit(next) {
				if (fence.current === undefined && state !== undefined) fence.current = state.revision
				setDraft(next)
				setNotice('')
			}

			const noticeTone = notice === 'failed' || notice === 'rejected' || notice === 'pickerFailed' || notice === 'pickerUnavailable'
				? 'error'
				: notice === 'saved' ? 'success' : ''

			const note = loading ? t('loading') : unavailable ? t('unavailable') : writable ? '' : t('readOnly')

			return h('div', { className: 'dsaardio-root', 'data-dsh-aardio-config': '' },
				h('style', null, CSS),
				h('label', { className: 'dsaardio-label', htmlFor: inputId }, t('fieldLabel')),
				h('p', { id: descId, className: 'dsaardio-description' }, t('fieldDescription')),
				note === '' ? null : h('p', { className: 'dsaardio-note' }, note),
				savedFolder === '' ? h('p', { className: 'dsaardio-note' }, t('autoDetectHint')) : null,
				h('div', { className: 'dsaardio-input-row' },
					h('input', {
						id: inputId,
						className: 'dsaardio-input',
						type: 'text',
						value: shown,
						placeholder: loading ? '' : t('placeholder'),
						spellCheck: false,
						autoComplete: 'off',
						disabled,
						'aria-describedby': `${descId} ${hintId} ${statusId}`,
						'aria-invalid': notice === 'failed' || notice === 'rejected' ? 'true' : undefined,
						onChange: (event) => { edit(event.target.value) },
						onKeyDown: (event) => {
							if (event.key !== 'Enter') return
							event.preventDefault()
							if (!disabled && dirty) save()
						},
					}),
					h('button', {
						type: 'button',
						className: 'dsaardio-button',
						disabled: disabled || pickerBroken,
						onClick: browse,
					}, t('browse')),
				),
				h('div', { className: 'dsaardio-actions' },
					h('button', {
						type: 'button',
						className: 'dsaardio-button dsaardio-button-primary',
						disabled: disabled || !dirty,
						onClick: save,
					}, busy ? t('saving') : t('save')),
					stored
						? h('button', {
							type: 'button',
							className: 'dsaardio-link',
							disabled: disabled || savedFolder === '',
							onClick: () => { commit([{ op: 'unset', path: [FIELD] }], '') },
						}, t('reset'))
						: null,
					h('span', {
						id: statusId,
						className: 'dsaardio-status',
						'data-tone': noticeTone,
						role: 'status',
						'aria-live': 'polite',
						'aria-atomic': 'true',
					}, notice === '' ? '' : t(notice)),
				),
				h('p', { id: hintId, className: 'dsaardio-hint' }, `${t('hint')} ${t('exeHint')}`),
			)
		}

		/**
		 * Choose the view the Plugins page asks for.
		 * @param props - the Plugins page view props.
		 * @returns the summary line or the form.
		 */
		function ConfigPage(props) {
			if (props.view === 'summary') return h(Summary, props)
			if (props.form !== undefined) return h(Form, props)
			// The bundle-level slot passes no form; the page expects the entry to ask the
			// settings service itself, which is how the official bundle pages work.
			return h(ServiceForm, props)
		}

		/**
		 * Resolve this plugin's settings controller from the client service.
		 * @param props - the Plugins page view props, including the plugin context.
		 * @returns the form bound to that controller, or a hint when it is unavailable.
		 */
		function ServiceForm(props) {
			const service = props.ctx !== undefined && typeof props.ctx.get === 'function'
				? props.ctx.get('configForms')
				: undefined
			const controller = React.useMemo(
				() => (service !== undefined && typeof service.get === 'function' ? service.get(ENTRY_ID) : undefined),
				[service],
			)
			if (controller === undefined) return h('p', { className: 'dsaardio-description' }, props.t('unavailable'))
			return h(BoundForm, { ...props, controller })
		}

		/**
		 * Re-render on every accepted value or revision change of a controller.
		 * @param props - the page props plus the resolved controller.
		 * @returns the form with a live `form` prop.
		 */
		function BoundForm(props) {
			const { controller, ...rest } = props
			const state = React.useSyncExternalStore(
				(onChange) => controller.subscribe(onChange),
				() => controller.getSnapshot(),
				() => controller.getSnapshot(),
			)
			const form = React.useMemo(
				() => ({ state, mutate: (ops, revision) => controller.mutate(ops, revision) }),
				[controller, state],
			)
			return h(Form, { ...rest, form })
		}

		return {
			inject: ['slots', 'locale'],
			apply(ctx) {
				ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-aardio: configuration copy')

				// Two seats: the bundle's own page (where people look first) and the row page
				// opened by the row's chevron control.
				ctx.effect(
					() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
						name: 'plugins.bundle.config',
						key: ENTRY_ID,
						locale: NS,
					}, (props) => h(ConfigPage, { ...props, ctx }))),
					'dsh-aardio: bundle configuration page',
				)

				ctx.effect(
					() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
						name: 'plugins.row.config',
						key: ROW_CONFIG_KEY,
						locale: NS,
					}, (props) => h(ConfigPage, { ...props, ctx }))),
					'dsh-aardio: row configuration page',
				)
			},
		}
	},
})
