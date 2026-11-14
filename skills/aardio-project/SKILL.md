---
name: aardio-project
description: "Use when creating or maintaining an aardio project: *.aproj, main.aardio, /lib, /res, output name, version attributes, publishDir. 新建或维护 aardio 工程时使用。"
---

# aardio 工程（*.aproj）创建与维护

移植自 AA 的 `autos.skills.aardioProjectBuilder`。原技能的函数（`pb.createProject` 等）依赖 aardio 进程内的 `import autos.skills.aardioProjectBuilder` 和 `loadcode` 编译检查，**DSH 调不到**；这里只保留可复用的工程结构与踩坑经验，操作改为直接读写文件 + 让用户在 IDE 里验证。

## 结构约定

- 工程根目录 = `*.aproj` 所在目录，同时也是运行时的"应用程序基准目录"：代码里以 `/` 或 `\` 开头的虚拟绝对路径都锚定在这里。
- 根目录只放 `main.aardio` 和 `default.aproj`（一个目录可以放多个 `*.aproj`，但实际开发通常只有一个）。
- `/lib/` 用户库：**不写进 aproj**，由 IDE 动态扫描显示。
- `/res/` 资源（`embed="true"`，编译进 EXE）；`/dlg/` 窗体文件。
- `/docs/` 可选工程文档；用户库文档放 `/docs/library/`，工程文档放 `/docs/`。
- 完整字段规范见安装目录里的 `docs\specs\aproj.md`，真实实例见 `project\HostEditor\default.aproj`（安装目录用 `aardio_env` 查）。

## 新建工程：只由用户在 IDE 里做

1. **DSH 不新建工程、不写 `default.aproj`。** 需要新工程时，让用户在 IDE 里「新建工程」；你只负责之后修改 `main.aardio`、`res/`、`dlg/`、`lib/` 里的代码。
2. **工程属性也在 IDE 里改**（图标、版本号、公司名、输出名、`publishDir`）。手写的 `default.aproj` 会在 IDE 打开时被内存配置整个覆盖，改了等于没改。
3. **改过 `dlg/` 或 `lib/` 后，提醒用户回 IDE 手动同步/刷新**（重新打开工程或重启 IDE）。IDE 会缓存窗体与库，未刷新时你和他看到的报错都可能来自旧版本。
4. 下面的 aproj 片段只是**只读参考**，用来理解字段含义，不要据此生成文件。

## 最小可用模板（只读参考）

`default.aproj`（UTF-8 XML，注意 `ver="10"`）：

```xml
<?xml version="1.0" encoding="utf-8"?>
<project ver="10" name="Demo" libEmbed="true" icon="..." ui="win" output="Demo.exe" CompanyName="作者" FileDescription="Demo" LegalCopyright="Copyright (C) 作者 2026" ProductName="Demo" InternalName="Demo" FileVersion="0.0.0.1" ProductVersion="0.0.0.1" publishDir="/dist/" dstrip="false">
	<file name="main.aardio" path="main.aardio" comment="main.aardio"/>
	<folder name="资源文件" path="res" embed="true"/>
	<folder name="窗体文件" path="dlg" comment="目录" embed="true"/>
</project>
```

根属性关键项：

| 属性 | 含义 |
|---|---|
| `ver` | 兼容的最小主版本，固定 `"10"` |
| `name` | 工程管理器里显示的名称 |
| `ui` | `win`（窗口）、`console`（控制台）、`website`（网站） |
| `output` | 发布生成的 EXE 名 |
| `publishDir` | 发布输出目录，默认 `/dist/` |
| `icon` | 图标路径，`"..."` 或空表示用默认图标 |
| `libEmbed` | 是否把引用的库编译内嵌进 EXE |
| `dstrip` | 发布时是否去掉调试符号 |
| `CompanyName` / `FileDescription` / `LegalCopyright` / `ProductName` / `InternalName` / `FileVersion` / `ProductVersion` | EXE 版本信息资源 |

## 从原技能保留的坑

- `ide.project.create*` 的 `projectDir` 是**父目录**，实际工程建在 `projectDir/projectName`，目标已存在会失败（AA 侧经验）。
- 工程名必须是合法文件夹名（`fsys.path.validName()` 校验）。
- `ide.openProject` / `openDocument` 是**异步**的，刚打开就读工程路径可能拿到空值。
- 写 `.aardio` 文件前应先确认能编译；改库文件后要换干净会话验证，否则旧库缓存会让结论失真。
- `/*DSG{{*/ ... /*}}*/` 窗体设计器区域必须保持完整。
- 不要往工程根目录塞多个入口文件；库代码一律放 `/lib/`。

## 发布

发布走 IDE（发布菜单 / `ide.libPublish`）。DSH 只负责准备文件、`publishDir`、`output`、版本号等属性，不要在 DSH 侧假装执行了编译或发布。
