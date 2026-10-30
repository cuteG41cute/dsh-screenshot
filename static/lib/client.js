// dsh-screenshot — Client half (static / composition plugin)
//
// Browser bundle consumed by the client module loader (window.__ModuleLoader__).
//
// What it does
// ------------
// Registers one button into the composer's `conversation.input.left` slot.
// The composer renders that slot inside the bottom tools row, immediately
// AFTER the "+" (commands) and paperclip (attach) buttons — same row, same
// height, same 14px icon size.
//
// Click flow:
//   1. navigator.mediaDevices.getDisplayMedia() lets the user pick a screen
//      or window (browser/WebView2 picker).
//   2. The first frame is frozen into an offscreen canvas and shown full-screen
//      (letterboxed, never upscaled past fit) by this plugin's own overlay.
//      The WHOLE frame starts already selected.
//   3. Either confirm as-is — Enter, double-click, or the "整幅画面" button —
//      or drag a smaller rectangle (Esc / right-click cancels).
//   4. The chosen crop opens in the ANNOTATION EDITOR: freehand pen, rectangle,
//      ellipse, arrow, and text, in six colours, with undo and clear. Every
//      annotation is kept as a vector and the canvas is repainted from scratch,
//      so undo/clear are exact and the export is rendered at native resolution.
//   5. Confirming the editor renders the annotated crop into a PNG File and
//      feeds it into the composer's own attachment intake — the hidden
//      `input[type="file"]` that the paperclip button drives — so the image
//      lands in the pending draft attachments exactly like an attached or
//      pasted image (same size/type limits, same upload path).
//
// Alt+click on the button skips BOTH steps: whatever surface the picker returns
// is attached whole and unannotated (one gesture, for the "just grab it" case).
//
// Keyboard: 1-5 pick a tool, Ctrl+Z undoes, Enter confirms, Esc cancels.
//
// Nothing is sent anywhere by this plugin: it only hands bytes to the
// composer, which owns submission.
//
// Failure policy: never silent. Every failure path surfaces a toast, and the
// capture helpers are exposed on window.__dshScreenshot for console testing.
window.__ModuleLoader__.load({
  id: 'dsh-screenshot',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
    let react = require('react');

    const inject = ['slots'];

    const VERSION = '1.2.1';
    const STYLE_TAG_ID = 'dsh-screenshot/styles';
    const BTN_CLASS = 'dsh-screenshot-btn';
    const PLUGIN_ID = 'dsh-screenshot';
    /** Below this (in captured pixels) a drag counts as a click, not a crop. */
    const MIN_REGION = 4;
    /** Annotation colours, first one is the default. */
    const PALETTE = ['#ff3b30', '#ffd60a', '#34c759', '#0a84ff', '#ffffff', '#000000'];
    /** Annotation tools, in toolbar order; `key` is the keyboard shortcut. */
    const TOOLS = [
      { id: 'pen', label: '画笔', key: '1' },
      { id: 'rect', label: '矩形', key: '2' },
      { id: 'ellipse', label: '圆形', key: '3' },
      { id: 'arrow', label: '箭头', key: '4' },
      { id: 'text', label: '文字', key: '5' },
    ];

    /* ------------------------------------------------------------------ *
     * styles
     * ------------------------------------------------------------------ */

    function installStyles() {
      if (typeof document === 'undefined') return;
      if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]') !== null) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = PLUGIN_ID;
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = [
        '.' + BTN_CLASS + '{box-sizing:border-box;width:28px;height:28px;flex:none;display:grid;place-items:center;',
        'padding:0;border:none;border-radius:8px;background:transparent;cursor:pointer;',
        'color:var(--dsw-alias-label-tertiary,#8a8a8a);transition:background-color .12s,color .12s}',
        '.' + BTN_CLASS + ':hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14));',
        'color:var(--dsw-alias-label-primary,#222)}',
        '.' + BTN_CLASS + ':disabled{opacity:.45;cursor:default}',
        '.dsh-screenshot-spin{animation:dsh-screenshot-spin 1s linear infinite}',
        '@keyframes dsh-screenshot-spin{to{transform:rotate(360deg)}}',
      ].join('');
      document.head.appendChild(tag);
    }

    /* ------------------------------------------------------------------ *
     * transient toast (the composer exposes no toast channel to plugins)
     * ------------------------------------------------------------------ */

    function toast(text, isError) {
      if (typeof document === 'undefined' || document.body === null) return;
      const el = document.createElement('div');
      el.setAttribute('data-dsh-screenshot-toast', isError === true ? 'error' : 'info');
      el.textContent = text;
      el.style.cssText = [
        'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483001;',
        'max-width:80vw;padding:8px 16px;border-radius:10px;pointer-events:none;',
        'background:' + (isError === true ? 'rgba(180,35,35,.94)' : 'rgba(24,24,24,.9)') + ';color:#fff;',
        'font:13px/20px Inter,system-ui,-apple-system,"Segoe UI",sans-serif;',
        'box-shadow:0 6px 24px rgba(0,0,0,.28);transition:opacity .25s;opacity:1;',
      ].join('');
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 300);
      }, isError === true ? 4200 : 1800);
    }

    /* ------------------------------------------------------------------ *
     * capture
     * ------------------------------------------------------------------ */

    /** Poll one predicate until it holds or the budget runs out. */
    function waitFor(predicate, timeoutMs) {
      return new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
          let ok = false;
          try {
            ok = predicate();
          } catch (error) {
            ok = false;
          }
          if (ok === true) {
            resolve(true);
            return;
          }
          if (Date.now() - started > timeoutMs) {
            resolve(false);
            return;
          }
          setTimeout(tick, 50);
        };
        tick();
      });
    }

    /**
     * Watchdog for getDisplayMedia: on engines whose screen-capture backend is
     * broken (e.g. WebKitGTK when the ScreenCast portal or PipeWire socket is
     * unavailable) the promise neither resolves nor rejects â it hangs forever
     * and the composer button spins indefinitely. A pending system picker also
     * looks identical from JS, so the budget is generous (45s) and the error
     * text tells the user what to check instead of leaving a stuck button.
     */
    const CAPTURE_WATCHDOG_MS = 45000;

    /** Map a raw getUserMedia/getDisplayMedia failure to an actionable message. */
    function describeCaptureError(error) {
      const name = error && error.name !== undefined ? String(error.name) : '';
      const detail = error && error.message !== undefined && error.message !== '' ? '：' + String(error.message) : '';
      if (name === 'OverconstrainedError') {
        return '屏幕捕获被拒绝（' + name + '）：当前浏览器引擎的屏幕共享后端不可用。'
          + 'Linux/WebKitGTK 下请确认 xdg-desktop-portal 与 PipeWire 正常运行；或改用 Chrome/Edge 等浏览器访问本页面。';
      }
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return '未找到可捕获的屏幕/窗口源' + detail + '。';
      }
      if (name === 'NotReadableError' || name === 'TrackStartError') {
        return '屏幕捕获源无法读取（可能被其他程序占用）' + detail + '。';
      }
      if (name === 'SecurityError') {
        return '当前页面环境不允许屏幕捕获（需要安全上下文）' + detail + '。';
      }
      return '屏幕捕获失败（' + (name !== '' ? name : '未知错误') + '）' + detail + '。';
    }

    /**
     * One getDisplayMedia attempt with a watchdog, resolved with the frozen
     * first frame. Rejects with the raw error (or a timeout Error).
     */
    function grabFrameOnce(options) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn, value) => {
          if (settled === true) return;
          settled = true;
          clearTimeout(watchdog);
          fn(value);
        };
        const watchdog = setTimeout(() => {
          settle(reject, new Error(
            '屏幕捕获请求超时（' + Math.round(CAPTURE_WATCHDOG_MS / 1000) + ' 秒无响应）：'
            + '选屏对话框一直未返回。通常是当前环境的屏幕共享通道不可用'
            + '（Linux/WebKitGTK 需要 xdg-desktop-portal + PipeWire）。'
            + '请检查系统屏幕共享设置，或改用 Chrome/Edge 等浏览器访问本页面。'
          ));
        }, CAPTURE_WATCHDOG_MS);
        navigator.mediaDevices.getDisplayMedia(options).then(async (stream) => {
          try {
            const video = document.createElement('video');
            video.srcObject = stream;
            video.muted = true;
            video.playsInline = true;
            await video.play();
            const ready = await waitFor(() => video.videoWidth > 0 && video.videoHeight > 0, 5000);
            if (ready !== true) throw new Error('无法读取捕获画面的尺寸');
            // Two paint opportunities so the decoder has produced a real frame.
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const frame = document.createElement('canvas');
            frame.width = video.videoWidth;
            frame.height = video.videoHeight;
            frame.getContext('2d').drawImage(video, 0, 0);
            video.srcObject = null;
            settle(resolve, frame);
          } catch (error) {
            settle(reject, error);
          } finally {
            for (const track of stream.getTracks()) track.stop();
          }
        }).catch((error) => settle(reject, error));
      });
    }

    /**
     * Ask for a display surface and freeze its first frame.
     * @returns the frozen frame as a canvas at native captured resolution,
     *          or null when the user dismissed the picker.
     */
    async function grabFrame() {
      if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined
        || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        throw new Error('当前环境不支持屏幕捕获（getDisplayMedia 不可用）');
      }
      // First attempt keeps the original constraints; if the engine rejects them
      // (some WebKit builds choke on selfBrowserSurface) retry once with the
      // bare minimum before reporting failure.
      const attempts = [
        { video: true, audio: false, selfBrowserSurface: 'exclude' },
        { video: true, audio: false },
      ];
      let lastError;
      for (let i = 0; i < attempts.length; i++) {
        try {
          return await grabFrameOnce(attempts[i]);
        } catch (error) {
          const name = error && error.name !== undefined ? String(error.name) : '';
          // A dismissed picker and a hard failure are indistinguishable here;
          // NotAllowedError is the dismissed/cancelled case.
          if (name === 'NotAllowedError' || name === 'AbortError') return null;
          if (error instanceof Error && error.message.indexOf('屏幕捕获请求超时') === 0) {
            throw error; // watchdog fired: no point retrying the same dead backend
          }
          lastError = error;
        }
      }
      throw new Error(describeCaptureError(lastError));
    }

    /**
     * Show the frozen frame full-screen and resolve with the confirmed region in
     * frame pixel coordinates, or null when the user cancels.
     *
     * The whole frame starts selected, so the common case — "I picked the window,
     * I want that window" — is a single Enter / click. Dragging narrows it.
     */
    function pickRegion(frame) {
      return new Promise((resolve) => {
        const fw = frame.width;
        const fh = frame.height;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Letterbox: fit the whole frame, never crop it away.
        const scale = Math.min(vw / fw, vh / fh);
        const dw = Math.max(1, Math.round(fw * scale));
        const dh = Math.max(1, Math.round(fh * scale));
        const offX = Math.round((vw - dw) / 2);
        const offY = Math.round((vh - dh) / 2);

        const overlay = document.createElement('div');
        overlay.setAttribute('data-dsh-screenshot-overlay', '');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#000;cursor:crosshair;user-select:none;';

        const view = document.createElement('canvas');
        view.width = dw;
        view.height = dh;
        view.style.cssText =
          'position:absolute;left:' + offX + 'px;top:' + offY + 'px;width:' + dw + 'px;height:' + dh + 'px;pointer-events:none;';
        view.getContext('2d').drawImage(frame, 0, 0, dw, dh);

        const selection = document.createElement('div');
        selection.style.cssText =
          'position:absolute;border:1.5px solid #4d6bfe;box-shadow:0 0 0 9999px rgba(0,0,0,.55);pointer-events:none;';

        const badge = document.createElement('div');
        badge.style.cssText = [
          'position:absolute;padding:2px 8px;border-radius:6px;',
          'background:rgba(20,20,20,.86);color:#fff;pointer-events:none;white-space:nowrap;',
          'font:12px/18px Inter,system-ui,"Segoe UI",sans-serif;',
        ].join('');

        // ── bottom action bar: the no-drag path ──
        const actions = document.createElement('div');
        actions.setAttribute('data-dsh-screenshot-actions', '');
        actions.style.cssText = [
          'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:2;',
          'display:flex;align-items:center;gap:10px;padding:8px 10px 8px 16px;border-radius:12px;',
          'background:rgba(20,20,20,.88);box-shadow:0 8px 28px rgba(0,0,0,.4);',
          'font:13px/20px Inter,system-ui,"Segoe UI",sans-serif;color:#fff;white-space:nowrap;',
        ].join('');

        const tip = document.createElement('span');
        tip.textContent = '拖动鼠标框选区域，或直接用整幅画面 → 下一步可标注';

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = '取消 · Esc';
        cancelButton.style.cssText = [
          'padding:6px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;',
          'border:1px solid rgba(255,255,255,.28);background:transparent;color:#fff;',
          'font:13px/18px Inter,system-ui,"Segoe UI",sans-serif;',
        ].join('');

        const confirmButton = document.createElement('button');
        confirmButton.type = 'button';
        confirmButton.textContent = '整幅画面 · Enter';
        confirmButton.style.cssText = [
          'padding:6px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;border:none;',
          'background:#4d6bfe;color:#fff;font:600 13px/18px Inter,system-ui,"Segoe UI",sans-serif;',
        ].join('');

        actions.appendChild(tip);
        actions.appendChild(cancelButton);
        actions.appendChild(confirmButton);

        overlay.appendChild(view);
        overlay.appendChild(selection);
        overlay.appendChild(badge);
        overlay.appendChild(actions);

        let dragging = false;
        let settled = false;
        let startX = 0;
        let startY = 0;
        /** Frame-pixel rect confirmed by Enter / the button; starts at the whole frame. */
        let pending = { x: 0, y: 0, w: fw, h: fh };
        /** Rect produced by the in-flight drag, or null while it is still too small. */
        let dragRect = null;

        const cleanup = () => {
          window.removeEventListener('mousedown', onDown, true);
          window.removeEventListener('mousemove', onMove, true);
          window.removeEventListener('mouseup', onUp, true);
          window.removeEventListener('keydown', onKey, true);
          overlay.remove();
        };
        const finish = (value) => {
          if (settled === true) return;
          settled = true;
          cleanup();
          resolve(value);
        };

        /** Clamp one viewport-space drag into the frame: CSS box + frame-pixel rect. */
        const measure = (x1, y1, x2, y2) => {
          const left = Math.max(offX, Math.min(x1, x2));
          const top = Math.max(offY, Math.min(y1, y2));
          const right = Math.min(offX + dw, Math.max(x1, x2));
          const bottom = Math.min(offY + dh, Math.max(y1, y2));
          const w = Math.max(0, right - left);
          const h = Math.max(0, bottom - top);
          const sx = Math.round((left - offX) / scale);
          const sy = Math.round((top - offY) / scale);
          const sw = Math.round(w / scale);
          const sh = Math.round(h / scale);
          const rect = sw >= MIN_REGION && sh >= MIN_REGION
            ? {
                x: Math.max(0, Math.min(Math.max(0, fw - sw), sx)),
                y: Math.max(0, Math.min(Math.max(0, fh - sh), sy)),
                w: Math.min(sw, fw),
                h: Math.min(sh, fh),
              }
            : null;
          return { left, top, w, h, sw, sh, rect };
        };

        /** The CSS box equivalent of one frame-pixel rect. */
        const boxOfRect = (rect) => ({
          left: offX + rect.x * scale,
          top: offY + rect.y * scale,
          w: rect.w * scale,
          h: rect.h * scale,
          sw: rect.w,
          sh: rect.h,
        });

        /** Paint one measured box and its size badge. */
        const render = (box) => {
          selection.style.left = box.left + 'px';
          selection.style.top = box.top + 'px';
          selection.style.width = box.w + 'px';
          selection.style.height = box.h + 'px';
          // Inside the selection's top-left corner: never collides with the bar.
          badge.style.left = box.left + 8 + 'px';
          badge.style.top = box.top + 8 + 'px';
          badge.textContent = Math.max(0, box.sw) + ' × ' + Math.max(0, box.sh);
        };

        /** True when the event started on the action bar (never starts a drag). */
        const onActionBar = (target) => target !== null && target !== undefined
          && typeof target.closest === 'function'
          && target.closest('[data-dsh-screenshot-actions]') !== null;

        function onDown(event) {
          if (onActionBar(event.target) === true) return;
          if (event.button !== 0) {
            event.preventDefault();
            finish(null);
            return;
          }
          dragging = true;
          dragRect = null;
          startX = event.clientX;
          startY = event.clientY;
          render(measure(startX, startY, startX, startY));
          event.preventDefault();
        }
        function onMove(event) {
          if (dragging !== true) return;
          event.preventDefault();
          const box = measure(startX, startY, event.clientX, event.clientY);
          dragRect = box.rect;
          render(box);
        }
        function onUp(event) {
          if (dragging !== true) return;
          dragging = false;
          event.preventDefault();
          if (dragRect !== null) {
            finish(dragRect);
            return;
          }
          // A plain click (or a sub-threshold twitch) must not cancel: restore
          // the selection the user already had and wait for a real decision.
          render(boxOfRect(pending));
        }
        function onKey(event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(null);
            return;
          }
          if (event.key === 'Enter' && dragging !== true) {
            event.preventDefault();
            event.stopPropagation();
            finish(pending);
          }
        }

        cancelButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        });
        confirmButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          finish(pending);
        });

        window.addEventListener('mousedown', onDown, true);
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', onUp, true);
        window.addEventListener('keydown', onKey, true);
        overlay.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          finish(null);
        });
        overlay.addEventListener('dblclick', (event) => {
          event.preventDefault();
          finish(pending);
        });

        // The whole frame is selected from the start — one Enter confirms it.
        render(boxOfRect(pending));
        document.body.appendChild(overlay);
      });
    }

    /* ------------------------------------------------------------------ *
     * annotation editor
     * ------------------------------------------------------------------ */

    /** One straight arrow: shaft plus a filled head. */
    function drawArrow(context, x1, y1, x2, y2, width) {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(width * 3.4, 9);
      context.beginPath();
      context.moveTo(x1, y1);
      context.lineTo(x2, y2);
      context.stroke();
      context.beginPath();
      context.moveTo(x2, y2);
      context.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
      context.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
      context.closePath();
      context.fill();
    }

    /** Render one annotation (or the in-flight draft) at native resolution. */
    function drawAnnotation(context, item) {
      context.save();
      context.strokeStyle = item.color;
      context.fillStyle = item.color;
      context.lineWidth = item.width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      if (item.type === 'pen') {
        const points = item.points;
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);
        if (points.length === 1) context.lineTo(points[0].x + 0.01, points[0].y + 0.01);
        for (let index = 1; index < points.length; index += 1) {
          context.lineTo(points[index].x, points[index].y);
        }
        context.stroke();
      } else if (item.type === 'rect') {
        context.beginPath();
        context.rect(
          Math.min(item.x1, item.x2),
          Math.min(item.y1, item.y2),
          Math.abs(item.x2 - item.x1),
          Math.abs(item.y2 - item.y1),
        );
        context.stroke();
      } else if (item.type === 'ellipse') {
        const rx = Math.abs(item.x2 - item.x1) / 2;
        const ry = Math.abs(item.y2 - item.y1) / 2;
        context.beginPath();
        context.ellipse(
          (item.x1 + item.x2) / 2,
          (item.y1 + item.y2) / 2,
          Math.max(rx, 0.5),
          Math.max(ry, 0.5),
          0,
          0,
          Math.PI * 2,
        );
        context.stroke();
      } else if (item.type === 'arrow') {
        drawArrow(context, item.x1, item.y1, item.x2, item.y2, item.width);
      } else if (item.type === 'text') {
        context.font = '600 ' + item.size + 'px Inter,system-ui,"Segoe UI",sans-serif';
        context.textBaseline = 'top';
        context.lineWidth = Math.max(2, item.size / 7);
        context.strokeStyle = 'rgba(0,0,0,.72)';
        context.strokeText(item.text, item.x, item.y);
        context.fillStyle = item.color;
        context.fillText(item.text, item.x, item.y);
      }
      context.restore();
    }

    /**
     * Annotation editor over one cropped canvas.
     *
     * Annotations are stored as vectors and the canvas is repainted from the
     * base image on every change, so undo and clear are exact and the export is
     * a native-resolution composite rather than a re-scaled screenshot.
     *
     * @param base - the cropped capture (native pixels); it is never mutated.
     * @returns the annotated canvas, or null when the user cancels.
     */
    function editImage(base) {
      return new Promise((resolve) => {
        const width = base.width;
        const height = base.height;
        /** Stroke width scaled to the crop so small and huge shots both look right. */
        const strokeWidth = Math.max(2, Math.round(Math.min(width, height) / 220));
        const textSize = Math.max(14, Math.round(Math.min(width, height) / 40));
        const annotations = [];
        let tool = 'pen';
        let color = PALETTE[0];
        let draft = null;
        let settled = false;

        const overlay = document.createElement('div');
        overlay.setAttribute('data-dsh-screenshot-editor', '');
        overlay.style.cssText = [
          'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.84);',
          'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:20px;',
          'user-select:none;',
        ].join('');

        const toolbar = document.createElement('div');
        toolbar.setAttribute('data-dsh-screenshot-toolbar', '');
        toolbar.style.cssText = [
          'display:flex;align-items:center;flex-wrap:wrap;justify-content:center;gap:6px;padding:6px 10px;',
          'border-radius:12px;background:rgba(28,28,30,.96);box-shadow:0 8px 28px rgba(0,0,0,.45);',
          'font:13px/18px Inter,system-ui,"Segoe UI",sans-serif;color:#fff;',
        ].join('');

        const stage = document.createElement('div');
        stage.style.cssText = 'position:relative;display:inline-block;line-height:0;';

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.setAttribute('data-dsh-screenshot-canvas', '');
        canvas.style.cssText = [
          'display:block;max-width:calc(100vw - 48px);max-height:calc(100vh - 200px);',
          'border-radius:6px;background:#000;box-shadow:0 12px 40px rgba(0,0,0,.55);cursor:crosshair;',
        ].join('');

        const context = canvas.getContext('2d');

        /** Repaint base image + committed annotations + the in-flight draft. */
        const redraw = () => {
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.clearRect(0, 0, width, height);
          context.drawImage(base, 0, 0);
          const list = draft === null ? annotations : annotations.concat([draft]);
          for (const item of list) drawAnnotation(context, item);
        };

        // ── toolbar ──
        const PLAIN_BUTTON = [
          'padding:5px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;',
          'border:1px solid transparent;background:transparent;color:#fff;',
          'font:500 13px/18px Inter,system-ui,"Segoe UI",sans-serif;',
        ].join('');
        const ACTIVE_BUTTON = 'background:#4d6bfe;border-color:#4d6bfe;color:#fff;';

        const toolButtons = [];
        const syncToolbar = () => {
          for (const entry of toolButtons) {
            entry.element.style.cssText = PLAIN_BUTTON + (entry.id === tool ? ACTIVE_BUTTON : '');
          }
          for (const entry of swatchButtons) {
            entry.element.style.outline = entry.value === color ? '2px solid #fff' : 'none';
          }
          canvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
        };
        const selectTool = (id) => {
          tool = id;
          syncToolbar();
        };

        const separator = () => {
          const line = document.createElement('span');
          line.style.cssText = 'width:1px;height:20px;background:rgba(255,255,255,.22);margin:0 2px;';
          return line;
        };

        for (const item of TOOLS) {
          const element = document.createElement('button');
          element.type = 'button';
          element.textContent = item.label;
          element.title = item.label + '（快捷键 ' + item.key + '）';
          element.setAttribute('data-dsh-tool', item.id);
          element.style.cssText = PLAIN_BUTTON;
          element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectTool(item.id);
          });
          toolButtons.push({ id: item.id, element: element });
          toolbar.appendChild(element);
        }

        toolbar.appendChild(separator());

        const swatchButtons = [];
        for (const value of PALETTE) {
          const element = document.createElement('button');
          element.type = 'button';
          element.title = '颜色 ' + value;
          element.setAttribute('data-dsh-color', value);
          element.style.cssText = [
            'width:20px;height:20px;padding:0;border-radius:50%;cursor:pointer;flex:none;',
            'border:1px solid rgba(255,255,255,.35);background:' + value + ';',
          ].join('');
          element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            color = value;
            syncToolbar();
          });
          swatchButtons.push({ value: value, element: element });
          toolbar.appendChild(element);
        }

        toolbar.appendChild(separator());

        const undoButton = document.createElement('button');
        undoButton.type = 'button';
        undoButton.textContent = '撤销';
        undoButton.title = '撤销上一笔（Ctrl+Z）';
        undoButton.setAttribute('data-dsh-action', 'undo');
        undoButton.style.cssText = PLAIN_BUTTON;
        undoButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          annotations.pop();
          redraw();
        });

        const clearButton = document.createElement('button');
        clearButton.type = 'button';
        clearButton.textContent = '清空';
        clearButton.title = '清除全部标注';
        clearButton.setAttribute('data-dsh-action', 'clear');
        clearButton.style.cssText = PLAIN_BUTTON;
        clearButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          annotations.length = 0;
          redraw();
        });

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.textContent = '取消 · Esc';
        cancelButton.setAttribute('data-dsh-action', 'cancel');
        cancelButton.style.cssText = [
          'padding:5px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;margin-left:8px;',
          'border:1px solid rgba(255,255,255,.28);background:transparent;color:#fff;',
          'font:13px/18px Inter,system-ui,"Segoe UI",sans-serif;',
        ].join('');

        const doneButton = document.createElement('button');
        doneButton.type = 'button';
        doneButton.textContent = '完成 · Enter';
        doneButton.setAttribute('data-dsh-action', 'done');
        doneButton.style.cssText = [
          'padding:5px 14px;border-radius:8px;cursor:pointer;white-space:nowrap;border:none;',
          'background:#4d6bfe;color:#fff;font:600 13px/18px Inter,system-ui,"Segoe UI",sans-serif;',
        ].join('');

        toolbar.appendChild(undoButton);
        toolbar.appendChild(clearButton);
        toolbar.appendChild(cancelButton);
        toolbar.appendChild(doneButton);

        const hint = document.createElement('div');
        hint.textContent = '拖动绘制 · 数字键 1-5 切换工具 · Ctrl+Z 撤销 · Enter 完成 · Esc 取消';
        hint.style.cssText = [
          'color:rgba(255,255,255,.72);text-align:center;',
          'font:12px/18px Inter,system-ui,"Segoe UI",sans-serif;',
        ].join('');

        stage.appendChild(canvas);
        overlay.appendChild(toolbar);
        overlay.appendChild(stage);
        overlay.appendChild(hint);

        // ── pointer handling (canvas pixels ↔ CSS pixels) ──
        const pointOf = (event) => {
          const rect = canvas.getBoundingClientRect();
          const scaleX = rect.width === 0 ? 1 : width / rect.width;
          const scaleY = rect.height === 0 ? 1 : height / rect.height;
          return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
          };
        };

        const isMeaningful = (item) => {
          if (item.type === 'pen') return item.points.length > 1;
          const dx = item.x2 - item.x1;
          const dy = item.y2 - item.y1;
          return Math.sqrt(dx * dx + dy * dy) >= Math.max(4, item.width * 2);
        };

        /** Inline text box at the click point; Enter commits, Esc drops it. */
        const openTextInput = (point) => {
          const rect = canvas.getBoundingClientRect();
          const ratio = rect.width === 0 ? 1 : rect.width / width;
          const input = document.createElement('input');
          input.type = 'text';
          input.setAttribute('data-dsh-screenshot-text', '');
          input.placeholder = '输入文字，回车确认';
          input.style.cssText = [
            'position:absolute;z-index:3;padding:1px 4px;border-radius:4px;outline:none;',
            'border:1px dashed rgba(255,255,255,.7);background:rgba(0,0,0,.45);',
            'font:600 ' + Math.max(12, Math.round(textSize * ratio)) + 'px/1.3 Inter,system-ui,"Segoe UI",sans-serif;',
            'color:' + color + ';min-width:' + Math.max(80, Math.round(100 * ratio)) + 'px;',
            'left:' + (point.x * ratio) + 'px;top:' + (point.y * ratio) + 'px;',
          ].join('');
          let closed = false;
          const close = (commit) => {
            if (closed === true) return;
            closed = true;
            const value = input.value.trim();
            input.remove();
            if (commit === true && value !== '') {
              annotations.push({ type: 'text', x: point.x, y: point.y, text: value, color: color, size: textSize });
              redraw();
            }
          };
          input.addEventListener('keydown', (event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              close(true);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              close(false);
            }
          });
          input.addEventListener('blur', () => close(true));
          stage.appendChild(input);
          input.focus();
        };

        const onCanvasDown = (event) => {
          if (event.button !== 0) return;
          const point = pointOf(event);
          if (tool === 'text') {
            event.preventDefault();
            openTextInput(point);
            return;
          }
          draft = tool === 'pen'
            ? { type: 'pen', color: color, width: strokeWidth, points: [point] }
            : { type: tool, color: color, width: strokeWidth, x1: point.x, y1: point.y, x2: point.x, y2: point.y };
          redraw();
          event.preventDefault();
        };
        const onCanvasMove = (event) => {
          if (draft === null) return;
          const point = pointOf(event);
          if (draft.type === 'pen') draft.points.push(point);
          else {
            draft.x2 = point.x;
            draft.y2 = point.y;
          }
          redraw();
          event.preventDefault();
        };
        const onWindowUp = () => {
          if (draft === null) return;
          const finished = draft;
          draft = null;
          if (isMeaningful(finished) === true) annotations.push(finished);
          redraw();
        };

        // ── lifecycle ──
        const cleanup = () => {
          window.removeEventListener('mouseup', onWindowUp, true);
          window.removeEventListener('keydown', onKey, true);
          overlay.remove();
        };
        const finish = (value) => {
          if (settled === true) return;
          settled = true;
          cleanup();
          resolve(value);
        };
        /** Flatten the draft and hand back the composite canvas. */
        const complete = () => {
          draft = null;
          redraw();
          finish(canvas);
        };

        function onKey(event) {
          const target = event.target;
          // The inline text box owns its own Enter/Esc while it is open.
          if (target !== null && target !== undefined && typeof target.hasAttribute === 'function'
            && target.hasAttribute('data-dsh-screenshot-text') === true) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(null);
            return;
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            complete();
            return;
          }
          if ((event.ctrlKey === true || event.metaKey === true) && (event.key === 'z' || event.key === 'Z')) {
            event.preventDefault();
            annotations.pop();
            redraw();
            return;
          }
          const match = TOOLS.find((entry) => entry.key === event.key);
          if (match !== undefined) {
            event.preventDefault();
            selectTool(match.id);
          }
        }

        canvas.addEventListener('mousedown', onCanvasDown);
        canvas.addEventListener('mousemove', onCanvasMove);
        canvas.addEventListener('contextmenu', (event) => event.preventDefault());
        window.addEventListener('mouseup', onWindowUp, true);
        window.addEventListener('keydown', onKey, true);
        cancelButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          finish(null);
        });
        doneButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          complete();
        });
        overlay.addEventListener('dblclick', (event) => event.stopPropagation());

        syncToolbar();
        redraw();
        document.body.appendChild(overlay);
      });
    }

    /** Encode one canvas as a PNG Blob (the attachment's bytes). */
    function toPngBlob(canvas) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob === null) reject(new Error('PNG 编码失败'));
          else resolve(blob);
        }, 'image/png');
      });
    }

    /**
     * Full interactive capture: pick a surface, frame a region, annotate, encode.
     * @param options.instant - skip the region overlay AND the editor, attaching
     *                          the picked surface whole (the Alt+click shortcut).
     * @returns a PNG Blob, or null when the user cancelled at any step.
     */
    async function captureRegion(options) {
      if (typeof navigator === 'undefined' || navigator.mediaDevices === undefined
        || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
        throw new Error('当前环境不支持屏幕捕获（getDisplayMedia 不可用）');
      }
      const instant = options !== undefined && options.instant === true;
      const frame = await grabFrame();
      if (frame === null) return null;
      const region = instant === true
        ? { x: 0, y: 0, w: frame.width, h: frame.height }
        : await pickRegion(frame);
      if (region === null) return null;
      const crop = document.createElement('canvas');
      crop.width = region.w;
      crop.height = region.h;
      crop.getContext('2d').drawImage(frame, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
      if (instant === true) return toPngBlob(crop);
      const annotated = await editImage(crop);
      if (annotated === null) return null;
      return toPngBlob(annotated);
    }

    /* ------------------------------------------------------------------ *
     * attachment intake — hand the File to the composer's own pipeline
     * ------------------------------------------------------------------ */

    /** The composer's hidden file input (the one the paperclip button drives). */
    function composerFileInput() {
      return document.querySelector('[data-composer-card] input[type="file"]')
        || document.querySelector('input[type="file"][multiple]')
        || document.querySelector('input[type="file"]');
    }

    /** The composer's contenteditable host, for the paste fallback. */
    function composerEditor() {
      return document.querySelector('[data-composer-input]');
    }

    /**
     * Stage one file as a pending draft attachment.
     *
     * Primary path: assign to the composer's own file input and dispatch a
     * native bubbling `change`, which is exactly what the paperclip button
     * does — the product then runs its normal intake (type check, image
     * limits, upload, rail card).
     *
     * Fallback: a synthetic `paste` on the editor, which the composer's paste
     * command routes into the very same intake.
     */
    function attachFile(file) {
      const input = composerFileInput();
      if (input !== null && input.disabled !== true) {
        try {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          input.files = transfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, via: 'file-input' };
        } catch (error) {
          // fall through to the paste path
        }
      }
      const editor = composerEditor();
      if (editor !== null) {
        try {
          const transfer = new DataTransfer();
          transfer.items.add(file);
          const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', { value: transfer });
          editor.dispatchEvent(event);
          if (event.defaultPrevented === true) return { ok: true, via: 'paste' };
        } catch (error) {
          // fall through to the failure report
        }
      }
      return {
        ok: false,
        via: null,
        reason: input === null ? '找不到输入框的附件入口' : '输入框当前不接受附件（可能正在运行或处于子会话）',
      };
    }

    /* ------------------------------------------------------------------ *
     * UI
     * ------------------------------------------------------------------ */

    function ShotIcon(props) {
      const spinning = props !== undefined && props.spin === true;
      return react.createElement('svg', {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        className: spinning === true ? 'dsh-screenshot-spin' : undefined,
        style: { display: 'block' },
      }, [
        react.createElement('path', {
          key: 'body',
          d: 'M5.6 2.6 4.7 4.1H3.1A1.6 1.6 0 0 0 1.5 5.7v5.7a1.6 1.6 0 0 0 1.6 1.6h9.8a1.6 1.6 0 0 0 1.6-1.6V5.7a1.6 1.6 0 0 0-1.6-1.6h-1.6l-.9-1.5H5.6Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinejoin: 'round',
        }),
        react.createElement('circle', {
          key: 'lens',
          cx: 8,
          cy: 8.4,
          r: 2.55,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
      ]);
    }

    function ShotButton() {
      const [busy, setBusy] = react.useState(false);

      const onClick = async (event) => {
        if (busy === true) return;
        // Alt+click: attach the picked surface whole, with no framing or editing.
        const instant = event !== null && event !== undefined && event.altKey === true;
        setBusy(true);
        try {
          const blob = await captureRegion({ instant: instant });
          if (blob === null) return; // cancelled by the user: not an error
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const file = new File([blob], 'screenshot-' + stamp + '.png', { type: 'image/png' });
          const result = attachFile(file);
          if (result.ok === true) toast(instant === true ? '整幅截图已加入待发送附件' : '截图已加入待发送附件');
          else toast('截图已生成，但未能加入输入框：' + result.reason, true);
        } catch (error) {
          const message = error !== null && error !== undefined && error.message !== undefined
            ? String(error.message)
            : String(error);
          toast('截图失败：' + message, true);
        } finally {
          setBusy(false);
        }
      };

      return react.createElement('button', {
        type: 'button',
        className: BTN_CLASS,
        'data-dsh-screenshot': 'button',
        disabled: busy === true,
        title: '截图：选屏幕/窗口 → 框选或整幅 → 可标注（画笔/矩形/圆形/箭头/文字）→ 完成入附件\n'
          + 'Alt+点击：跳过框选与标注，直接把所选窗口/屏幕整幅加入附件',
        'aria-label': '截图',
        onMouseDown: (mouseEvent) => mouseEvent.preventDefault(),
        onClick: onClick,
      }, react.createElement(ShotIcon, { spin: busy === true }));
    }

    /* ------------------------------------------------------------------ *
     * plugin body
     * ------------------------------------------------------------------ */

    function apply(ctx) {
      const slots = ctx.get('slots');
      if (slots === undefined) return;
      installStyles();
      // conversation.input.left renders inside the composer's bottom tools row,
      // immediately after the "+" and paperclip buttons.
      slots.inject('conversation.input.left', () => slots.register(
        { name: 'conversation.input.left', id: 'dsh-screenshot', order: 100 },
        () => ShotButton(),
      ));
      // Console probe: verify the pipeline without clicking through the UI.
      // pickRegion()/editImage() accept any canvas, so both overlays can be
      // exercised without screen-capture permission:
      //   const c = document.createElement('canvas'); c.width = 800; c.height = 600;
      //   await window.__dshScreenshot.pickRegion(c)
      //   await window.__dshScreenshot.editImage(c)
      if (typeof window !== 'undefined') {
        window.__dshScreenshot = {
          version: VERSION,
          captureRegion: captureRegion,
          pickRegion: pickRegion,
          editImage: editImage,
          attachFile: attachFile,
          grabFrame: grabFrame,
        };
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
