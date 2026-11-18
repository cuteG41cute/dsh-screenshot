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

## 1.3.1：桌面壳原生截屏通道（Linux Wayland 的真正解法）

1.2.1 只是让失败**可控**。根因在 WebKitGTK 里：KDE Wayland 上 kwin 的截屏流广播
**可变帧率**（SPA EnumFormat `framerate=0/1`），WebKitGTK 的 GStreamer 胶囊协商直接断言失败——

```
gst_value_collect_int_range: assertion 'collect_values[0].v_int < collect_values[1].v_int' failed
```

于是 `getDisplayMedia()` 永远建不起流。1.3.1 让**桌面壳**绕开视频流：一次拿一张 PNG。

```
页面 grabFrame()
  → 有 window.chrome.webview 桥 → postMessage({type:'dsh-screenshot', id})
  → 桌面壳（Python）调 org.freedesktop.portal.Screenshot（interactive=false）
  → portal 回一张 PNG 的 file:// → 转 data URL → evaluate_javascript 回传
  → 页面 window.__dshShotReply(id, {ok, dataUrl}) → canvas
  → 复用原有框选 / 标注 / 入附件（零改动）
```

| 要点 | 说明 |
| --- | --- |
| 没有桥就原样走浏览器 | 普通浏览器里 `nativeCapture()` 直接 resolve(null)；**1.4.0 起还要求宿主声明 `window.__dshShotNative = true`** |
| 桥失败会回退 | 原生通道报错 → 先 toast 一条原因，再走 `getDisplayMedia`（看门狗仍在） |
| **两个名字** | 注册表 `window.__dshShot[id]`，回传函数 `window.__dshShotReply(id,res)`；同名会让宿主把对象当函数调用，回传静默失败（原型的坑） |
| 超时兜底 | 原生通道 15 秒（1.4.0 从 30 秒收紧）；浏览器通道 45 秒看门狗不变 |

真实 Chromium 里的验证（`node test/browser-compat.mjs`，9/9）：

| 用例 | 结果 |
| --- | --- |
| 宿主回 `{ok:true, dataUrl}` | 拿到 **640×480 canvas**，`getDisplayMedia` **0 次**调用 |
| 宿主回 `{ok:false}` | 回退到浏览器通道（1 次调用拿到 320px），并弹出「原生截屏通道不可用…」toast |
| 无桥（普通浏览器） | 6 项原有用例全部通过，行为未变 |

## 1.4.0：Linux 实机验证 + 两处跨平台修复

1.3.1 的原生通道是在 Linux 上设计的，但此前**没有在真实 Linux 机器上跑过完整链路**。1.4.0 补上了这一步，并修掉过程中暴露的两个真实缺陷。

### 实机验证

环境：**Ubuntu 26.04.1 LTS（GNOME Wayland，内核 7.0.0）+ dsh 0.2.2-rc.1 + Chrome 158**，虚拟机上全新安装插件后，用 CDP 程序化驱动真实浏览器走完整条链路：

| 环节 | 结果 |
| --- | --- |
| boot 图谱 | `dsh-screenshot/client.js&rev=…` 在首页里，探针 `__dshScreenshot.version = 1.4.0` |
| 按钮 | 出现在输入框底部工具栏，文案与 Windows 完全一致 |
| 点击 → 捕获遮罩 | ✅ 整幅默认选中，角标 `1600 × 900`，底部「整幅画面 · Enter / 取消 · Esc」齐全 |
| 标注编辑器 | ✅ 5 个工具（画笔/矩形/圆形/箭头/文字）、6 种颜色、撤销/清空/取消/完成 |
| 真实鼠标事件绘制 | ✅ 画笔折线 + 箭头两笔都落在画布上 |
| 完成 → 附件 | ✅ `[data-composer-card] img` 出现 1 张，`naturalWidth×Height = 1600×900`（**原始分辨率**，不是缩放后的二次截图） |
| toast | ✅ 「截图已加入待发送附件」 |
| 控制台错误 | **0** |

> 测试方法说明：Xvfb 下 Chrome 的 X11 桌面捕获枚举不到源（`getDisplayMedia` 永远 pending、连选择器都不弹），
> 这是无合成器环境的表现，不是插件问题。因此**捕获流的来源**用 Chrome 的 `--use-fake-device-for-media-stream`
> 代替，**插件侧代码路径与真实用户完全一致**（同一个 `getDisplayMedia` 调用、同一套冻结/框选/标注/导出）。
> 真实桌面上的选择器由浏览器自己弹出，用户点一次即可。

### 修复 1：隐藏/被遮挡页面导致截图永久挂起

