// ─── 浏览器内建能力：站点集合 + 可访问性标记 ────────────────────────
//
// 一个采集域 = 一个分组；条目来自工作区 sites/<domain>/ 下的页面快照。
// 行上是快照头部的页面标题与 URL；打开走实时视图（不经 transport / codec）。
// 白名单属工作区策略：settings.json 的 workspaceStudio.browser.allowlist。

import { fileURLToPath } from 'node:url';
import { getWorkspaceId } from '../agent/workspace.ts';
import { readBrowserAllowlist } from '../../infrastructure/preferences.ts';
import {
  registerList,
  registerPresenter,
  registerViewAction,
} from '../ura/sdk.ts';
import { MIME, type ListEntry } from '../../../shared/ura.ts';
import type { ListDefinition } from '../../../shared/lists.ts';
import type { ListProvider } from '../lists/registry.ts';
import { DOC_FIELDS, OPEN_ACTION } from '../lists/builtins/common.ts';
import { mtimeOf } from '../lists/builtins/file-time.ts';
import { allowlisted, readSnapshotHead } from '../sites/snapshots.ts';

const SITES_DIR = 'sites';

function titleFallbackOf(ref: string): string {
  const name = ref.slice(ref.lastIndexOf('/') + 1);
  return name.replace(/\.md$/i, '');
}

const webDefinition: ListDefinition = {
  id: 'web',
  label: '网站资料',
  icon: 'globe',
  tone: 'bg-sky-500 text-sky-50 dark:bg-sky-600 dark:text-sky-100',
  unit: '页',
  order: 20,
  sourceScope: 'workspace',
  itemType: 'document',
  fields: DOC_FIELDS,
  actions: [OPEN_ACTION],
  empty: { icon: 'globe', text: '暂无网站资料' },
  grouping: 'domain',
};

const webProvider: ListProvider = async (ctx) => {
  // 白名单属工作区策略（同一次列表快照内工作区不变）
  const allowlist = readBrowserAllowlist(
    getWorkspaceId(fileURLToPath(ctx.workspace)),
  );
  if (allowlist.length === 0) return [];
  // 快照目录按页面真实 hostname 落盘（含子域），所以按目录分组后再用白名单过滤
  const files: ListEntry[] = await ctx
    .find('*.md', { scope: `${ctx.workspace}/${SITES_DIR}`, limit: 600 })
    .catch(() => []);
  const byDomain = new Map<string, typeof files>();
  for (const file of files) {
    if (file.type !== 'file') continue;
    const domain = domainOfRef(file.ref);
    if (!domain || !allowlisted(domain, allowlist)) continue;
    const bucket = byDomain.get(domain);
    if (bucket) bucket.push(file);
    else byDomain.set(domain, [file]);
  }
  const groups = [];
  for (const [domain, entries] of byDomain) {
    const favicon = `https://${domain}/favicon.ico`;
    groups.push({
      id: domain,
      label: domain,
      icon: favicon,
      items: await Promise.all(
        entries.map(async (entry) => {
          const head = await readSnapshotHead(entry.ref);
          const updatedAt = await mtimeOf(entry.ref);
          const url = head.url ?? '';
          return {
            key: entry.ref,
            // 头里有 url 才是可打开的站点页面；缺头的旧快照退回按文档打开
            itemType: url ? 'web-page' : 'document',
            title: head.title || titleFallbackOf(entry.ref),
            subtitle: url || domain,
            icon: favicon,
            meta: {
              ref: entry.ref,
              source: 'web',
              sourceLabel: '网站资料',
              groupId: domain,
              groupTitle: domain,
              ...(url ? { url } : {}),
              ...(updatedAt ? { updatedAt } : {}),
            },
          };
        }),
      ),
    });
  }
  return groups;
};

/** `…/sites/<domain>/<file>.md` → `<domain>`。 */
function domainOfRef(ref: string): string | null {
  const marker = `/${SITES_DIR}/`;
  const index = ref.indexOf(marker);
  if (index < 0) return null;
  const rest = ref.slice(index + marker.length);
  const end = rest.indexOf('/');
  return end > 0 ? rest.slice(0, end) : null;
}

// ─── 地址栏动作：可访问性元素标记 ────────────────────────────────────

// 标记层常驻页面：滚动 / 尺寸变化时按最新 rect 重绘；关闭时整体移除。

const MARKS_SCRIPT = `(() => {
  const KEY = '__wsA11yMarks';
  const previous = window[KEY];
  if (previous) previous.stop();

  const style = document.createElement('style');
  style.textContent =
    '.__ws-a11y-box{position:fixed;box-sizing:border-box;border:1.5px solid #4F6BED;border-radius:3px;pointer-events:none;}' +
    '.__ws-a11y-box b{position:absolute;left:-1px;top:-15px;background:#4F6BED;color:#fff;' +
    'font:10px/14px -apple-system,sans-serif;padding:0 4px;border-radius:3px;font-weight:600;}';

  const layer = document.createElement('div');
  layer.id = '__ws_a11y_layer__';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  document.documentElement.appendChild(style);
  document.documentElement.appendChild(layer);

  const selector = 'a[href],button,input,select,textarea,[role],[tabindex]:not([tabindex="-1"])';
  let items = [];
  let raf = 0;
  let mutationTimer = 0;

  const collect = () => {
    layer.replaceChildren();
    items = [...document.querySelectorAll(selector)].map((el, index) => {
      const box = document.createElement('div');
      box.className = '__ws-a11y-box';
      const badge = document.createElement('b');
      badge.textContent = String(index + 1);
      box.appendChild(badge);
      layer.appendChild(box);
      return { el, box };
    });
  };

  const render = () => {
    for (const { el, box } of items) {
      const rect = el.getBoundingClientRect();
      const visible =
        rect.width > 2 &&
        rect.height > 2 &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= innerHeight &&
        rect.left <= innerWidth;
      if (!visible) {
        box.style.display = 'none';
        continue;
      }
      box.style.display = 'block';
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      box.style.width = rect.width + 'px';
      box.style.height = rect.height + 'px';
    }
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  };

  const onMutation = () => {
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(() => {
      mutationTimer = 0;
      collect();
      render();
    }, 200);
  };

  collect();
  render();
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  const observer = new MutationObserver(onMutation);
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const stop = () => {
    window.removeEventListener('scroll', schedule, true);
    window.removeEventListener('resize', schedule);
    observer.disconnect();
    if (mutationTimer) clearTimeout(mutationTimer);
    if (raf) cancelAnimationFrame(raf);
    layer.remove();
    style.remove();
    items = [];
    delete window[KEY];
  };

  window[KEY] = { stop };
  return items.length;
})()`;

export function registerBrowserFeatures(): void {
  registerList({ definition: webDefinition, provider: webProvider });
  registerPresenter({
    key: { transport: 'https', mime: MIME.html, codec: '' },
    type: 'browser',
    requires: ['live'],
    surface: 'browser',
    present: (_decoded, _raw, ref) => ({
      type: 'browser',
      surface: 'browser',
      url: ref,
    }),
  });
  registerViewAction({
    id: 'a11y-marks',
    label: '可访问性标记',
    icon: 'mouse-pointer-click',
    target: 'browser',
    toggle: true,
    async run(ctx) {
      if (ctx.on) {
        await ctx.execute<number>(MARKS_SCRIPT);
      } else {
        await ctx.execute(
          `(window.__wsA11yMarks && window.__wsA11yMarks.stop(), 0)`,
        );
      }
      ctx.setState(ctx.on ? 'on' : 'off');
    },
  });
}
