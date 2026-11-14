---
name: aardio-library
description: "Use when creating or editing an aardio user library or extension library (lib/_.aardio), its intellisense block, or its docs/library pages. 编写或维护 aardio 库时使用。"
---

# aardio 用户库 / 扩展库

移植自 AA 的 `autos.skills.aardioLibraryBuilder`，去掉了 `lb.*` 运行时函数（`import autos.skills.aardioLibraryBuilder` 只在 AA 进程内可用），保留库结构、智能提示与文档规范。

## 库放哪

- 公共库：`<aardio 安装目录>\lib\<路径>.aardio` —— **只读安装目录，不要改**，只用来读实现和范本。安装目录用 `aardio_env` 工具查，不要写死。
- 工程用户库：`<工程目录>\lib\<路径>.aardio`，命名空间与路径一致：`namespace app.helper;` ↔ `lib\app\helper.aardio`。
- 单文件库 `lib\name.aardio`；目录库 `lib\name\_.aardio`（`_.aardio` 是入口）。

## 智能提示是必须的，文档是可选的

每个库源码都要有 intellisense 注释块，IDE 靠它做补全、并自动生成"库参考"：

```aardio
/*****intellisense(your.namespace)
函数名 = 一句话说明
end intellisense*****/
```

函数级详细说明：

```aardio
/**details(函数名)
说明文字
end details**/
```

**范本是现成的**：先读安装目录里的 `lib\autos\_.aardio` 和 `lib\fsys\_.aardio`（用 `aardio_env` 定位安装目录，或用 `aardio_docs` 直接搜），照它们的写法组织，不要凭记忆猜注释语法。第三方 API 数量太大时，intellisense 只放高频、稳定、验证过的接口，复杂用法写进文档。

## 库文档（交付给使用者的指南）

路径推导规则：库路径去掉 `~/lib/`（公共库）或 `/lib/`（工程库）前缀，去掉结尾的 `/_.aardio` 或 `.aardio`，拼到文档根目录。

- 公共库 → `<aardio 安装目录>\docs\library\<库名>\`
- 工程库 → `<工程目录>\docs\library\<库名>\`

例：`lib\example.aardio` → `~/docs/library/example/`。

要求：

- 每个文档目录至少有 `.aar` 索引 + `index.md`。
- `.aar` 行格式：`显示名称=文件名或目录名`；目录索引要指向目录，不要指向该目录下的 `.aar`。
- `index.md` 写：安装/导入、最小示例、文档地图、常见坑。
- API 页组织：用途 → 最小可运行示例 → 常用属性/方法/事件 → 坑点。
- 文档是给使用者的，不要写开发过程流水账。

## 分批建设与验证

1. **最小链路先行**：能 `import`、能构造核心对象、能调一个关键方法。
2. 再补 `index.md`、高频 API，最后补全目录页，避免断链和占位页。
3. 自检清单：`.aar` 指向的文件/目录确实存在；```aardio 代码块里的代码能编译。
4. **DSH 不能编译**：编译校验必须在 aardio IDE 里做。改动库后请用户重开工程或重启 IDE，避免旧库缓存影响结论；UI / COM / .NET 类库要真实开窗或连真实对象冒烟测试，构造成功不等于能用。
5. 扩展库打包用 IDE 自带工具：`<aardio 安装目录>\tools\IDE\extlib.aardio`。

## 封装 .NET 程序集（可选路线）

反射结果只是"候选清单"，不是最终智能提示：优先用精确类型名筛选，不要整库塞进 intellisense；生成后仍需人工筛高频 API 并补文档示例。AA 用 `dotNet.reflection` 自动导出，DSH 侧需要用户提供程序集信息或已有反射结果。
