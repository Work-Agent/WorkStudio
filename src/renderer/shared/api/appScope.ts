/** renderer 启动门：壳层只要求 workStudio 就绪。 */
export async function initAppScope(): Promise<void> {
  if (typeof window === 'undefined' || !window.workStudio) {
    throw new Error('workStudio is unavailable');
  }
}
