/**
 * 地址：`domain/resource`。
 *
 * 只按第一个 `/` 分两段：resource 可以是 ref（file:///…），
 * 框架不在这里解释 ref，只把它当作域内的寻址字符串。
 */

export interface Address {
  domain: string;
  resource: string;
}

export function parseAddress(value: string): Address | null {
  const index = value.indexOf('/');
  if (index <= 0 || index === value.length - 1) return null;
  return {
    domain: value.slice(0, index),
    resource: value.slice(index + 1),
  };
}

export function formatAddress(address: Address): string {
  return `${address.domain}/${address.resource}`;
}
