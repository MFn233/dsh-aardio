# 无头验证：让用户在 IDE 里跑一份结构化测试

aardio 没有无头命令行入口，所以「验证」只有两条路：**桥接开着就自己跑，没开就让用户在 IDE 里按 F5**。两条路都用 aardio 自带的 `util.testRunner`（AA / autos 自己就用它），把结论变成一段可粘贴的 JSON，而不是一张截图。

## 路径一：桥接开着 → 自己跑

用户启动过 `bridge/aardioBridge.aardio`（IDE 里 F5，窗口留着）时，直接调 `aardio_exec`：

```text
aardio_exec({ code: "import console; var a=1+1; print(a); return a;" })
aardio_exec({ path: "/path/to/foo.test.aardio" })
aardio_exec({ code: "var a = ", mode: "check" })   // 只编译，不执行
```

返回里有 `print`（收集到的输出行）、`result`（`return` 值的 JSON）、`compileError`/`error`。

**GUI 冒烟不要改源文件**：用 `replace` 在内存里把 `win.loopMessage();` 换成有限步骤，编译前替换、必须恰好命中一次：

```text
aardio_exec({
  path: "/path/to/demo.aardio",
  replace: {
    oldCode: "win.loopMessage();",
    newCode: "thread.delay(400); var bmp = winform.btn.snap(); bmp.save(io.fullpath(string.getenv(\"TEMP\") ++ \"\\smoke.png\")); winform.close(); return \"closed\";"
  }
})
```

**超时不等于停止**：代码超过 `timeoutMs` 仍在跑时，回复里会带 `jobId`；用 `aardio_exec({ jobId })` 继续等。死循环只能让用户在 IDE 里停止。

## 路径二：桥接没开 → 交给用户

写一份 `xxx.test.aardio`，让用户 F5，把 JSON 贴回来。

## 为什么优先无头

- 截图、模拟鼠标、视觉识别是**阻塞且易错**的验证方式，用户也可能同时动那台电脑。
- 纯逻辑、字符串处理、文件读写、算法、像素运算都能在无头环境里断言。
- 失败报告带**源文件与行号**，比"看起来不对"可修得多。

## 最小可运行模板

把下面这段放进用户工作区的 `xxx.test.aardio`，让用户 F5：

```aardio
import util.testRunner;
import JSON;

var $ = util.testRunner("排序与路径-test");

$.test(#"abc" == 3, "字符串长度");
$.expect(1 + 1, 2, "整数加法");
$.expectNear(0.1 + 0.2, 0.3, "浮点近似", 1e-9);
$.contains("hello world", "lo wo", "子串包含");
$.match("2026-11-14", "^\d+-\d+-\d+$", "日期模式");
$.throws(function(){ error("boom") }, "应抛出错误");
$.notThrows(function(){ return 1 }, "不应抛出");

var report = $.report();
print(JSON.stringify(report));   // IDE 输出窗口里可见，便于用户整段贴回
return report;
```

请用户把 `print` 打印的那行 JSON（或报错原文 + 行号）贴回来。

## API

| 调用 | 用途 |
|---|---|
| `util.testRunner(name?)` / `util.testRunner(options)` | 新建套件；`options` 可含 `suiteName`、`maxDepth`、`maxItems`、`maxStringBytes`、`maxBufferBytes` |
| `$.test(condition, name, detail?)` | 布尔断言 |
| `$.expect(actual, expected, name)` | 全等或 JSON 序列化后相等 |
| `$.expectNear(actual, expected, name, tolerance?)` | 浮点近似，默认 `1e-6` |
| `$.contains(container, expected, name)` | 字符串子串，或表/数组包含某值 |
| `$.match(str, pattern, name)` | aardio 模式匹配（不是 PCRE） |
| `$.throws(fn, name, expectedPattern?)` | 期望抛出错误，可用模式匹配错误文本 |
| `$.notThrows(fn, name)` | 期望不抛出 |
| `$.assert(condition, name, detail?)` | 失败即中断（会 `error`） |
| `$.fail(name, detail)` | 显式记一条失败 |
| `$.log(value, message?)` | 只记录观察值，不计入通过/失败 |
| `$.report()` | 返回 `{suiteName,total,passed,failed,success,durationMs,results[]}` |

报告里的 `results` 每条失败项带 `file` / `line` / `expected` / `actual`（`testRunner` 用 `debug.queryinfo` 抓的栈信息）。

## 常见验证场景

纯函数与算法——直接断言返回值，不要构造界面。

文件读写——用工作区里的临时子目录，测完删掉：

```aardio
import fsys;
var dir = io.fullpath("/.test-tmp/");
fsys.createDir(dir);
string.save(dir ++ "a.txt", "hello");
$.expect(string.load(dir ++ "a.txt"), "hello", "文件往返");
fsys.delete(dir);
```

离屏像素——用 `gdip` 在内存位图上验证绘制，不显示窗口：

```aardio
import gdip;
var bmp = gdip.bitmap(40, 30);
var g = gdip.graphics(bmp);
var brush = gdip.solidBrush(0xFFFF0000);
g.fillCircle(brush, 10, 10, 5);
var argb = bmp.getPixel(10, 10);
$.expect(argb, 0xFFFF0000, "圆心被填充");
```

GUI 冒烟——**不要写 `win.loopMessage()`**（会一直阻塞到窗口关闭；桥接不会自动覆盖它）。源文件保留它给用户运行，另外写一份冒烟副本把消息泵换成有限步骤：

```aardio
winform.show();
thread.delay(1000);                     // 先让消息泵跑起来，再操作
winform.plus.click(20, 15);             // 客户区坐标
var bmp = winform.plus.snap();          // 双缓冲截图，依赖 WM_PAINT
winform.close();                        // 不进 win.loopMessage()
$.test(bmp != null, "控件截图非空");
```

## 只给人跑的用例

如果要交付一份"用户自己点着看"的测试，用 `console.test` / `console.expect` / `console.contains` 这套交互式断言（会打开控制台），不要交给 `util.testRunner`——它没有控制台输出。

## 报告给模型时的取舍

- 用户只需要贴回：`print` 的 JSON、或 IDE 报错的第一行 + 行号。
- 不要要求用户截整屏；不要根据外观猜测通过与否。
- 失败后先修，再让他重跑同一份文件；不要每次换一套用例。
