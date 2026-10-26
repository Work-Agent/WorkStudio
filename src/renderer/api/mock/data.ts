/**
 * Mock 演示数据 —— 页面开发期的数据面（真实主进程服务就绪后由 IPC 替换）。
 * 内容按 architecture.md §13.2 的列表投影组织：Document / UraGroup / Plugin / Skill / Session。
 */
import type {
  DocumentContent,
  DocumentMeta,
  ExtensionDef,
  PluginInfo,
  ParsedMessage,
  SessionMeta,
  SkillInfo,
  UraGroupInfo,
} from '../../../shared/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();

// ─── 文档（本地 / 业务数据 / 网站资料） ─────────────────────

export const demoDocuments: DocumentMeta[] = [
  {
    id: 'local:docs/quarterly-report.md',
    title: '季度经营报告.md',
    path: 'docs/季度经营报告.md',
    url: 'docs/季度经营报告.md',
    ext: 'md',
    type: 'content',
    source: 'local',
    sourceLabel: '本地文档',
    createdAt: now - 6 * DAY,
    updatedAt: now - 2 * HOUR,
    description: '2025 Q3 经营分析草稿',
  },
  {
    id: 'local:docs/customer-visit-log.md',
    title: '客户拜访记录.md',
    path: 'docs/客户拜访记录.md',
    url: 'docs/客户拜访记录.md',
    ext: 'md',
    type: 'content',
    source: 'local',
    sourceLabel: '本地文档',
    createdAt: now - 4 * DAY,
    updatedAt: now - 1 * DAY,
    description: '南洋实业 / 恒远科技',
  },
  {
    id: 'local:docs/proposal-draft.html',
    title: '方案草案.html',
    path: 'docs/方案草案.html',
    url: 'docs/方案草案.html',
    ext: 'html',
    type: 'content',
    source: 'local',
    sourceLabel: '本地文档',
    createdAt: now - 3 * DAY,
    updatedAt: now - 5 * HOUR,
    description: '可交互方案预览页',
  },
  {
    id: 'local:docs/meeting-notes.txt',
    title: '会议纪要.txt',
    path: 'docs/会议纪要.txt',
    url: 'docs/会议纪要.txt',
    ext: 'txt',
    type: 'content',
    source: 'local',
    sourceLabel: '本地文档',
    createdAt: now - 8 * HOUR,
    updatedAt: now - 8 * HOUR,
  },
  {
    id: 'data:business/order',
    title: 'order',
    path: 'business/order',
    url: 'app://business/order',
    ext: 'schema',
    type: 'data',
    source: 'business',
    sourceLabel: '业务数据',
    createdAt: now - 30 * DAY,
    updatedAt: now - 1 * DAY,
    description: '订单对象 · 含审批状态机',
    schema: {
      label: '订单 Order',
      fields: [
        { name: 'id', type: 'string', description: '订单号', required: true },
        {
          name: 'customer',
          type: 'string',
          description: '客户名称',
          required: true,
        },
        { name: 'amount', type: 'number', description: '金额（元）' },
        {
          name: 'status',
          type: 'enum',
          description: '状态：draft / submitted / approved / rejected',
          required: true,
        },
        { name: 'submittedAt', type: 'datetime', description: '提交时间' },
      ],
      states: ['draft', 'submitted', 'approved', 'rejected'],
      relations: [{ target: 'business/customer', description: '所属客户' }],
    },
  },
  {
    id: 'data:business/customer',
    title: 'customer',
    path: 'business/customer',
    url: 'app://business/customer',
    ext: 'schema',
    type: 'data',
    source: 'business',
    sourceLabel: '业务数据',
    createdAt: now - 30 * DAY,
    updatedAt: now - 6 * DAY,
    description: '客户对象',
    schema: {
      label: '客户 Customer',
      fields: [
        { name: 'id', type: 'string', description: '客户编号', required: true },
        {
          name: 'name',
          type: 'string',
          description: '客户名称',
          required: true,
        },
        { name: 'level', type: 'string', description: '客户等级 A/B/C' },
      ],
    },
  },
  {
    id: 'web:github.com/pull-1024',
    title: 'feat: 工作台统一标签流 by qingo',
    path: 'github.com/pull-1024',
    url: 'RESOURCES/github.com/pull-1024.md',
    ext: 'html',
    type: 'snapshot',
    source: 'web',
    sourceLabel: '网站资料',
    group: { id: 'github.com', title: 'GitHub' },
    createdAt: now - 2 * DAY,
    updatedAt: now - 2 * DAY,
  },
  {
    id: 'web:github.com/issues-88',
    title: 'Memory leak on session switch · Issue #88',
    path: 'github.com/issues-88',
    url: 'RESOURCES/github.com/issues-88.md',
    ext: 'html',
    type: 'snapshot',
    source: 'web',
    sourceLabel: '网站资料',
    group: { id: 'github.com', title: 'GitHub' },
    createdAt: now - 5 * DAY,
    updatedAt: now - 5 * DAY,
  },
  {
    id: 'web:developer.mozilla.org/fetch-api',
    title: 'Fetch API - Web APIs | MDN',
    path: 'developer.mozilla.org/fetch-api',
    url: 'RESOURCES/developer.mozilla.org/fetch-api.md',
    ext: 'html',
    type: 'snapshot',
    source: 'web',
    sourceLabel: '网站资料',
    group: { id: 'developer.mozilla.org', title: 'MDN Web Docs' },
    createdAt: now - 3 * DAY,
    updatedAt: now - 3 * DAY,
  },
];

