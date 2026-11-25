/** 内置 HTML 阅读器：订阅插件认领的资源并渲染文本。 */
const params = new URLSearchParams(location.search);
const ref = params.get('ref') ?? '';
const source = document.getElementById('source');
const bridge = window.workStudio;
/** 工作区作用域资源地址：`<wsId>/<ref>`；窗口绑定由宿主注入。 */
const address = `${bridge?.workspaceId ?? ''}/${ref}`;

function render(value) {
  if (!source || !value) return;
  const items = Array.isArray(value) ? value : [value];
  const item = items.find((entry) => typeof entry?.text === 'string');
  if (item) source.textContent = item.text;
}

if (bridge && ref) {
  bridge.onUpdate((update) => {
    if (update.domain !== 'workspace' || update.resource !== address) return;
    if (update.type === 'snapshot' || update.type === 'patch') {
      render(update.data);
    }
  });
  bridge
    .subscribe('workspace', address)
    .then(render)
    .catch(() => undefined);
}

export {};

export {};
