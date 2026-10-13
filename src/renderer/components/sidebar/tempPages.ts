/**
 * 「临时网页」分组常量（不在域名名单内的打开标签页——不落盘，只活在标签里）。
 *
 * 侧边栏把它当 web 形态的一个特殊域参与形态机（sidebarDomain = 该常量），
 * 二级列表据此渲染「打开的临时标签页」而不是 URA 文档。
 */
export const TEMP_PAGES_DOMAIN = '__temporary__';
export const TEMP_PAGES_TITLE = '临时网页';
