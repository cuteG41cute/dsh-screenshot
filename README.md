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
window.__dshScreenshot.version                                      // → '1.2.0'

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
node test/bundle-smoke.mjs    # 8 项检查：bundle 加载 / 槽位注册 / 渲染 / 附件注入
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
├── test/bundle-smoke.mjs     # 离线自检（8 项）
├── install.ps1
├── uninstall.ps1
└── README.md
```

MIT License.
