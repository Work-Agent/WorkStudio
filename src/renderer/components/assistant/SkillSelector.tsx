/** 技能选择器：激活技能注入系统提示（随 prompt 提交）。 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Zap } from 'lucide-react';
import { useAgentConfigStore } from '../../state/agentConfig';
import { setUiState, useUiStore } from '../../state/uiState';

export function SkillSelector() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const skills = useAgentConfigStore((s) => s.skills);
  const selected = useUiStore((s) => s.selectedSkills);

  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = (name: string): void => {
    setUiState({
      selectedSkills: selected.includes(name)
        ? selected.filter((s) => s !== name)
        : [...selected, name],
    });
  };

  if (skills.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
          selected.length > 0
            ? 'text-[#4F6BED]'
            : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200'
        } hover:bg-zinc-100 dark:hover:bg-[#2a2d2e]`}
      >
        <Zap className="w-3 h-3" />
        <span>技能{selected.length > 0 ? ` · ${selected.length}` : ''}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-white dark:bg-[#252829] border border-zinc-300 dark:border-zinc-700 rounded-md shadow-lg py-1 z-50 max-h-72 overflow-y-auto">
          {skills.map((s) => {
            const active = selected.includes(s.name);
            return (
              <button
                key={`${s.pluginId}/${s.name}`}
                onClick={() => toggle(s.name)}
                className="w-full text-left px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-[#2a2d2e] transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-[12px] truncate ${active ? 'text-[#4F6BED] font-medium' : 'text-zinc-700 dark:text-zinc-300'}`}
                  >
                    {s.name}
                  </span>
                  {active && (
                    <Check className="w-3 h-3 text-[#4F6BED] shrink-0" />
                  )}
                </div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate">
                  {s.pluginName}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
