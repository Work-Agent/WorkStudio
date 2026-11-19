/** 已加载资源投影：扩展 / 技能 / 提示词 / 主题 + 装载错误。 */
import type { LoadedResourcesView } from '../../../shared/types.ts';

interface ResourceLoaderLike {
  getExtensions(): {
    extensions: Array<{
      resolvedPath?: string;
      path: string;
      hidden?: boolean;
      tools: Map<string, unknown>;
      commands: Map<string, unknown>;
    }>;
    errors: Array<{ path: string; error: string }>;
  };
  getSkills(): {
    skills: Array<{ name: string; description?: string; filePath: string }>;
  };
  getPrompts(): { prompts: Array<{ name: string; filePath: string }> };
  getThemes(): { themes: Array<{ name?: string; filePath?: string }> };
}

export function loadedResources(
  loader: ResourceLoaderLike,
): LoadedResourcesView {
  const ext = loader.getExtensions();
  const skills = loader.getSkills();
  const prompts = loader.getPrompts();
  const themes = loader.getThemes();
  return {
    extensions: ext.extensions.map((e) => ({
      path: e.resolvedPath || e.path,
      hidden: e.hidden === true,
      tools: [...e.tools.keys()],
      commands: [...e.commands.keys()],
    })),
    skills: skills.skills.map((s) => ({
      name: s.name,
      description: s.description ?? '',
      path: s.filePath,
    })),
    prompts: prompts.prompts.map((p) => ({
      name: p.name,
      path: p.filePath,
    })),
    themes: themes.themes.map((t) => ({
      name: t.name ?? '',
      path: t.filePath ?? '',
    })),
    errors: ext.errors.map((e) => ({ path: e.path, message: e.error })),
  };
}
