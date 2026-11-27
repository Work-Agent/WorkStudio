/**
 * 插件注册表的两个官方来源：GitHub raw 与腾讯云 COS 镜像。
 *
 * 主进程用它决定默认地址，设置面板用它渲染下拉框；两边只认这一份常量。
 */

/** 国内镜像根：与安装包更新共用同一个 COS 存储桶。 */
export const DOMESTIC_BASE_URL =
  'https://ai-1301618848.cos.ap-nanjing.myqcloud.com/data/';

export const PLUGIN_CATALOG_SOURCES = {
  github:
    'https://raw.githubusercontent.com/Work-Agent/PluginRegistry/main/index.json',
  domestic: `${DOMESTIC_BASE_URL}plugins/index.json`,
} as const;

export type PluginCatalogSource = keyof typeof PLUGIN_CATALOG_SOURCES;

/** 当前地址属于哪个来源；自定义地址返回 null。 */
export function catalogSourceOf(
  url: string | null | undefined,
): PluginCatalogSource | null {
  for (const [source, value] of Object.entries(PLUGIN_CATALOG_SOURCES)) {
    if (value === url) return source as PluginCatalogSource;
  }
  return null;
}
