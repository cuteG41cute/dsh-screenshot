# dsh-screenshot

> 仓库：<https://github.com/cuteG41cute/dsh-screenshot>

DeepSeek Harness 静态插件：在**会话输入框底部工具栏**（与「+」和回形针**同一排、紧挨回形针右侧**）加一个截图按钮。点击后选择屏幕/窗口，**直接回车即为整幅截图**，也可拖拽框选局部；截图按捕获分辨率 1:1 转成 PNG 自动加入**待发送附件**，与手动粘贴/附加图片完全同一条管线。

**特性**

- 📷 **就在手边** —— 按钮与「+」「📎」同排同高，14px 图标，零学习成本；
- ⚡ **两步出一张图** —— 选窗口 → 回车（整幅），不用先框选再确认；
- ✏️ **可直接批注** —— 画笔 / 矩形 / 圆形 / 箭头 / 文字，6 种颜色，撤销 + 清空；
- 🖼️ **原图画质** —— 标注是矢量重绘后按原生分辨率合成，不是把缩放后的画面再截一次；
- 📎 **走产品自己的附件管线** —— 复用输入框的图片校验、数量/体积上限与上传流程，发送与否仍由你决定；
- 🔒 **不联网** —— 插件自身不发起任何网络请求、不落盘，只把字节交给输入框。

## 效果

```
┌──────────────────────────────────────────────┐
│  [输入框]                                     │
│  ⊕  📎  📷  │  权限 ▾   /plan ▾              │  ← 📷 就是本插件
│                                  [模型] [发送]│
└──────────────────────────────────────────────┘
```

点击 📷 后的流程：

1. 弹出系统的屏幕/窗口选择器（`getDisplayMedia`），选你要截的屏幕或窗口；
2. 画面被**冻结**并全屏显示，**整幅画面已默认选中**（选区左上角实时显示 `宽 × 高` 像素）；
3. 二选一确认选区：
   - **整幅直接用** —— 按 `Enter`、双击画面，或点底部「整幅画面 · Enter」按钮；
   - **只要局部** —— 按住鼠标拖出矩形，松手即确认（单击或微小抖动不会误取消，会保留原选区）；
4. 进入**标注编辑器**，在截图上画重点；
5. 点「**完成 · Enter**」→ 标注合成后的截图进入待发送附件。

### 标注编辑器

| 工具 | 快捷键 | 说明 |
| --- | --- | --- |
| 画笔 | `1` | 自由手绘线条 |
| 矩形 | `2` | 框住一块区域 |
| 圆形 | `3` | 圈出某个控件/图标 |
| 箭头 | `4` | 指向具体位置，带实心箭头 |
| 文字 | `5` | 点一下落一个文字框，输入后回车确认（文字带描边，深色浅色背景都看得清） |

工具栏还有 **6 种颜色**（红/黄/绿/蓝/白/黑）、**撤销**（`Ctrl+Z`）、**清空**、**取消**（`Esc`）。

标注以矢量形式保存、每次都从原图重绘，所以撤销/清空是精确的，导出的是**原始分辨率**的合成图（不是把缩放后的画面再截一次）。线宽与字号按截图尺寸自动计算，小图大图都不会太细或太粗。

免步骤快捷键：**Alt + 点击 📷** —— 选完屏幕或窗口直接整幅进附件，跳过框选和标注。

## 安装

```powershell
git clone https://github.com/cuteG41cute/dsh-screenshot.git
cd dsh-screenshot
powershell -ExecutionPolicy Bypass -File install.ps1
```

它会：
- 把 `static/` 装到 `<profile>\node_modules\dsh-screenshot\`；
- 在 `<profile>\cordis.patch.yml` 末尾追加一行组合条目；
- 覆盖前把原文件备份到 `<profile>\_backup\dsh-screenshot-<时间戳>\`。

**然后必须重启 harness 进程**（关闭并重新启动 `dsh web` / 桌面版）——组合变更在启动时读取。浏览器标签刷新不够。

## 验证

重启后，在页面里按 F12 打开控制台：

```js
// 1. 模块进了 boot 图谱
window.__DSH_BOOT__.entries.some(e => e.id === 'dsh-screenshot')   // → true

// 2. 探针可用
window.__dshScreenshot.version                                      // → '1.2.1'

