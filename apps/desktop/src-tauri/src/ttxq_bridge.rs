//! Browser-side collection bridge for Tencent Xiangqi.
//!
//! This module owns the bounded JavaScript traversal and its Tauri callback;
//! synchronization state and import decisions remain in `ttxq_sync`.

use super::*;

pub(crate) fn collect_ttxq_h5_history_impl(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(TTXQ_WINDOW_LABEL)
        .ok_or("请先打开天天象棋授权窗口")?;
    let current_host = window
        .url()
        .ok()
        .and_then(|url| url.host_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "未知页面".into());
    state
        .model
        .lock()
        .map_err(|_| "本地棋谱库不可用".to_owned())?
        .store
        .clear_ttxq_diagnostic_samples()
        .map_err(|error| error.to_string())?;
    let attempt_id = {
        let mut sync = state
            .ttxq_sync
            .lock()
            .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
        begin_read_attempt(&mut sync)
    };

    // A tiny preflight is injected separately so expensive page traversal can
    // never hide a missing or unusable remote IPC bridge.
    let preflight_script = format!(
        r#"(async () => {{
          const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
          if (typeof invoke !== 'function') return;
          await invoke('report_ttxq_read_progress', {{ attemptId: {attempt_id}, total: 0, completed: 0, failed: 0, scanned: 0, current: 0, phase: 'discovering' }});
        }})().catch(() => undefined)"#
    );
    if let Err(error) = window.eval(&preflight_script) {
        let mut sync = state
            .ttxq_sync
            .lock()
            .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
        fail_unacknowledged_bridge(&mut sync, attempt_id, &current_host);
        return Err(format!("无法注入天天象棋桥接：{error}"));
    }
    // The remote page never receives filesystem or generic application APIs. This
    // bridge only serializes a narrow, validated DTO back to the dedicated command.
    let collector_script = r#"(async () => {
      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (!invoke) throw new Error('天天象棋授权窗口未获得导入权限；请关闭窗口后重新打开');
      // A stale favourite/self-recorded row can remain in Tencent's list after
      // its detail has been removed or access has changed. Opening it displays
      // a modal in the authorization window. Do not inspect body.innerText:
      // detail pages can legitimately retain this phrase in hidden/old content.
      // Only a newly mounted, visible dialog tied to a confirm button is an
      // unavailable-record signal.
      const isVisible = (element) => {
        try {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden'
            && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
        } catch (_) { return true; }
      };
      const unavailableDialogCandidates = () => {
        if (typeof document === 'undefined') return [];
        const candidates = [];
        const seen = new Set();
        const clickableSelector = 'button,[role="button"],a,[class*="btn"],[class*="button"],div,span';
        const add = (element, confirm = null) => {
          if (!element || seen.has(element) || !isVisible(element)) return;
          const text = String(element.textContent || '').trim();
          if (!/(?:棋谱不存在|删除失败|棋谱已删除)/.test(text)) return;
          seen.add(element);
          const button = confirm || Array.from(element.querySelectorAll(clickableSelector))
            .find((item) => isVisible(item) && /^确定$/.test(String(item.textContent || '').trim()));
          candidates.push({ element, confirm: button, signature: text.slice(0, 240) });
        };
        // Prefer semantic/modal containers when the page provides them.
        for (const element of document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.dialog,[class*="modal"],[class*="dialog"],[class*="popup"]')) {
          add(element);
        }
        // Some QQ builds render a paper dialog without a semantic class. Start
        // at its visible “确定” button and walk only a few ancestors, never up
        // to body where unrelated detail text would become a false match.
        for (const button of document.querySelectorAll(clickableSelector)) {
          if (!isVisible(button) || !/^确定$/.test(String(button.textContent || '').trim())) continue;
          let current = button;
          for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
            add(current, button);
            if (seen.has(current)) break;
          }
        }
        // Tencent's FDK build renders these paper dialogs into a canvas. In
        // that build there is no DOM text or button to query, but the display
        // object graph still exposes a short `text`/`label` and a clickable
        // child. Walk only that graph, with a small time and node bound, and
        // use it solely when the DOM probe found nothing.
        if (candidates.length === 0 && window.fdk && typeof window.fdk === 'object') {
          const textOf = (value) => {
            if (!value || typeof value !== 'object') return '';
            for (const key of ['text', '_text', 'label', '_label', 'value', '_value']) {
              try {
                const text = value[key];
                if (typeof text === 'string' && text.trim().length <= 240) return text.trim();
              } catch (_) { /* Display getters can disappear during a route switch. */ }
            }
            return '';
          };
          const childrenOf = (value) => {
            const children = [];
            let names = [];
            try { names = Object.getOwnPropertyNames(value); } catch (_) { return children; }
            for (const key of names.slice(0, 120)) {
              if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
              try {
                const child = value[key];
                if (child && typeof child === 'object') children.push(child);
              } catch (_) { /* Ignore transient FDK properties. */ }
            }
            return children;
          };
          const canClick = (value) => value && (typeof value.click === 'function'
            || typeof value.dispatchEvent === 'function'
            || typeof value.emit === 'function'
            || typeof value.onClick === 'function');
          const findConfirm = (root) => {
            const stack = [{ value: root, depth: 0 }];
            const seen = new Set();
            let visited = 0;
            while (stack.length && visited < 900) {
              const { value, depth } = stack.pop();
              if (!value || typeof value !== 'object' || seen.has(value) || depth > 6) continue;
              seen.add(value); visited += 1;
              if (/^确定$/.test(textOf(value)) && canClick(value)) return value;
              for (const child of childrenOf(value)) stack.push({ value: child, depth: depth + 1 });
            }
            return null;
          };
          const stack = [{ value: window.fdk, depth: 0, ancestors: [] }];
          const seen = new Set();
          const deadline = Date.now() + 120;
          let visited = 0;
          while (stack.length && visited < 6_000 && Date.now() < deadline) {
            const { value, depth, ancestors } = stack.pop();
            if (!value || typeof value !== 'object' || seen.has(value) || depth > 12) continue;
            seen.add(value); visited += 1;
            const text = textOf(value);
            if (/(?:棋谱不存在|删除失败|棋谱已删除)/.test(text)) {
              // The paper dialog stores its message and confirm button as
              // siblings. Search the nearest bounded ancestors as well as the
              // message object itself; searching only descendants misses the
              // real button. Do not fall back to clicking the dialog/message
              // surface because it can sit above Tencent's delete control.
              let confirm = findConfirm(value);
              for (let index = ancestors.length - 1;
                !confirm && index >= Math.max(0, ancestors.length - 4);
                index -= 1) {
                confirm = findConfirm(ancestors[index]);
              }
              candidates.push({ element: value, confirm, signature: text.slice(0, 240) });
              break;
            }
            for (const child of childrenOf(value)) {
              stack.push({ value: child, depth: depth + 1, ancestors: [...ancestors, value] });
            }
          }
        }
        // Keep the smallest matching container so nested modal wrappers do not
        // produce duplicate signatures or accidentally include page content.
        return candidates.sort((left, right) => left.signature.length - right.signature.length);
      };
      const unavailableDialogBaseline = () => unavailableDialogCandidates().map(({ element, signature }) => ({ element, signature }));
      const invokeDisplayClick = (control) => {
        if (!control) return false;
        // DOM buttons and FDK display objects expose different event APIs.
        // Try the least surprising adapter first and retain the context when
        // invoking a callback; a bare `.click()` was a no-op on paper dialogs.
        const attempts = [
          () => typeof control.click === 'function' && control.click(),
          () => typeof control.dispatchEvent === 'function' && control.dispatchEvent(
            typeof Event === 'function' ? new Event('click', { bubbles: true }) : 'click',
          ),
          () => typeof control.emit === 'function' && control.emit('click', { type: 'click', currentTarget: control }),
          () => typeof control.onClick === 'function' && control.onClick({ type: 'click', currentTarget: control }),
        ];
        for (const attempt of attempts) {
          try {
            if (attempt() !== false) return true;
          } catch (_) { /* Try the next event adapter. */ }
        }
        return false;
      };
      const closeUnavailableDialogs = () => {
        for (const candidate of unavailableDialogCandidates()) {
          invokeDisplayClick(candidate.confirm);
        }
      };
      const dismissUnavailableDialog = (baseline = []) => {
        // A dialog that survived the previous close attempt is still blocking
        // the authorization page. Treat it as unavailable on every poll so a
        // stale board can never be accepted merely because its DOM node was
        // already present in the baseline.
        const match = unavailableDialogCandidates()[0];
        if (!match) return '';
        // Only an exact visible "确定" control is safe to activate. The
        // message/dialog surface can overlap Tencent's underlying delete
        // action and was the source of repeated "删除失败" dialogs.
        invokeDisplayClick(match.confirm);
        return '天天象棋棋谱不存在、已删除或当前账号无权访问';
      };
      // QQ's paper dialog can be remounted a few times after its confirm
      // callback. Drain it with a small, bounded retry window so a failed
      // record cannot cover the next game or remain over the import window.
      const drainUnavailableDialogs = async (attempts = 8) => {
        let detected = '';
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          const result = dismissUnavailableDialog();
          if (!result) return detected;
          detected = result;
          await delay(100);
        }
        return detected;
      };
      await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total: 0, completed: 0, failed: 0, scanned: 0, current: 0, phase: 'discovering' });
      const bridgeError = async (error) => {
        await invoke('report_ttxq_bridge_error', { attemptId: __TTXQ_ATTEMPT_ID__, message: String(error && error.message || error) });
      };
      // Matches the proven desktop exporter traversal limit. Tencent's `fdk`
      // graph commonly exceeds 20,000 objects before the notification owner.
      const findObjectWithOwnProperty = (root, property, limit = 100_000) => {
        if (!root || typeof root !== 'object') return null;
        const stack = [root];
        const seen = new WeakSet();
        let visited = 0;
        while (stack.length && visited < limit) {
          const value = stack.pop();
          if (!value || typeof value !== 'object' || seen.has(value)) continue;
          seen.add(value);
          visited += 1;
          try {
            if (Object.prototype.hasOwnProperty.call(value, property)) return value;
            const children = Array.isArray(value) ? value : Object.values(value);
            for (const child of children) if (child && typeof child === 'object' && !seen.has(child)) stack.push(child);
          } catch (_) { /* Ignore protected display objects and transient getters. */ }
        }
        return null;
      };
      // Some QQ H5 revisions expose board data through a prototype getter or
      // method instead of an own property. Keep this fallback bounded and use
      // it only for the explicitly approved bridge fields; broad prototype
      // traversal would otherwise collect renderer state from stale boards.
      const findObjectWithProperty = (root, property, limit = 100_000) => {
        if (!root || typeof root !== 'object') return null;
        const stack = [root];
        const seen = new WeakSet();
        let visited = 0;
        while (stack.length && visited < limit) {
          const value = stack.pop();
          if (!value || typeof value !== 'object' || seen.has(value)) continue;
          seen.add(value);
          visited += 1;
          try {
            if (property in value) return value;
            const names = new Set();
            let prototype = value;
            for (let depth = 0; prototype && depth < 3; depth += 1) {
              Object.getOwnPropertyNames(prototype).forEach(name => names.add(name));
              prototype = Object.getPrototypeOf(prototype);
            }
            for (const name of names) {
              let child;
              try { child = value[name]; } catch (_) { continue; }
              if (child && typeof child === 'object' && !seen.has(child)) stack.push(child);
            }
            if (Array.isArray(value)) {
              for (const child of value) if (child && typeof child === 'object' && !seen.has(child)) stack.push(child);
            }
          } catch (_) { /* Ignore protected proxies and transient display objects. */ }
        }
        return null;
      };
      let model = null;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        try { model = window.fdk && window.fdk.getModel && window.fdk.getModel('QipuModel'); } catch (_) { model = null; }
        const hasAnyQipuListRoot = () => {
          if (!model) return false;
          if (model._qipuRecentView || model._qipuWallDataList || model._qipuWallPreViewData || model._qipuDataList || model._qipuCollectDataList || model._qipuCreateDataList || model._qipuSelfRecordDataList || model._qipuManualDataList) return true;
          try {
            return Object.keys(model).some(key => /(?:qipu|recent|wall|collect|favor|create|record|manual|list|data)/i.test(key) && model[key] && typeof model[key] === 'object');
          } catch (_) {
            return false;
          }
        };
        if (model && hasAnyQipuListRoot() && model.jumpQipuGame) break;
        if (attempt % 8 === 0) await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total: 0, completed: 0, failed: 0, scanned: 0, current: 0, phase: 'discovering' });
        await delay(250);
      }
      if (!model || !model.jumpQipuGame) throw new Error('未检测到天天象棋棋谱数据，请在授权窗口进入“最近对局 / 我的收藏 / 我创建的 / 记谱”列表后重试');
      // Tencent's H5 list is virtualized. Trigger bounded scrolls before scanning
      // so the page has a chance to append older items without an unbounded loop.
      const scrollPageAndLists = () => {
        const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        window.scrollTo(0, height);
        for (const element of Array.from(document.querySelectorAll('*')).slice(0, 800)) {
          try {
            if (element.scrollHeight > element.clientHeight + 20) element.scrollTop = element.scrollHeight;
          } catch (_) { /* Ignore detached nodes. */ }
        }
        return height;
      };
      let stableScrolls = 0;
      let previousHeight = 0;
      for (let pass = 0; pass < 24 && stableScrolls < 3; pass += 1) {
        const height = scrollPageAndLists();
        await delay(500);
        const nextHeight = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        stableScrolls = nextHeight > previousHeight ? 0 : stableScrolls + 1;
        previousHeight = Math.max(previousHeight, nextHeight);
      }
      const qipuIdOf = (value) => {
        const candidateId = value && (value.qipuId ?? value.qipuID ?? value.iQipuId ?? value.iQipuID ?? value.lQipuId ?? value.lQiPuID ?? value.qipu_id);
        if (candidateId == null) return '';
        const id = String(candidateId).trim();
        // Real QQ chess qipu ids are numeric and non-zero. Model placeholders
        // such as qipuId=0 and unrelated caches must not become phantom rows.
        if (!/^[1-9]\d{4,}$/.test(id)) return '';
        return id;
      };
      const visibleQipuListEmptyState = () => {
        if (typeof document === 'undefined' || !document.querySelectorAll) return '';
        const visible = (element) => {
          if (!element) return false;
          try {
            if (element === document.body || element === document.documentElement) return false;
          } catch (_) { /* Some harnesses do not expose body/documentElement. */ }
          try {
            if (typeof window !== 'undefined' && window.getComputedStyle) {
              const style = window.getComputedStyle(element);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            }
          } catch (_) { /* Keep probing text-only harness elements. */ }
          try {
            if (element.getBoundingClientRect) {
              const rect = element.getBoundingClientRect();
              if (rect && rect.width === 0 && rect.height === 0) return false;
            }
          } catch (_) { /* Detached Tencent nodes can throw while routing. */ }
          return true;
        };
        const texts = [];
        try {
          for (const element of Array.from(document.querySelectorAll('*')).slice(0, 1600)) {
            if (!visible(element)) continue;
            const text = String(element.innerText || element.textContent || '').replace(/\s+/g, '');
            if (!text || text.length > 120) continue;
            if (/(?:暂无数据|暂无棋谱|暂无收藏|请稍后轻触重试|请稍后重试|加载失败)/.test(text)) texts.push(text);
          }
        } catch (_) { return ''; }
        const joined = texts.join(' ');
        return /(?:暂无数据|暂无棋谱|暂无收藏)/.test(joined) || /(?:请稍后轻触重试|请稍后重试|加载失败)/.test(joined)
          ? '授权窗口当前列表为空或加载失败，请在天天象棋里刷新/切换列表后重试。'
          : '';
      };
      const qipuListRoots = () => {
        const activeListKind = () => {
        const selectedText = [];
        try {
          for (const element of Array.from(document.querySelectorAll('[aria-selected="true"], .active, .selected, [class*="current"]')).slice(0, 80)) {
            const text = String(element.innerText || element.textContent || '').trim();
            if (text && text.length <= 32) selectedText.push(text);
          }
        } catch (_) { /* The page can replace the list DOM while it loads. */ }
        let modelHint = '';
        try {
          for (const key of Object.keys(model).slice(0, 240)) {
            if (!/(?:tab|type|kind|mode|category|current|selected)/i.test(key)) continue;
            const value = model[key];
            if (typeof value === 'string' || typeof value === 'number') modelHint += ` ${key}:${value}`;
          }
        } catch (_) { /* Some QQ model properties are accessor-backed. */ }
        const hint = `${selectedText.join(' ')} ${modelHint}`;
        if (/(?:我的收藏|收藏棋谱|collect|favou?rite)/i.test(hint)) return 'favorite';
        if (/(?:我创建的|自建棋谱|我的记谱|create|created|manual|record)/i.test(hint)) return 'created';
        if (/(?:最近对局|最近棋谱|recent|history)/i.test(hint)) return 'recent';
        return '';
        };
        const candidates = [];
        const add = (key, kind, label, priority) => {
          try {
            const value = model[key];
            if (value && typeof value === 'object') candidates.push({ key, kind, label, priority, value });
          } catch (_) { /* Ignore transient getters. */ }
        };
        add('_qipuRecentView', 'recent', '最近对局', 100);
        add('_qipuDataList', 'recent', '最近对局', 80);
        add('_qipuListData', 'recent', '最近对局', 70);
        add('_qipuCollectDataList', 'favorite', '我的收藏', 110);
        add('_qipuFavoriteDataList', 'favorite', '我的收藏', 100);
        // "wall" has been used by Tencent for both 收藏 and 自建 pages. Treat
        // it as a fallback shared view, never as an unconditional favorite.
        add('_qipuWallDataList', 'shared', '当前棋谱列表', 80);
        add('_qipuWallPreViewData', 'shared', '当前棋谱列表', 70);
        add('_qipuCreateDataList', 'created', '我创建的', 110);
        add('_qipuSelfRecordDataList', 'created', '我创建的', 105);
        add('_qipuManualDataList', 'created', '我创建的', 100);
        add('_qipuRecordDataList', 'created', '我创建的', 95);
        const hasQipuRows = (root) => {
          if (!root || typeof root !== 'object') return false;
          const stack = [{ value: root, depth: 0 }];
          const seen = new WeakSet();
          let visited = 0;
          while (stack.length && visited < 1200) {
            const { value, depth } = stack.pop();
            if (!value || typeof value !== 'object' || seen.has(value)) continue;
            seen.add(value); visited += 1;
            if (qipuIdOf(value)) return true;
            if (depth >= 7) continue;
            for (const key of Object.keys(value).slice(0, 80)) {
              if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/.test(key)) continue;
              try {
                const child = value[key];
                if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
              } catch (_) { /* Ignore transient display-object accessors. */ }
            }
          }
          return false;
        };
        const kind = activeListKind();
        const pool = kind ? candidates.filter(candidate => candidate.kind === kind || candidate.kind === 'shared') : candidates;
        // Tencent keeps hidden caches for the other list tabs. Never pick one
        // by field priority: aliases that point to the same visible object are
        // safe, but two distinct roots are ambiguous and must fail closed.
        const distinct = [];
        for (const candidate of pool) {
          if (!distinct.some(existing => existing.value === candidate.value)) distinct.push(candidate);
        }
        const matching = kind ? distinct.filter(candidate => candidate.kind === kind) : distinct;
        const matchingWithRows = matching.filter(candidate => hasQipuRows(candidate.value));
        if (matchingWithRows.length === 1) return matchingWithRows;
        // Tencent sometimes leaves the typed list object empty while drawing
        // the current page from its shared wall view. It is safe only when it
        // is the single shared root that actually owns qipu records.
        if (kind && matchingWithRows.length === 0) {
          const sharedWithRows = distinct.filter(candidate => candidate.kind === 'shared' && hasQipuRows(candidate.value));
          if (sharedWithRows.length === 1) return sharedWithRows;
        }
        if (distinct.length === 1) return distinct;
        const explicitlyVisible = distinct.filter(candidate => {
          try { return candidate.value.visible === true || candidate.value._visible === true; }
          catch (_) { return false; }
        });
        return explicitlyVisible.length === 1 ? explicitlyVisible : [];
      };
      const found = new Map();
      // QQ exposes different list roots for recent games, favourites, and
      // self-recorded manuals. Each root is a display-object graph as well as a
      // data source. Its
      // parent/stage/event branches can be effectively unbounded, so only follow
      // data-shaped children and always retain records discovered before a limit.
      const visibleEmptyState = visibleQipuListEmptyState();
      if (visibleEmptyState) throw new Error(visibleEmptyState);
      const selectedListRoots = qipuListRoots();
      const selectedList = selectedListRoots[0];
      const sourceList = selectedList ? selectedList.label : '';
      const stack = selectedListRoots.map(candidate => ({ value: candidate.value, depth: 0 }));
      const seen = new WeakSet();
      const scanLimit = 16000;
      const depthLimit = 14;
      const dataKey = /(?:qipu|recent|list|items?|records?|data|result|page|collection|collect|favor|create|created|manual|wall|provider|extDataBody|stTittleInfo)/i;
      const ignoredKey = /^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?|children|_children)$/;
      let scanned = 0;
      let lastReported = 0;
      while (stack.length && scanned < scanLimit) {
        const { value, depth } = stack.pop();
        if (!value || typeof value !== 'object' || seen.has(value)) continue;
        seen.add(value); scanned += 1;
        const candidateId = qipuIdOf(value);
        if (candidateId) found.set(candidateId, value);
        if (depth < depthLimit) {
          const keys = Object.keys(value).slice(0, 80);
          // The traversal stack is LIFO. Push children in reverse so Tencent's
          // array index 0 (the visible top row) is visited before later rows.
          for (let keyIndex = keys.length - 1; keyIndex >= 0; keyIndex -= 1) {
            const key = keys[keyIndex];
            if (ignoredKey.test(key)) continue;
            try {
              const child = value[key];
              if (!child || typeof child !== 'object') continue;
              const childId = qipuIdOf(child);
              if (Array.isArray(child) || childId || dataKey.test(key)) stack.push({ value: child, depth: depth + 1 });
            } catch (_) { /* Ignore inaccessible H5 properties. */ }
          }
        }
        if (scanned - lastReported >= 256 || (!lastReported && found.size > 0)) {
          lastReported = scanned;
          await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total: found.size, completed: 0, failed: 0, scanned, current: 0, phase: 'discovering', bridgeVersion: __TTXQ_BRIDGE_VERSION__, sourceList, discoveredCount: found.size, ignoredStaleCount: 0 });
          await delay(0);
        }
      }
      if (!found.size) {
        throw new Error('无法唯一确定当前可见棋谱列表。请在授权窗口只打开“最近对局 / 我的收藏 / 我创建的”中的一个列表，等待内容显示后重试');
      }
      const games = [];
      const total = found.size;
      let completed = 0;
      let failed = 0;
      await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current: 0, phase: 'reading', bridgeVersion: __TTXQ_BRIDGE_VERSION__, sourceList, discoveredCount: total, ignoredStaleCount: 0 });
      const getQipuCapture = (() => {
        const stateKey = Symbol.for('cn.xiangqi.studio.ttxq.getQipuCapture');
        let state;
        try { state = window[stateKey]; } catch (_) { state = null; }
        if (!state || typeof state !== 'object') {
          state = { responses: new Map(), installed: false, accept: null };
          try { window[stateKey] = state; } catch (_) { /* One read still works without a persistent cache. */ }
        }
        if (!(state.responses instanceof Map)) state.responses = new Map();
        else state.responses.clear();
        const endpoint = (value) => /(?:^|[\/_-])get[-_]?qipu(?:$|[/?#&])/i.test(String(value || ''));
        const boundedText = (value, limit) => {
          if (typeof value !== 'string' && typeof value !== 'number') return '';
          return String(value).slice(0, limit);
        };
        const sanitizeRow = (row) => {
          if (typeof row === 'string' || typeof row === 'number') return boundedText(row, 16 * 1024);
          if (!row || typeof row !== 'object') return null;
          const result = {};
          for (const key of ['msg', 'comment', 'remark', 'note', 'content', 'text', 'body', 'time', 'date', 'timestamp', 'createTime', 'uname', 'userName', 'nickName', 'author']) {
            let text = '';
            try { text = boundedText(row[key], key === 'msg' || key === 'content' || key === 'text' || key === 'body' ? 16 * 1024 : 240); } catch (_) { text = ''; }
            if (text) result[key] = text;
          }
          return Object.keys(result).length ? result : null;
        };
        const sanitizeCommentV2 = (value) => {
          if (!value || typeof value !== 'object') return null;
          const result = {};
          let count = 0;
          for (const key of Object.keys(value)) {
            if (count >= 1024 || !/^(?:\d+|\d+[-_]\d+|(?:DhtmlXQ_)?comment\d+[_-]\d+)$/.test(key)) continue;
            let rawRows;
            try { rawRows = value[key]; } catch (_) { continue; }
            const rows = (Array.isArray(rawRows) ? rawRows : [rawRows])
              .slice(0, 64)
              .map(sanitizeRow)
              .filter(Boolean);
            if (!rows.length) continue;
            result[key] = rows;
            count += 1;
          }
          return count ? result : null;
        };
        const qipuIdOf = (value) => {
          if (!value || typeof value !== 'object') return '';
          for (const key of ['qipuId', '_qipuId', 'qipu_id', 'qipuID', '_qipuID']) {
            try {
              const text = boundedText(value[key], 160).trim();
              if (text) return text;
            } catch (_) { /* Ignore response wrappers with transient getters. */ }
          }
          return '';
        };
        const qipuIdFromRequest = (url, body) => {
          const readParams = (text) => {
            try {
              const params = new URLSearchParams(String(text || '').replace(/^\?/, ''));
              for (const key of ['qipuId', '_qipuId', 'qipu_id', 'qipuID', '_qipuID']) {
                const value = boundedText(params.get(key), 160).trim();
                if (value) return value;
              }
            } catch (_) { /* Not a query/form payload. */ }
            return '';
          };
          try {
            const parsed = new URL(String(url || ''), 'https://h5.qqchess.qq.com/');
            const id = readParams(parsed.search);
            if (id) return id;
          } catch (_) { /* A relative or opaque request URL is still allowed below. */ }
          if (typeof body === 'string') {
            const formId = readParams(body);
            if (formId) return formId;
            try {
              const parsed = JSON.parse(body);
              const id = qipuIdOf(parsed) || qipuIdOf(parsed && parsed.data);
              if (id) return id;
            } catch (_) { /* Not JSON. */ }
          }
          try {
            if (body && typeof body.get === 'function') {
              for (const key of ['qipuId', '_qipuId', 'qipu_id', 'qipuID', '_qipuID']) {
                const value = boundedText(body.get(key), 160).trim();
                if (value) return value;
              }
            }
          } catch (_) { /* Ignore protected request bodies. */ }
          return '';
        };
        const responseParts = (payload) => [
          payload,
          payload && payload.data,
          payload && payload.data && payload.data.data,
          payload && payload.result,
          payload && payload.result && payload.result.data,
        ].filter(value => value && typeof value === 'object');
        state.accept = (payload, url, body) => {
          if (!endpoint(url)) return;
          const parts = responseParts(payload);
          let qipuId = '';
          let commentV2 = null;
          for (const part of parts) {
            if (!qipuId) qipuId = qipuIdOf(part);
            const candidates = [
              part.commentV2,
              part.qipuData && part.qipuData.commentV2,
              part.qipuInfo && part.qipuInfo.commentV2,
              part.qipu && part.qipu.commentV2,
            ];
            for (const candidate of candidates) {
              commentV2 = sanitizeCommentV2(candidate);
              if (commentV2) break;
            }
            if (commentV2) break;
          }
          if (!qipuId) qipuId = qipuIdFromRequest(url, body);
          if (!qipuId || !commentV2) return;
          state.responses.set(qipuId, commentV2);
          while (state.responses.size > 64) state.responses.delete(state.responses.keys().next().value);
        };
        if (!state.installed && typeof window.fetch === 'function') {
          const nativeFetch = window.fetch;
          const wrappedFetch = function(input, init) {
            const result = nativeFetch.apply(this, arguments);
            let url = '';
            try { url = typeof input === 'string' ? input : input && input.url || String(input || ''); } catch (_) { url = ''; }
            if (endpoint(url)) {
              Promise.resolve(result).then(response => {
                let clone;
                try { clone = response && response.clone(); } catch (_) { clone = null; }
                if (!clone || typeof clone.json !== 'function') return;
                clone.json().then(payload => state.accept(payload, url, init && init.body)).catch(() => undefined);
              }).catch(() => undefined);
            }
            return result;
          };
          try { window.fetch = wrappedFetch; state.installed = true; } catch (_) { /* XHR capture may still be available. */ }
        }
        if (!state.xhrInstalled && typeof window.XMLHttpRequest === 'function') {
          try {
            const prototype = window.XMLHttpRequest.prototype;
            const nativeOpen = prototype.open;
            const nativeSend = prototype.send;
            const requests = new WeakMap();
            prototype.open = function(method, url) {
              requests.set(this, { url: String(url || ''), body: null });
              return nativeOpen.apply(this, arguments);
            };
            prototype.send = function(body) {
              const request = requests.get(this) || { url: '', body: null };
              request.body = body;
              requests.set(this, request);
              if (endpoint(request.url) && typeof this.addEventListener === 'function') {
                this.addEventListener('load', () => {
                  let payload = null;
                  try { payload = this.responseType === 'json' ? this.response : JSON.parse(this.responseText); } catch (_) { payload = null; }
                  if (payload) state.accept(payload, request.url, request.body);
                }, { once: true });
              }
              return nativeSend.apply(this, arguments);
            };
            state.xhrInstalled = true;
          } catch (_) { /* Fetch capture may still be available. */ }
        }
        return {
          commentV2For(qipuId) {
            return state.responses.get(String(qipuId || '').trim()) || null;
          },
        };
      })();
      // The current QQ H5 has shipped both the original `fdk.NOTIFY_QIPU_DATA`
      // layout and a model-owned layout. Keep this traversal narrow: it only
      // reads known chess-view roots and never serializes page state.
      const bridgeRoots = () => [
        window.fdk,
        selectedList && selectedList.value,
        model && model._qipuView,
        model && model.currentQipu,
      ].filter(Boolean);
      const propertyNames = (value) => {
        const names = new Set();
        let current = value;
        for (let depth = 0; current && depth < 3; depth += 1) {
          try { Object.getOwnPropertyNames(current).forEach(name => names.add(name)); } catch (_) { /* Ignore protected objects. */ }
          try { current = Object.getPrototypeOf(current); } catch (_) { current = null; }
        }
        return [...names];
      };
      const displayAncestorRoots = (seeds) => {
        const roots = [];
        const seen = new WeakSet();
        for (const seed of seeds.filter(Boolean)) {
          let current = seed;
          for (let depth = 0; current && typeof current === 'object' && depth < 12; depth += 1) {
            if (!seen.has(current)) { seen.add(current); roots.push(current); }
            let parent = null;
            try { parent = current.parent || current._parent; } catch (_) { parent = null; }
            if (!parent || parent === current || parent === window || parent === document) break;
            current = parent;
          }
        }
        return roots;
      };
      let notifyOwnerCache = null;
      let notifySearchAt = 0;
      let notifySearches = 0;
      const notificationOwner = () => {
        if (notifyOwnerCache && Object.prototype.hasOwnProperty.call(notifyOwnerCache, 'NOTIFY_QIPU_DATA')) return notifyOwnerCache;
        // The board notification object is installed asynchronously. Avoid a
        // complete fdk traversal on each 200ms polling iteration.
        if (Date.now() - notifySearchAt < 1_000) return null;
        notifySearchAt = Date.now();
        notifySearches += 1;
        notifyOwnerCache = findObjectWithOwnProperty(window.fdk, 'NOTIFY_QIPU_DATA', 100_000)
          || findObjectWithProperty(window.fdk, 'NOTIFY_QIPU_DATA', 100_000)
          // A few Tencent builds expose the notification bus on `window`
          // rather than on the fdk facade. Keep this as a last, bounded
          // fallback; the active entry is still restricted to index 0 below.
          || findObjectWithOwnProperty(window, 'NOTIFY_QIPU_DATA', 30_000)
          || findObjectWithProperty(window, 'NOTIFY_QIPU_DATA', 30_000);
        return notifyOwnerCache;
      };
      const boardControls = () => {
        const controls = [];
        const notifyOwner = notificationOwner();
        try {
          const entries = notifyOwner && notifyOwner.NOTIFY_QIPU_DATA;
          // QQ keeps several historical/detail boards alive at once. Only the
          // first notification entry is the currently displayed game; walking
          // every root here makes a previous game look like the current one.
          const entry = Array.isArray(entries) ? entries[0] : entries;
          const current = entry && (entry.thisObj || entry)._boardControl;
          if (current && typeof current === 'object') controls.push(current);
        } catch (_) { /* QQ H5 may replace notification state while a game is loading. */ }
        // Some revisions omit NOTIFY_QIPU_DATA entirely and retain the active
        // controller on the model's current detail object. Use only the
        // explicitly named current roots, never a scan of every historical
        // qipu/list object, so an earlier game cannot become the target.
        if (!controls.length) {
          for (const root of [model && model.currentQipu, model && model._qipuView]) {
            if (!root || typeof root !== 'object') continue;
            let current = null;
            try {
              current = root._boardControl || root.boardControl || root.thisObj && root.thisObj._boardControl;
              if (!current) {
                const owner = findObjectWithProperty(root, '_boardControl', 8_000);
                current = owner && owner._boardControl;
              }
            } catch (_) { current = null; }
            if (current && typeof current === 'object') { controls.push(current); break; }
          }
        }
        return controls;
      };
      const detailDisplayRoots = () => {
        const seeds = [...boardControls(), model && model._qipuView, model && model.currentQipu];
        const notifyOwner = notificationOwner();
        try {
          const entries = notifyOwner && notifyOwner.NOTIFY_QIPU_DATA;
          for (const entry of Array.isArray(entries) ? entries : [entries]) {
            if (!entry) continue;
            seeds.push(entry, entry.thisObj, entry._boardControl, entry.thisObj && entry.thisObj._boardControl);
          }
        } catch (_) { /* The active detail view can be replaced between games. */ }
        return displayAncestorRoots(seeds);
      };
      let moveOwnerCache = null;
      let moveOwnerSearchAt = 0;
      const moveSurfaceOwners = () => {
        if (moveOwnerCache && ('getQipuMoveStep' in moveOwnerCache)) return [moveOwnerCache];
        if (Date.now() - moveOwnerSearchAt < 1_000) return [];
        moveOwnerSearchAt = Date.now();
        for (const root of [model, window.fdk, model && model._qipuView, model && model.currentQipu, window]) {
          const owner = findObjectWithOwnProperty(root, 'getQipuMoveStep', 100_000)
            || findObjectWithProperty(root, 'getQipuMoveStep', 100_000);
          if (owner) { moveOwnerCache = owner; return [owner]; }
        }
        return [];
      };
      const qipuSources = (extraSources = []) => {
        const controls = boardControls();
        return [
          ...extraSources,
          ...controls,
          ...moveSurfaceOwners(),
          ...controls.flatMap(control => [control && control._qipuData, control && control._qipuInfo]),
          ...bridgeRoots(),
          model._qipuData,
          model._qipuInfo,
          model.currentQipu,
        ].filter(Boolean);
      };
      const moveText = (value) => {
        if (value == null) return '';
        if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
        try { return JSON.stringify(value); } catch (_) { return ''; }
      };
      const knownMoveField = /(?:^|\.)(?:getQipuMoveStep|getMainMoveList|getLessonNextMoveStep|qipuMoveStep|_qipuMoveStep|moveStep|_moveStep|moveList|_moveList|MOVE_STR|moveData)$/i;
      const safeMoveText = /^[0-9,\s\[\]]+$/;
      const stringifyMoveValue = (value) => {
        if (!value || typeof value !== 'object') return { status: 'not-object', text: '', length: 0 };
        try {
          const text = String(value).trim();
          if (!text) return { status: 'empty', text: '', length: 0 };
          if (text.length > 32 * 1024) return { status: 'too-long', text: '', length: text.length };
          return { status: 'ok', text, length: text.length };
        } catch (_) {
          return { status: 'error', text: '', length: 0 };
        }
      };
      const materializeMoveValue = (value, owner = null) => {
        if (typeof value !== 'function') return value;
        try {
          const result = value.call(owner);
          return result === value ? null : result;
        } catch (_) {
          return null;
        }
      };
      const moveCandidate = (value, path, owner = null) => {
        value = materializeMoveValue(value, owner);
        if (value == null) return null;
        const perMoveField = /(?:getMainMoveList|getLessonNextMoveStep)$/i.test(path);
        const digitStreamField = !perMoveField && /(?:getQipuMoveStep|qipuMoveStep|_?moveStep)$/i.test(path);
        const dhtmlField = knownMoveField.test(path);
        // Some H5 revisions expose the move stream through a Proxy or a
        // typed-array-like wrapper. It has numeric indexes and a bounded
        // length but is not an Array, so Array.isArray would drop valid data.
        const arrayLike = Array.isArray(value) || ArrayBuffer.isView(value)
          || (value && typeof value === 'object'
            && Number.isInteger(value.length)
            && value.length >= 0
            && value.length <= 4096);
        let arrayItems = [];
        if (arrayLike) {
          try { arrayItems = Array.from(value); } catch (_) { arrayItems = []; }
        }
        // QQ's live board exposes DhtmlXQ coordinates as an array. The proven
        // exporter consumes Array#toString() and removes commas; JSON encoding
        // turns string elements into quoted JSON and made this exact live field
        // look invalid. Prefer primitive/boxed numeric members, then use the
        // bounded whole-value toString fallback for Tencent's wrapper objects.
        const numericToken = (item) => {
          let token = item;
          if (token && typeof token === 'object') {
            try { token = token.valueOf(); } catch (_) { return null; }
            if (token === item) return null;
          }
          if (typeof token === 'number' && Number.isInteger(token)) return String(token);
          if (typeof token === 'string' && /^\d+$/.test(token)) return token;
          return null;
        };
        const numericTokens = dhtmlField && arrayLike ? arrayItems.map(numericToken) : [];
        const numericArray = numericTokens.length > 0 && numericTokens.every(Boolean)
          && (digitStreamField
            ? numericTokens.every(token => token.length === 1 && Number(token) <= 9)
            : numericTokens.every(token => token.length === 4));
        const wholeValue = dhtmlField ? stringifyMoveValue(value) : null;
        const wholeText = wholeValue && wholeValue.status === 'ok' && wholeValue.text !== '[object Object]'
          ? wholeValue.text
          : '';
        // Only use a whole-value serialization as a coordinate stream when it
        // contains the restricted DhtmlXQ alphabet. Otherwise retain JSON/ICCS
        // object extraction for legitimate non-Dhtml move aliases.
        const text = numericArray
          ? numericTokens.join('')
          : arrayLike && numericTokens.length > 0 && numericTokens.every(Boolean)
          ? numericTokens.join('')
          : wholeText && safeMoveText.test(wholeText) ? wholeText : moveText(value);
        if (!text || text === '[]' || text === '{}') return null;
        const type = numericArray
          ? `array<${arrayItems.every(item => typeof item === 'number') ? 'number' : 'numeric-string'}>`
          : wholeText && safeMoveText.test(wholeText)
          ? `${Array.isArray(value) ? 'array' : 'object'}<toString>`
          : arrayLike ? 'array-like' : typeof value;
        const iccs = (text.match(/[a-i][0-9][a-i][0-9]/gi) || []).length;
        const chinese = (text.match(/[车車马馬炮砲兵卒相象仕士帅将將帥][前后後中一二三四五六七八九１２３４５６７８９][进退平][前后後中一二三四五六七八九１２３４５６７８９]/g) || []).length;
        const compactDigits = text.replace(/[^0-9]/g, '');
        const dhtml = dhtmlField
          && safeMoveText.test(text)
          && compactDigits.length >= 4
          && compactDigits.length % 4 === 0;
        // Do not accept a generic object merely because its property contains
        // "move". Board animations such as moveFailEffect are not move lists.
        if (!iccs && !chinese && !dhtml) return null;
        return { text: dhtml ? compactDigits : text, path, type, length: text.length, score: dhtml * 120 + iccs * 100 + chinese * 80 + (Array.isArray(value) ? value.length : 0) + Math.min(text.length, 40) / 100, owner };
      };
      const readRawMoves = (extraSources = []) => {
        const candidates = [];
        const visit = (value, path, depth) => {
          if (depth > 2 || !value || typeof value !== 'object') return;
          for (const key of propertyNames(value).slice(0, 120)) {
            if (!/(?:qipu.*move|move|step|notation|record|chess.*data)/i.test(key)) continue;
            try {
              const child = value[key];
              const candidate = moveCandidate(child, `${path}.${key}`, value);
              if (candidate) candidates.push(candidate);
              visit(child, `${path}.${key}`, depth + 1);
            } catch (_) { /* Ignore transient getters. */ }
          }
        };
        for (const [sourceIndex, source] of qipuSources(extraSources).entries()) {
          const path = `source[${sourceIndex}]`;
          try {
            for (const key of ['getQipuMoveStep', 'getMainMoveList', 'getLessonNextMoveStep', 'qipuMoveStep', '_qipuMoveStep', 'moveStep', '_moveStep', 'moveList', '_moveList', 'MOVE_STR', 'moveData']) {
              if (!(key in source)) continue;
              const candidate = moveCandidate(source[key], `${path}.${key}`, source);
              if (candidate) candidates.push(candidate);
            }
            visit(source, path, 0);
          } catch (_) { /* A page model can expose transient getters while loading. */ }
        }
        candidates.sort((left, right) => right.score - left.score || right.length - left.length);
        return candidates[0] || { text: '', path: '', type: '', length: 0, score: 0 };
      };
      const directNotifyMove = () => {
        const owner = notificationOwner();
        try {
          const entries = owner && owner.NOTIFY_QIPU_DATA;
          const entry = Array.isArray(entries) ? entries[0] : entries;
          const control = entry && (entry.thisObj || entry)._boardControl;
          return moveCandidate(control && control.getQipuMoveStep, 'NOTIFY_QIPU_DATA[0].thisObj._boardControl.getQipuMoveStep', control);
        } catch (_) { return null; }
      };
      const directModelMove = () => {
        for (const owner of moveSurfaceOwners()) {
          try {
            const candidate = moveCandidate(owner.getQipuMoveStep, 'QipuModel.*.getQipuMoveStep', owner);
            if (candidate) return candidate;
          } catch (_) { /* The live board can be replaced while changing games. */ }
        }
        return null;
      };
      const moveFieldSnapshot = (key, value, owner = null) => {
        value = materializeMoveValue(value, owner);
        const base = `${key}:${Array.isArray(value) ? `array(${value.length})` : typeof value}`;
        if (!knownMoveField.test(key) || (!Array.isArray(value) && (!value || typeof value !== 'object'))) return base;
        const elementTypes = Array.isArray(value)
          ? [...new Set(value.slice(0, 12).map(item => item === null ? 'null' : typeof item))].join('|') || 'empty'
          : '';
        const serialized = stringifyMoveValue(value);
        if (!serialized || serialized.status !== 'ok') {
          return `${base}${elementTypes ? ` · elements:${elementTypes}` : ''} · toString:${serialized ? serialized.status : 'unavailable'}`;
        }
        const compact = serialized.text.replace(/[^0-9]/g, '');
        const coordinateStream = safeMoveText.test(serialized.text) && compact.length >= 4 && compact.length % 4 === 0;
        const sample = serialized.text.slice(0, 160).replace(/[^0-9,\s\[\]]/g, '?');
        return `${base}${elementTypes ? ` · elements:${elementTypes}` : ''} · toString:${serialized.length} chars · ${coordinateStream ? 'coordinate-candidate' : 'serialization-invalid'} · sample:${sample}`;
      };
      const bridgeSnapshot = (extraSources = []) => {
        const owner = notificationOwner();
        let notifyState = `NOTIFY_QIPU_DATA:${owner ? 'found' : 'missing'} (searched ${notifySearches} times)`;
        if (owner) try {
          const entries = owner.NOTIFY_QIPU_DATA;
          const entry = Array.isArray(entries) ? entries[0] : entries;
          const control = entry && (entry.thisObj || entry)._boardControl;
          notifyState += ` · entries:${Array.isArray(entries) ? entries.length : 1} · boardControl:${control ? typeof control : 'missing'} · ${control ? moveFieldSnapshot('getQipuMoveStep', control.getQipuMoveStep, control) : 'getQipuMoveStep:missing'}`;
        } catch (_) { notifyState += ' · entries:unavailable'; }
        const modelDetail = ['jumpQipuGame', 'requestGetQipuInfo', '_qipuRecentView', '_qipuWallDataList', '_qipuWallPreViewData']
          .map(key => `${key}:${typeof model[key]}`).join(', ');
        const sources = qipuSources(extraSources).slice(0, 12).map((source, index) => {
        const fields = propertyNames(source)
          .filter(key => /(?:qipu|move|step|notation|record|chess|board|data)/i.test(key))
          .slice(0, 24)
          .map(key => {
            try {
              const value = source[key];
              return moveFieldSnapshot(key, value, source);
            } catch (_) { return `${key}:unavailable`; }
          });
        const nested = propertyNames(source)
          .filter(key => /(?:qipu|record|list|data)/i.test(key))
          .slice(0, 6)
          .map(key => {
            try {
              const value = source[key];
              const item = Array.isArray(value) ? value[0] : value;
              if (!item || typeof item !== 'object') return '';
              const itemFields = propertyNames(item)
                .filter(name => /(?:qipu|move|step|notation|record|chess|player|date|result)/i.test(name))
                .slice(0, 18)
                .map(name => {
                  try {
                    const field = item[name];
                    return moveFieldSnapshot(name, field);
                  } catch (_) { return `${name}:unavailable`; }
                });
              return itemFields.length ? `${key}[0]{${itemFields.join(', ')}}` : '';
            } catch (_) { return ''; }
          })
          .filter(Boolean);
          return `source[${index}] ${[fields.join(', '), ...nested].filter(Boolean).join(' | ') || '(no known chess fields)'}`;
        });
        return [notifyState, `QipuModel ${modelDetail}`, ...sources].join('\n').slice(0, 8 * 1024);
      };
      const normalizeInitialFen = (value) => {
        if (typeof value !== 'string') return '';
        const text = value.trim();
        if (!text.includes('/') || text.length > 240) return '';
        const fields = text.split(/\s+/).filter(Boolean);
        const placement = fields[0] || '';
        const ranks = placement.split('/');
        if (ranks.length !== 10) return '';
        for (const rank of ranks) {
          let files = 0;
          for (const symbol of rank) {
            if (/^[1-9]$/.test(symbol)) {
              files += Number(symbol);
            } else if (/^[rheakcpRHEAKCPnbagpsNBAGPS]$/.test(symbol)) {
              files += 1;
            } else {
              return '';
            }
          }
          if (files !== 9) return '';
        }
        const side = /^(?:w|r|b)$/.test(fields[1] || '') ? (fields[1] === 'r' ? 'w' : fields[1]) : 'w';
        return `${placement} ${side} - - 0 1`;
      };
      const snapshotToFen = (value) => {
        if (!value || typeof value !== 'object') return '';
        const entries = Array.isArray(value)
          ? value
          : ['pieces', 'chessmen', 'men', 'items', 'squares', 'board'].map(key => value[key]).find(candidate => Array.isArray(candidate))
            || Object.values(value);
        if (!entries.length || entries.length > 64) return '';
        const pieceMap = new Map([
          ['k', 'k'], ['king', 'k'], ['帅', 'k'], ['将', 'k'], ['将帅', 'k'],
          ['a', 'a'], ['advisor', 'a'], ['guard', 'a'], ['仕', 'a'], ['士', 'a'],
          ['b', 'b'], ['e', 'b'], ['elephant', 'b'], ['象', 'b'], ['相', 'b'],
          ['n', 'n'], ['h', 'n'], ['horse', 'n'], ['马', 'n'],
          ['r', 'r'], ['rook', 'r'], ['chariot', 'r'], ['车', 'r'],
          ['c', 'c'], ['炮', 'c'], ['砲', 'c'], ['cannon', 'c'],
          ['p', 'p'], ['pawn', 'p'], ['兵', 'p'], ['卒', 'p'],
        ]);
        const pieces = [];
        for (const entry of entries) {
          if (!entry || typeof entry !== 'object') continue;
          const read = (keys) => {
            for (const key of keys) {
              try {
                const candidate = entry[key];
                if (candidate !== undefined && candidate !== null && candidate !== '') return candidate;
              } catch (_) { /* Ignore transient piece getters. */ }
            }
            return undefined;
          };
          const rowValue = read(['row', 'rank', 'y', 'r']);
          const colValue = read(['col', 'file', 'x', 'c']);
          const row = typeof rowValue === 'number' ? rowValue : (typeof rowValue === 'string' && /^\d+$/.test(rowValue) ? Number(rowValue) : NaN);
          const col = typeof colValue === 'number' ? colValue : (typeof colValue === 'string' && /^\d+$/.test(colValue) ? Number(colValue) : NaN);
          if (!Number.isInteger(row) || row < 0 || row > 9 || !Number.isInteger(col) || col < 0 || col > 8) return '';
          const kindValue = String(read(['kind', 'type', 'piece', 'role', 'name', 'chessman']) ?? '').trim().toLowerCase();
          const kind = pieceMap.get(kindValue) || pieceMap.get(kindValue.replace(/[^a-z\u4e00-\u9fff]/g, ''));
          if (!kind) return '';
          const sideValue = String(read(['color', 'side', 'camp', 'team', 'player']) ?? '').trim().toLowerCase();
          const red = /red|\u7ea2|\u65b91|^r$|^1$/.test(sideValue);
          const black = /black|\u9ed1|\u65b92|^b$|^0$/.test(sideValue);
          if (!red && !black) return '';
          pieces.push({ row, col, symbol: red ? kind.toUpperCase() : kind });
        }
        if (pieces.length < 2 || pieces.filter(piece => piece.symbol === 'K').length !== 1 || pieces.filter(piece => piece.symbol === 'k').length !== 1) return '';
        const squares = new Map();
        for (const piece of pieces) {
          const key = `${piece.row}-${piece.col}`;
          if (squares.has(key)) return '';
          squares.set(key, piece.symbol);
        }
        const placement = Array.from({ length: 10 }, (_, row) => {
          let empty = 0;
          let rank = '';
          for (let col = 0; col < 9; col += 1) {
            const symbol = squares.get(`${row}-${col}`);
            if (!symbol) { empty += 1; continue; }
            if (empty) { rank += String(empty); empty = 0; }
            rank += symbol;
          }
          if (empty) rank += String(empty);
          return rank;
        }).join('/');
        return `${placement} w - - 0 1`;
      };
      const initialFen = () => {
        const roots = boardControls().flatMap(control => [
          control,
          control && control._qipuData,
          control && control._qipuInfo,
          control && control.qipuData,
          control && control.qipuInfo,
        ]).filter(Boolean);
        const seen = new WeakSet();
        const stack = roots.map(value => ({ value, depth: 0 }));
        let visited = 0;
        while (stack.length && visited < 8_000) {
          const { value, depth } = stack.pop();
          if (!value || typeof value !== 'object' || seen.has(value) || depth > 6) continue;
          seen.add(value); visited += 1;
          for (const key of propertyNames(value).slice(0, 120)) {
            if (/(?:^|_)(?:cookie|token|ticket|skey|p_skey|credential|password|html)(?:$|_)/i.test(key)) continue;
            try {
              const child = value[key];
              if (typeof child === 'string') {
                const fen = normalizeInitialFen(child);
                if (fen) return fen;
              } else if (typeof child === 'function' && /(?:fen|position|start|initial)/i.test(key)) {
                let result; try { result = child.call(value); } catch (_) { result = null; }
                const fen = normalizeInitialFen(result);
                if (fen) return fen;
              } else if (child && typeof child === 'object' && /(?:initial|start|origin|snapshot|position|pieces|chessmen)/i.test(key)) {
                const fen = snapshotToFen(child);
                if (fen) return fen;
              } else if (child && typeof child === 'object' && /(?:fen|init|start|qipu|board|chess|data|info|ju|jumian|局面)/i.test(key)) {
                stack.push({ value: child, depth: depth + 1 });
              }
            } catch (_) { /* Ignore transient board-control fields. */ }
          }
        }
        return '';
      };
      const isPrivateBridgeField = (key) => {
        const text = String(key);
        return /cookie|token|ticket|skey|credential|password|uin|avatar|face/i.test(text)
          || (/html/i.test(text) && !/^(?:DhtmlXQ_)?comment\d+_\d+$/i.test(text));
      };
      const boundedBranchJson = (value) => {
        try {
          const encoded = JSON.stringify(value);
          if (encoded.length <= 32 * 1024) return encoded;
          // Branch candidates can be very large (hundreds of routes), while
          // annotations are the user-visible payload that must survive the
          // safety bound. Trim structural candidates first and retain as many
          // complete annotation rows as fit in the bounded envelope.
          const annotations = Array.isArray(value && value.annotations) ? value.annotations : [];
          const candidates = Array.isArray(value && value.candidates) ? value.candidates : [];
          const keySamples = Array.isArray(value && value.annotationKeySamples) ? value.annotationKeySamples.slice(0, 24) : [];
          const retained = [];
          const base = {
            bridgeVersion: value && value.bridgeVersion || __TTXQ_BRIDGE_VERSION__,
            payloadTruncated: true,
            annotationKeySamples: keySamples,
            annotationsComplete: value && value.annotationsComplete !== false,
            routeNumbers: Array.isArray(value && value.routeNumbers) ? value.routeNumbers.slice(0, 16) : [],
            visibleRouteNumbers: Array.isArray(value && value.visibleRouteNumbers) ? value.visibleRouteNumbers.slice(0, 16) : [],
            routeFailures: Array.isArray(value && value.routeFailures) ? value.routeFailures.slice(0, 16) : [],
            candidates: [],
            annotations: retained,
          };
          for (const annotation of annotations.slice(0, 256)) {
            retained.push(annotation);
            if (JSON.stringify(base).length > 32 * 1024) {
              retained.pop();
              base.annotationsComplete = false;
              break;
            }
          }
          // Keep branch routing usable when possible by reducing diagnostic
          // path/value metadata before dropping candidates altogether.
          const compactCandidates = candidates.slice(0, 256).map(candidate => ({
            path: String(candidate && candidate.path || '').replace(/^.*?(getMoveBranchKey\.\d+-\d+-\d+)$/, '$1'),
            raw: String(candidate && candidate.raw || '').slice(0, 32 * 1024),
            afterPly: Number.isInteger(candidate && candidate.afterPly) ? candidate.afterPly : null,
            routeNo: Number.isInteger(candidate && candidate.routeNo) ? candidate.routeNo : null,
            comment: String(candidate && candidate.comment || '').slice(0, 240),
          }));
          for (const candidate of compactCandidates) {
            base.candidates.push(candidate);
            if (JSON.stringify(base).length > 32 * 1024) {
              base.candidates.pop();
              break;
            }
          }
          return JSON.stringify({
            ...base,
            payloadTruncated: true,
            annotationCount: annotations.length,
          });
        } catch (_) {
          return JSON.stringify({ serializationFailed: true, annotationsComplete: false, candidates: [] });
        }
      };
      const localSnapshotSignature = (value) => {
        let encoded = '';
        try { encoded = JSON.stringify(value); } catch (_) { return ''; }
        if (!encoded) return '';
        let hash = 2166136261;
        for (let index = 0; index < encoded.length; index += 1) {
          hash ^= encoded.charCodeAt(index);
          hash = Math.imul(hash, 16777619);
        }
        return `${encoded.length}:${(hash >>> 0).toString(16)}`;
      };
      const branchPayload = (preferredControl = null) => {
        // Branch and annotation graphs are independent QQ objects. Keep their
        // budgets separate so a large msgContainer cannot starve branch data.
        const overallDeadline = Number.isFinite(branchPayload.deadline)
          ? branchPayload.deadline
          : Number.POSITIVE_INFINITY;
        // Annotation traversal runs first, so start the branch budget only
        // when branch traversal begins. Otherwise a slow msgContainer would
        // consume most of the advertised branch window.
        let branchDeadline = overallDeadline;
        const collectAnnotationData = branchPayload.skipAnnotations !== true;
        const annotationDeadline = collectAnnotationData
          ? Math.min(Date.now() + 2500, overallDeadline)
          : Date.now();
        let branchScanTimedOut = false;
        let annotationScanTimedOut = false;
        let branchKeySeen = false;
        let unknownBranchKeySeen = false;
        const branchScanExpired = () => {
          if (Date.now() < branchDeadline) return false;
          branchScanTimedOut = true;
          return true;
        };
        const annotationScanExpired = () => {
          if (Date.now() < annotationDeadline) return false;
          annotationScanTimedOut = true;
          return true;
        };
        const materializeBranchValue = (value, owner = null) => {
          if (typeof value !== 'function') return value;
          // The standalone branch harness used by regression tests may omit
          // the move-field helper; preserve the raw value in that case.
          if (typeof materializeMoveValue !== 'function') return value;
          return materializeMoveValue(value, owner);
        };
        // Detect coordinate-bearing values below an unknown branch key. This
        // lets newer QQ encodings fail closed while ignoring empty metadata
        // wrappers and labels.
        const branchCoordinateText = (value) => {
          const primitiveToken = (item) => {
            if (typeof item === 'number' && Number.isInteger(item)) return String(item);
            if (typeof item === 'string' && /^\d+$/.test(item)) return item;
            return null;
          };
          let text = '';
          if (Array.isArray(value)) {
            const tokens = value.map(primitiveToken);
            if (tokens.length && tokens.every(Boolean)) text = tokens.join('');
          }
          if (!text && (typeof value === 'string' || typeof value === 'number')) text = String(value).trim();
          if (!text && value && typeof value === 'object') {
            for (const key of ['moves', 'move', 'raw', 'line', 'data', 'value', 'step', 'steps', 'moveList', 'variationMoves']) {
              let nested; try { nested = value[key]; } catch (_) { nested = null; }
              if (Array.isArray(nested)) {
                const tokens = nested.map(primitiveToken);
                if (tokens.length && tokens.every(Boolean)) { text = tokens.join(''); break; }
              } else if (typeof nested === 'string' || typeof nested === 'number') {
                text = String(nested).trim();
                if (text) break;
              }
            }
          }
          if (!text || text.length > 32 * 1024) return '';
          const compactDigits = text.replace(/[^0-9]/g, '');
          const dhtml = safeMoveText.test(text) && compactDigits.length >= 4 && compactDigits.length % 4 === 0;
          const tagged = text.includes('[DhtmlXQ_move_') || text.includes('[DhtmlXQ_movelist]');
          const iccs = (text.match(/[a-i][0-9][a-i][0-9]/gi) || []).length;
          const chinese = (text.match(/[车車马馬炮砲兵卒相象仕士帅将將帥][前后後中一二三四五六七八九１２３４５６７８９][进退平][前后後中一二三四五六七八九１２３４５６７８９]/g) || []).length;
          return dhtml ? compactDigits : (tagged || iccs || chinese ? text : '');
        };
        const branchPlyHint = (path, owner) => {
          const dhtmlKey = String(path).match(/(?:^|\.)(\d+)-(\d+)-(\d+)$/);
          if (dhtmlKey) return Number(dhtmlKey[2]);
          if (owner && typeof owner === 'object') {
            for (const key of ['afterPly', 'after_ply', 'ply', 'parentPly', 'moveIndex', 'stepIndex', 'startPly', 'branchPly']) {
              try {
                const value = owner[key];
                if (Number.isInteger(value) && value >= 0) return value;
                if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
              } catch (_) { /* Ignore transient branch getters. */ }
            }
          }
          const numbers = String(path).match(/\d+/g) || [];
          return numbers.length ? Number(numbers[numbers.length - 1]) : undefined;
        };
        const branchMoveCandidate = (value, path, owner = null) => {
          if (/(?:^|\.)(?:getQipuMoveStep|qipuMoveStep|_qipuMoveStep)$/.test(path) && !/^route\[\d+\]\./.test(path)) return null;
          if (/(?:^|\.)(?:msg|_msg|comment|remark|note)$/i.test(path)) return null;
          if (/(?:^|\.)(?:content|text|body|title|label|description)(?:\.|$)/i.test(path)) return null;
          const directDhtmlBranch = /(?:^|\.)getMoveBranchKey\.\d+-\d+-\d+(?:\.|$)/.test(path);
          const activatedRoute = /^route\[\d+\]\./.test(path);
          if (!directDhtmlBranch && !activatedRoute) return null;
          if (directDhtmlBranch && !/(?:^|\.)getMoveBranchKey\.\d+-\d+-\d+$/.test(path)) return null;
          let text = '';
          const primitiveToken = (item) => {
            if (typeof item === 'number' && Number.isInteger(item)) return String(item);
            if (typeof item === 'string' && /^\d+$/.test(item)) return item;
            return null;
          };
          if (Array.isArray(value)) {
            const tokens = value.map(primitiveToken);
            if (tokens.length && tokens.every(Boolean)) text = tokens.join('');
          }
          if (!text && (typeof value === 'string' || typeof value === 'number')) text = String(value).trim();
          if (!text && value && typeof value === 'object') {
            // A branch wrapper may expose an explicit move field, but its
            // object stringification is often a renderer/debug label. Never
            // serialize an arbitrary object because msg metadata can contain
            // coordinate-looking text.
            for (const key of ['moves', 'move', 'raw', 'line', 'data']) {
              let nested; try { nested = value[key]; } catch (_) { nested = null; }
              if (Array.isArray(nested)) {
                const tokens = nested.map(primitiveToken);
                if (tokens.length && tokens.every(Boolean)) { text = tokens.join(''); break; }
              } else if (typeof nested === 'string' || typeof nested === 'number') {
                text = String(nested).trim();
                if (text) break;
              }
            }
            if (!text) for (const key of ['value', 'step', 'steps', 'moveList', 'variationMoves']) {
              let nested; try { nested = value[key]; } catch (_) { nested = null; }
              if (Array.isArray(nested)) {
                const tokens = nested.map(primitiveToken);
                if (tokens.length && tokens.every(Boolean)) { text = tokens.join(''); break; }
              } else if (typeof nested === 'string' || typeof nested === 'number') {
                text = String(nested).trim();
                if (text) break;
              }
            }
          }
          if (!text || text.length > 32 * 1024) return null;
          const compactDigits = text.replace(/[^0-9]/g, '');
          const dhtml = safeMoveText.test(text) && compactDigits.length >= 4 && compactDigits.length % 4 === 0;
          const tagged = text.includes('[DhtmlXQ_move_') || text.includes('[DhtmlXQ_movelist]');
          const iccs = (text.match(/[a-i][0-9][a-i][0-9]/gi) || []).length;
          const chinese = (text.match(/[车車马馬炮砲兵卒相象仕士帅将將帥][前后後中一二三四五六七八九１２３４５６７８９][进退平][前后後中一二三四五六七八九１２３４５６７８９]/g) || []).length;
          if (!dhtml && !tagged && !iccs && !chinese) return null;
          return {
            path,
            raw: dhtml ? compactDigits : text.slice(0, 32 * 1024),
            valueType: Array.isArray(value) ? 'array' : typeof value,
            afterPly: branchPlyHint(path, owner),
          };
        };
        const collectBranchCandidates = (roots) => {
          const candidates = [];
          const seen = new WeakSet();
          const stack = roots.filter(Boolean).map(({ value, path }) => ({ value, path, depth: 0, owner: null }));
          let visited = 0;
          while (stack.length && visited < 4000 && candidates.length < 256 && !branchScanExpired()) {
            const { value, path, depth, owner } = stack.pop();
            if (value == null) continue;
            const candidate = branchMoveCandidate(value, path, owner);
            if (candidate) candidates.push(candidate);
            if (!value || typeof value !== 'object' || depth >= 7 || seen.has(value)) continue;
            seen.add(value); visited += 1;
            for (const key of propertyNames(value).slice(0, 100)) {
              if (branchScanExpired()) break;
              if (isPrivateBridgeField(key)) continue;
              // Tencent's msg rows mix branch payloads with comment metadata.
              // Keep unknown/obfuscated keys available, but never interpret
              // stable account, author, or timestamp fields as coordinates.
              if (/^(?:msg|comment|remark|note|content|text|body|title|label|description|id|uUin|uin|userId|userName|uname|nickName|avatar|face|time|date|timestamp|createTime|updateTime|qipuId)$/i.test(key)) continue;
              try {
                const child = value[key];
                const namedBranchField = /(?:move|step|branch|qipu|data|list|line|DhtmlXQ|key|^\d+(?:-\d+-\d+)?$)/i.test(key);
                const insideBranchContainer = /(?:branch|variation|getMoveBranchKey)/i.test(path);
                if (!namedBranchField && !insideBranchContainer) continue;
                const childPath = `${path}.${key}`;
                // A numeric A-B-C property is only a real branch signal when
                // its value already contains a bounded, coordinate-like move
                // payload. Empty wrappers are common around msg metadata and
                // must not block a mainline-only import after a scan timeout.
                const knownBranchKey = /^\d+-\d+-\d+$/.test(String(key));
                const childCandidate = knownBranchKey
                  ? branchMoveCandidate(child, childPath, value)
                  : null;
                if (childCandidate) branchKeySeen = true;
                if (!knownBranchKey
                  && /(?:^|\.)getMoveBranchKey(?:\.|$)/.test(path)
                  && branchCoordinateText(child)) {
                  unknownBranchKeySeen = true;
                }
                stack.push({ value: child, path: childPath, depth: depth + 1, owner: value });
              } catch (_) { /* Ignore transient branch getters. */ }
            }
          }
          const seenSignatures = new Set();
          return candidates.filter(candidate => {
            // Two routes may legitimately start with the same coordinate
            // stream at the same local ply. Only mirrors of the same
            // A-B-C entry should collapse, so include the route key when it
            // is available instead of using the move text alone.
            const routeKey = String(candidate.path || '').match(/getMoveBranchKey\.(\d+-\d+-\d+)$/)?.[1];
            const signature = `${routeKey || candidate.afterPly || ''}:${candidate.raw}`;
            if (seenSignatures.has(signature)) return false;
            seenSignatures.add(signature);
            return true;
          });
        };
        const branchMessageContainers = (root, property, rootPath, limit = 8_000) => {
          const containers = [];
          if (!root || typeof root !== 'object') return containers;
          const seen = new WeakSet();
          const returned = new WeakSet();
          // QQ's current board shape is boardControl.Eb.wn.msgContainer. A
          // broad object-graph walk can spend the whole annotation budget on
          // renderer state before reaching this small object. Follow only
          // chess/comment-shaped properties, and return the container itself
          // so callers do not accidentally append a second `.msgContainer`.
          const relevant = /(?:msg(?:Container)?|comments?|annotation|comment|message|Eb|wn|board|qipu|data)/i;
          // Fast paths for the shapes used by current Tencent builds. These
          // avoid losing the container when a display object exposes more
          // than 120 renderer properties before Eb/wn is enumerated.
          const direct = [
            [property, root && root[property]],
            ['msgContainer', root && root.msgContainer],
            ['msg', root && root.msg],
            ['commentV2', root && root.commentV2],
            ['Eb.wn.msgContainer', root && root.Eb && root.Eb.wn && root.Eb.wn.msgContainer],
            ['Eb.msgContainer', root && root.Eb && root.Eb.msgContainer],
            ['wn.msgContainer', root && root.wn && root.wn.msgContainer],
            ['comments', root && root.comments],
          ];
          for (const [suffix, value] of direct) {
            if (!value || typeof value !== 'object' || returned.has(value)) continue;
            returned.add(value);
            containers.push({ value, path: `${rootPath}.${suffix}` });
          }
          // In the FDK build used by self-recorded games the annotation
          // container is often attached below a private display link (for
          // example `_targetChessBoardLink`) and is not reachable through the
          // first 120 enumerable renderer properties.  Resolve only the exact
          // approved `msg`/`msgContainer` owners on the active controller; do
          // not walk arbitrary social/comment objects or historical boards.
          for (const name of ['msgContainer', 'msg']) {
            try {
              const owner = findObjectWithOwnProperty(root, name, 16_000)
                || findObjectWithProperty(root, name, 16_000);
              const value = owner && owner[name];
              if (value && typeof value === 'object' && !returned.has(value)) {
                returned.add(value);
                containers.push({ value, path: `${rootPath}.*.${name}` });
              }
            } catch (_) { /* Display getters can disappear during a route switch. */ }
          }
          const stack = [{ value: root, path: rootPath, depth: 0 }];
          let visited = 0;
          while (stack.length && visited < limit && containers.length < 32 && !annotationScanExpired()) {
            const { value, path, depth } = stack.pop();
            if (!value || typeof value !== 'object' || seen.has(value) || depth > 10) continue;
            seen.add(value); visited += 1;
            for (const key of propertyNames(value).slice(0, 120)) {
              if (annotationScanExpired()) break;
              if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
              if (isPrivateBridgeField(key)) continue;
              let child; try { child = value[key]; } catch (_) { continue; }
              if (!child || typeof child !== 'object') continue;
              const childPath = `${path}.${key}`;
              if (/^(?:msg|msgContainer|commentV2|comments?|annotation(?:s|Container)?|message(?:s|Container)?)$/i.test(String(key))) {
                if (!returned.has(child)) {
                  returned.add(child);
                  containers.push({ value: child, path: childPath });
                }
              }
              // The FDK board keeps the annotation model behind private
              // display links (for example `_targetChessBoardLink`). Those
              // links do not contain the word "msg" themselves, but they are
              // still part of the current board controller. Follow only the
              // small set of known board-link names so a delayed/lazy
              // msgContainer is found without walking social/page state.
              const boardLink = /(?:targetChessBoardLink|chessBoardLink|boardLink|qipuBoard|displayLink)/i.test(String(key));
              if (relevant.test(String(key)) || relevant.test(path) || boardLink) {
                stack.push({ value: child, path: childPath, depth: depth + 1 });
              }
            }
          }
          return containers;
        };
        const directCommentV2Containers = (root, rootPath) => {
          if (!root || typeof root !== 'object') return [];
          const containers = [];
          const returned = new WeakSet();
          const candidates = [
            ['commentV2', () => root.commentV2],
            ['data.commentV2', () => root.data && root.data.commentV2],
            ['_qipuData.commentV2', () => root._qipuData && root._qipuData.commentV2],
            ['_qipuInfo.commentV2', () => root._qipuInfo && root._qipuInfo.commentV2],
            ['qipuData.commentV2', () => root.qipuData && root.qipuData.commentV2],
            ['qipuInfo.commentV2', () => root.qipuInfo && root.qipuInfo.commentV2],
          ];
          for (const [suffix, read] of candidates) {
            let value;
            try { value = read(); } catch (_) { continue; }
            if (!value || typeof value !== 'object' || returned.has(value)) continue;
            returned.add(value);
            containers.push({ value, path: `${rootPath}.${suffix}` });
          }
          return containers;
        };
        const routeNumberFromText = (value) => {
          const text = String(value == null ? '' : value).trim();
          // Self-recorded collections can expose dozens of routes (the
          // current UI has been observed with 24, 42 and 66). Keep this
          // bounded, but do not silently discard valid route controls merely
          // because the old UI happened to show at most sixteen.
          if (!/^\\d{1,3}$/.test(text)) return null;
          const number = Number(text);
          return number >= 1 && number <= 512 ? number : null;
        };
        const collectRouteControlGroup = (preferred) => {
          const textOf = (value) => {
            if (!value || typeof value !== 'object') return '';
            for (const key of ['text', '_text', 'value', '_value', 'label', '_label', 'name', '_name']) {
              try {
                const candidate = value[key];
                if ((typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim().length <= 32) return String(candidate).trim();
              } catch (_) { /* Display getters can disappear during a route switch. */ }
            }
            return '';
          };
          const childValues = (value) => {
            const children = [];
            for (const key of propertyNames(value).slice(0, 120)) {
              if (branchScanExpired()) break;
              if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
              if (isPrivateBridgeField(key)) continue;
              try {
                const child = value[key];
                if (child && typeof child === 'object') children.push(child);
              } catch (_) { /* Ignore inaccessible display properties. */ }
            }
            return children;
          };
          const contains = (root, target) => {
            if (!preferred || root === preferred) return true;
            const seen = new WeakSet();
            const stack = [{ value: root, depth: 0 }];
            let visited = 0;
            while (stack.length && visited < 6000 && !branchScanExpired()) {
              const item = stack.pop();
              if (item.value === target) return true;
              if (!item.value || typeof item.value !== 'object' || item.depth > 10 || seen.has(item.value)) continue;
              seen.add(item.value); visited += 1;
              for (const child of childValues(item.value)) stack.push({ value: child, depth: item.depth + 1 });
            }
          return false;
        };
          const roots = [
            preferred,
            ...(typeof detailDisplayRoots === 'function' ? detailDisplayRoots() : []),
          ].filter(Boolean);
          const seen = new WeakSet();
          const stack = roots.map(value => ({ value, depth: 0 }));
          let visited = 0;
          const groups = [];
          while (stack.length && visited < 12000 && groups.length < 8 && !branchScanExpired()) {
            const { value, depth } = stack.pop();
            if (!value || typeof value !== 'object' || depth > 12 || seen.has(value)) continue;
            seen.add(value); visited += 1;
            const children = childValues(value);
            const buttons = children
              .map(control => ({ routeNo: routeNumberFromText(textOf(control)), control }))
              .filter(item => item.routeNo != null && (
                typeof item.control.dispatchEvent === 'function'
                || typeof item.control.emit === 'function'
                || typeof item.control.click === 'function'
                || typeof item.control.onClick === 'function'
              ));
            const numbers = [...new Set(buttons.map(item => item.routeNo))].sort((a, b) => a - b);
            const consecutive = numbers.length >= 2 && numbers.length <= 512 && numbers[0] === 1
              && numbers.every((number, index) => number === index + 1);
            const context = [textOf(value), ...children.map(textOf)].filter(Boolean).join(' ');
            // Some H5 revisions render route controls as bare numbers and do
            // not include a textual "棋谱导航" label. Once the active board
            // has exposed either a real branch key or an annotation container,
            // the consecutive clickable group is unambiguous enough to use;
            // ordinary numeric toolbars still fail both evidence checks.
            const routeContext = /(?:编辑|完成|下一步|下变|播放|棋谱导航)/.test(context)
              || branchKeySeen
              || annotationContainerSeen;
            if (consecutive && routeContext && buttons.length === numbers.length && contains(value, preferred)) {
              groups.push({
                numbers,
                buttons: buttons.sort((a, b) => a.routeNo - b.routeNo),
                container: value,
              });
            }
            for (const child of children) stack.push({ value: child, depth: depth + 1 });
          }
          groups.sort((a, b) => b.numbers.length - a.numbers.length);
          return groups[0] || { numbers: [], buttons: [], container: null };
        };
        const discoveredControls = boardControls();
        // The move stream and the branch/comment graph are not guaranteed to
        // share an owner. In particular, some QQ builds expose
        // getQipuMoveStep on a model wrapper while the active controller owns
        // getMoveBranchKey/Eb.wn.msgContainer. Never let the move-field owner
        // suppress the active board controller's annotations.
        const annotationOnlyControl = branchPayload.annotationOnlyControl || null;
        const preferredLooksLikeBoardControl = preferredControl
          && typeof preferredControl === 'object'
          && ('getMoveBranchKey' in preferredControl
            || 'msgContainer' in preferredControl
            || 'Eb' in preferredControl
            || 'boardControl' in preferredControl);
        // The move-field owner is frequently a thin board wrapper while the
        // active notification entry owns Eb.wn.msgContainer. Keep the
        // explicitly selected controller first, then include the one current
        // controller returned by NOTIFY_QIPU_DATA[0]. This avoids losing
        // annotations without walking historical boards.
        const controls = [...new Set((annotationOnlyControl
          ? [annotationOnlyControl]
          : (preferredLooksLikeBoardControl
            ? [preferredControl, ...discoveredControls]
            : discoveredControls)
        ).filter(value => value && typeof value === 'object'))];
        const branchOwner = controls[0] || null;
        if (!controls.length) return { data: '', path: '', complete: true, owner: null, branchSignature: '', annotationSignature: '', branchKeySeen: false, unknownBranchKeySeen: false, annotationContainerSeen: false };
        const branchSources = [];
        const referenceContainers = [];
        const addBranchSource = (value, path) => {
          if (value == null) return;
          branchSources.push({ value, path });
        };
        const branchFieldNames = ['getMoveBranchKey'];
        // A route button/control can own a lazily mounted msgContainer after it
        // is clicked. It is an annotation root only: branch candidates still
        // come exclusively from getMoveBranchKey on the active board control.
        const cachedRouteControls = branchPayload.routeControls
          && Array.isArray(branchPayload.routeControls.buttons)
          ? branchPayload.routeControls.buttons.map(item => item && item.control).filter(Boolean)
          : [];
        // Selecting a numeric route does not have one stable storage shape in
        // Tencent's FDK builds. Some revisions attach msgContainer to the
        // clicked display object, while others replace it on the active board
        // controller. Read both approved roots after activation; the
        // annotation signature de-duplicates mirrored containers.
        const annotationControls = annotationOnlyControl
          ? [...new Set([annotationOnlyControl, ...controls])]
          : [...new Set([...controls, ...cachedRouteControls])];
        for (const [index, control] of controls.entries()) {
          for (const key of branchFieldNames) {
            try {
              if (!(key in control)) continue;
              const value = materializeBranchValue(control[key], control);
              addBranchSource(value, `boardControl[${index}].${key}`);
            } catch (_) { /* Ignore transient branch fields. */ }
          }
          for (const key of ['getMoveBranchKey']) {
            try {
              const owner = findObjectWithOwnProperty(control, key, 8_000);
              if (owner && owner !== control) {
                const value = materializeBranchValue(owner[key], owner);
                addBranchSource(value, `boardControl[${index}].*.${key}`);
              }
            } catch (_) { /* Branch message data is optional. */ }
          }
        }
        if (collectAnnotationData) {
          for (const [index, control] of annotationControls.entries()) {
            for (const container of branchMessageContainers(control, 'msg', `boardControl[${index}]`)) {
              // The reference exporter reads this container separately from
              // getMoveBranchKey. It contains annotations, never branch moves.
              referenceContainers.push(container);
            }
          }
        }
        const detailRoots = preferredControl ? []
          : [model && model._qipuView, model && model.currentQipu, model && model._qipuData, model && model._qipuInfo].filter(Boolean);
        for (const [index, root] of detailRoots.entries()) {
          for (const key of ['getMoveBranchKey']) {
            try {
              const owner = findObjectWithOwnProperty(root, key, 8_000);
              if (!owner) continue;
              const value = materializeBranchValue(owner[key], owner);
              addBranchSource(value, `detailRoot[${index}].*.${key}`);
            } catch (_) { /* Detail roots vary by Tencent build. */ }
          }
          if (collectAnnotationData) {
            for (const container of branchMessageContainers(root, 'msg', `detailRoot[${index}]`)) {
              referenceContainers.push(container);
            }
          }
        }
        if (collectAnnotationData && preferredControl) {
          const expectedQipuId = String(branchPayload.expectedQipuId || '').trim();
          if (expectedQipuId && typeof getQipuCapture !== 'undefined') {
            const capturedCommentV2 = getQipuCapture.commentV2For(expectedQipuId);
            if (capturedCommentV2) {
              referenceContainers.push({
                value: capturedCommentV2,
                path: `get-qipu[${expectedQipuId}].data.commentV2`,
              });
            }
          }
          const annotationRootQipuId = (root) => {
            const directId = (value) => {
              if (!value || typeof value !== 'object') return '';
              for (const key of ['qipuId', '_qipuId', 'qipu_id', 'qipuID', '_qipuID']) {
                try {
                  const text = String(value[key] == null ? '' : value[key]).trim();
                  if (text && text.length <= 160) return text;
                } catch (_) { /* Detail response objects can be replaced mid-read. */ }
              }
              return '';
            };
            const rootId = directId(root);
            if (rootId) return rootId;
            for (const key of ['data', '_qipuData', '_qipuInfo', 'qipuData', 'qipuInfo']) {
              try {
                const childId = directId(root && root[key]);
                if (childId) return childId;
              } catch (_) { /* Ignore transient response wrappers. */ }
            }
            return '';
          };
          const ownedRoots = controls.flatMap(control => [
            control && control._qipuData,
            control && control._qipuInfo,
            control && control.qipuData,
            control && control.qipuInfo,
          ]);
          const currentRoots = [
            model && model.currentQipu,
            model && model._qipuData,
            model && model._qipuInfo,
            model && model._qipuView,
          ].filter(root => expectedQipuId && annotationRootQipuId(root) === expectedQipuId);
          const annotationRoots = [...new Set([...ownedRoots, ...currentRoots].filter(Boolean))];
          for (const [index, root] of annotationRoots.entries()) {
            // get-qipu detail responses can retain the entire FDK renderer
            // graph. Walking those roots blocks the page thread long enough
            // to trip the native progress watchdog. commentV2 has stable,
            // shallow response paths, so inspect only those paths here.
            for (const container of directCommentV2Containers(root, `targetDetailRoot[${index}]`)) {
              referenceContainers.push(container);
            }
          }
        }
          const collectAnnotations = (containers) => {
            const annotations = [];
            const signatures = new Set();
            const seen = new WeakSet();
            const keySamples = [];
            let complete = true;
            const metadataByKey = new Map();
          const annotationPosition = (rawKey, sourcePath = '') => {
            const key = String(rawKey || '').trim();
            let match = key.match(/^(?:DhtmlXQ_)?comment(\d+)[_-](\d+)$/i);
            if (match) return { sourceRouteId: Number(match[1]), absoluteAfterPly: Number(match[2]), keyFormat: 'dhtml-comment' };
            match = key.match(/^(\d+)_(\d+)$/);
            if (match) return { sourceRouteId: Number(match[1]), absoluteAfterPly: Number(match[2]), keyFormat: 'dhtml-compact' };
            if (/^\d+$/.test(key)) return { sourceRouteId: 0, absoluteAfterPly: Number(key), keyFormat: 'mainline-ply' };
            match = key.match(/^(\d+)-(\d+)$/);
            if (match) {
              const sourceRouteId = Number(match[1]);
              const sourcePosition = Number(match[2]);
              // get-qipu's commentV2 uses a one-based node position for
              // branch routes, while the older mounted msgContainer exposes
              // the absolute after-ply directly. Keep the container origin in
              // the normalized format so the two wire conventions can coexist.
              const commentV2Branch = sourceRouteId > 0
                && sourcePosition > 0
                && /(?:^|\.)commentV2(?:\.|$)/i.test(String(sourcePath));
              return {
                sourceRouteId,
                absoluteAfterPly: commentV2Branch ? sourcePosition - 1 : sourcePosition,
                keyFormat: commentV2Branch ? 'ttxq-comment-v2-route-ply' : 'ttxq-route-ply',
              };
            }
            if (/^(?:root|start|initial)$/i.test(key)) return { sourceRouteId: 0, absoluteAfterPly: 0, keyFormat: 'root-alias' };
            return null;
          };
          // Some Tencent builds expose route annotations directly under a
          // generic `comments` wrapper while others use `msgContainer`.
          // Restrict the generic path to keys whose shape unambiguously
          // identifies a route/ply; social comments must never become
          // annotation candidates or completeness failures.
          const hasRouteAnnotationKey = (rawKey) => {
            const key = String(rawKey || '').trim();
            return /^(?:DhtmlXQ_)?comment\d+_\d+$/i.test(key)
              || /^\d+[_-]\d+$/.test(key)
              || /^\d+$/.test(key)
              || /^(?:root|start|initial)$/i.test(key);
          };
          const annotationText = (row) => {
            const read = (value, depth = 0) => {
              if (depth > 3 || value == null) return '';
              if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
              if (Array.isArray(value)) {
                return value.map(item => read(item, depth + 1)).filter(Boolean).join('\n').trim();
              }
              if (typeof value !== 'object') return '';
              for (const key of ['msg', 'text', 'content', 'body', 'value', 'message']) {
                let nested; try { nested = value[key]; } catch (_) { continue; }
                const text = read(nested, depth + 1);
                if (text) return text;
              }
              return '';
            };
            if (typeof row === 'string' || typeof row === 'number') return String(row).trim();
            if (!row || typeof row !== 'object') return '';
            for (const key of ['msg', 'text', 'content', 'body', 'message', 'value']) {
              let value; try { value = row[key]; } catch (_) { continue; }
              const text = read(value);
              if (text) return text;
            }
            return '';
          };
          const collectCompanionMetadata = (value, depth = 0) => {
            if (!value || typeof value !== 'object' || depth > 4) return;
            for (const field of ['time', 'uname', 'author', 'createdAt']) {
              let mapping;
              try { mapping = value[field]; } catch (_) { mapping = null; }
              if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) continue;
              for (const key of propertyNames(mapping).slice(0, 4096)) {
                let item;
                try { item = mapping[key]; } catch (_) { continue; }
                if (typeof item !== 'string' && typeof item !== 'number') continue;
                const current = metadataByKey.get(String(key)) || {};
                if (field === 'time' || field === 'createdAt') current.createdAt = String(item).trim();
                else current.author = String(item).trim();
                metadataByKey.set(String(key), current);
              }
            }
            // Only follow annotation-shaped wrappers. This avoids walking the
            // renderer graph while still finding msg/time/uname siblings.
            for (const field of ['msg', 'msgContainer', 'commentV2', 'comments', 'annotation', 'annotations', 'Eb', 'wn']) {
              let child;
              try { child = value[field]; } catch (_) { child = null; }
              if (child && typeof child === 'object') collectCompanionMetadata(child, depth + 1);
            }
          };
          const annotationRows = (value) => {
            if (Array.isArray(value)) return value;
            // Tencent revisions differ in whether a keyed msgContainer entry
            // stores the raw text or a row object. Treat primitive values as a
            // single row and let annotationText apply the same bounded
            // extraction rules to both shapes.
            if (typeof value === 'string' || typeof value === 'number') return [value];
            if (value && typeof value === 'object') {
              if (['msg', 'text', 'content', 'body', 'message', 'value'].some(key => {
                try { return typeof value[key] !== 'undefined'; } catch (_) { return false; }
              })) return [value];
              for (const key of ['rows', 'items', 'list', 'messages', 'annotations']) {
                try {
                  if (Array.isArray(value[key])) return value[key];
                } catch (_) { /* Ignore transient wrapper getters. */ }
              }
            }
            return null;
          };
          const rowPositionKey = (row, sourcePath = '') => {
            if (!row || typeof row !== 'object') return '';
            for (const field of ['sourceKey', 'key', 'position', 'location', 'name', 'id']) {
              let value; try { value = row[field]; } catch (_) { continue; }
              if (typeof value === 'string' || typeof value === 'number') {
                const text = String(value).trim();
                if (!text || (field === 'id' && /^\d+$/.test(text))) continue;
                if (annotationPosition(text, sourcePath)) return text;
              }
            }
            return '';
          };
          const rowAnnotationPosition = (row, sourcePath = '') => {
            if (!row || typeof row !== 'object') return null;
            // A keyed msgContainer can group several independent annotation
            // rows under the position that happened to be mounted first. The
            // row's own route key is authoritative when it is present. Do not
            // treat a numeric database/message id as a mainline ply: only
            // explicit location fields may use a pure numeric position.
            for (const field of ['sourceKey', 'key', 'position', 'location', 'name', 'id']) {
              let value; try { value = row[field]; } catch (_) { continue; }
              if (typeof value !== 'string' && typeof value !== 'number') continue;
              const key = String(value).trim();
              if (!key || (field === 'id' && /^\d+$/.test(key))) continue;
              const position = annotationPosition(key, sourcePath);
              if (position) return { key, position };
            }
            return null;
          };
          const routeKeyFromPath = (path) => {
            const parts = String(path || '').split('.');
            for (let index = parts.length - 1; index >= 0; index -= 1) {
              const part = parts[index].replace(/\[\d+\]$/g, '');
              if (/^(?:DhtmlXQ_)?comment\d+[_-]\d+$/i.test(part)
                || /^\d+[_-]\d+$/.test(part)
                || /^\d+$/.test(part)
                || /^(?:root|start|initial)$/i.test(part)) return part;
            }
            return '';
          };
          const visit = (value, path, depth = 0) => {
            if (!value || typeof value !== 'object' || seen.has(value)) return;
            if (depth > 6 || annotations.length >= 256 || annotationScanExpired()) {
              complete = false;
              return;
            }
            seen.add(value);
            // The companion time/uname maps are metadata for msg rows. They
            // are not additional annotation text entries themselves.
            if (/(?:^|\.)(?:time|uname|author|createdAt)(?:\.|$)/i.test(path)) return;
            const names = propertyNames(value);
            // A msgContainer commonly has one property per route/ply and can
            // legitimately exceed the old 120-property traversal cap. The
            // annotation budget already bounds work and the result is capped
            // at 256 rows, so scan a larger bounded key set instead of
            // treating a rich container as corrupt.
            const boundedNames = names.slice(0, 4096);
            if (names.length > boundedNames.length) complete = false;
            // Only the known msg/msgContainer shapes are authoritative. A generic
            // `comments` object may hold social/game comments; parse keys that
            // are explicitly route-addressable there, but do not reject a
            // record merely because an unrelated comment key is present.
            const strictContainer = /(?:^|\.)(?:msg|msgContainer|commentV2)(?:\.|$)/i.test(path);
            // Some Tencent revisions expose msgContainer as an array of rows
            // (`[{ key: '11-2', msg: '...' }]`) instead of a keyed map. Handle
            // that shape explicitly so the array index never becomes ply 0.
            if (Array.isArray(value)) {
              value.slice(0, 32).forEach((row, index) => {
                const rowLocation = rowAnnotationPosition(row, path);
                // Array-form rows have no enclosing route/ply property. They
                // must carry an explicit position themselves; a numeric row
                // id is not a move index and cannot be guessed safely.
                const rawKey = rowLocation ? rowLocation.key : '';
                const position = rowLocation ? rowLocation.position : null;
                const text = annotationText(row);
                if (!rawKey || !text) return;
                if (keySamples.length < 24) keySamples.push({
                  path: `${path}[${index}]`,
                  key: rawKey.slice(0, 120),
                  keyFormat: position ? position.keyFormat : 'unknown',
                  rows: 1,
                  hasMsg: true,
                  hasTime: Boolean(row && (typeof row.time === 'string' || typeof row.time === 'number')),
                  hasUname: Boolean(row && typeof row.uname === 'string'),
                });
                if (!position) { complete = false; return; }
                const companion = metadataByKey.get(String(rawKey)) || {};
                const rawAuthor = row && typeof row === 'object' && typeof row.uname === 'string'
                  ? row.uname.trim()
                  : String(companion.author || '').trim();
                const rawCreatedAt = row && typeof row === 'object' && (typeof row.time === 'string' || typeof row.time === 'number')
                  ? String(row.time).trim()
                  : String(companion.createdAt || '').trim();
                const annotation = {
                  sourceRouteId: position.sourceRouteId,
                  absoluteAfterPly: position.absoluteAfterPly,
                  keyFormat: position.keyFormat,
                  text: text.slice(0, 8 * 1024),
                  author: rawAuthor.slice(0, 200),
                  createdAt: rawCreatedAt.slice(0, 100),
                  sourceKey: `${path}.${rawKey}[${index}]`.slice(0, 500),
                };
                const signature = `${annotation.sourceRouteId}:${annotation.absoluteAfterPly}:${rawKey}:${index}:${annotation.author}:${annotation.createdAt}:${annotation.text}`;
                if (!signatures.has(signature)) { signatures.add(signature); annotations.push(annotation); }
              });
              return;
            }
            for (const key of boundedNames) {
              if (isPrivateBridgeField(key)) continue;
              let child; try { child = value[key]; } catch (_) { continue; }
              const rows = annotationRows(child);
              if (rows && rows.some(row => annotationText(row))) {
                // A generic `comments`/`messages` collection is commonly a
                // social or review feed. Only the constrained msg/msgContainer
                // path is authoritative for route annotations.
                if (!strictContainer && !hasRouteAnnotationKey(key) && !rows.some(row => hasRouteAnnotationKey(rowPositionKey(row, path)))) continue;
                const containerKey = hasRouteAnnotationKey(key)
                  ? key
                  : rowPositionKey(rows[0], path) || routeKeyFromPath(path);
                const position = annotationPosition(containerKey, path);
                const rowLocations = rows.slice(0, 32).map(row => rowAnnotationPosition(row, path));
                const sampleRowLocation = rowLocations.find(Boolean);
                const hasExplicitRowPosition = Boolean(sampleRowLocation);
                if (keySamples.length < 24) keySamples.push({
                  path: `${path}.${String(key).slice(0, 120)}`,
                  key: String((sampleRowLocation ? sampleRowLocation.key : containerKey) || key).slice(0, 120),
                  keyFormat: sampleRowLocation ? sampleRowLocation.position.keyFormat : (position ? position.keyFormat : 'unknown'),
                  rows: rows.length,
                  hasMsg: rows.some(row => Boolean(annotationText(row))),
                  hasTime: rows.some(row => row && (typeof row.time === 'string' || typeof row.time === 'number')),
                  hasUname: rows.some(row => row && typeof row.uname === 'string'),
                });
                if (!position && !hasExplicitRowPosition) {
                  // A msg row is a route annotation, not an optional social
                  // comment. If its location key is unknown, reject the
                  // record instead of importing a silently misplaced note.
                  if (strictContainer) complete = false;
                  continue;
                }
                if (rows.length > 32) complete = false;
                rows.slice(0, 32).forEach((row, index) => {
                  if (row == null || (typeof row !== 'object' && typeof row !== 'string' && typeof row !== 'number')) return;
                  const rawText = annotationText(row);
                  if (rawText.length > 8 * 1024) complete = false;
                  const text = rawText.slice(0, 8 * 1024);
                  if (!text) return;
                  const rowLocation = rowLocations[index];
                  if (!rowLocation && !position) return;
                  const rowKey = rowLocation ? rowLocation.key : String(containerKey || key).trim();
                  const rowPosition = rowLocation ? rowLocation.position : position;
                  const sourceRouteId = rowPosition.sourceRouteId;
                  const absoluteAfterPly = rowPosition.absoluteAfterPly;
                  if (!Number.isInteger(sourceRouteId) || sourceRouteId < 0 || sourceRouteId > 512
                    || !Number.isInteger(absoluteAfterPly) || absoluteAfterPly < 0 || absoluteAfterPly > 1_000) {
                    complete = false;
                    return;
                  }
                  const companion = metadataByKey.get(rowKey) || {};
                  const rawAuthor = row && typeof row === 'object' && typeof row.uname === 'string'
                    ? row.uname.trim()
                    : String(companion.author || '').trim();
                  const rawCreatedAt = row && typeof row === 'object' && (typeof row.time === 'string' || typeof row.time === 'number')
                    ? String(row.time).trim()
                    : String(companion.createdAt || '').trim();
                  const rawSourceKey = `${path}.${rowKey}[${index}]`;
                  if (rawAuthor.length > 200 || rawCreatedAt.length > 100 || rawSourceKey.length > 500) complete = false;
                  const annotation = {
                    sourceRouteId,
                    absoluteAfterPly,
                    keyFormat: rowPosition.keyFormat,
                    text,
                    author: rawAuthor.slice(0, 200),
                    createdAt: rawCreatedAt.slice(0, 100),
                    sourceKey: rawSourceKey.slice(0, 500),
                  };
                  // The same QQ msgContainer is often reachable through more
                  // than one display-object path. The path is diagnostic
                  // context, not annotation identity; including it duplicates
                  // every row when the object graph exposes a mirror.
                  // A container can be reachable through mirror display paths,
                  // so path is diagnostic only. Keep the source key and row
                  // index in the identity: two distinct rows with identical
                  // metadata/text are still separate Tencent annotations.
                  const signature = `${annotation.sourceRouteId}:${annotation.absoluteAfterPly}:${rowKey}:${index}:${annotation.author}:${annotation.createdAt}:${annotation.text}`;
                  if (!signatures.has(signature)) {
                    signatures.add(signature);
                    annotations.push(annotation);
                  }
                });
              } else if (child && typeof child === 'object') {
                visit(child, `${path}.${key}`, depth + 1);
              }
            }
          };
          containers.forEach(container => {
            collectCompanionMetadata(container.value);
            visit(container.value, container.path);
          });
          return { annotations, complete, keySamples };
        };
        const annotationState = collectAnnotationData
          ? collectAnnotations(referenceContainers)
          : { annotations: [], complete: true, keySamples: [] };
        const annotationContainerSeen = referenceContainers.length > 0;
        branchDeadline = Math.min(Date.now() + 3500, overallDeadline);
        const candidates = collectBranchCandidates(branchSources);
        // Route controls are only considered after a real branch key/value has
        // been inspected. Ordinary numeric toolbars must never be interpreted
        // as routes, but a Tencent page can expose route buttons before the
        // selected route's branch payload is mounted.
        const routeControls = collectRouteControlGroup(branchOwner);
        branchPayload.routeControls = routeControls;
        branchPayload.routeControlOwner = branchOwner;
        const branchSignature = candidates.length ? localSnapshotSignature(candidates.map(candidate => ({
          path: candidate.path,
          raw: candidate.raw,
          valueType: candidate.valueType,
          afterPly: candidate.afterPly,
        }))) : '';
        const annotationSignature = annotationState.annotations.length || annotationState.keySamples.length || !annotationState.complete
          ? localSnapshotSignature({
              annotations: annotationState.annotations,
              keySamples: annotationState.keySamples,
              complete: annotationState.complete,
            })
          : '';
        const hasBranchSignal = candidates.length > 0;
        const hasUnverifiedBranchSignal = unknownBranchKeySeen;
        if (branchScanTimedOut && !hasBranchSignal && (branchKeySeen || hasUnverifiedBranchSignal)) {
          return {
            data: boundedBranchJson({ bridgeVersion: __TTXQ_BRIDGE_VERSION__, annotationScanTimedOut, branchScanTimedOut: true, unknownBranchKeySeen: hasUnverifiedBranchSignal, signals: [], candidates: [], annotations: annotationState.annotations, annotationKeySamples: annotationState.keySamples, annotationsComplete: annotationState.complete }),
            path: 'NOTIFY_QIPU_DATA._boardControl.msg',
            complete: false,
            owner: branchOwner,
            branchSignature: '',
            annotationSignature,
            branchKeySeen,
            unknownBranchKeySeen: hasUnverifiedBranchSignal,
            annotationContainerSeen,
          };
        }
        if (!hasBranchSignal && hasUnverifiedBranchSignal) {
          return {
            data: boundedBranchJson({ bridgeVersion: __TTXQ_BRIDGE_VERSION__, annotationScanTimedOut, unknownBranchKeySeen: true, signals: [], candidates: [], annotations: annotationState.annotations, annotationKeySamples: annotationState.keySamples, annotationsComplete: annotationState.complete }),
            path: 'NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey',
            complete: false,
            owner: branchOwner,
            branchSignature: '',
            annotationSignature,
            branchKeySeen,
            unknownBranchKeySeen: true,
            annotationContainerSeen,
          };
        }
        if (!hasBranchSignal) {
          return {
            data: annotationState.annotations.length || !annotationState.complete
              ? boundedBranchJson({ bridgeVersion: __TTXQ_BRIDGE_VERSION__, annotationScanTimedOut, signals: [], candidates: [], annotations: annotationState.annotations, annotationKeySamples: annotationState.keySamples, annotationsComplete: annotationState.complete })
              : '',
            path: 'NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey',
            complete: true,
            owner: branchOwner,
            branchSignature: '',
            annotationSignature,
            branchKeySeen,
            unknownBranchKeySeen: false,
            annotationContainerSeen,
          };
        }
        try {
          return {
            data: boundedBranchJson({ bridgeVersion: __TTXQ_BRIDGE_VERSION__, annotationScanTimedOut, candidates, annotations: annotationState.annotations, annotationKeySamples: annotationState.keySamples, annotationsComplete: annotationState.complete }),
            path: 'NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey',
            complete: false,
            owner: branchOwner,
            branchSignature,
            annotationSignature,
            branchKeySeen,
            unknownBranchKeySeen: hasUnverifiedBranchSignal,
            annotationContainerSeen,
          };
        } catch (_) {
          return { data: '[网页变招字段无法序列化]', path: 'NOTIFY_QIPU_DATA._boardControl.getMoveBranchKey', complete: false, owner: branchOwner, branchSignature, annotationSignature, branchKeySeen, unknownBranchKeySeen: hasUnverifiedBranchSignal, annotationContainerSeen };
        }
      };
      const liveLoadedId = () => {
        const idOf = (source) => {
          if (!source || typeof source !== 'object') return '';
          for (const key of ['qipuId', '_qipuId', 'qipu_id', 'qipuID', '_qipuID']) {
            try {
              const value = source[key];
              const text = String(value == null ? '' : value).trim();
              if (text && text.length <= 160) return text;
            } catch (_) { /* Live display objects can disappear during a route switch. */ }
          }
          return '';
        };
        // Never inspect the requested recent-list item here: its qipuId is the
        // target id even while the visible board is still showing the previous
        // game. Prefer identity attached to the active notification entry or
        // the model's explicitly current qipu. Older QQ builds keep stale
        // qipu ids on generic model/cache objects; consulting those first made
        // a valid current getQipuMoveStep look like a previous-game snapshot.
        const notifyOwner = typeof notificationOwner === 'function' ? notificationOwner() : null;
        let hasCurrentNotification = false;
        try {
          const entries = notifyOwner && notifyOwner.NOTIFY_QIPU_DATA;
          hasCurrentNotification = Boolean(entries);
          const entry = Array.isArray(entries) ? entries[0] : entries;
          const control = entry && (entry.thisObj || entry)._boardControl;
          const explicit = idOf(control) || idOf(entry && entry.thisObj) || idOf(entry);
          if (explicit) return explicit;
        } catch (_) { /* The notification bus may be replaced between reads. */ }
        if (hasCurrentNotification) return '';
        const currentModel = typeof model !== 'undefined' ? model : null;
        for (const source of [currentModel && currentModel.currentQipu, currentModel && currentModel._qipuView]) {
          const explicit = idOf(source);
          if (explicit) return explicit;
        }
        // Keep the narrow standalone fallback used by older bridge revisions
        // and unit harnesses, but only after explicit current roots were absent.
        for (const source of (typeof qipuSources === 'function' ? qipuSources() : [])) {
          const explicit = idOf(source);
          if (explicit) return explicit;
        }
        return '';
      };
      const snapshotHasCoordinateCandidate = (snapshot) =>
        typeof snapshot === 'string' && /getQipuMoveStep:[^\n]*coordinate-candidate/.test(snapshot);
      const acceptsTargetCandidate = (candidate, qipuId, beforeSignature, beforeOwner = null, options = {}) => {
        if (!candidate || !candidate.text) return false;
        const signature = `${candidate.path}:${candidate.type}:${candidate.text}`;
        const controllerChanged = candidate.owner && beforeOwner && candidate.owner !== beforeOwner;
        const loadedId = liveLoadedId();
        let belongsToCurrentNotification = false;
        if (candidate.owner && typeof notificationOwner === 'function') {
          try {
            const entries = notificationOwner()?.NOTIFY_QIPU_DATA;
            const entry = Array.isArray(entries) ? entries[0] : entries;
            const control = entry && (entry.thisObj || entry)._boardControl;
            belongsToCurrentNotification = control === candidate.owner;
          } catch (_) { /* The notification bus can be replaced during a jump. */ }
        }
        // A few QQ builds leave the previous qipu id on the notification
        // entry while reusing the same board controller. A coordinate-backed
        // snapshot from that exact controller is stronger evidence than the
        // stale scalar id; generic model/cache ids remain hard rejects.
        if (loadedId && loadedId !== String(qipuId)
          && !(belongsToCurrentNotification && options.coordinateSnapshot)) return false;
        if (loadedId === String(qipuId) || controllerChanged) return true;
        if (signature !== beforeSignature && options.stableSignature === signature) return true;
        // Some QQ pages reuse the same board controller and can produce the
        // same coordinate stream for adjacent records. After a bounded wait,
        // a snapshot of the live notification board that already marks the
        // move field as a DhtmlXQ coordinate candidate is the best available
        // positive signal; a contradictory loadedId above still wins.
        return Boolean(options.coordinateSnapshot);
      };
      const waitForTarget = async (qipuId, beforeSignature, beforeOwner = null, extraSources = [], maxPolls = 12, unavailableBaseline = []) => {
        let stableSignature = '';
        const deadline = Number.isFinite(waitForTarget.deadline)
          ? waitForTarget.deadline
          : Date.now() + 8000;
        for (let poll = 0; poll < maxPolls && Date.now() < deadline; poll += 1) {
          await delay(Math.min(200, Math.max(0, deadline - Date.now())));
          const unavailable = typeof dismissUnavailableDialog === 'function'
            ? dismissUnavailableDialog(unavailableBaseline)
            : '';
          if (unavailable) {
            // The confirm handler is asynchronous in QQ's paper-dialog
            // implementation. Let it unmount before the next board read.
            await delay(120);
            throw new Error(unavailable);
          }
          const candidate = directNotifyMove() || directModelMove() || readRawMoves(extraSources);
          if (acceptsTargetCandidate(candidate, qipuId, beforeSignature, beforeOwner, { stableSignature })) return candidate;
          const signature = candidateSignature(candidate);
          stableSignature = signature && signature !== beforeSignature ? signature : '';
        }
        throw new Error('棋谱加载超时');
      };
      const candidateSignature = (candidate) => candidate && candidate.text
        ? `${candidate.path}:${candidate.type}:${candidate.text}`
        : '';
      const readBranchRoutes = async (qipuId, mainRaw, passiveBranch, beforeBranchSignature = '', beforeAnnotationSignature = '') => {
        const gameDeadline = Number.isFinite(readBranchRoutes.deadline)
          ? readBranchRoutes.deadline
          : Date.now() + 8000;
        const reportBranchHeartbeat = async () => {
          if (typeof invoke !== 'function'
            || typeof total === 'undefined'
            || typeof completed === 'undefined'
            || typeof failed === 'undefined'
            || typeof scanned === 'undefined'
            || typeof current === 'undefined') return;
          await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'branches' });
        };
        // getQipuMoveStep becomes available before QQ finishes installing the
        // branch-key/msg structures. The reference exporter polls the board
        // control as a whole; do the same here instead of permanently trusting
        // the first (often empty) snapshot taken as soon as the mainline loads.
        const preferredOwner = mainRaw && mainRaw.owner || null;
        const passiveOwnedByTarget = Boolean(
          preferredOwner && passiveBranch && passiveBranch.owner === preferredOwner,
        );
        let settledBranch = preferredOwner && passiveBranch && passiveBranch.owner && !passiveOwnedByTarget
          ? { data: '', path: '', complete: true, owner: preferredOwner, branchSignature: '', annotationSignature: '' }
          : (passiveBranch || { data: '', path: '', complete: true, owner: preferredOwner, branchSignature: '', annotationSignature: '' });
        const structuralSignature = snapshot => String(snapshot && snapshot.branchSignature || '');
        const annotationSignature = snapshot => String(snapshot && snapshot.annotationSignature || '');
        const passiveStructuralSignature = structuralSignature(settledBranch);
        let previousSnapshotUnverified = passiveOwnedByTarget
          && Boolean(passiveStructuralSignature)
          && passiveStructuralSignature === beforeBranchSignature;
        let verifiedNonEmptySnapshot = passiveOwnedByTarget
          && Boolean(passiveStructuralSignature)
          && !previousSnapshotUnverified;
        let latestAnnotationSnapshot = annotationSignature(settledBranch)
          && liveLoadedId() === String(qipuId)
          ? settledBranch
          : null;
        let annotationCandidateSignature = '';
        let annotationStablePolls = 0;
        let consecutiveEmptySnapshots = 0;
        // The annotation panel is mounted asynchronously after the move list
        // and often settles between 800ms and 2s after a qipu switch. Keep
        // polling for the full annotation budget; the old five-poll/600ms
        // window made valid msgContainer rows disappear while branch data was
        // still available.
        for (let poll = 0; poll < 14 && Date.now() < gameDeadline; poll += 1) {
          if (poll > 0) await delay(180);
          await reportBranchHeartbeat();
          const observed = branchPayload(preferredOwner, gameDeadline);
          const signature = structuralSignature(observed);
          const observedAnnotationSignature = annotationSignature(observed);
          if (observedAnnotationSignature) {
            if (observedAnnotationSignature === annotationCandidateSignature) {
              annotationStablePolls += 1;
            } else {
              annotationCandidateSignature = observedAnnotationSignature;
              annotationStablePolls = 1;
            }
            const targetConfirmed = liveLoadedId() === String(qipuId);
            if (targetConfirmed || (observedAnnotationSignature !== beforeAnnotationSignature && annotationStablePolls >= 2)) {
              latestAnnotationSnapshot = observed;
            }
          }
          if (signature || (observed && observed.complete === false)) {
            if (signature
              && previousSnapshotUnverified
              && signature === beforeBranchSignature
              && liveLoadedId() !== String(qipuId)) {
              consecutiveEmptySnapshots = 0;
              continue;
            }
            settledBranch = observed;
            if (preferredOwner && observed && observed.owner === preferredOwner && signature) {
              verifiedNonEmptySnapshot = true;
              previousSnapshotUnverified = false;
            }
            consecutiveEmptySnapshots = 0;
          } else if (!verifiedNonEmptySnapshot) {
            consecutiveEmptySnapshots += 1;
            // A stale controller can expose the previous game's branches for
            // the first read after jumpQipuGame. Two explicit empty snapshots
            // from the settled target clear that old payload without masking a
            // branch structure that appears later in this bounded window.
            if (consecutiveEmptySnapshots >= 2) {
              settledBranch = latestAnnotationSnapshot || observed;
              previousSnapshotUnverified = false;
            }
          } else if (latestAnnotationSnapshot) {
            settledBranch = latestAnnotationSnapshot;
          }
        }
        if (previousSnapshotUnverified && !verifiedNonEmptySnapshot) {
          settledBranch = {
            data: JSON.stringify({ staleSnapshot: true, signals: [], candidates: [] }),
            path: 'previous-game-branch-signature',
            complete: false,
            owner: preferredOwner,
            branchSignature: '',
            annotationSignature: '',
          };
        }
        passiveBranch = settledBranch;
        let envelope = {};
        if (passiveBranch && passiveBranch.data) {
          try {
            envelope = JSON.parse(passiveBranch.data);
          } catch (_) {
            envelope = { rawBranchData: String(passiveBranch.data).slice(0, 2000) };
          }
        }
        const annotationsBySignature = new Map();
        const annotationKeySamplesBySignature = new Map();
        let annotationsComplete = envelope.annotationsComplete !== false;
        const mergeAnnotations = (candidateEnvelope) => {
          if (!candidateEnvelope || typeof candidateEnvelope !== 'object') return;
          if (candidateEnvelope.annotationsComplete === false) annotationsComplete = false;
          for (const annotation of Array.isArray(candidateEnvelope.annotations) ? candidateEnvelope.annotations : []) {
            if (!annotation || typeof annotation !== 'object') continue;
            const sourceKey = String(annotation.sourceKey || '').trim();
            // The object path can change when QQ remounts the same
            // msgContainer (for example after returning to route 1). Use the
            // route-key and row index as the stable source identity so a
            // remount does not duplicate every annotation while distinct rows
            // at the same position remain intact.
            const sourceRef = sourceKey.match(/\.([^.[\]]+)\[(\d+)\]$/);
            const stableSourceKey = sourceRef ? `${sourceRef[1]}[${sourceRef[2]}]` : sourceKey;
            const signature = `${annotation.sourceRouteId ?? ''}:${annotation.absoluteAfterPly ?? ''}:${stableSourceKey}:${annotation.author || ''}:${annotation.createdAt || ''}:${annotation.text || ''}`;
            if (signature) annotationsBySignature.set(signature, annotation);
          }
          for (const sample of Array.isArray(candidateEnvelope.annotationKeySamples) ? candidateEnvelope.annotationKeySamples : []) {
            if (!sample || typeof sample !== 'object') continue;
            const signature = `${sample.path || ''}:${sample.key || ''}:${sample.keyFormat || ''}`;
            if (signature) annotationKeySamplesBySignature.set(signature, sample);
          }
        };
        mergeAnnotations(envelope);
        // A branch structure can settle after the annotation container. Keep
        // the most recent target-confirmed annotation snapshot even when the
        // structural snapshot that won the race has no msgContainer rows.
        if (latestAnnotationSnapshot && latestAnnotationSnapshot !== passiveBranch) {
          try {
            const latestEnvelope = latestAnnotationSnapshot.data
              ? JSON.parse(latestAnnotationSnapshot.data)
              : {};
            mergeAnnotations(latestEnvelope);
          } catch (_) { /* Keep the valid envelope already collected. */ }
        }
        envelope.annotations = [...annotationsBySignature.values()].slice(0, 256);
        envelope.annotationKeySamples = [...annotationKeySamplesBySignature.values()].slice(0, 24);
        envelope.annotationsComplete = annotationsComplete;
        const routeControlGroup = branchPayload.routeControlOwner === preferredOwner
          ? branchPayload.routeControls
          : null;
        const routeCandidates = [];
        const routeFailures = [];
        const seenRouteCandidates = new Set();
        const directBranchCandidates = Array.isArray(envelope.candidates)
          ? envelope.candidates.filter(candidate => candidate
            && /(?:^|\.)getMoveBranchKey\.\d+-\d+-\d+$/.test(String(candidate.path || '')))
          : [];
        const routeBranchExpected = Boolean(
          directBranchCandidates.length
          || passiveBranch && (passiveBranch.branchKeySeen || passiveBranch.unknownBranchKeySeen),
        );
        // Route activation serves two independent consumers: branch discovery
        // and lazy annotation mounting. A direct branch graph already covers
        // the former, so give the latter a little more bounded time without
        // weakening the per-game deadline.
        // A route button can mount its msgContainer asynchronously.  Large
        // self-recorded collections expose dozens of routes (66 has been
        // observed), so a short seven-second window only visits the first
        // handful and silently drops later annotations.  Keep this bounded,
        // but allow the full route set to settle before finalising the row.
        // Route buttons can mount one msgContainer per click. The per-route
        // read below is intentionally restricted to that button, so it is
        // cheap enough to use the remaining per-game window rather than
        // dropping the tail of a 40+ route self-recorded collection.
        const routeDeadline = Math.min(Date.now() + 6000, gameDeadline);
        const collectActivatedCandidates = directBranchCandidates.length === 0;
        // Only activate a numeric route group when the current controller has
        // actually exposed A-B-C branch keys. This keeps ordinary 1/2/3/4
        // playback controls out of branch detection while still handling QQ's
        // lazy route payload, which appears only after a click.
        const shouldInspectRouteControls = Boolean(passiveBranch
          && routeControlGroup
          && routeControlGroup.numbers.length > 1
          // A self-recorded route can lazily mount both its branch key and
          // msgContainer only after a route click. If no annotation snapshot
          // exists yet, inspect the explicitly identified route-control group
          // even when the initial branch wrapper is empty. Candidate filtering
          // below still requires a real A-B-C key and coordinate payload.
          && (passiveBranch.branchKeySeen || passiveBranch.annotationContainerSeen)
          // Direct branch candidates do not imply that route annotations are
          // mounted.  Tencent often exposes the complete A-B-C graph first,
          // then creates each route's msgContainer only after its button is
          // clicked.  Always activate the explicitly identified route group
          // when it is present; otherwise one early root annotation would
          // suppress all lazy route reads.
        );
        if (shouldInspectRouteControls) {
          const controlsByRoute = new Map((routeControlGroup.buttons || []).map(item => [Number(item.routeNo), item.control]));
          const activateRoute = (routeNo) => {
            const control = controlsByRoute.get(routeNo);
            return invokeDisplayClick(control);
          };
          for (const routeNo of routeControlGroup.numbers.filter(number => number >= 2)) {
            if (!activateRoute(routeNo)) {
              // The complete getMoveBranchKey graph is already authoritative.
              // A route activation is then only an annotation enrichment pass;
              // failure to click it must not invalidate decoded branch moves.
              if (collectActivatedCandidates && routeBranchExpected) routeFailures.push({ routeNo, reason: '路线按钮无法触发' });
              continue;
            }
            let collected = false;
            // When the complete A-B-C graph is already present, activating a
            // route is only an annotation enrichment pass. One settled read
            // per route lets 40-66 route collections finish inside the fixed
            // per-game deadline; four identical reads consumed the budget on
            // the first routes and silently skipped the tail. Lazy branch
            // discovery still keeps its bounded four-read retry window.
            const maxRoutePolls = collectActivatedCandidates ? 4 : 1;
            for (let poll = 0; poll < maxRoutePolls && !collected && Date.now() < routeDeadline && Date.now() < gameDeadline; poll += 1) {
              await delay(50);
              await reportBranchHeartbeat();
              if (liveLoadedId() && liveLoadedId() !== String(qipuId)) continue;
              let active;
              try {
                // Restrict the pass to the clicked route plus the one active
                // board controller. Tencent alternates between those owners
                // across builds; branchPayload keeps all other page state out.
                branchPayload.annotationOnlyControl = control;
                active = branchPayload(control, gameDeadline);
              } finally {
                branchPayload.annotationOnlyControl = null;
              }
              let activeEnvelope = {};
              try { activeEnvelope = active && active.data ? JSON.parse(active.data) : {}; } catch (_) { activeEnvelope = {}; }
              // Selecting a Tencent route can mount its msgContainer lazily.
              // Keep route-specific annotations even when that snapshot has no
              // new branch candidate.
              mergeAnnotations(activeEnvelope);
              for (const candidate of collectActivatedCandidates
                ? (Array.isArray(activeEnvelope.candidates) ? activeEnvelope.candidates : [])
                : []) {
                // Route activation may also change the visible mainline. That
                // stream is not branch data; only a structured A-B-C entry
                // from getMoveBranchKey can be imported as a variation.
                if (!candidate || !candidate.raw
                  || !/(?:^|\.)getMoveBranchKey\.\d+-\d+-\d+$/.test(String(candidate.path || ''))) continue;
                const key = `${candidate.path || ''}:${candidate.raw}`;
                if (seenRouteCandidates.has(key)) continue;
                seenRouteCandidates.add(key);
                routeCandidates.push({
                  ...candidate,
                  path: candidate.path && /getMoveBranchKey\.\d+-\d+-\d+$/.test(candidate.path)
                    ? candidate.path
                    : `route[${routeNo}].${candidate.path || 'branchData'}`,
                  routeNo,
                  comment: candidate.comment || `天天象棋路线 ${routeNo}`,
                });
                collected = true;
              }
            }
            if (!collected && collectActivatedCandidates && routeBranchExpected) {
              routeFailures.push({ routeNo, reason: '未取得与主线不同的分支走法' });
            }
          }
          const mainRoute = controlsByRoute.get(1);
          if (mainRoute) {
            try {
              if (typeof mainRoute.dispatchEvent === 'function') mainRoute.dispatchEvent('click');
              else if (typeof mainRoute.emit === 'function') mainRoute.emit('click');
              else if (typeof mainRoute.click === 'function') mainRoute.click();
            } catch (_) { /* Restoring the main route is best effort. */ }
            // The root route owns the opening-position annotation in QQ's
            // self-recorded manuals. It is common for that msgContainer to be
            // mounted only after returning from a variation route, so give
            // the main route one bounded read before finalising the envelope.
            for (let poll = 0; poll < 3 && Date.now() < routeDeadline && Date.now() < gameDeadline; poll += 1) {
              await delay(80);
              await reportBranchHeartbeat();
              if (liveLoadedId() && liveLoadedId() !== String(qipuId)) continue;
              const active = branchPayload(preferredOwner, gameDeadline);
              let activeEnvelope = {};
              try { activeEnvelope = active && active.data ? JSON.parse(active.data) : {}; } catch (_) { activeEnvelope = {}; }
              mergeAnnotations(activeEnvelope);
            }
          }
        }
        if (routeFailures.length) {
          envelope.routeFailures = routeFailures.slice(0, 16);
          envelope.routesAttempted = routeControlGroup ? routeControlGroup.numbers.filter(number => number >= 2) : [];
        }
        envelope.annotations = [...annotationsBySignature.values()].slice(0, 256);
        envelope.annotationKeySamples = [...annotationKeySamplesBySignature.values()].slice(0, 24);
        envelope.annotationsComplete = annotationsComplete;
        if (routeCandidates.length || routeFailures.length) {
          envelope.candidates = [...(Array.isArray(envelope.candidates) ? envelope.candidates : []), ...routeCandidates].slice(0, 256);
          envelope.routeCandidates = routeCandidates.map(candidate => ({ routeNo: candidate.routeNo, path: candidate.path, valueType: candidate.valueType, length: candidate.raw.length, comment: candidate.comment }));
          try {
            return { ...passiveBranch, data: boundedBranchJson(envelope), path: `${passiveBranch.path || 'ttxq-branch'} + routeControls`, complete: false };
          } catch (_) { /* Keep the passive snapshot if route metadata cannot serialize. */ }
        }
        if (!passiveBranch || !passiveBranch.data) {
          // A lazy route may expose its msgContainer only after activation.
          // In that case the initial passive snapshot is empty, but the
          // annotation accumulator above still contains valid data. Preserve
          // it as a standalone envelope instead of returning the empty
          // passive snapshot and silently dropping the annotations.
          const hasCollectedAnnotations = annotationsBySignature.size > 0
            || annotationKeySamplesBySignature.size > 0
            || !annotationsComplete;
          if (!hasCollectedAnnotations && !routeCandidates.length && !routeFailures.length) return passiveBranch;
          return {
            ...(passiveBranch || {}),
            data: boundedBranchJson(envelope),
            path: `${(passiveBranch && passiveBranch.path) || 'ttxq-branch'} + routeControls`,
            complete: !routeCandidates.length && !routeFailures.length,
            branchSignature: passiveBranch && passiveBranch.branchSignature || '',
            annotationSignature: passiveBranch && passiveBranch.annotationSignature || '',
          };
        }
        try {
          return {
            ...passiveBranch,
            data: boundedBranchJson(envelope),
          };
        } catch (_) {
          return passiveBranch;
        }
      };
      let current = 0;
      const failures = [];
      for (const [qipuId, info] of found) {
        current += 1;
        try {
          // Keep each game bounded independently. The phase budgets below are
          // intentionally finite so a slow Tencent route cannot stall the
          // entire recent-game batch.
          const initialGameDeadline = Date.now() + 8000;
          if (typeof branchPayload === 'function') branchPayload.deadline = initialGameDeadline;
          await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'loading' });
          let raw = { text: '', path: '', type: '', length: 0, score: 0 };
          const gameDeadline = Date.now() + 8000;
          // A notification owner and move-field owner can be reused by QQ for
          // adjacent records. Clear both before taking the previous-game
          // baseline so no branch/annotation snapshot is carried across a
          // qipu switch.
          notifyOwnerCache = null;
          notifySearchAt = 0;
          moveOwnerCache = null;
          moveOwnerSearchAt = 0;
          if (typeof branchPayload === 'function') {
            branchPayload.routeControls = null;
            branchPayload.routeControlOwner = null;
            branchPayload.expectedQipuId = '';
          }
          const beforeCandidate = directNotifyMove() || directModelMove() || readRawMoves([info]);
          const beforeSignature = `${beforeCandidate.path}:${beforeCandidate.type}:${beforeCandidate.text}`;
          const beforeOwner = beforeCandidate.owner || null;
          if (typeof branchPayload === 'function') branchPayload.skipAnnotations = true;
          const beforeBranchSnapshot = typeof branchPayload === 'function'
            ? branchPayload(beforeOwner || null)
            : null;
          if (typeof branchPayload === 'function') branchPayload.skipAnnotations = false;
          const beforeBranchSignature = String(beforeBranchSnapshot && beforeBranchSnapshot.branchSignature || '');
          const beforeAnnotationSignature = String(beforeBranchSnapshot && beforeBranchSnapshot.annotationSignature || '');
          // A failed row can leave its paper dialog mounted while QQ updates
          // the list. Clear it before taking the next baseline; it must never
          // be mistaken for the newly requested game's result.
          if (typeof drainUnavailableDialogs === 'function') await drainUnavailableDialogs();
          const unavailableBaseline = typeof unavailableDialogBaseline === 'function'
            ? unavailableDialogBaseline()
            : [];
          // QQ implementations differ: some return immediately after
          // scheduling the request, while others return a Promise. Await a
          // Promise-valued jump (with a short cap) so the subsequent polling
          // observes the board after the request has actually been issued.
          let jumpResult;
          try {
            jumpResult = model.jumpQipuGame(qipuId, -1, false, 0, 1, 0);
            if (jumpResult && typeof jumpResult.then === 'function') {
              await Promise.race([Promise.resolve(jumpResult).catch(() => undefined), delay(1500)]);
            }
          } catch (_) {
            jumpResult = null;
          }
          // On self-recorded pages jumpQipuGame may only change the selection;
          // requestGetQipuInfo is the call that starts the detail fetch. Start
          // it immediately as well, but keep the bridge bounded if this QQ
          // revision uses a different signature.
          try {
            if (typeof model.requestGetQipuInfo === 'function') {
              const detailResult = model.requestGetQipuInfo(qipuId);
              if (detailResult && typeof detailResult.then === 'function') {
                await Promise.race([
                  Promise.resolve(detailResult).catch(() => undefined),
                  delay(500),
                ]);
              }
            }
          } catch (_) { /* The normal jump path remains authoritative. */ }
          // jumpQipuGame can report a missing remote record through a page
          // modal rather than a rejected promise. Give that modal one bounded
          // turn to mount before waiting on board data.
          await new Promise(resolve => setTimeout(resolve, 80));
          const unavailable = typeof dismissUnavailableDialog === 'function'
            ? dismissUnavailableDialog(unavailableBaseline)
            : '';
          if (unavailable) {
            await delay(120);
            throw new Error(unavailable);
          }
          // The first page needs enough time to mount QQ's board controls.
          // Each remaining game is bounded independently so a full virtual
          // history is not silently dropped after an arbitrary batch deadline.
          // Every game gets the same bounded twelve-second window. The old
          // twelve-poll limit gave games after the first only ~2.4 seconds,
          // which is shorter than QQ's self-recorded-game detail request.
          const polls = 40;
          waitForTarget.deadline = gameDeadline;
          if (typeof branchPayload === 'function') branchPayload.deadline = gameDeadline;
          try {
            raw = await waitForTarget(qipuId, beforeSignature, beforeOwner, [info, jumpResult], polls, unavailableBaseline);
          } catch (_) {
            // A few self-recorded pages expose jumpQipuGame but defer the
            // detail request until requestGetQipuInfo is called. Give that
            // explicit refresh one bounded chance before classifying the
            // record as missing.
            try {
              if (typeof model.requestGetQipuInfo === 'function') {
                const refreshResult = model.requestGetQipuInfo(qipuId);
                if (refreshResult && typeof refreshResult.then === 'function') {
                  await Promise.race([
                    Promise.resolve(refreshResult).catch(() => undefined),
                    delay(1000),
                  ]);
              } else {
                await delay(250);
              }
              }
              if (!raw.text && Date.now() < gameDeadline) {
                try {
                  raw = await waitForTarget(
                    qipuId,
                    beforeSignature,
                    beforeOwner,
                    [info, jumpResult],
                    10,
                    unavailableBaseline,
                  );
                } catch (_) { /* Keep the bounded boundary recovery below. */ }
              }
            } catch (_) { /* Continue with the boundary recovery below. */ }
          }
          if (!raw.text) {
            const settled = directNotifyMove() || directModelMove() || readRawMoves([info, jumpResult]);
            const settledSignature = settled && settled.text ? `${settled.path}:${settled.type}:${settled.text}` : '';
            await new Promise(resolve => setTimeout(resolve, 100));
            const confirmed = directNotifyMove() || directModelMove() || readRawMoves([info, jumpResult]);
            const confirmedSignature = confirmed && confirmed.text ? `${confirmed.path}:${confirmed.type}:${confirmed.text}` : '';
            if (settledSignature && settledSignature === confirmedSignature
              && acceptsTargetCandidate(confirmed, qipuId, beforeSignature, beforeOwner, { stableSignature: settledSignature })) raw = confirmed;
          }
          if (!raw.text) {
            const snapshot = bridgeSnapshot([info]);
            // Snapshot traversal takes long enough for some QQ records to
            // finish replacing getQipuMoveStep's loading object with the real
            // coordinate array. Re-read once before committing a false
            // missing diagnostic, while retaining the stale-game guard.
            const settledAfterSnapshot = directNotifyMove() || directModelMove() || readRawMoves([info, jumpResult]);
            const snapshotSignature = settledAfterSnapshot && settledAfterSnapshot.text
              ? `${settledAfterSnapshot.path}:${settledAfterSnapshot.type}:${settledAfterSnapshot.text}` : '';
            await new Promise(resolve => setTimeout(resolve, 100));
            const confirmedAfterSnapshot = directNotifyMove() || directModelMove() || readRawMoves([info, jumpResult]);
            const confirmedSnapshotSignature = confirmedAfterSnapshot && confirmedAfterSnapshot.text
              ? `${confirmedAfterSnapshot.path}:${confirmedAfterSnapshot.type}:${confirmedAfterSnapshot.text}` : '';
            if (snapshotSignature && snapshotSignature === confirmedSnapshotSignature
              && acceptsTargetCandidate(confirmedAfterSnapshot, qipuId, beforeSignature, beforeOwner, {
                stableSignature: snapshotSignature,
                coordinateSnapshot: snapshotHasCoordinateCandidate(snapshot),
              })) {
              raw = confirmedAfterSnapshot;
            } else {
              raw = {
                text: snapshot || '[网页未发现走法字段；未找到棋谱详情对象]',
                path: snapshot ? 'bridge-snapshot' : '未发现走法字段',
                type: 'missing',
                length: snapshot.length,
                score: 0,
              };
            }
          }
          if (typeof invoke === 'function') {
            await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'metadata' });
          }
          const moves = raw.text ? (raw.text.match(/[a-i][0-9][a-i][0-9]/gi) || []).map(move => move.toLowerCase()) : [];
          // A bridge snapshot is a diagnostic fallback, never a playable move
          // stream. Do not append it to the batch: one unresolved Tencent row
          // must not make validate_payload reject every otherwise valid game or
          // leave a half-imported "格式待处理" record in the local library.
          const compactRawMoves = raw.text.replace(/[^0-9]/g, '');
          const hasDhtmlMoves = /^[0-9,\s\[\]]+$/.test(raw.text)
            && compactRawMoves.length >= 4
            && compactRawMoves.length % 4 === 0;
          const hasChineseMoves = /[车車马馬炮砲兵卒相象仕士帅将將帥][前后後中一二三四五六七八九１２３４５６７８９][进退平][前后後中一二三四五六七八九１２３４５６７８９]/.test(raw.text);
          if ((!moves.length && !hasDhtmlMoves && !hasChineseMoves)
            || raw.type === 'missing' || raw.path === 'bridge-snapshot') {
            throw new Error(`棋谱 ${qipuId} 的走法格式不兼容，已跳过未解析记录`);
          }
          const startingFen = initialFen();
          if (!startingFen) {
            throw new Error(`棋谱 ${qipuId} 未取得可校验的初始局面，已跳过以避免棋子丢失`);
          }
          // Tencent keeps the visible detail fields under version-dependent model
          // objects. Read only approved scalar names from a bounded graph; never
          // serialize the graph, HTML, credentials, or page data.
          const metadata = [
            info,
            raw.owner,
            ...(typeof boardControls === 'function' ? boardControls() : []),
            model && model.currentQipu,
            model && model._qipuData,
            model && model._qipuInfo,
            model && model._qipuView,
          ].filter(Boolean);
          // A display-control title such as Panel_BoardContainer can appear
          // before the actual game title under the same field name. Keep a
          // small ordered candidate set instead of letting that first value
          // permanently mask the useful one.
          const scalarFields = new Map();
          const wantedField = /^(?:title|name|qipuName|qipuTitle|qipuTitleName|qipuGameName|gameName|sTitle|szQipuName|getToWallQipuName|red|redName|redPlayer|redNick|redUserName|redPlayerName|redUserNick|sRedName|szRedName|black|blackName|blackPlayer|blackNick|blackUserName|blackPlayerName|blackUserNick|sBlackName|szBlackName|event|eventName|competition|competitionName|matchName|sEventName|szEventName|site|location|platform|date|gameDate|gameDateTime|createdDate|createTime|sCreateTime|result|gameResult|resultText|resultDesc|winLose|winner|winSide|round|roundNo|roundNumber|roundName|gameRound|iRound|stage|playedAt|gameTime|startTime|createdAt|duration|gameDuration|durationText|elapsedTime|usedTime|totalTime|iTime|timeControl|timeRule|clockRule|gameRule|ruleName|playRule)$/i;
          const seenMetadata = new WeakSet(); let metadataNodes = 0;
          const metadataDeadline = Date.now() + 500;
          const collectMetadata = (value, depth = 0) => {
            if (!value || depth > 4 || metadataNodes >= 1800 || Date.now() >= metadataDeadline || typeof value !== 'object') return;
            if (seenMetadata.has(value)) return; seenMetadata.add(value); metadataNodes += 1;
            for (const key of propertyNames(value).slice(0, 100)) {
              if (Date.now() >= metadataDeadline) break;
              let child; try { child = value[key]; } catch (_) { continue; }
              if (wantedField.test(key) && (typeof child === 'string' || typeof child === 'number')) {
                const text = String(child).trim();
                const normalizedKey = key.toLowerCase();
                const values = scalarFields.get(normalizedKey) || [];
                if (text && text.length <= 240 && !values.includes(text) && values.length < 8) {
                  values.push(text); scalarFields.set(normalizedKey, values);
                }
              }
              if (child && typeof child === 'object' && /(?:qipu|game|match|player|detail|info|data|model|board|body|title|tittle|battle|user|profile|avatar|^va$)/i.test(key)) collectMetadata(child, depth + 1);
              // Some QQ H5 revisions put the detail object into a JSON string.
              // Only parse bounded strings under known detail/data keys; the
              // parsed object is used in-memory for the approved scalar fields.
              if (typeof child === 'string' && child.length <= 16 * 1024 && /(?:qipu|game|match|player|detail|info|data|record)/i.test(key)) {
                try {
                  const parsed = JSON.parse(child);
                  if (parsed && typeof parsed === 'object') collectMetadata(parsed, depth + 1);
                } catch (_) { /* This field is ordinary text, not JSON. */ }
              }
            }
          };
          metadata.forEach(source => collectMetadata(source));
          const firstText = (...keys) => {
            for (const key of keys) {
              const texts = scalarFields.get(String(key).toLowerCase());
              if (texts && texts[0]) return texts[0];
            }
            return '';
          };
          const firstUsableTitle = (...keys) => {
            const internalTitle = value => /(?:^Panel_|^preLink|<PrefabLink>|QipuChessBoardControl|ChessBoard(?:Mark|Control|Container))/i.test(value);
            for (const key of keys) {
              const texts = scalarFields.get(String(key).toLowerCase()) || [];
              const text = texts.find(value => !internalTitle(value));
              if (text) return text;
            }
            return '';
          };
          const semanticDetailFields = () => {
            const fields = { title: '', event: '', date: '', site: '', red: '', black: '', result: '', round: '' };
            const labels = {
              title: ['标题'], event: ['场次', '赛事'], date: ['日期'], site: ['地点'],
              red: ['红方'], black: ['黑方'], result: ['结果'], round: ['回合'],
            };
            const acceptText = (candidate) => {
              if (typeof candidate !== 'string' && typeof candidate !== 'number') return;
              const text = String(candidate).trim();
              if (!text || text.length > 240 || /(?:<PrefabLink>|^preLink|^Panel_|QipuChessBoardControl)/i.test(text)) return;
              for (const [field, fieldLabels] of Object.entries(labels)) {
                for (const label of fieldLabels) {
                  const match = text.match(new RegExp(`^${label}\\s*[:：]\\s*(.+)$`));
                  if (match && match[1].trim() && !fields[field]) fields[field] = match[1].trim();
                }
              }
              if (!fields.title && /(?:[一二三四五六七八九十百千万\d]+轮|布局|开局|中局|残局|顺炮|列炮|飞相|屏风马|反宫马|横车|直车|过宫炮|士角炮|仙人指路|起马|巡河炮|急进中兵|创建于\s*20\d{2})/.test(text)) fields.title = text;
              // Full QQ titles are generated as player/rank + result + rank +
              // move count, for example 放飞[业9-2]先和[业9-2],29回合.
              if (/(?:先胜|先负|先和|后胜|后负|后和)/.test(text) && /[,，]?\d+\s*回合/.test(text)) fields.title = text;
              const heading = text.match(/^(.+?)\s+(先胜|先负|先和|后胜|后负|后和)\s*\(\s*\d+\s*\/\s*(\d+)\s*\)$/);
              if (heading) {
                if (!fields.title) fields.title = `${heading[1]} ${heading[2]}（${heading[3]} 半回合）`;
                if (!fields.red) fields.red = heading[1].trim();
                if (!fields.result) fields.result = heading[2];
                if (!fields.round) fields.round = `${Math.ceil(Number(heading[3]) / 2)} 回合`;
              }
              if (!fields.date && /^20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)) fields.date = text;
              if (!fields.site && text === '天天象棋') fields.site = text;
            };
            const seen = new WeakSet();
            // The traversal stack is LIFO. Put the global FDK root first so
            // current detail roots are popped and searched before the broad
            // application graph.
            const stack = [window.fdk, ...detailDisplayRoots()].filter(Boolean).map(value => ({ value, depth: 0 }));
            let visited = 0;
            const traversalDeadline = Date.now() + 350;
            while (stack.length && visited < 40_000 && Date.now() < traversalDeadline) {
              const { value, depth } = stack.pop();
              if (!value || typeof value !== 'object' || seen.has(value) || depth > 16) continue;
              seen.add(value); visited += 1;
              for (const key of propertyNames(value).slice(0, 140)) {
                if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
                try {
                  const child = value[key];
                  if (typeof child === 'string' || typeof child === 'number') {
                    if (/^(?:sTitle|qipuName|qipuTitle|gameName)$/i.test(key)) {
                      const text = String(child).trim();
                      if (text && text.length <= 240 && !fields.title) fields.title = text;
                    }
                    if (/^(?:iRound|round|gameRound)$/i.test(key)) {
                      const text = String(child).trim();
                      if (/^\d+$/.test(text) && !fields.round) fields.round = `${text} 回合`;
                    }
                    acceptText(child);
                  }
                  else if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
                } catch (_) { /* Ignore transient FDK getters. */ }
              }
              if (fields.title && fields.event && fields.date && fields.red && fields.result) break;
            }
            return fields;
          };
          // QQ's detail panel is the user-facing source of truth. Its backing
          // model often exposes Unity control names instead of the title shown
          // in the page, so read only its small labelled text segment.
          const visibleDetailFields = () => {
            const body = document.body;
            // Some QQ H5 releases update textContent before innerText. Combine
            // the two render projections locally, then retain only labelled
            // scalar values below; neither representation is sent to the app.
            const pageText = [body && body.innerText, body && body.textContent]
              .filter(Boolean).join('\n').replace(/\r/g, '');
            const panelStart = pageText.indexOf('棋谱属性');
            const panel = panelStart >= 0 ? pageText.slice(panelStart, panelStart + 2_400) : '';
            const field = (...labels) => {
              for (const label of labels) {
                const sameLine = panel.match(new RegExp(`(?:^|\\n)${label}\\s*[:：]\\s*([^\\n]+)`, 'm'));
                const nextLine = panel.match(new RegExp(`(?:^|\\n)${label}\\s*[:：]?\\s*\\n\\s*([^\\n]+)`, 'm'));
                const value = (sameLine && sameLine[1] || nextLine && nextLine[1] || '').trim();
                if (value && value.length <= 240) return value;
              }
              return '';
            };
            return {
              title: field('标题'),
              event: field('场次', '赛事'),
              date: field('日期'),
              site: field('地点'),
              red: field('红方'),
              black: field('黑方'),
              result: field('结果'),
            };
          };
          const displayObjectDetailFields = () => {
            // QQ renders the right property panel through its FDK display
            // objects, not consistently through DOM text. Walk only the
            // current detail/board roots, find the `棋谱属性` subtree, and keep
            // the neighbouring label values. No display-object graph or other
            // text is serialized back to the desktop app.
            const textOf = (value) => {
              if (!value || typeof value !== 'object') return '';
              for (const key of ['text', '_text', 'value', '_value', 'label', '_label']) {
                try {
                  const candidate = value[key];
                  if ((typeof candidate === 'string' || typeof candidate === 'number') && String(candidate).trim().length <= 240) return String(candidate).trim();
                } catch (_) { /* Display objects can have transient getters. */ }
              }
              return '';
            };
            const childValues = (value) => {
              const children = [];
              for (const key of propertyNames(value).slice(0, 140)) {
                if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
                try {
                  const child = value[key];
                  if (child && typeof child === 'object') children.push(child);
                } catch (_) { /* Ignore inaccessible FDK properties. */ }
              }
              return children;
            };
            const emptyFields = () => ({ title: '', event: '', date: '', site: '', red: '', black: '', result: '' });
            const fieldsFromTexts = (detailTexts) => {
              const find = (...labels) => {
                for (let index = 0; index < detailTexts.length; index += 1) {
                const current = detailTexts[index];
                for (const label of labels) {
                  const inline = current.match(new RegExp(`^${label}\\s*[:：]\\s*(.+)$`));
                  if (inline && inline[1].trim()) return inline[1].trim();
                  if (new RegExp(`^${label}\\s*[:：]?$`).test(current)) {
                    const next = detailTexts.slice(index + 1, index + 5)
                      .find(value => value && !/^(?:标题|场次|赛事|日期|地点|红方|黑方|结果)\s*[:：]?$/.test(value));
                    if (next) return next;
                  }
                }
              }
              return '';
              };
              return {
                title: find('标题'),
                event: find('场次', '赛事'),
                date: find('日期'),
                site: find('地点'),
                red: find('红方'),
                black: find('黑方'),
                result: find('结果'),
              };
            };
            const subtreeTexts = (root, limit = 800) => {
              const texts = [];
              const seen = new WeakSet();
              const stack = [root];
              let visited = 0;
              while (stack.length && visited < limit) {
                const value = stack.pop();
                if (!value || typeof value !== 'object' || seen.has(value)) continue;
                seen.add(value); visited += 1;
                const text = textOf(value);
                if (text) texts.push(text);
                for (const child of childValues(value)) stack.push(child);
              }
              return texts;
            };
            // The board control is the fast path. The FDK root is necessary for
            // current QQ builds where the right-side property panel is a sibling
            // of the board rather than a child of it.
            // The stack below is LIFO: keep the broad FDK graph as the final
            // fallback after the current board/detail roots.
            const roots = [window.fdk, ...detailDisplayRoots()]
              .filter(Boolean);
            const seen = new WeakSet();
            const stack = roots.map(value => ({ value, depth: 0 }));
            let visited = 0;
            const traversalDeadline = Date.now() + 350;
            while (stack.length && visited < 40_000 && Date.now() < traversalDeadline) {
              const { value, depth } = stack.pop();
              if (!value || typeof value !== 'object' || seen.has(value) || depth > 16) continue;
              seen.add(value); visited += 1;
              const text = textOf(value);
              if (text === '棋谱属性' || text === '棋谱属性：') {
                let panel = value;
                for (let level = 0; panel && level < 7; level += 1) {
                  const fields = fieldsFromTexts(subtreeTexts(panel));
                  if (fields.title || fields.red || fields.event) return fields;
                  try { panel = panel.parent || panel._parent; } catch (_) { panel = null; }
                }
              }
              for (const child of childValues(value)) stack.push({ value: child, depth: depth + 1 });
            }
            return emptyFields();
          };
          const metadataProbe = () => {
            const samples = [];
            const seen = new WeakSet();
            const stack = detailDisplayRoots().map((value, index) => ({ value, path: `detailRoot[${index}]`, depth: 0 }));
            let visited = 0;
            const traversalDeadline = Date.now() + 250;
            const usefulKey = /(?:text|label|value|title|name|qipu|red|black|result|event|date|round|site)/i;
            const usefulText = /(?:标题|场次|赛事|日期|地点|红方|黑方|结果|回合|先胜|先负|先和|后胜|后负|后和|天天象棋|^20\d{2}[\/-])/;
            while (stack.length && visited < 8_000 && samples.length < 80 && Date.now() < traversalDeadline) {
              const { value, path, depth } = stack.pop();
              if (!value || typeof value !== 'object' || seen.has(value) || depth > 10) continue;
              seen.add(value); visited += 1;
              for (const key of propertyNames(value).slice(0, 120)) {
                if (/^(?:parent|_parent|stage|_stage|root|_root|owner|_owner|target|currentTarget|event|events|listeners?)$/i.test(key)) continue;
                try {
                  const child = value[key];
                  if (typeof child === 'string' || typeof child === 'number') {
                    const text = String(child).trim();
                    if (text && text.length <= 240 && (usefulKey.test(key) || usefulText.test(text))) {
                      samples.push(`${path}.${key}=${text}`);
                    }
                  } else if (child && typeof child === 'object') {
                    stack.push({ value: child, path: `${path}.${key}`, depth: depth + 1 });
                  }
                } catch (_) { /* Ignore transient display-object getters. */ }
              }
            }
            return samples.join('\n').slice(0, 8 * 1024);
          };
          const displayDate = (value) => {
            if (!/^\d{10,13}$/.test(value)) return value;
            const epoch = Number(value) * (value.length === 10 ? 1000 : 1);
            const date = new Date(epoch);
            if (!Number.isFinite(epoch) || date.getFullYear() < 2000 || date.getFullYear() > 2100) return value;
            const two = part => String(part).padStart(2, '0');
            return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
          };
          const mergeDetailFields = (...sources) => {
            const keys = new Set(sources.flatMap(source => Object.keys(source || {})));
            return Object.fromEntries([...keys].map(key => [key, sources.find(source => source && source[key])?.[key] || '']));
          };
          const detailFields = () => {
            const dom = visibleDetailFields();
            if (dom.title || dom.red || dom.black || dom.event) return dom;
            const display = displayObjectDetailFields();
            const semantic = semanticDetailFields();
            return mergeDetailFields(display, dom, semantic);
          };
          let visible = detailFields();
          // The board control reaches getQipuMoveStep before QQ paints the
          // right-hand property panel. Give that panel a short bounded chance
          // to settle, otherwise a valid game incorrectly falls back to its id.
          for (let detailPoll = 0; detailPoll < 10 && !visible.title && !visible.red && !visible.event && Date.now() < gameDeadline; detailPoll += 1) {
            await delay(Math.min(150, Math.max(0, gameDeadline - Date.now())));
            visible = mergeDetailFields(visibleDetailFields(), visible);
          }
          if (!visible.title && !visible.red && !visible.event) {
            visible = mergeDetailFields(detailFields(), visible);
          }
          if (typeof invoke === 'function') {
            await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'branches' });
          }
          // The route-control group belongs to the active board instance. A
          // jump can reuse the same controller object, so discard the
          // pre-jump group before collecting target annotations.
          if (typeof branchPayload === 'function') {
            branchPayload.routeControls = null;
            branchPayload.routeControlOwner = null;
            branchPayload.expectedQipuId = qipuId;
          }
          const passiveBranch = branchPayload(raw.owner || null);
          readBranchRoutes.deadline = gameDeadline;
          const branch = await readBranchRoutes(qipuId, raw, passiveBranch, beforeBranchSignature, beforeAnnotationSignature);
          const rawResult = firstText('result', 'gameResult', 'resultText', 'resultDesc', 'winLose', 'winner', 'winSide') || visible.result;
          const normalizedResult = /和/.test(rawResult) ? '1/2-1/2'
            : /(?:先胜|红胜|后负)/.test(rawResult) ? '1-0'
            : /(?:后胜|黑胜|先负)/.test(rawResult) ? '0-1' : rawResult;
          let annotationEnvelope = {};
          try { annotationEnvelope = branch.data ? JSON.parse(branch.data) : {}; } catch (_) { annotationEnvelope = { annotationsComplete: false }; }
          // QQ can mount the unavailable-record dialog after the move field and
          // metadata have already settled. Check once more before committing
          // this row so a stale board is never accepted while the dialog stays
          // visible over the authorization window.
          if (typeof dismissUnavailableDialog === 'function') {
            const lateUnavailable = dismissUnavailableDialog(unavailableBaseline);
            if (lateUnavailable) {
              await delay(120);
              throw new Error(lateUnavailable);
            }
          }
          games.push({
            qipuId,
            title: firstUsableTitle('sTitle', 'title', 'qipuName', 'qipuTitle', 'szQipuName', 'getToWallQipuName', 'gameName', 'name') || visible.title,
            startingFen,
            red: firstText('red', 'redName', 'redPlayer', 'redNick', 'redUserName', 'redPlayerName', 'sRedName', 'szRedName') || visible.red,
            black: firstText('black', 'blackName', 'blackPlayer', 'blackNick', 'blackUserName', 'blackPlayerName', 'sBlackName', 'szBlackName') || visible.black,
            event: firstText('event', 'eventName', 'competition', 'competitionName', 'matchName', 'sEventName', 'szEventName') || visible.event,
            site: firstText('site', 'location', 'platform') || visible.site || '天天象棋',
            date: displayDate(firstText('date', 'gameDate', 'createdDate') || visible.date),
            result: normalizedResult,
            note: rawResult && rawResult !== normalizedResult ? `天天象棋赛果：${rawResult}` : '',
            round: firstText('round', 'roundNo', 'roundNumber', 'roundName', 'gameRound', 'iRound', 'stage') || visible.round,
            playedAt: displayDate(firstText('playedAt', 'gameTime', 'startTime', 'createdAt', 'gameDateTime', 'createTime', 'sCreateTime') || visible.date),
            duration: firstText('duration', 'gameDuration', 'durationText', 'elapsedTime', 'usedTime', 'totalTime', 'iTime'),
            timeControl: firstText('timeControl', 'timeRule', 'clockRule', 'gameRule', 'ruleName', 'playRule'),
            moves,
            rawMoves: raw.text.slice(0, 32 * 1024),
            rawMovePath: raw.path,
            rawMoveType: raw.type,
            rawMoveLength: raw.length,
            branchData: branch.data,
            branchPath: branch.path,
            branchComplete: branch.complete,
            annotations: Array.isArray(annotationEnvelope.annotations) ? annotationEnvelope.annotations : [],
            annotationsComplete: annotationEnvelope.annotationsComplete !== false,
            metadataProbe: visible.title ? '' : metadataProbe(),
          });
        } catch (error) {
          failed += 1;
          failures.push(`第 ${current} 盘：${String(error && error.message || error)}`);
        } finally {
          if (typeof drainUnavailableDialogs === 'function') await drainUnavailableDialogs();
          completed += 1;
          await invoke('report_ttxq_read_progress', { attemptId: __TTXQ_ATTEMPT_ID__, total, completed, failed, scanned, current, phase: 'reading' });
        }
      }
      if (!games.length) throw new Error(`未读取到有效棋谱${failures.length ? `；${failures.slice(0, 3).join('；')}` : ''}`);
      if (typeof drainUnavailableDialogs === 'function') await drainUnavailableDialogs();
      await invoke('submit_ttxq_bridge_payload', { attemptId: __TTXQ_ATTEMPT_ID__, payload: { version: __TTXQ_BRIDGE_VERSION__, requireStartingFen: true, games } });
    })().catch(async error => {
      const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
      if (invoke) await invoke('report_ttxq_bridge_error', { attemptId: __TTXQ_ATTEMPT_ID__, message: String(error && error.message || error) });
    })"#
        .replace("__TTXQ_ATTEMPT_ID__", &attempt_id.to_string())
        .replace("__TTXQ_BRIDGE_VERSION__", &super::BRIDGE_VERSION.to_string());
    if let Err(error) = window.eval(&collector_script) {
        let mut sync = state
            .ttxq_sync
            .lock()
            .map_err(|_| "天天象棋同步状态不可用".to_owned())?;
        set_read_error(
            &mut sync,
            attempt_id,
            &format!("无法启动天天象棋采集器：{error}"),
        );
        return Err(format!("无法启动天天象棋采集器：{error}"));
    }

    let watchdog_app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(BRIDGE_HANDSHAKE_TIMEOUT).await;
        let state = watchdog_app.state::<DesktopState>();
        if let Ok(mut sync) = state.ttxq_sync.lock() {
            fail_unacknowledged_bridge(&mut sync, attempt_id, &current_host);
        }
    });
    let stall_watchdog_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let observed_revision = {
                let state = stall_watchdog_app.state::<DesktopState>();
                let Ok(sync) = state.ttxq_sync.lock() else {
                    return;
                };
                if sync.progress.state != "reading" || sync.active_attempt != attempt_id {
                    return;
                }
                sync.progress_revision
            };
            tokio::time::sleep(BRIDGE_PROGRESS_STALL_TIMEOUT).await;
            let state = stall_watchdog_app.state::<DesktopState>();
            let Ok(mut sync) = state.ttxq_sync.lock() else {
                return;
            };
            if fail_stalled_read(&mut sync, attempt_id, observed_revision) {
                return;
            }
            if sync.progress.state != "reading" || sync.active_attempt != attempt_id {
                return;
            }
        }
    });
    Ok(())
}
