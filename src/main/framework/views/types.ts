import type { Grant, ViewType } from '../../core/types';
import type { ViewPreload } from '../electron-middleware';

export interface CreateViewRequest {
  type: ViewType;
  title?: string;
  url?: string;
  grants?: Grant;
  sessionId?: string | null;
  contentPath?: string | null;
  content?: () => unknown;
  partition?: string;
  preload?: ViewPreload;
}
