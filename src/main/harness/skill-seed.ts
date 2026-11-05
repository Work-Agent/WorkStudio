/**
 * 内置技能播种 —— 随安装包分发的技能，启动时落到数据根 skills/ 目录。
 *
 * 技能源文件经 ?raw 内嵌进主进程产物（无运行期资源路径问题，dev 与打包一致）；
 * 播种幂等：只补缺失的文件，不覆盖用户已有改动。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import officeGenSkill from '../../skills/office-gen/SKILL.md?raw';
import officeGenScript from '../../skills/office-gen/scripts/gen_office.py?raw';

export interface BuiltinSkill {
  name: string;
  files: Record<string, string>;
}

/** 与 shared/builtin-skills.ts 的 BUILTIN_SKILL_NAMES 保持同步。 */
export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'office-gen',
    files: {
      'SKILL.md': officeGenSkill,
      'scripts/gen_office.py': officeGenScript,
    },
  },
];

/** 把内置技能播种进 agent 技能目录（幂等；启动装配期调用一次）。 */
export function seedBuiltinSkills(agentDir: string): void {
  for (const skill of BUILTIN_SKILLS) {
    for (const [relative, content] of Object.entries(skill.files)) {
      const target = join(agentDir, 'skills', skill.name, relative);
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content, 'utf-8');
    }
  }
}
