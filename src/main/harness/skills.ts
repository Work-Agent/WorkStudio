/**
 * 技能激活过滤（architecture.md §5.3）。
 *
 * 装载走 pi 官方链（additionalSkillPaths + ResourceLoader），本模块只做激活语义：
 *   空选中 = 全量注入（pi 官方默认）；有选中 = 按名过滤 appendSystemPrompt 段与清单。
 */
import type {
  ResourceDiagnostic,
  Skill,
} from '@earendil-works/pi-coding-agent';

export interface SkillInfoView {
  name: string;
  description: string;
  pluginId: string;
  pluginName: string;
  path: string;
  scope: string;
  source: string;
  manualOnly: boolean;
}

export class SkillsManager {
  private active = new Set<string>();
  private infos: SkillInfoView[] = [];
  private diagnostics: Array<{ type: string; message: string; path?: string }> =
    [];

  setActive(names: string[]): void {
    this.active = new Set(names);
  }

  getActive(): string[] {
    return [...this.active];
  }

  /** 官方装载结果登记（UI 只读清单数据源 + 装载诊断）。 */
  registerLoaded(
    skills: Skill[],
    diagnostics: ResourceDiagnostic[],
    pluginNameOf: (source: string) => string,
  ): void {
    this.infos = skills.map((s) => ({
      name: s.name,
      description: s.description ?? '',
      pluginId: s.sourceInfo?.source ?? 'builtin',
      pluginName: pluginNameOf(s.sourceInfo?.source ?? ''),
      path: s.filePath,
      scope: s.sourceInfo?.scope ?? 'user',
      source: s.sourceInfo?.source ?? '',
      manualOnly: s.disableModelInvocation === true,
    }));
    this.diagnostics = diagnostics.map((d) => ({
      type: d.type,
      message: d.message,
      ...(d.path ? { path: d.path } : {}),
    }));
  }

  getSkillInfos(): SkillInfoView[] {
    return this.infos;
  }

  getDiagnostics(): Array<{ type: string; message: string; path?: string }> {
    return this.diagnostics;
  }

  /** appendSystemPromptOverride 过滤体：空选中透传官方产物。 */
  filterAppendSystemPrompt(base: string[]): string[] {
    if (this.active.size === 0) return base;
    return base.map((block) => this.filterBlock(block)).filter(Boolean);
  }

  /** skillsOverride 过滤体（命令注册面；prompt 语义保持装载全集）。 */
  filterSkills(
    skills: Skill[],
    diagnostics: ResourceDiagnostic[],
  ): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
    if (this.active.size === 0) return { skills, diagnostics };
    return {
      skills: skills.filter((s) => this.active.has(s.name)),
      diagnostics,
    };
  }

  private filterBlock(block: string): string {
    const sections = block.split(/(?=## Skill: |### |## )/).filter(Boolean);
    if (sections.length <= 1) return block;
    const kept = sections.filter((s) => {
      const m = s.match(/^##+ .*?\b([\w-]+)\b/);
      return m ? this.active.has(m[1]) : true;
    });
    return kept.join('');
  }
}
