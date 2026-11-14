# dsh-aardio

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 aardio 工具链插件：内置三个 aardio 编写技能，可就地检索你本机的 aardio 文档、范例和标准库源码，把文件或工程交给 aardio IDE 打开，并在插件设置页里选好 aardio 安装目录 —— 不再把路径写死在代码里。

[English](README.md) | 中文

## 包含什么

| 类型 | 名称 | 作用 |
|---|---|---|
| 技能 | `aardio` | 语法铁律、本机文档地图、写代码的工作流 |
| 技能 | `aardio-project` | `*.aproj` 工程结构、版本属性、发布设置与踩坑 |
| 技能 | `aardio-library` | 用户库/扩展库：`intellisense`/`details` 注释块与文档目录规范 |
| 工具 | `aardio_docs` | 在安装目录的 `docs/`、`examples/`、`lib/` 里按关键字检索 |
| 工具 | `aardio_open` | 用 aardio IDE 打开 `.aardio` 文件、`.aproj` 或工程目录 |
| 工具 | `aardio_env` | 报告插件解析到的安装目录、来源，以及探测过的位置 |
| 设置 | 配置页 | 选择包含 `aardio.exe` 的文件夹，可浏览选择，也可一键恢复自动探测 |

## 安装

**从插件页安装（推荐）**：打开 **插件 → 添加插件**，选择本插件所在目录并安装。安装后插件会被激活；如果插件页之前就开着，刷新一下页面。

**命令行安装：**

```powershell
dsh plugin --profile desktop add dsh-aardio
# 或者安装本地检出目录：
dsh plugin --profile desktop add link:D:\path\to\dsh-aardio
```

卸载：`dsh plugin --profile desktop remove dsh-aardio`。

安装后，新会话的技能目录里会出现三个 aardio 技能，工具列表里会出现三个工具。

## 指定 aardio 安装目录

**不需要改 YAML**。插件按这个顺序确定安装目录：

1. 设置项 `aardioRoot`（见下一节）；
2. 环境变量 `AARDIO_ROOT` 或 `AARDIO_HOME`；
3. 自动探测：`%ProgramFiles%\aardio`、`%LOCALAPPDATA%\aardio`、`%APPDATA%\aardio`，以及每个固定磁盘上的 `aardio`、`Develop\aardio`、`Program Files\aardio`、`Applications\aardio`、`software\aardio`、`tools\aardio`。

目录里有 `aardio.exe` 才算有效安装。全都找不到时，工具会在报错里列出探测过的每个目录，`aardio_env` 也能随时查看同样的信息。

### 设置页在哪

表单就在插件自己的页面上：**插件 → aardio 工具链**。它渲染在插件说明下面、组件列表上面，打开插件就能看到；`dsh-aardio` 那一行标题旁的小箭头打开的「行页面」里是同一个表单。

- **aardio 所在文件夹**：可以手输，也可以点 **选择文件夹…** 用系统文件夹选择窗口挑。粘贴进来的各种写法会先被规范化：带引号的路径、`file:///` 链接、正斜杠、结尾反斜杠，甚至直接粘 `aardio.exe` 的完整路径。
- **保存**：写进 profile 的配置层并立即生效 —— 这个字段声明为 volatile，插件不会重启，工具下一次调用就用新目录。
- **改回自动查找**：清掉存下来的值（只有真的存过值时才出现），回到自动探测。

留空就是自动查找；清空时写入的是「未设置」而不是空字符串，所以不会盖住 patch 层里的值。

手工管理 profile 时，也可以直接在 `cordis.patch.yml` 里固定：

```yaml
- id: dsh-aardio
  name: dsh-aardio
  config:
    aardioRoot: D:/path/to/aardio
```

写在 patch 里属于组合层默认值：设置页会显示为「继承」，仍可覆盖或清除。

## 工具细节

`aardio_docs`：`query`（必填）、`scope`（`docs` / `examples` / `lib` / `all`，默认 `all`）、`limit`（默认 12，最多 40）。只读文本文件；最多 8000 个文件、96 MB、深度 10，触到预算会标记 `truncated`。

`aardio_open`：`path`；传目录时优先打开其中的 `default.aproj`，让 IDE 恢复整个工程而不是单个文件。启动后立即返回，不阻塞会话。

`aardio_env`：无参数。检索不到东西时先调它 —— 它会告诉你解析到的目录、来源（设置 / 环境变量 / 自动探测）、`aardio.exe` 是否存在，以及探测过哪些目录。

## 内置技能的优先级

三个技能由插件自己注册，rank 600；你自己技能目录里同名的技能 rank 400，会覆盖插件内的版本。想以插件为唯一来源，删掉 `~/.dsh/skills/aardio*` 即可。

技能里刻意不写任何绝对安装路径：需要时让模型先调 `aardio_env`，找 API 优先用 `aardio_docs`，而不是凭记忆编。

## 已知边界

- **aardio 没有无头命令行入口。** `aardio.exe <脚本>` 只会打开 IDE，`/run`、`/build` 之类参数无效；`loadcode`/`loadcodex` 只在 aardio 进程内可用。所以本插件**不能编译、不能运行、不能发布**：写完代码请在 IDE 里按 <kbd>F5</kbd>。
- **IDE 只有 Windows 版**，因此 `aardio_open` 在其他平台会直接报错；检索和技能对任何平台的安装副本都可用。
- **官方文档只读不随包分发。** `docs/index.md` 禁止单独分发 aardio 官方文档；本插件只带原创索引与摘要，检索读的是你本机的安装目录。

## 开发

```powershell
npm test          # node --test：安装目录解析、检索、技能、工具、打包
npm run check     # Host 与浏览器入口的语法检查
npm run pack:check
```

测试全离线，fixture 建在系统临时目录里。

`Config` 依赖 `@deepseek-ai/schemastery`（由安装本插件的 profile 提供）。本地 `link:` 检出没有 `node_modules`，所以 `lib/config.js` 还会通过 `DSH_INSTALL_DIR`/`DSH_PROFILE_DIR`/`DSH_HOME` 解析这个 peer；完全找不到时插件仍能加载，只是退回环境变量 + 自动探测，没有设置页。

### 目录

| 路径 | 作用 |
|---|---|
| `index.js` | Cordis 入口：`Config`、`inject`、注册与释放 |
| `client.js` | 浏览器半边：`dsh-aardio#dsh-aardio` 的 `plugins.row.config` 页面 |
| `lib/config.js` | Config schema 与 peer 解析 |
| `lib/installation.js` | 路径规范化、探测、优先级、诊断 |
| `lib/search.js` | 有预算上限的关键字检索 |
| `lib/skills.js` | 技能 frontmatter 解析与 provider |
| `lib/tools.js` | 三个工具定义 |
| `skills/` | 内置技能 |
| `docs/` | 插件页详情图 |

## 版权

MIT。aardio 官方文档、范例与标准库源码不属于本包，也不会被本包分发。
