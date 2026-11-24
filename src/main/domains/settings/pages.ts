/**
 * 系统设置卡片清单。
 *
 * 资源诊断 / URA 绑定已随 URA 退役；设置页只保留仍由新域支撑的卡片。
 */

import type { SettingsPage } from './domains.ts';

export const DEFAULT_SETTINGS_PAGES: SettingsPage[] = [
  {
    id: 'appearance',
    label: '外观与主题',
    desc: '浅色 / 深色 / 跟随系统 · 界面缩放',
    icon: 'palette',
  },
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
    label: '网站采集',
    desc: '归档白名单 · 域名分组',
    icon: 'globe',
  },
  {
    id: 'plugins',
    label: '文档插件',
    desc: 'zip 安装 · 固定安装路径',
    icon: 'package',
  },
  {
    id: 'updates',
    label: '关于与更新',
    desc: '版本检查 · 安装包下载',
    icon: 'download',
  },
  {
    id: 'models',
    label: '模型连接',
    desc: '供应商登录 · 模型目录 · API Key',
    icon: 'cpu',
  },
  {
    id: 'extensions',
    label: '助手扩展',
    desc: '社区包安装 · 已加载扩展',
    icon: 'puzzle',
  },
  {
    id: 'skills',
    label: '技能',
    desc: '已加载清单 · 装载诊断',
    icon: 'book',
  },
  {
    id: 'sessions',
    label: '会话历史',
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
];
