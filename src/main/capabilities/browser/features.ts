// ─── 浏览器内建能力：站点集合 + 可访问性标记 ────────────────────────
//
// 一个白名单域 = 一个分组；条目来自工作区 sites/<domain>/ 下的页面快照。
// 白名单存在浏览器设置（plugin-data/browser/settings.json，key = allowlist）。

import { registerCollection, registerConsumer, registerViewAction } from '../../ura/sdk'
import { MIME } from '../../../shared/ura'
import type { CollectionGroup, CollectionProvider } from '../../../shared/ura'

const SITES_DIR = 'sites'

function titleOf(ref: string): string {
  return ref.slice(ref.lastIndexOf('/') + 1)
}

const webCollection: CollectionProvider = {
  id: 'web',
  label: '网站资料',
  icon: 'globe',

  async list(ctx) {
    const allowlist = await ctx.settings.get<string[]>('allowlist', [])
    const groups: CollectionGroup[] = []
    for (const domain of allowlist) {
      const scope = `${ctx.workspace}/${SITES_DIR}/${domain}`
      const entries = await ctx
        .find('*.md', { scope, limit: 200 })
        .catch(() => [])
      groups.push({
        id: domain,
        title: domain,
        icon: `https://${domain}/favicon.ico`,
        items: entries
          .filter((entry) => entry.type === 'file')
          .map((entry) => ({ ref: entry.ref, title: titleOf(entry.ref) })),
      })
    }
    return groups
  },
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
})()`

export function registerBrowserFeatures(): void {
  registerCollection(webCollection)
  registerConsumer({
    docType: 'html-doc@1',
    mime: [MIME.html],
    transports: ['http', 'https'],
    type: 'editor',
    requires: ['live'],
    surface: 'browser',
    project: (_decoded, _raw, ref) => ({
      type: 'browser',
      surface: 'browser',
      url: ref,
    }),
  })
  registerViewAction({
  id: 'a11y-marks',
  label: '可访问性标记',
  icon: 'mouse-pointer-click',
  target: 'browser',
  toggle: true,
  async run(ctx) {
    if (ctx.on) {
      await ctx.execute<number>(MARKS_SCRIPT)
    } else {
      await ctx.execute(
        `(window.__wsA11yMarks && window.__wsA11yMarks.stop(), 0)`,
      )
    }
    ctx.setState(ctx.on ? 'on' : 'off')
  },
})
}