// 3. 按钮在 DOM 里（输入框同排）
document.querySelector('[data-dsh-screenshot="button"]')            // → <button>

// 4. 不想点击也能测捕获链路
const blob = await window.__dshScreenshot.captureRegion();          // 框选/回车后返回 PNG Blob

// 5. 只测遮罩交互（不需要屏幕捕获权限，用任意 canvas 当背景）
const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
await window.__dshScreenshot.pickRegion(c);                         // 回车 → 整幅 rect；拖拽 → 局部 rect；Esc → null
```

服务端侧（无需登录的路径）：

```powershell
curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3080/plugins/dsh-screenshot/client.js   # → 200
```

离线自检（不需要浏览器/harness）：

```powershell
node test/bundle-smoke.mjs      # 10 项：bundle 加载 / 槽位注册 / 渲染 / 附件注入 / 捕获分支
node test/browser-compat.mjs    # 7 项：真实 Chromium 里跑完整捕获链路（Windows 基线）
```

## 实现要点

| 关注点 | 做法 |
| --- | --- |
| 按钮位置 | 注册进 `conversation.input.left` 槽位——产品把该槽渲染在输入框底部工具栏内、`+` 与回形针之后 |
| 截图 | `navigator.mediaDevices.getDisplayMedia()` 取流 → 首帧冻结到离屏 canvas → 自绘全屏遮罩框选 → 按捕获像素 1:1 裁切 |
| 加入附件 | 直接驱动输入框自己的隐藏 `input[type="file"]`（回形针按钮用的同一个入口）并派发冒泡 `change`，因此复用产品的类型校验、图片数量/体积上限与上传流程；失败时退化为向编辑器派发合成 `paste` 事件 |
| 失败可见 | 任何异常都会弹出提示条（找不到入口/输入框繁忙/捕获失败），不做静默失败 |
| 隐私 | 插件自身不联网、不落盘，只把字节交给输入框，发送与否由用户决定 |

Host 半部（`lib/index.js`）不做事：整个功能都在浏览器侧，它存在只是为了让组合能加载这个包、从而让客户端 bundle 进入 boot 图谱。

## Linux 环境适配（1.2.1）

在 **WebKitGTK 桌面壳**（Linux 版 dsh-desktop）上，点截图按钮可能**一直转圈**：

- 插件用 `navigator.mediaDevices.getDisplayMedia` 取画面；Windows 的 WebView2（Chromium）这条路成熟，
  Linux 的 WebKitGTK 需要 `xdg-desktop-portal` → PipeWire → 合成器；
- 该系统链路损坏时（日志：`Unable to open pipewire remote: 已到超时限制`，随后 `OverconstrainedError`），
  **请求会永久挂起**；1.2.0 对此没有兜底，按钮 `busy` 永远是 true，也没有任何提示。

1.2.1 的处理（只改 `static/lib/client.js`，宿主端 `lib/index.js` 未动）：

| 改动 | 作用 |
| --- | --- |
| **45 秒看门狗** | `getDisplayMedia` 既不 resolve 也不 reject 时强制结束，按钮恢复并弹出说明性提示 |
| **约束降级重试** | 先带 `selfBrowserSurface:"exclude"`；被引擎拒绝时退回 `{video:true,audio:false}` 再试一次 |
| **错误分类** | `describeCaptureError()` 把 `OverconstrainedError` / `NotFoundError` / `NotReadableError` / `SecurityError` 映射成可操作的中文提示（含 Linux 通道排查指引） |
| **能力检查前移** | `grabFrame()` 自身也检查 `getDisplayMedia` 是否存在（原来只在 `captureRegion` 检查） |
| 取消语义不变 | 用户关掉选屏框（`NotAllowedError` / `AbortError`）静默返回 `null`，不算错误 |

> ⚠️ 这属于「环境不适配」的**可控失败**：它让插件在链路坏掉时给出明确原因，**不等于截图就能用了**。
> 要让截图真正工作，仍需修好系统屏幕共享链路（KDE：`xdg-desktop-portal` + `xdg-desktop-portal-kde` + `PipeWire` 齐全并运行），
> 或者用 Chromium 内核浏览器访问 Web 版。

## Windows / Chromium 兼容性（1.2.1 同版验证）

1.2.1 的修复是从 Linux 侧提出的，但**只有一条代码线**，不是 Linux 分支。理由与证据：

| 验证 | 手段 | 结果 |
| --- | --- | --- |
| 完整捕获链路 | 真实 Chromium（Edge 156 headless）+ CDP，用 `canvas.captureStream()` 提供**真 MediaStream**，跑 `video.play() → videoWidth → drawImage → canvas` | **250 ms** 拿到 640×480 画面，只调用 1 次 `getDisplayMedia`（无多余重试） |
| 约束未被改动 | 断言首次调用参数仍是 `{video, audio, selfBrowserSurface:'exclude'}` | 通过 |
| 用户取消 | `getDisplayMedia` 抛 `NotAllowedError` | 1 ms 返回 `null`，1 次尝试，不弹错 |
| 约束降级 | 首次抛 `OverconstrainedError`，第二次成功 | 第 2 次参数严格等于 `{video:true,audio:false}` |
| 硬失败提示 | 抛 `NotFoundError` | 中文提示「未找到可捕获的屏幕/窗口源」，不挂起 |
| 死链路兜底 | `getDisplayMedia` 永不返回（看门狗临时缩到 700 ms 测） | 715 ms 抛超时、只尝试 1 次、不再重试 |
| 无 API 环境 | `navigator.mediaDevices` 缺失 | 「当前环境不支持屏幕捕获」，不抛栈 |
| 挂载契约 | `apply()` 注册 `conversation.input.left#dsh-screenshot`、按钮可渲染、探针 6 个键 | 与 1.2.0 一致 |

