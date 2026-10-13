import { useState } from 'react';
import { LoaderCircle, Wrench } from 'lucide-react';
import { formatArgs, type ToolCall } from '../../state/message';

export function ToolCallChip({ tc }: { tc: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const label = formatArgs(tc.args);

  return (
    <div
      data-toolcall-id={tc.toolCallId}
      className={`text-[12px] border rounded-md bg-zinc-100 dark:bg-[#1c1e1f] overflow-hidden cursor-pointer transition-colors ${
        tc.status === 'error'
          ? 'border-red-400 dark:border-red-900'
          : 'border-zinc-300 dark:border-zinc-700'
      }`}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-center px-2.5 py-1.5 space-x-1.5">
        <Wrench className="w-3 h-3 text-zinc-500 shrink-0" />
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {tc.toolName}
        </span>
        {label && (
          <span className="text-zinc-500 dark:text-zinc-500 truncate">
            ({label})
          </span>
        )}
        {tc.status === 'running' && (
          <LoaderCircle className="w-3 h-3 animate-spin text-zinc-400 ml-auto" />
        )}
        {tc.status === 'done' && (
          <span className="text-green-600 ml-auto">✓</span>
        )}
        {tc.status === 'error' && (
          <span className="text-red-500 ml-auto">✗</span>
        )}
      </div>
      {expanded && tc.result && (
        <pre className="px-2.5 py-2 text-[11px] text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-[#18191a] overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto border-t border-zinc-200 dark:border-zinc-800">
          {tc.result}
        </pre>
      )}
    </div>
  );
}
