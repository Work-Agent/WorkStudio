/**
 * 消息气泡：用户（右，靛蓝）/ 助手（左，竖线引导）。
 * 内容块三分：thinking（可折叠）/ tool（ToolCallChip）/ text。
 */
import { useState } from 'react';
import type { ChatMessage, ContentBlock } from '../../state/message';
import { ToolCallChip } from './ToolCallChip';

export function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';

  return (
    <div
      className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}
      data-testid="message"
      data-role={msg.role}
    >
      <div className={`w-full ${isUser ? 'flex justify-end' : ''}`}>
        <div
          className={
            isUser
              ? 'px-3 py-1.5 bg-[#3D56E0] text-white rounded-2xl rounded-tr-sm shadow-sm text-[13px] leading-normal inline-block max-w-[85%]'
              : 'pl-4 border-l-2 border-zinc-300/15 dark:border-zinc-700/25 text-[14px] leading-[1.7] text-zinc-800 dark:text-zinc-200'
          }
        >
          <div className="space-y-2">
            {msg.blocks.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </div>
          {msg.blocks.length === 0 && msg.streaming && (
            <span className="text-zinc-400">…</span>
          )}
          {msg.error && (
            <div className="mt-2 text-[12px] text-red-500 dark:text-red-400 border-t border-red-500/30 pt-2">
              {msg.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BlockView({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'thinking':
      return <ThinkingBlock text={block.text} />;
    case 'tool':
      return <ToolCallChip tc={block.toolCall} />;
    case 'text':
      return <div className="whitespace-pre-wrap">{block.text}</div>;
  }
}

function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        <span
          className={`transform transition-transform ${open ? 'rotate-90' : ''}`}
        >
          ▶
        </span>
        <span>Thinking {open ? '' : `(${text.length} chars)`}</span>
      </button>
      {open && (
        <div className="mt-1.5 px-3 py-2 text-[12px] text-zinc-500 dark:text-zinc-400 bg-zinc-200/50 dark:bg-[#18191a] rounded-md whitespace-pre-wrap">
          {text}
        </div>
      )}
    </>
  );
}
