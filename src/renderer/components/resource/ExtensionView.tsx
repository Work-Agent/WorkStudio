/**
 * WebContentsView 的 React 封装：占位 div 丈量窗口相对坐标，
 * syncBounds 驱动主进程移动/缩放原生 webview。
 * mount/active 变化立即同步；ResizeObserver 持续同步；卸载归零防残留。
 *
 * mock 模式（preload 未暴露扩展视图宿主）下额外渲染 DOM 预览，
 * 让页面开发期能看到内容；真实模式下原生视图恒覆盖此区域，预览不可见。
 */
import { useEffect, useRef } from 'react';
import { FileText, Package } from 'lucide-react';
import { agentAPI, isMock } from '../../api/bridge';
import { useTabServiceStore } from '../../state/tabService';
import { useTabsStore } from '../../state/tabs';

export function ExtensionView({
  instanceId,
  active,
}: {
  instanceId: string;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const syncBounds = (): void => {
    const el = containerRef.current;
    if (!active || !el) {
      void agentAPI.extensions.syncBounds(instanceId, {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
      return;
    }
    const rect = el.getBoundingClientRect();
    void agentAPI.extensions.syncBounds(instanceId, {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  };

  useEffect(() => {
    syncBounds();
    const el = containerRef.current;
    const ro = el ? new ResizeObserver(() => syncBounds()) : null;
    if (el && ro) ro.observe(el);
    return () => {
      ro?.disconnect();
      void agentAPI.extensions.syncBounds(instanceId, {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, active]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      {isMock && (
        <MockExtensionPreview instanceId={instanceId} active={active} />
      )}
    </div>
  );
}

/** 页面开发期预览（真实版由原生 WebContentsView 内容覆盖）。 */
function MockExtensionPreview({
  instanceId,
  active,
}: {
  instanceId: string;
  active: boolean;
}) {
  const tab = useTabsStore((s) =>
    s.tabs.find((t) => t.instanceId === instanceId),
  );
  const doc = tab?.document;
  const plugin = tab?.plugin;
  const previewContent = useTabServiceStore((s) => s.previewContent);

  if (!active) return null;

  if (doc) {
    return (
      <div className="h-full w-full overflow-y-auto bg-white dark:bg-[#1E2021]">
        <div className="max-w-3xl mx-auto px-10 py-8">
          <div className="text-[12px] text-zinc-400 dark:text-zinc-500 mb-1">
            {doc.url ?? doc.path}
          </div>
          <h1 className="text-[20px] font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            {doc.title}
          </h1>
          {doc.type === 'data' && doc.schema ? (
            <div className="text-[13px] text-zinc-700 dark:text-zinc-300">
              <p className="mb-3 text-zinc-500 dark:text-zinc-400">
                {doc.schema.label} · schema-only（数据经工具查询）
              </p>
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                {doc.schema.fields.map((f) => (
                  <div
                    key={f.name}
                    className="flex items-start gap-3 px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0"
                  >
                    <span className="font-mono text-[12px] text-teal-600 dark:text-teal-400 w-28 shrink-0">
                      {f.name}
                    </span>
                    <span className="text-[12px] text-zinc-500 dark:text-zinc-400 w-20 shrink-0">
                      {f.type}
                    </span>
                    <span className="text-[12px] text-zinc-600 dark:text-zinc-300">
                      {f.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : previewContent && previewContent.content ? (
            <pre className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-700 dark:text-zinc-300 font-sans">
              {previewContent.content}
            </pre>
          ) : (
            <p className="text-[13px] text-zinc-500 dark:text-zinc-400">
              页面快照由扩展视图渲染（mock 模式下无正文）。
            </p>
          )}
        </div>
      </div>
    );
  }

  if (plugin) {
    return (
      <div className="h-full w-full overflow-y-auto bg-white dark:bg-[#1E2021]">
        <div className="max-w-2xl mx-auto px-10 py-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-cyan-500 text-cyan-50 dark:bg-cyan-600">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-[17px] font-semibold text-zinc-900 dark:text-zinc-100">
                {plugin.name}
              </h1>
              <div className="text-[11px] text-zinc-400 dark:text-zinc-500">
                v{plugin.version}
              </div>
            </div>
          </div>
          <p className="text-[13px] text-zinc-600 dark:text-zinc-300 leading-relaxed">
            {plugin.description}
          </p>
          <div className="mt-6 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg px-4 py-6 text-center">
            <p className="text-[12px] text-zinc-400 dark:text-zinc-500">
              插件 config 页（介绍 + 设置一体）——扩展视图由插件 HTML 渲染
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-zinc-400 dark:text-zinc-600 text-[12px]">
      <FileText className="w-6 h-6 opacity-50" />
      <span>扩展视图加载中…</span>
    </div>
  );
}
