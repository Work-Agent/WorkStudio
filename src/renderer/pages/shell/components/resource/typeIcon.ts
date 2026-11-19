/**
 * 视图类型 → 图标（标签栏与 TitleBar 地址栏共用，单一事实源）。
 */
import {
  FileText,
  Globe,
  Package,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import type { ViewType } from '../../../../../shared/types.ts';

const TYPE_ICON: Record<ViewType, LucideIcon> = {
  settings: SlidersHorizontal,
  extension: Package,
  browser: Globe,
};

export function typeIcon(viewType: ViewType): LucideIcon {
  return TYPE_ICON[viewType] ?? FileText;
}
