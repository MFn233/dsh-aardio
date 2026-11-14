# dsh-aardio

The [aardio](https://aardio.com) toolchain for DeepSeek Harness: three bundled authoring skills, documentation search over your own aardio installation, open-in-IDE, and a settings page that points the plugin at the aardio folder on your machine.

English | [中文](README.zh.md)

## What you get

| Kind | Name | What it does |
|---|---|---|
| Skill | `aardio` | Language rules, the local documentation map, and the working procedure for writing aardio code |
| Skill | `aardio-project` | `*.aproj` project structure, version attributes, publish settings, and the traps around them |
| Skill | `aardio-library` | User and extension libraries: `intellisense`/`details` blocks and the documentation layout |
| Tool | `aardio_docs` | Keyword search over `docs/`, `examples/`, and `lib/` of your installation |
| Tool | `aardio_open` | Hand an `.aardio` file, an `.aproj`, or a project folder to the aardio IDE |
| Tool | `aardio_env` | Report the resolved installation, where the value came from, and what was probed |
| Setting | Config page | Choose the folder that contains `aardio.exe`, with a folder picker and an auto-detect reset |

## Install

**From the Plugins page** (recommended): open **Plugins → Add plugin**, choose the local directory that holds this package, and install it. DSH restarts the plugin when it activates; reload the page if the Plugins page was already open.

**From the CLI:**

```powershell
dsh plugin --profile desktop add dsh-aardio
# or a checkout on disk:
dsh plugin --profile desktop add link:D:\path\to\dsh-aardio
```

Remove it with `dsh plugin --profile desktop remove dsh-aardio`.

After installation, a new session lists the three skills, and the three tools appear in the tool list.

## Point the plugin at your aardio folder

You do **not** need to edit YAML. The plugin resolves the installation in this order:

1. the `aardioRoot` setting (see below),
2. the `AARDIO_ROOT` or `AARDIO_HOME` environment variable,
3. automatic detection: `%ProgramFiles%\aardio`, `%LOCALAPPDATA%\aardio`, `%APPDATA%\aardio`, and the usual `aardio`, `Develop\aardio`, `Program Files\aardio`, `Applications\aardio`, `software\aardio`, and `tools\aardio` folders on every fixed drive.

A folder counts as an installation when it contains `aardio.exe`. If nothing matches, the tools say so and list every folder they probed; `aardio_env` shows the same information on demand.

### The settings page

The form sits on the bundle's own page: **Plugins → Aardio toolchain**. It renders between the description and the component list, so opening the plugin is enough — the row's own page (opened by the chevron beside the row title) shows the same form.

- **aardio folder** — typed, or chosen with **Choose folder…**, which opens the native folder picker. Pasted shapes are normalised first: surrounding quotes, `file:///` URLs, forward slashes, a trailing separator, or the `aardio.exe` file itself.
- **Save** stores it in the profile's configuration layer and applies immediately: the field is declared volatile, so the plugin is not restarted and the tools read the new folder on their next call.
- **Find automatically** clears the stored value (it appears only when a value is actually stored), so detection takes over again.

An empty field means "auto-detect", and it is stored as an empty value rather than an empty string, so it never shadows a value set in a patch layer.

The same value can be pinned in `cordis.patch.yml` when you manage profiles by hand:

```yaml
- id: dsh-aardio
  name: dsh-aardio
  config:
    aardioRoot: D:/path/to/aardio
```

A value set in the patch is a composition-layer value: the settings page shows it as inherited and can override or clear it.

## Tools

`aardio_docs` takes `query` (required), `scope` (`docs` | `examples` | `lib` | `all`, default `all`), and `limit` (default 12, maximum 40). It searches text files only and stops at 8000 files, 96 MB, or depth 10, reporting `truncated` when it hits a budget.

`aardio_open` takes `path`; a folder opens its `default.aproj` so the IDE restores the project instead of a bare file. It launches the IDE detached and returns immediately.

`aardio_env` takes no arguments and is the first thing to call when a search finds nothing: it reports the resolved folder, whether it came from the setting, the environment, or detection, and which folders were probed.

## Bundled skills

The three skills are registered by the plugin itself, with rank 600. A skill of the same name in your own skills directory ranks 400 and therefore wins, so you can keep experimenting locally without editing the package. Delete `~/.dsh/skills/aardio*` if you want the bundled copies to be the only source.

The skills deliberately contain no absolute installation path: they tell the model to call `aardio_env`, and to prefer `aardio_docs` over guessing an API.

## Limits

- **aardio has no headless command line.** `aardio.exe <script>` only opens the IDE; `/run`, `/build`, and friends do nothing. `loadcode`/`loadcodex` exist only inside an aardio process. This plugin therefore cannot compile, run, or publish your code — write it, open it in the IDE, and press <kbd>F5</kbd>.
- **The IDE is Windows-only**, so `aardio_open` refuses to run elsewhere. Search and skills still work against any copy of an installation.
- **The documentation is read, never shipped.** `docs/index.md` forbids redistributing the official documentation; this package contains only original indexes and summaries, and reads your installation in place.

## Development

```powershell
npm test          # node --test: installation resolution, search, skills, tools, packaging
npm run check     # syntax check of the Host and browser entry points
npm run pack:check
```

Tests are offline and create their fixtures in the OS temp directory.

`Config` needs `@deepseek-ai/schemastery`, a peer provided by the profile that installs the plugin. A linked checkout has no `node_modules`, so `lib/config.js` also resolves the peer through `DSH_INSTALL_DIR`/`DSH_PROFILE_DIR`/`DSH_HOME`; without any copy the plugin still loads and falls back to the environment variable and detection, just without a settings page.

### Layout

| Path | Role |
|---|---|
| `index.js` | Cordis entry: `Config`, `inject`, registration, disposal |
| `client.js` | Browser half: the `plugins.row.config` page for `dsh-aardio#dsh-aardio` |
| `lib/config.js` | Config schema and its peer resolution |
| `lib/installation.js` | Path normalisation, probing, precedence, diagnostics |
| `lib/search.js` | Bounded keyword search |
| `lib/skills.js` | Skill frontmatter and the provider |
| `lib/tools.js` | The three tool definitions |
| `skills/` | The bundled skills |
| `docs/` | The Plugins-page detail image |

## License

MIT. The aardio documentation, examples, and library sources are not part of this package.