```
node test/browser-compat.mjs
# 7/7 PASS  engine: HeadlessChrome/156 Edg/156  (Windows NT 10.0; Win64; x64)
```

三条改动都是**只在异常/超时才走**的兜底路径：Windows 正常路径上 `getDisplayMedia` 立即 resolve，
看门狗被 `clearTimeout`（实测 250 ms 完成），约束降级分支永不进入。因此不需要分叉分支；
`main` 同时是 Linux 与 Windows 的发布线。

## 已知限制

- **必须重启一次 harness**：静态插件在启动时装载，无法在会话内热加。
- 桌面版（WebView2）里 `getDisplayMedia` 的可用性取决于本机 WebView2 运行时；若不可用，点击按钮会明确报「当前环境不支持屏幕捕获」，不会静默。此时可改用**原生捕获方案**（桌面壳 C# 抓屏 + 遮罩框选，单步、无选择器对话框），需要改 `dsh-desktop\App.cs` 并重装桌面版。
- 子会话（subagent）输入框被禁用时不接受附件，会提示「输入框当前不接受附件」。
- 选择器里默认排除「当前标签页」（`selfBrowserSurface: 'exclude'`），避免拍到 harness 自己。

## 卸载 / 回滚

```powershell
powershell -ExecutionPolicy Bypass -File uninstall.ps1                 # 删除包 + 组合行
powershell -ExecutionPolicy Bypass -File uninstall.ps1 -RestoreBackup  # 从最近备份还原 cordis.patch.yml
```

重启 harness 后生效。

## 目录

```
dsh-screenshot/
├── static/
│   ├── package.json          # 包清单，声明 dsh.client → lib/client.js
│   └── lib/
│       ├── index.js          # Host 半部（惰性）
│       └── client.js         # 浏览器 bundle：按钮 + 框选遮罩 + 附件注入
├── test/
│   ├── bundle-smoke.mjs      # 离线自检（10 项，无需浏览器）
│   └── browser-compat.mjs    # 真实 Chromium 捕获链路（7 项，Windows 兼容基线）
├── tools/
│   └── upgrade-installed.ps1 # 把已安装的包同步到仓库版本（备份 + sha256 + 校验模式）
├── install.ps1
├── uninstall.ps1
└── README.md
```

## 升级已安装的包（Windows）

不用重装整个插件，直接同步 `static/` 到已安装目录（会先备份）：

```powershell
powershell -ExecutionPolicy Bypass -File tools\upgrade-installed.ps1          # 复制
# 重启 harness
powershell -ExecutionPolicy Bypass -File tools\upgrade-installed.ps1 -Verify  # 校验 sha256
```

`-Verify` 只比对磁盘文件；运行态请在页面控制台看 `window.__dshScreenshot.version`。

MIT License.
