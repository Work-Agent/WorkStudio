/**
 * 声明式标题栏动作目录（architecture.md §2.2）。
 *
 * 插件 manifest 的 `titlebarActions` 只声明语义 id；主窗口按本目录渲染按钮
 * （图标 / 标题 / 激活态 / 禁用态），点击经 `views.action` 下发到视图页，
 * 视图页以 `actionState` 回报当前状态（actionStates 投影）。
 */
import {
  Code2,
  Columns2,
  Eye,
  Save,
  ShieldCheck,
  ShieldOff,
  WrapText,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { ViewEntry } from '../../../shared/types';

export interface TitlebarActionSpec {
  /** 按钮标题（随动作状态变化）。 */
  title: (state: string | undefined, view: ViewEntry) => string;
  icon: (state: string | undefined) => LucideIcon;
  /** 开关类动作的激活态。 */
  active?: (state: string | undefined) => boolean;
  /** 禁用判定（如 save 未脏）。 */
  disabled?: (state: string | undefined, view: ViewEntry) => boolean;
}

/** 动作语义目录（插件声明的 id 必须来自此处；未登记的 id 渲染为通用动作）。 */
export const TITLEBAR_ACTIONS: Record<string, TitlebarActionSpec> = {
  /** 布局循环：preview → split → source → preview（视图页决定顺序）。 */
  'layout-switch': {
    title: (state) =>
      state === 'source'
        ? '源码视图（点击切换）'
        : state === 'split'
          ? '分屏视图（点击切换）'
          : '预览视图（点击切换）',
    icon: (state) =>
      state === 'source' ? Code2 : state === 'split' ? Columns2 : Eye,
  },
  /** 保存（脏态由视图页 dirty 上报驱动）。 */
  save: {
    title: (_state, view) => (view.dirty ? '保存（有未保存修改）' : '保存'),
    icon: () => Save,
    disabled: (_state, view) => !view.dirty,
  },
  /** 自动换行开关。 */
  'toggle-wrap': {
    title: (state) => (state === 'off' ? '开启自动换行' : '关闭自动换行'),
    icon: () => WrapText,
    active: (state) => state !== 'off',
  },
  /** 预览脚本开关。 */
  'toggle-scripts': {
    title: (state) =>
      state === 'on' ? '禁止预览脚本' : '允许预览脚本（沙箱隔离）',
    icon: (state) => (state === 'on' ? ShieldCheck : ShieldOff),
    active: (state) => state === 'on',
  },
};

export const FALLBACK_ACTION: TitlebarActionSpec = {
  title: (state) => (state ? `视图动作：${state}` : '视图动作'),
  icon: () => Zap,
};
