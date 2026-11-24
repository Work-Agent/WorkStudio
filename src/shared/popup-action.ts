/**
 * 弹出菜单动作 id 的解析。
 *
 * 菜单项把动作和锚点编码成 `action:anchor`，而锚点本身可能含冒号
 * （view id 形如 `wsId:web-2`，Windows 会话路径带盘符），所以只在
 * 第一个冒号处切分。
 */
export interface PopupAction {
  action: string;
  /** 锚点原值（可能为空；含冒号时保持完整）。 */
  value: string;
}

export function parsePopupAction(actionId: string): PopupAction {
  const split = actionId.indexOf(':');
  if (split < 0) return { action: actionId, value: '' };
  return {
    action: actionId.slice(0, split),
    value: actionId.slice(split + 1),
  };
}
