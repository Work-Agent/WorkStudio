/**
 * agent 上下文：工作目录、打开的资源与当前选择。
 *
 * 只描述「助手看到什么」，不持有资源字节；
 * 具体内容由工具面按 ref 现取。
 */

export interface AgentContextState {
  cwd: string;
  openRefs: string[];
  selection: string | null;
}

export class AgentContext {
  private state: AgentContextState = {
    cwd: '',
    openRefs: [],
    selection: null,
  };

  snapshot(): AgentContextState {
    return {
      cwd: this.state.cwd,
      openRefs: [...this.state.openRefs],
      selection: this.state.selection,
    };
  }

  setWorkspace(path: string): void {
    this.state = { cwd: path, openRefs: [], selection: null };
  }

  opened(ref: string): void {
    if (!this.state.openRefs.includes(ref)) {
      this.state.openRefs.push(ref);
    }
  }

  closed(ref: string): void {
    this.state.openRefs = this.state.openRefs.filter((item) => item !== ref);
    if (this.state.selection === ref) this.state.selection = null;
  }

  select(ref: string | null): void {
    this.state.selection = ref;
  }
}
