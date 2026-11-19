// ─── 操作型工具：office 生成（office-gen 技能的执行入口） ─────────────
//
// 模型传 kind/output/spec，本工具在主进程代跑内置技能脚本（gen_office.py）并落盘。
// 不向模型开放 shell；脚本路径固定为内置技能播种目录，规格格式由技能定义。

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Type } from 'typebox';
import {
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { OfficeGenKind } from '../plugins/packages.ts';

const run = promisify(execFile);

/** Windows 上通常只有 `python`，macOS / Linux 是 `python3`。 */
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

export interface OfficeToolDeps {
  /** 按格式解析生成脚本（插件声明优先；调用方负责内置兜底）。 */
  scriptOf: (kind: OfficeGenKind) => string;
  /** 相对输出路径的解析基准（当前工作区）。 */
  workspace: () => string;
}

const KINDS = ['pptx', 'docx', 'xlsx'] as const;

export function createOfficeTools(deps: OfficeToolDeps): ToolDefinition[] {
  const params = Type.Object({
    kind: Type.Union(
      KINDS.map((kind) => Type.Literal(kind)),
      {
        description: 'File type to generate.',
      },
    ),
    output: Type.String({
      description: 'Output file path (absolute, or relative to the workspace).',
    }),
    spec: Type.Unknown({
      description:
        'Content spec. Format defined by the office-gen skill: pptx {slides:[{title,bullets}]} / docx {paragraphs:[{style,text}]} / xlsx {sheets:[{name,rows}]}.',
    }),
  });
  const genTool = defineTool<typeof params, unknown>({
    name: 'office_gen',
    label: '生成 Office 文件',
    description:
      'Generate a real binary Office file (pptx/docx/xlsx) from a JSON spec. Use for creating PPT slides, Word documents or Excel sheets. Never write .pptx/.docx/.xlsx with the write tool — that produces a fake text file.',
    parameters: params,
    execute: async (_id, { kind, output, spec }) => {
      const script = deps.scriptOf(kind);
      const target = isAbsolute(output)
        ? output
        : resolve(deps.workspace(), output);
      const scratch = await mkdtemp(join(tmpdir(), 'office-gen-'));
      const specPath = join(scratch, 'spec.json');
      try {
        await writeFile(specPath, JSON.stringify(spec, null, 2), 'utf-8');
        await mkdir(dirname(target), { recursive: true });
        const { stdout } = await run(PYTHON, [script, kind, target, specPath], {
          timeout: 60_000,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: stdout.trim() || `generated ${target}`,
            },
          ],
          details: { output: target },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            { type: 'text' as const, text: `office_gen failed: ${message}` },
          ],
          details: { error: true },
        };
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
  });
  return [genTool];
}
