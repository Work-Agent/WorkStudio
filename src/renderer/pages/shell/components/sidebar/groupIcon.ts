/** 列表分组图标：内置语义名 → lucide，图片图标优先。 */
import {
  FolderOpen,
  Globe,
  Hourglass,
  MessagesSquare,
  Package,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import type { ResourceGroup } from '../../../../../shared/resources.ts';

const ICONS: Record<string, LucideIcon> = {
  folder: FolderOpen,
  globe: Globe,
  hourglass: Hourglass,
  messages: MessagesSquare,
  package: Package,
  sliders: Settings,
};

export function groupIconOf(group: ResourceGroup): {
  Icon: LucideIcon;
  iconUrl?: string;
} {
  const raw = group.icon ?? 'folder';
  if (/^(data:|https?:)/.test(raw)) return { Icon: Globe, iconUrl: raw };
  return { Icon: ICONS[raw] ?? FolderOpen };
}
