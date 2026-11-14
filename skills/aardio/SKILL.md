---
name: aardio
description: "Use when writing, reviewing, or debugging aardio code (.aardio), or when a task involves aardio standard libraries, GUI (win.form), console programs, or the aardio IDE. 涉及 aardio 代码的编写、修改、排查时使用。"
---

# aardio 编程

## 核心原则：先查本地文档，再写代码

aardio 是闭源小众语言，模型训练数据里正确样本极少，凭记忆写 API 必然编造。任何超出基础语法的库/函数，**先在本机文档里确认存在与签名**，再写。

资料根目录：本机 aardio 安装目录（含 `aardio.exe`，由插件设置或自动探测决定，**不要写死路径**）。先用 `aardio_env` 工具拿到实际路径；找 API 优先用 `aardio_docs` 工具，而不是自己拼绝对路径。

下表所有相对路径都相对这个安装目录。

| 要找什么 | 去哪看 |
|---|---|
| 总入口、语言简介 | `docs\index.md` |
| 语法（基础语法、命名空间、类、数据类型、运算符、语句、模板） | `docs\language-reference\`：`basic-syntax.md`、`namespace.md`、`class\`、`builtin-function\`、`operator\`、`statements\`、`templating\` |
| 某个库的 API 参考 | `docs\library\<库名>\index.md`（如 `docs\library\fsys\index.md`） |
| 某个库的用法指南与示例 | `docs\library-guide\`：`builtin\`、`std\win\ui\`、`std\inet\`、`ext\python\` 等 |
| 工程文件、JSON、协议规范 | `docs\specs\`：`aproj.md`、`JSON.md`、`AASDL.md` |
| 官方 AI 系统提示词（语法陷阱大全，3400+ 行） | `docs\guide\ide\system-prompt.md` |
| 可运行范例 | `examples\`（24 组：Console、Web、Network、Database、COM、Windows、WebUI、Automation、Snippets…） |
| 标准库实现源码（`import` 的库都在这里） | `lib\<库名>\_.aardio` 或 `lib\<库名>.aardio` |
| 真实工程模板 | `project\HostEditor\`（含 `default.aproj` + `main.aardio` 实例） |

检索方式：不确定函数名先用 `aardio_docs` 工具按关键字搜。它支持多关键词（默认全部命中才算候选）、`"引号短语"` 相邻匹配、`-词` 排除，返回带上下文并已排序的命中；找不到时自动放宽为「任一命中」。命中后再用 `aardio_docs` 的 `path` 参数直接读该文件（不依赖文件工具能否访问安装目录），读对应 `index.md` 确认签名。

## 语法铁律（违反必错）

1. **字符串引号（最高频错误）**
   - 单引号 = 编译期转义：`'a\nb'` 是换行；`'\r\n'`、`'\0'`、`'\x41'`、`'\uF002'` 必须写在单引号里。
   - 双引号 / 反引号 = 原样字面值：`"\n"` 是两个字符 `\` 和 `n`。路径与模式匹配用双引号，**不要转义反斜杠**：`io.createDir("C:\folder\example\")` ✅，`"C:\\folder\\"` ❌。
   - 字符串里要含双引号时，优先用单引号或反引号包外层。
2. **对象没有方法**：`buf.hex()` ❌ → `string.hex(buf)` ✅；表、数组、buffer、字符串一律走内置库函数。
3. `#` 取长度；表索引从 1 开始。
4. 函数可返回多值：`var a,b = f()`。表构造器 `{k=v; k2=v2}` 的元素分隔符之间**不能留空**（`{1,,2}` ❌）；但调用实参可以留空（`print(1,,3)` 等价于中间传 `null`）。
5. 形参默认值只能是布尔/字符串/数值**字面值**；形参里**禁止**声明 `owner`（隐式传递，不占形参位置）。
6. `lambda` 主体是单个表达式，必须省略 `return`，只返回一个值：`lambda(a,b) {a,b}` 返回一个表对象（这里 `{}` 是表字面量，不是语句块）。
7. 字面量使用一元/下标操作符必须加括号：`([1,2,3])[1]` ✅，`[1,2,3][1]` ❌；`(function(){})()` ✅，`function(){}()` ❌。
8. 除函数调用外，表达式不能独立成句：`num + 1;` ❌ → `num = num + 1;`。
9. `class` 有 `ctor` 时必须写在所有成员之前，且 `ctor` 不能调用后面才定义的成员。
10. `namespace` / `class` 内访问全局对象要加 `..`：`..print(...)`、`..string.format(...)`；保留函数（`type`、`loadcode`、`loadcodex`、`eval`、`execute`、`error`、`assert`、`call`、`invoke`、`rget`、`switch`、`reduce`、`sleep`、`tostring`、`tonumber`、`topointer`）不加。
11. **不要拿 try/catch 当异常流**：它本质是立即执行的匿名函数，内部 `return` 退不出外层函数，且没有 `finally`。标准错误处理是检查 `null, err` 返回值。
12. `call(fn, owner, ...args)` 第 2 个参数固定是 `owner`，没有 owner 必须显式传 `null`，否则实参整体错位；返回的第 1 个值只是执行状态，不是业务数据。
13. **别过度防御**：构造 `win.form()`、`inet.http()`、`web.rest.aiChat()` 这类内置对象不会失败，不需要判空或包 try。
14. 路径语义：`/` 开头 = 应用程序基准目录（工程根；在编辑器里运行未保存代码时指 `aardio.exe` 目录）；`~/` 或 `~\` = `aardio.exe` 所在目录。

## 常用骨架

窗口程序：

```aardio
import win.ui;
/*DSG{{*/
var winform = win.form(text="标题";right=600;bottom=400)
winform.add()
/*}}*/

winform.show();
win.loopMessage();
```

控制台程序：

```aardio
import console;
console.log("hello");
console.pause();
```

`/*DSG{{*/ ... /*}}*/` 是窗体设计器区域，改代码时保持整块完整，不要打散或重排。

## 工作流

1. **工程先由用户在 IDE 里建好，再动代码。** 任务涉及 `.aproj` 工程时，第一步不是写文件，而是确认工程存在且是 IDE「新建工程」生成的；
   没有就请用户先建一个，然后再改 `main.aardio`、`lib/`、`res/`、`dlg/`。
   - **不要手写或手改 `default.aproj`**：IDE 打开工程时会用内存配置把它整个覆盖掉，改了也白改；
     模板还会一并生成 `.build/`、Manifest、图标引用等，手搓容易漏。
   - 工程属性里的**图标、版本号、公司名、输出名**也在 IDE 里改并保存；`icon` 用相对工程根目录的路径（如 `res\icon.ico`）。
   - 判断信号：工程目录里有 `.build/`、`default.aproj` 的 `ver` 是较新的模板版本、`icon` 有值而不是 `"..."`。
   - 典型症状：改了 `icon=` 不生效、图标选不上、发布出来的 exe 没有版本信息 —— 基本都是没走 IDE 建工程。
2. 拆任务 → 用 `aardio_docs` 定位涉及的库与函数（多关键词 / 引号短语），再用 `path` 参数读 `index.md` 确认签名，必要时在 `examples\` 找可运行写法。
3. 在用户工作区写 `.aardio` 文件。**不要**往 aardio 安装目录里写文件，那是只读安装目录。
   改过工程的 `dlg/` 或 `lib/` 之后，**提醒用户回 IDE 手动同步/刷新**（重开工程或重启 IDE），否则 IDE 缓存会让你和他看到的报错都来自旧版本。
4. 自检一遍：引号、`null,err`、1-based、有没有写成 `obj.method()`、命名空间里少了 `..`。
5. **验证：写一份无头测试，而不是靠截图。** 用 aardio 自带的 `util.testRunner` 写 `xxx.test.aardio`（模板与 API 见本技能 `references/headless-tests.md`），`print(JSON.stringify($.report()))` 后让用户在 IDE 里 F5，把 JSON 或报错行号贴回来。纯逻辑、文件、算法、离屏像素都能这样验；GUI 冒烟用有限步骤，**不要写 `win.loopMessage()`**。
   DSH 没有 aardio 编译器，确实不能自己跑；但不要就此停在"无法验证"——要么给可运行测试，要么明确说明哪部分只能由用户验证。
6. 断言失败就修，然后让用户重跑同一份测试文件；不要每次换新用例，也不要凭外观猜测通过与否。

## 反模式

- 凭"别的语言大概有"编 API → 一律先用 `aardio_docs` 在本机文档里确认。
- 抢在用户前面手写 `default.aproj`，或趁 IDE 开着改工程属性 → 会被覆盖，图标和版本号白设。
- 改完 `dlg/`、`lib/` 就催用户运行 → 没让他在 IDE 里同步刷新，旧缓存会把失败说成成功、或反过来。
- 把 Python / JS 习惯带进来：`obj.method()`、`None`、`++i`、`try/finally`、列表推导、`len()`。
- 把官方文档原文大段抄进回复或产物。

## 版权

`docs\index.md` 明确禁止单独分发与搬运 aardio 官方文档（包括由 AI 搬运）。本技能只做**索引与摘要**，细节以本地文档为准；不要把文档原文成段复制到交付物里。
