import { useCallback, useState } from 'react';

interface Draft {
  text: string;
  commandTag: string | null;
  selectedSkills: string[];
  skillMode: 'auto' | 'selected';
}
const emptyDraft: Draft = {
  text: '',
  commandTag: null,
  selectedSkills: [],
  skillMode: 'auto',
};

/** 草稿只属于当前工作区的当前对话；异步回调仍写回提交时的草稿。 */
export function useDraft(key: string) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const update = useCallback(
    (change: Partial<Draft> | ((draft: Draft) => Draft)) => {
      setDrafts((all) => {
        const current = all[key] ?? emptyDraft;
        return {
          ...all,
          [key]:
            typeof change === 'function'
              ? change(current)
              : { ...current, ...change },
        };
      });
    },
    [key],
  );
  return { ...(drafts[key] ?? emptyDraft), update };
}
