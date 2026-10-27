// ─── 内置插件装载表 ──────────────────────────────────────────────────
//
// 内置插件随应用构建：注册入口静态可达，避免运行期解析包路径。
// 已安装插件走 PluginHost 的动态 import。

import type { BuiltinLoader } from './host';

export const BUILTIN_PLUGINS: BuiltinLoader[] = [
  {
    id: 'markdown-viewer',
    load: () => import('../../plugins/markdown-viewer/ura'),
  },
  {
    id: 'html-viewer',
    load: () => import('../../plugins/html-viewer/ura'),
  },
  {
    id: 'text-editor',
    load: () => import('../../plugins/text-editor/ura'),
  },
];
