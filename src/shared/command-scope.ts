/** AppCommand 作用域推导（preload 与宿主共用同一份规则）。 */
import type { Scope } from './app';

export function scopeForCommand(action: string): Scope {
  if (action.startsWith('session.')) return 'session';
  if (action.startsWith('ui.')) return 'ui';
  if (
    action.startsWith('agent.') ||
    action.startsWith('config.') ||
    action.startsWith('plugins.') ||
    action.startsWith('packages.') ||
    action.startsWith('skills.')
  )
    return 'app';
  return 'workspace';
}