冻结首帧时用的是 `requestAnimationFrame(() => requestAnimationFrame(resolve))`。**隐藏页面里 rAF 永不触发**——
切到别的标签页再点截图、或窗口被最小化/遮挡时，整个捕获会卡死（`busy` 一直是 true，连看门狗都被节流）。

1.4.0 改成 **rAF + 400ms 定时器兜底**，两条路先到的赢。这是实操中很容易撞到的场景，不只是测试环境的怪癖。

### 修复 2：`window.chrome.webview` 存在 ≠ 宿主支持原生通道

1.3.1 只要看到 `window.chrome.webview` 就 `postMessage` 并等回包。但**Windows 桌面壳（WebView2）也有这个对象**，
却没有处理这个消息的代码——结果是每次点击先干等 30 秒超时、弹一条红色「原生截屏通道不可用」，才回退到 `getDisplayMedia`。

1.4.0 起原生通道必须**由宿主显式声明**：

```js
window.__dshShotNative = true;   // 桌面壳在注入脚本里声明「我能截」
```

没有这个标志就完全跳过原生通道、直接走浏览器捕获（普通浏览器和 Windows 桌面壳都是这条路），超时也缩短到 15 秒。
**对 Windows 用户而言这是修复**：不再有 30 秒空等。

### Linux 安装

```bash
git clone https://github.com/cuteG41cute/dsh-screenshot.git
cd dsh-screenshot
./install.sh                     # 默认 ~/.dsh/profiles/web
./uninstall.sh                   # 卸载（可 --restore-backup 还原）
```

`install.sh` 处理了 0.2.x 的三个现实问题：profile 的 `cordis.patch.yml` 初始是空数组 `[]`（直接追加会破坏 YAML，
现在会先删掉那行再追加）；profile 没有 `node_modules/@deepseek-ai/cordis`（自动软链到 dsh 自带的那份）；
每次安装前把 patch 与旧包备份到 `<profile>/_backup/dsh-screenshot-<时间戳>/`。

### 前置条件（Linux 浏览器访问）

浏览器要能捕获屏幕，需要**系统屏幕共享通道**在跑：

```bash
systemctl --user status xdg-desktop-portal xdg-desktop-portal-gnome pipewire
```

三者都在（Ubuntu 26.04 默认如此）时，点截图会弹浏览器自己的「选择共享内容」对话框，选一次即可。
缺了它们，插件会在 45 秒后给出明确错误，而不是静默卡死——这就是 1.2.1 看门狗存在的意义。

## 1.4.1：截图不再把目标窗口顶到最前（Conditional Focus）

**症状**：截完一个后台窗口后，那个窗口会跳到最前面并停在最上层，用户得再点回浏览器才能继续干活。

**原因不在插件**：Chromium/Edge 从 109 起实现了 *Conditional Focus*，`getDisplayMedia()` 的**默认行为是把用户刚选的屏幕/窗口带到前台**
（见 [Chromium CL: Bring Aura Window To Front When Sharing](https://codereview.chromium.org/2617613002)）。
这是为视频会议设计的（共享谁就看谁），但对截图工具来说正好相反——我们要的是「不动用户的窗口堆叠」。

**修法**：显式关掉这个焦点转移。

```js
const controller = new CaptureController();
controller.setFocusBehavior('no-focus-change');   // 调用 getDisplayMedia 之前
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, controller });
// Promise resolve 后再设一次（规范允许的另一个时机；屏幕源会抛异常，忽略即可）
```

按 [MDN](https://developer.mozilla.org/en-US/docs/Web/API/CaptureController/setFocusBehavior) 的语义，这两个时机都合法，插件两处都设了，避免不同版本实现只认其中一个。

**A/B 实测**（Edge 158，同一个源窗口 `window:8589510:0`，捕获后 2.4 秒内每 200ms 采样 `document.hasFocus()`）：

| 轮次 | 捕获前 | 捕获后 12 个采样点 |
| --- | --- | --- |
| 不加控制器（默认） | `true` | **`false` × 12** —— 目标窗口被顶到前台 |
| 加 `no-focus-change` | `true` | **`true` × 12** —— 焦点不动，窗口堆叠保持原样 |

**兼容性**：`CaptureController` 目前只有 Chromium 系（Chrome / Edge 109+）支持；Firefox/Safari 没有这个 API，
插件会自动降级为原来的行为（不传控制器参数），截图功能不受影响，只是仍可能被顶到前台。
捕获**整个屏幕**时本来就没有可聚焦的窗口，所以不受此问题影响。

**回归测试**：`node test/bundle-smoke.mjs` 新增一项，用桩 `CaptureController` 断言「控制器被传进 `getDisplayMedia`、两种时机都设了 `no-focus-change`」；
并顺带修掉了测试框架里**异步检查假通过**的漏洞（以前把 Promise 当结果记成 PASS）。

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
