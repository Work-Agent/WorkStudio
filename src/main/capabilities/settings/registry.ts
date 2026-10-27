// ─── 设置能力（框架内置页面） ──────────────────────────────────────
//
// 设置页由主进程能力拥有：清单在此声明，页面在 <id>/index.html。
// 视图宿主经 app://page 装载，渲染层只拿投影（id / label / desc / icon）。

import { existsSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { app } from 'electron';
import { mainDir } from '../../paths';

export interface SettingsPage {
  id: string;
  label: string;
  desc: string;
  /** 图标语义名（壳层映射）。 */
  icon: string;
  /** 页面入口（绝对路径）。 */
  page: string;
  /** 内部页：可打开，但不进设置列表。 */
  internal?: boolean;
}

interface SettingsPageDef {
  id: string;
  label: string;
  desc: string;
  icon: string;
  internal?: boolean;
}

const PAGES: SettingsPageDef[] = [
  {
    id: 'welcome',
    label: '欢迎',
    desc: '打开工作区 / 新建文件',
    icon: 'sparkles',
    internal: true,
  },
  {
    id: 'preferences',
    label: '偏好设置',
    desc: 'App 默认 / 本工作区两层配置',
    icon: 'sliders',
  },
  {
    id: 'browser',
    label: '浏览器',
    desc: '归档白名单 · 域名分组',
    icon: 'globe',
  },
  {
    id: 'plugins',
    label: '插件',
    desc: 'zip 安装 · 本地路径 · 内置插件',
    icon: 'package',
  },
  {
    id: 'models',
    label: '模型配置',
    desc: '供应商登录 · 模型目录 · API Key',
    icon: 'cpu',
  },
  {
    id: 'extensions',
    label: 'Pi 扩展',
    desc: '社区包安装 · 已加载扩展',
    icon: 'puzzle',
  },
  { id: 'skills', label: '技能', desc: '已加载清单 · 装载诊断', icon: 'book' },
  {
    id: 'sessions',
    label: '会话管理',
    desc: '会话列表 · 切换 · 删除与停止',
    icon: 'messages',
  },
  {
    id: 'workspaces',
    label: '工作区',
    desc: '注册表 · 切换 / 打开目录',
    icon: 'folder',
  },
  {
    id: 'storage',
    label: '存储与数据',
    desc: '落盘位置 · 会话目录 · 版本信息',
    icon: 'hard-drive',
  },
  {
    id: 'resources',
    label: '资源索引',
    desc: '资源地图 · 重新索引',
    icon: 'folder-tree',
  },
];

const ROOTS = [
  join(app.getAppPath(), 'src', 'main', 'capabilities', 'settings'),
  join(mainDir, '..', 'settings'),
];

function pagePath(root: string, id: string): string {
  return join(root, id, 'index.html');
}

function allSettingsPages(): SettingsPage[] {
  for (const root of ROOTS) {
    if (!existsSync(root)) continue;
    const pages = PAGES.map((def) => ({
      ...def,
      page: pagePath(root, def.id),
    })).filter((page) => existsSync(page.page));
    if (pages.length > 0) return pages;
  }
  return [];
}

/** 设置列表：过滤内部页（欢迎页）。 */
export function settingsPages(): SettingsPage[] {
  return allSettingsPages().filter((page) => !page.internal);
}

export function settingsPage(id: string): SettingsPage | undefined {
  return allSettingsPages().find((page) => page.id === id);
}

export function containsSettingsPage(file: string): boolean {
  return allSettingsPages().some((page) => {
    const dir = dirname(page.page);
    return file === page.page || file.startsWith(`${dir}${sep}`);
  });
}
