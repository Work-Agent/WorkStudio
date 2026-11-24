/**
 * 技能激活过滤（architecture.md §6.3.3）。
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
  builtin: boolean;
  enabled?: boolean;
}

export class SkillsManager {
  private active = new Set<string>();
  private disabled = new Set<string>();
  setDisabled(names: string[]): void {
    this.disabled = new Set(names);
  }
  private infos: SkillInfoView[] = [];
  private readonly pluginSkillNames = new Set<string>();
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
    pluginOf: (source: string) => { id: string; label: string } | null,
  ): void {
    this.infos = skills.map((s) => {
      const owner = pluginOf(s.filePath ?? s.sourceInfo?.source ?? '');
      return {
        name: s.name,
        description: s.description ?? '',
        pluginId: owner?.id ?? 'builtin',
        pluginName: owner?.label ?? '内置',
        path: s.filePath,
        scope: s.sourceInfo?.scope ?? 'user',
        source: s.sourceInfo?.source ?? '',
        manualOnly: s.disableModelInvocation === true,
        builtin: false,
      };
    });
    this.pluginSkillNames.clear();
    for (const skill of this.infos) {
      if (!skill.builtin && skill.pluginId !== 'builtin') {
        this.pluginSkillNames.add(skill.name);
      }
    }
    this.diagnostics = diagnostics.map((d) => ({
      type: d.type,
      message: d.message,
      ...(d.path ? { path: d.path } : {}),
    }));
  }

  getSkillInfos(): SkillInfoView[] {
    return this.infos.map((info) => ({
      ...info,
      enabled: !this.disabled.has(info.name),
    }));
  }

  getDiagnostics(): Array<{ type: string; message: string; path?: string }> {
    return this.diagnostics;
  }

  /** 插件技能按需注入；内置技能保持官方默认。 */
  filterAppendSystemPrompt(base: string[]): string[] {
    return base
      .map((block) => this.filterBlock(block))
      .filter((block): block is string => Boolean(block));
  }

  /** skillsOverride 过滤体（命令注册面）：插件技能只有被选中才进入。 */
  filterSkills(
    skills: Skill[],
    diagnostics: ResourceDiagnostic[],
  ): { skills: Skill[]; diagnostics: ResourceDiagnostic[] } {
    return {
      skills: skills.filter(
        (skill) =>
          !this.disabled.has(skill.name) &&
          (!this.pluginSkillNames.has(skill.name) ||
            this.active.has(skill.name)),
      ),
      diagnostics,
    };
  }

  private filterBlock(block: string): string {
    const sections = block.split(/(?=## Skill: |### |## )/).filter(Boolean);
    if (sections.length <= 1) return block;
    const kept = sections.filter((section) => {
      const match = section.match(/^##+ .*?\b([\w-]+)\b/);
      const name = match?.[1];
      if (!name || !this.pluginSkillNames.has(name)) return true;
      return this.active.has(name);
    });
    return kept.join('');
  }
}
