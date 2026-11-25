/** 内置 HTML 阅读器：订阅插件认领的资源并渲染文本。 */
const params = new URLSearchParams(location.search);
const ref = params.get('ref') ?? '';
const source = document.getElementById('source');
const bridge = window.workStudio;

function render(value) {
  if (!source || !value) return;
  const items = Array.isArray(value) ? value : [value];
  const item = items.find((entry) => typeof entry?.text === 'string');
  if (item) source.textContent = item.text;
}

if (bridge && ref) {
  // v2 页面边界：插件页只订阅 / 调用本插件域；资源内容经插件命令读取。
  void bridge
    .command('html-viewer', 'html-viewer', 'read', { ref })
    .then((result) => {
      if (result.ok) render(result.data);
    })
    .catch(() => undefined);
}

export {};

export {};
