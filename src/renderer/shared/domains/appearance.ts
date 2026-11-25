/**
 * 外观的首帧兜底。
 *
 * 主题唯一来源是主进程的 nativeTheme.themeSource，`prefers-color-scheme`
 * 是它在渲染层的投影；因此订阅返回前用它取初值，避免图标先按写死的
 * 亮 / 暗闪一帧。
 */
export function effectiveTheme(): 'light' | 'dark' {
  if (typeof matchMedia !== 'function') return 'dark';
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