export const demoGroups: UraGroupInfo[] = [
  {
    id: 'github.com',
    title: 'GitHub',
    source: 'web',
    sourceLabel: '网站资料',
    count: 2,
    updatedAt: now - 2 * DAY,
  },
  {
    id: 'developer.mozilla.org',
    title: 'MDN Web Docs',
    source: 'web',
    sourceLabel: '网站资料',
    count: 1,
    updatedAt: now - 3 * DAY,
  },
];

export const demoContents: Record<string, DocumentContent> = {
  'local:docs/quarterly-report.md': {
    ext: 'md',
    type: 'content',
    size: 860,
    content: `# 季度经营报告（2025 Q3）

## 核心指标
- 营收：4,820 万元（同比 +18.4%）
- 新签约客户：27 家
- 交付项目按期率：92%

## 业务回顾
本季度继续聚焦制造业客户，南洋实业、恒远科技两个标杆项目按期上线。

## 下季度重点
1. 打磨订单审批自动化链路
2. 上线周报自动生成能力
3. 扩充华东区售前团队
`,
  },
  'local:docs/customer-visit-log.md': {
    ext: 'md',
    type: 'content',
    size: 420,
    content: `# 客户拜访记录

## 2025-09-08 · 南洋实业
- 参与人：王总、李工
- 议题：审批流自定义、数据看板
- 结论：先落审批自动化，看板下季度排期

## 2025-09-05 · 恒远科技
- 参与人：赵经理
- 议题：采购订单对账
- 结论：试用两周后评估
`,
  },
  'local:docs/proposal-draft.html': {
    ext: 'html',
    type: 'content',
    size: 320,
    content: `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8" /><title>方案草案</title></head>
  <body style="font-family: system-ui; padding: 32px">
    <h1>订单审批自动化 · 方案草案</h1>
    <p>本页面由 AI 生成，用于向客户演示审批流程的可视化效果。</p>
    <button>提交审批</button>
  </body>
</html>
`,
  },
  'local:docs/meeting-notes.txt': {
    ext: 'txt',
    type: 'content',
    size: 180,
    content: `周例会纪要 2025-09-12
1. 工作台三栏布局定稿
2. AI 会话面板支持多标签
3. 插件 config 页统一入口
`,
  },
  'data:business/order': {
    ext: 'schema',
    type: 'data',
    size: 0,
    content: '',
  },
  'data:business/customer': {
    ext: 'schema',
    type: 'data',
    size: 0,
    content: '',
  },
  'web:github.com/pull-1024': {
    ext: 'html',
    type: 'snapshot',
    size: 0,
    content: '',
  },
  'web:github.com/issues-88': {
    ext: 'html',
    type: 'snapshot',
    size: 0,
    content: '',
  },
  'web:developer.mozilla.org/fetch-api': {
    ext: 'html',
    type: 'snapshot',
    size: 0,
    content: '',
  },
};

// ─── 插件 & 扩展 ────────────────────────────────────────────

