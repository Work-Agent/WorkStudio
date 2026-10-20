/**
 * 图标语义名 → lucide 组件（插件清单 workstudio.icon / 视图动作 icon 共用）。
 */
import {
  BookOpen,
  Code2,
  Cpu,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  HardDrive,
  List,
  MessagesSquare,
  MousePointerClick,
  Package,
  Puzzle,
  Search,
  Settings,
  SlidersHorizontal,
  Tag,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  globe: Globe,
  'file-text': FileText,
  code: Code2,
  settings: Settings,
  sliders: SlidersHorizontal,
  cpu: Cpu,
  puzzle: Puzzle,
  book: BookOpen,
  messages: MessagesSquare,
  folder: FolderOpen,
  'hard-drive': HardDrive,
  search: Search,
  package: Package,
  eye: Eye,
  list: List,
  tag: Tag,
  'mouse-pointer-click': MousePointerClick,
};

export function rendererIcon(name?: string): LucideIcon | null {
  return name ? (ICONS[name] ?? null) : null;
}
