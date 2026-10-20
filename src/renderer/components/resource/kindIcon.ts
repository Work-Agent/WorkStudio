/**
 * 视图类型 → 图标（标签栏与 TitleBar 地址栏共用，单一事实源）。
 */
import { FileText, Globe, Package, type LucideIcon } from 'lucide-react';
import type { ViewKind } from '../../../shared/types';

const KIND_ICON: Record<ViewKind, LucideIcon> = {
  extension: Package,
  browser: Globe,
};

export function kindIcon(kind: ViewKind): LucideIcon {
  return KIND_ICON[kind] ?? FileText;
}