export const demoPlugins: PluginInfo[] = [
  {
    id: 'milkdown-editor',
    name: 'Milkdown 编辑器',
    version: '0.9.2',
    description: 'Markdown 所见即所得编辑',
    builtin: true,
    extensionCount: 1,
    skillCount: 0,
    toolCount: 0,
    hasHome: false,
    hasConfig: true,
  },
  {
    id: 'html-editor',
    name: 'HTML 编辑器',
    version: '0.9.2',
    description: '预览 / 分屏 / 源码三态编辑',
    builtin: true,
    extensionCount: 1,
    skillCount: 0,
    toolCount: 1,
    hasHome: false,
    hasConfig: true,
  },
  {
    id: 'text-editor',
    name: '文本编辑器',
    version: '0.8.0',
    description: '备忘录式纯文本编辑（兜底渲染器）',
    builtin: true,
    extensionCount: 1,
    skillCount: 0,
    toolCount: 0,
    hasHome: false,
    hasConfig: true,
  },
  {
    id: 'browser',
    name: '浏览器',
    version: '0.6.1',
    description: '网页浏览 · 快照归档 · 可交互元素',
    builtin: true,
    extensionCount: 1,
    skillCount: 0,
    toolCount: 4,
    hasHome: true,
    hasConfig: true,
  },
  {
    id: 'weekly-report',
    name: '周报助手',
    version: '0.3.0',
    description: '业务数据 → 周报自动生成',
    builtin: false,
    extensionCount: 0,
    skillCount: 2,
    toolCount: 1,
    hasHome: false,
    hasConfig: false,
  },
];

export const demoExtensionDefs: ExtensionDef[] = [
  {
    id: 'milkdown-editor',
    label: 'Milkdown 编辑器',
    extensions: ['md', 'markdown'],
    src: '',
    pluginId: 'milkdown-editor',
  },
  {
    id: 'html-editor',
    label: 'HTML 编辑器',
    extensions: ['html', 'htm'],
    src: '',
    pluginId: 'html-editor',
    titlebarActions: ['layout-switch'],
  },
  {
    id: 'text-editor',
    label: '文本编辑器',
    extensions: ['txt', 'log', 'json', 'js', 'ts', 'css', 'schema'],
    src: '',
    pluginId: 'text-editor',
  },
  {
    id: 'milkdown-editor-config',
    label: 'Milkdown 编辑器',
    extensions: [],
    src: '',
    pluginId: 'milkdown-editor',
  },
  {
    id: 'html-editor-config',
    label: 'HTML 编辑器',
    extensions: [],
    src: '',
    pluginId: 'html-editor',
  },
  {
    id: 'text-editor-config',
    label: '文本编辑器',
    extensions: [],
    src: '',
    pluginId: 'text-editor',
  },
  {
    id: 'browser-home',
    label: '浏览器',
    extensions: [],
    src: '',
    pluginId: 'browser',
  },
];

export const demoSkills: SkillInfo[] = [
  {
    name: '生成周报',
    description: '从业务数据生成周报草稿',
    pluginId: 'weekly-report',
    pluginName: '周报助手',
  },
  {
    name: '客户画像',
    description: '汇总客户拜访与订单信息',
    pluginId: 'weekly-report',
    pluginName: '周报助手',
  },
  {
    name: '网页归档',
    description: '抓取网页并生成快照存证',
    pluginId: 'browser',
    pluginName: '浏览器',
  },
];

// ─── 会话 & 消息（模拟已落盘的 JSONL） ─────────────────────

export const demoSessions: SessionMeta[] = [
  {
    path: 'pi/sessions/20250910-order-review.jsonl',
    name: '订单审批复盘',
    createdAt: now - 2 * DAY,
    preview: '已生成《订单审批复盘.md》，共 12 条待审批订单。',
  },
  {
    path: 'pi/sessions/20250909-react19.jsonl',
    name: 'React 19 新特性调研',
    createdAt: now - 3 * DAY,
    preview: 'React 19 的主要变化：Actions、use()、服务端组件…',
  },
  {
    path: 'pi/sessions/20250908-quarterly.jsonl',
    name: 'Q3 经营数据分析',
    createdAt: now - 4 * DAY,
    preview: '营收同比增长 18.4%，新签客户 27 家。',
  },
  {
    path: 'pi/sessions/20250912-meeting.jsonl',
    name: '周例会待办整理',
    createdAt: now - 8 * HOUR,
    preview: '已将 4 条待办写入会议纪要.txt。',
  },
];

export const demoSessionDomains: Record<string, string> = {
  'pi/sessions/20250910-order-review.jsonl': 'github.com',
  'pi/sessions/20250909-react19.jsonl': 'developer.mozilla.org',
};

export const demoMessages: Record<string, ParsedMessage[]> = {
  'pi/sessions/20250910-order-review.jsonl': [
    {
      role: 'user',
      blocks: [
        { type: 'text', text: '查询已提交的订单，给南洋实业的订单走审批流程' },
      ],
    },
    {
      role: 'assistant',
      blocks: [
        {
          type: 'thinking',
          text: '需要先查询业务数据中的订单对象，筛选状态为 submitted 的记录，再按客户名称匹配南洋实业。',
        },
        {
          type: 'tool',
          toolCallId: 'tc-1',
          toolName: 'query_business',
          args: { object: 'order', filter: { status: 'submitted' } },
          result: '找到 12 条已提交订单，其中南洋实业 3 条（合计 ¥486,000）。',
        },
        {
          type: 'text',
          text: '已找到 12 条已提交订单，其中南洋实业 3 条。已为这 3 条订单发起审批流程，当前状态为「审批中」。',
        },
      ],
    },
    {
      role: 'user',
      blocks: [{ type: 'text', text: '把处理结果整理成一份复盘文档' }],
    },
    {
      role: 'assistant',
      blocks: [
        {
          type: 'thinking',
          text: '将审批结果与处理过程写入本地文档 docs/订单审批复盘.md。',
        },
        {
          type: 'tool',
          toolCallId: 'tc-2',
          toolName: 'document_create',
          args: { path: 'docs/订单审批复盘.md', title: '订单审批复盘' },
          result: '文档已写入工作区：docs/订单审批复盘.md（2.1 KB）',
        },
        {
          type: 'text',
          text: '已生成《订单审批复盘.md》，包含本次 12 条订单的处理明细与审批结论。',
        },
      ],
    },
  ],
  'pi/sessions/20250909-react19.jsonl': [
    {
      role: 'user',
      blocks: [
        {
          type: 'text',
          text: '帮我整理 React 19 的新特性，重点讲 Actions 和 use()',
        },
      ],
    },
    {
      role: 'assistant',
      blocks: [
        {
          type: 'thinking',
          text: '挂载 MDN 与 React 官方文档快照，汇总后输出。',
        },
        {
          type: 'tool',
          toolCallId: 'tc-3',
          toolName: 'browser_open',
          args: { url: 'https://react.dev/blog/2024/12/05/react-19' },
          result:
            '已归档页面快照：react.dev/blog/react-19（快照 id: web:react.dev/react-19）',
        },
        {
          type: 'text',
          text: 'React 19 的主要变化：1) Actions 简化异步状态与错误处理；2) use() 读取 Promise/Context；3) 表单与 useFormStatus；4) 原生文档元数据支持；5) ref 作为普通 prop。',
        },
      ],
    },
  ],
  'pi/sessions/20250908-quarterly.jsonl': [
    {
      role: 'user',
      blocks: [
        { type: 'text', text: '分析 Q3 经营数据，找出增长最快的业务线' },
      ],
    },
    {
      role: 'assistant',
      blocks: [
        {
          type: 'tool',
          toolCallId: 'tc-4',
          toolName: 'query_business',
          args: { object: 'order', groupBy: 'month' },
          result:
            '7-9 月营收：1,420 / 1,610 / 1,790 万元；制造业客户占比 63%。',
        },
        {
          type: 'text',
          text: '营收同比增长 18.4%，增长最快的是制造业订单审批自动化业务线。',
        },
      ],
    },
  ],
  'pi/sessions/20250912-meeting.jsonl': [
    {
      role: 'user',
      blocks: [{ type: 'text', text: '把周例会的 4 条待办写进会议纪要.txt' }],
    },
    {
      role: 'assistant',
      blocks: [
        {
          type: 'tool',
          toolCallId: 'tc-5',
          toolName: 'document_update',
          args: { path: 'docs/会议纪要.txt', mode: 'append' },
          result: '已追加 4 条待办事项。',
        },
        { type: 'text', text: '已将 4 条待办写入会议纪要.txt。' },
      ],
    },
  ],
};

export const demoTokens: Record<string, { input: number; output: number }> = {
  'pi/sessions/20250910-order-review.jsonl': { input: 8_412, output: 2_037 },
  'pi/sessions/20250909-react19.jsonl': { input: 5_106, output: 1_442 },
  'pi/sessions/20250908-quarterly.jsonl': { input: 3_890, output: 912 },
  'pi/sessions/20250912-meeting.jsonl': { input: 2_144, output: 476 },
};

export const demoWorkspace = '/Users/qingo/Projects/Acme-Operations';
