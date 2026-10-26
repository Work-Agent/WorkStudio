# Agent 域（agent-design.md）

> 定位：WorkStudio 如何接在 pi 上——插件模型、资源管道（URA）、harness、会话与事件、存储与生态。
>
> 架构前提见 [`README.md`](../README.md)；页面与视图见 [`views-design.md`](./views-design.md)。

## 一、集成模型

pi 只有两条扩展轴，WorkStudio 不另造插件系统：

```
资源轴（声明式）                    注册轴（命令式）
包清单 / 约定目录 / 设置路径        扩展模块执行时调用注册 API
extensions · skills                 tools · commands · hooks
prompts · themes                    providers · renderers
        │                                   │
        └────────────► pi 运行时 ◄──────────┘
                           │
                    WorkStudio 能力层
              URA · harness · 页面 · 设置 · 浏览器
```

| 轴     | 性质                             | 谁收集                      |
| ------ | -------------------------------- | --------------------------- |
| 资源轴 | 装载：声明有什么文件，不执行代码 | 包管理器扫文件 → 资源装载器 |
| 注册轴 | 执行：扩展工厂运行时填充能力表   | 扩展运行器                  |

**术语**：

- **插件（Plugin）**：WorkStudio 的可安装单元——npm 包，自带页面并注册资源实现。
- **Extension（Pi 扩展）**：pi 的扩展模块，向注册轴注册会话侧能力。
- 插件与 Pi 扩展分开管理：插件提供页面与资源实现；Pi 扩展向注册轴注册会话能力，来自 pi 包或独立路径。

## 二、插件模型

插件就是 npm 包，清单与代码入口都在 `package.json`：

```json
{
  "name": "@workstudio/plugin-docx",
  "version": "0.1.0",
  "type": "module",
  "exports": { "./ura": "./dist/ura.js" },
  "workstudio": {
    "id": "docx",
    "label": "Word 文档",
    "icon": "file-text",
    "page": "dist/page/index.html"
  }
}
```

- `workstudio` 声明身份与页面；`icon` 可为语义名或 favicon 文件（转 data URL）。
- `exports["./ura"]` 是 ESM 注册入口：模块求值时直接调用 `registerXXX`，代码即注册。
- 一个插件最多两个页面：`page`（资源页：渲染 / 编辑，键为 `(transport, mime, codec)`）与 `settings`（插件配置 / 详情页，归设置面，ref 为 `settings://plugin.<id>`）。
- 插件是一种形态：可注册资源实现并自带页面的可安装包。

```
扫描 package.json（含 workstudio）
        │
        ▼
import exports["./ura"] ──► registerTransport / Codec / Store / Presenter / Sidecar
        │                   registerCollection / ViewAction
        ▼
建立 页面 + 资源实现 + 集合 + 动作 的归属关系
```

**安装来源**：

| 来源 | 形式                          | 落盘                 |
| ---- | ----------------------------- | -------------------- |
| npm  | `npm:@scope/pkg@1.2.3`        | 应用自持插件目录     |
| git  | `git:github.com/user/repo@v1` | 同上（npm 负责克隆） |
| 本地 | 绝对路径 / `./path`           | 原地加载，不复制     |

**可安装列表来自一份 Markdown 清单**：一行一条来源（写法同上），与应用数据目录同层；设置 → 插件页的「可安装」段直接渲染它，页面上的添加 / 删除等价于改这份文件。已安装状态不写回清单，由扫描安装目录得出：卸载只移除安装目录内容，条目保留可再装。身份按包名 / 本地绝对路径去重；安装与卸载在下次启动时生效。

## 三、URA：资源管道

URA 是资源内容的唯一入口：人（Studio）、AI（工具）、页面（编辑器）都只拿 ref，不拿路径与句柄。

设计取向：请求侧不知道远端会返回什么，所以格式由响应决定；调用方不关心实现，所以表现层按能力选择；写按资源键串行，所以写必须先进入草稿再显式提交。

### 3.1 读与写

```
读：
ref ─► transport ─► { mime, bytes }
                ─► 绑定(transport, mime) ─► codec ─► 文档
                                                 └─► store ─► 结构化数据（派生）
                ─► 绑定(transport, mime, codec) ─► presenter
                       ├ page    ─► 插件页面
                       └ sidecar ─► 文本 / schema

写：
变更 ─► 定位（投影映射）─► 编码（最小补丁）─► 来源提交
     ─► 缓存失效 ─► 结构化数据更新 ─► 广播
```

| 控制项   | 机制                                                    |
| -------- | ------------------------------------------------------- |
| 寻址     | `scheme://authority/path`；ref 是身份，不带格式与表现层 |
| 物理访问 | 只有 transport 触达文件 / 网络 / 服务                   |
| 解释     | codec 按声明处理；未知或失败降级 raw                    |
| 可见性   | 模型侧只给 schema；页面侧拿可编辑投影                   |
| 并发     | 写会话 + 分片队列；同键串行，最后写入胜出               |
| 传播     | 所有写经同一出口：缓存、结构化数据、订阅一致            |

### 3.2 注册接口

| 接口                 | 注册什么                                           | 典型实现               |
| -------------------- | -------------------------------------------------- | ---------------------- |
| `registerTransport`  | 协议 → `{ mime, bytes }`；能力在注册时声明         | 本地文件、http(s)      |
| `registerCodec`      | `(transport, mime)` 组合（可多个）→ 文档           | docx、xlsx、markdown   |
| `registerStore`      | 绑在 codec 上：文档 → 结构化查询                   | 表格、邮件             |
| `registerPresenter`  | `(transport, mime, codec)` → 资源页（渲染 / 编辑） | 阅读器、编辑器         |
| `registerSidecar`    | `(transport, mime, codec)` → 文本 / schema         | 阅读器、数据源         |
| `registerCollection` | 侧栏分组                                           | 文档、网站资料         |
| `registerViewAction` | 地址栏动作                                         | 布局切换、可访问性标记 |

注册在装载期完成；同键后注册者胜出并记诊断。codec 声明 `(transport, mime)`，presenter 与 store 声明 `(transport, mime, codec)`；注册期校验 MIME、出口与页面匹配键，不兼容的注册被拒绝。

### 3.3 MIME 与 transport 枚举

MIME 是 transport 与 codec 之间的格式身份，采用标准 `Content-Type` 的 `type/subtype` 形式；核心维护一张**规范化表**：transport 可以返回原始 `Content-Type`，管道按别名归一后再进入绑定。

**内置 MIME**

| MIME                                                                        | 扩展名                 | 当前处理                                  | 状态        |
| --------------------------------------------------------------------------- | ---------------------- | ----------------------------------------- | ----------- |
| `text/plain`                                                                | `.txt .log .ini .conf` | 文本编辑器                                | 内置        |
| `text/markdown`                                                             | `.md .markdown`        | Markdown 阅读器                           | 内置        |
| `text/html`                                                                 | `.html .htm`           | 文件 → HTML 阅读器；https + live → 浏览器 | 内置        |
| `application/json`                                                          | `.json`                | raw（JSON 视图规划）                      | 内置（raw） |
| `application/xml`                                                           | `.xml`                 | raw（XML 视图规划）                       | 内置（raw） |
| `application/yaml`                                                          | `.yaml .yml`           | raw（YAML 视图规划）                      | 内置（raw） |
| `text/csv`                                                                  | `.csv`                 | 表格视图                                  | 规划        |
| `text/tab-separated-values`                                                 | `.tsv`                 | 表格视图                                  | 规划        |
| `application/pdf`                                                           | `.pdf`                 | PDF 视图 / 系统打开                       | 规划        |
| `application/vnd.openxmlformats-officedocument.wordprocessingml.document`   | `.docx .docm .dotx`    | DOCX 编辑器                               | 内置        |
| `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`         | `.xlsx .xlsm .xltx`    | XLSX 阅读                                 | 内置        |
| `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `.pptx .pptm .potx`    | PPT 视图                                  | 规划        |
| `image/png`                                                                 | `.png`                 | 图片视图                                  | 规划        |
| `image/jpeg`                                                                | `.jpg .jpeg`           | 图片视图                                  | 规划        |
| `image/gif`                                                                 | `.gif`                 | 图片视图                                  | 规划        |
| `image/webp`                                                                | `.webp`                | 图片视图                                  | 规划        |
| `image/svg+xml`                                                             | `.svg`                 | 图片视图                                  | 规划        |
| `application/octet-stream`                                                  | —                      | raw 兜底                                  | 内置        |

**别名归一**

| 原始值                                      | 归一为             |
| ------------------------------------------- | ------------------ |
| `text/x-markdown`、`application/x-markdown` | `text/markdown`    |
| `text/xml`、`application/xml`               | `application/xml`  |
| `application/x-yaml`、`text/yaml`           | `application/yaml` |
| `image/jpg`                                 | `image/jpeg`       |
| `application/x-pdf`                         | `application/pdf`  |

- MIME 参数（`charset` 等）不进入标识，单独保留为元数据。
- 未知 MIME 允许存在，但只有注册了 codec 才能解码；否则 raw。
- 自定义类型用 vendor 形式：`application/vnd.<vendor>.<name>+json` / `+zip`；注册 codec 即把它加入枚举。

**transport 类型**

| id       | scheme        | 能力                        | 变更检测                    | 状态     |
| -------- | ------------- | --------------------------- | --------------------------- | -------- |
| `file`   | `file`        | read · write · list · watch | 内容哈希                    | 内置     |
| `http`   | `http`        | read · live                 | ETag / Last-Modified / 哈希 | 内置     |
| `https`  | `https`       | read · live                 | 同上                        | 内置     |
| `webdav` | 显式绑定      | read · write · list · watch | ETag                        | 规划     |
| `sftp`   | `sftp`        | read · write · list         | mtime + size                | 规划     |
| 业务来源 | 自定义 scheme | read / write / watch 按需   | 业务标识                    | 插件注册 |

- **transport id 是开放枚举**：内置 `file` · `http` · `https`，规划 `webdav` · `sftp`，插件可注册自定义 id。
- **capabilities 枚举**：`read` · `write` · `list` · `watch` · `live`。在 transport 注册时静态声明。
- **watch 是可选的 transport 能力**：文件来源用 `fs.watch` + `watchFile` 兜底；http(s) 不提供推送，由实时视图承担；WebDAV / SFTP 用轮询；自定义来源可用 SSE / WebSocket。watch 事件只报 `ref + 变更类型 + 时间`，不承担冲突判断。
- **transport id 与 scheme 分离**：绑定键用 id（如 `https`），一个 transport 可服务多个 scheme；内置 scheme 保留，自定义 scheme 需带 vendor 前缀。
- 每个 scheme 有一个默认 transport；额外 transport（如 WebDAV）只能在绑定中显式选择，不能隐式抢占。
- **框架核心只内建 `file` / `http` / `https`**：本地文件与网页是启动即可用的基础能力。WebDAV、SFTP、邮件、业务 API 等常见来源作为官方或第三方插件，通过同一 `registerTransport` 接入——即使随应用分发，也不写死进核心分支。

```
transport.read(ref)
  → { mime, bytes }
        │
        ├─ 绑定(transport, mime) ─► codec
        │        文档供 store 与 presenter 使用
        │
        └─ 绑定(transport, mime, codec) ─► presenter
                 ├ page    → 插件页面
                 └ sidecar → 文本 / schema
```

**绑定表**（两级键，各管一段）：

```
codec:     (transport, mime)         → 用哪个解码器
store:     (transport, mime, codec)  → 结构化查询（派生）
presenter: (transport, mime, codec)  → 用哪个页面 / 文本出口
```

- `transport` 取注册的来源标识（如 `file` / `https` / 自定义来源）。
- `mime` 是 transport 返回的规范值；文件按扩展名、HTTP 按 `Content-Type` 归一；没有 MIME 即 raw。
- **出口由 codec 带出**：不需要意图参数——换了 codec，presenter 的键就换了，页面跟着换；读口径直接取 sidecar。
- 能力（如 `live`）是 transport 的静态声明，用于默认绑定与可行性校验，不需要每次读取返回。

| 优先级 | 规则                 | 例子                                      |
| ------ | -------------------- | ----------------------------------------- |
| 1      | 用户显式绑定         | `https + text/html → browser`（codec 空） |
| 2      | transport 专属绑定   | `file + text/html + html → html-viewer`   |
| 3      | MIME 默认绑定        | `application/pdf + pdf → pdf-viewer`      |
| 4      | 能力匹配（fallback） | `requires ⊆ capabilities`，`live` 优先    |
| 5      | 顺序与诊断           | 同键后注册者胜出，并在注册页可见          |

- 绑定只决定「用哪个实现」，不改变 ref 与内容。
- 同一键的多份注册不静默合并：后注册者胜出并记诊断；用户绑定优先，落应用数据目录，可用 `ura.bindings.*` 命令或设置 → 偏好设置 → 注册项编辑。
- 两级绑定都落空 → raw + 通用文本投影。

**LLM 读取面是 sidecar**：它不参与页面出口的竞争，由门面的读口径直接取，始终提供文本或 schema 出口：

- 已解码文档 → 结构化文本 / Markdown；
- 无 codec 或解码失败 → 原始文本 / 字节摘要；
- 浏览器快照 → Markdown；
- 数据类文档 → schema + query，不投递行数据。

### 3.4 写会话

| 项       | 设计                                         |
| -------- | -------------------------------------------- |
| 草稿     | 暂存不落盘、不进表现层、不进模型上下文       |
| 提交     | 单步 edit / write = 写会话的三步合成         |
| 队列     | 按资源键分片；同键串行，跨资源并行           |
| 写入     | 队列执行到即覆盖；最后写入胜出               |
| 外部变更 | watch 通知页面标记 stale；脏时提示重载或覆盖 |

### 3.5 页面会话

```
打开：ref → 解析页面 → 投递内容
就绪：页面主动上报
编辑：脏态 / 自动保存 / 手动保存
提交：文本或 saveBytes（二进制）；按队列顺序写入
外部变更：watch 标记 stale，脏时提示重载 / 覆盖
释放：关闭标签即释放会话
```

- 页面不持写队列与结构化数据；只持桥。
- 二进制文档（OOXML / PDF）以原始字节提交。
- 页面会话与视图记录绑定，关闭即释放。

### 3.6 变更与资源地图

- 事件维度：内容级（内容变更）、结构级（增删改名移动）、状态级（草稿 / 提交）。
- 所有写路径收敛到同一出口：工具、页面提交、外部文件变更、远端游标。
- **AGENTS.md 是 URA 托管的生成资源**：每工作区一份，内容 = 集合分组 + 每个资源的 codec + 数据 schema；写入与外部变更触发去抖重建，自身写入被识别，不形成回环。
- 资源地图按版本注入系统提示；会话进行中新写入的资源下一轮可见。

## 四、Harness

harness 是自持能力层，也是内置的 Pi Extension：提示、技能、工具。

产品上 sidecar 是 studio 的旁挂面——不占主表面，随工作区开合；数据上它只有一条来路：**资源地图**（URA 整合后的站点 / 分组 / schema）加 **文本出口**（按 ref 取到的文本或 schema）。它不扫盘、不持内容。

### 4.1 工具

| 类别       | 工具                                           | 通道         |
| ---------- | ---------------------------------------------- | ------------ |
| 资源管理型 | read · write · edit · grep · find · ls · query | URA 门面     |
| 操作型     | browser\_\* · 业务动作                         | 各自契约注入 |

- 7 个资源工具是门面的薄封装，不含 IO 与格式解释。
- 操作型工具不进 URA；浏览器工具依赖实现无关契约（打开 / 读取 / 点击 / 输入 / 截图 / 标注）。
- pi 内置工具停用；插件不能注册工具。

### 4.2 系统提示

```
角色与边界（业务操作，不写代码）
  + 资源地图（目录 / 分组 / schema，来自 URA）
  + 项目指令（AGENTS.md，带版本）
  + 数据轨（模型只见 schema 与 query）
```

### 4.3 技能

- 装载走资源轴；命名、诊断沿用 pi。
- 激活：选中集为空 = 全量；有选中按名过滤提示与清单。
- 管理页展示清单、来源、诊断与重新装载；选中集落用户状态。

### 4.4 浏览器自动化

- 作用对象是当前激活的网页标签；无网页时明确失败。

| 工具                 | 作用                                    |
| -------------------- | --------------------------------------- |
| `browser_open`       | 打开 http(s) 页面；白名单域自动归档快照 |
| `browser_read`       | 读取当前页面 URL / 标题 / 正文          |
| `browser_click`      | 按 CSS selector 点击元素                |
| `browser_type`       | 填写输入框 / textarea                   |
| `browser_back`       | 后退                                    |
| `browser_screenshot` | 截图                                    |
| `browser_snapshot`   | 结构化快照（可归档为 Markdown）         |

- 工具只在浏览器自动化实现可用时注册（L3 注入）；没有网页时返回明确错误。
- 实现走 `webContents.debugger`：操作走 `Input.*`，截图走 `Page.captureScreenshot`；正文（Readability）、可访问性结构与可交互性标记由注入遍历产出，都是浏览器能力的内置模块；侧车是自动化的唯一使用者。
- 快照：白名单域名整理为站点集合——该域下页面写成快照文件（`url` + Readability 的 title / excerpt / 正文 + 可访问性结构），落在应用管理的 `sites/<domain>/` 下（只有浏览器写入，用户不直接编辑）；已是 Markdown，不经 transport / codec，直接按文档登记（域 → 页两层），随资源地图同步给侧车。
- 这批工具是操作型工具，经浏览器契约注入，不走 URA。

## 五、会话与事件

### 5.1 会话生命周期

```
新建 / 切换 / 分支
        │
        ▼
  换代（重建运行时）
  ① 切换事件订阅
  ② 重绑扩展上下文（UI / 模式 / 命令 / 退出）
  ③ 上报换代原因
        │
        ▼
空闲 ◄─► 流式执行 ◄─► 中断 / 压缩 / 历史
```

- 换代由明确原因触发：模型目录变更、工作区切换、扩展运行器重启；流式中延后到本轮结束。
- 会话标签与视图标签是两套集合：关会话标签不删数据，关视图标签即释放页面。

### 5.2 事件桥

```
pi 会话事件 ─┐
应用事件   ─┼─► 合帧（16ms 同槽取最新）─► 单调序号帧 ─► 渲染层
            ┘
```

- 高频增量（消息 / 工具执行）合帧；定序事件（起止、轮次结束、队列变更）不合并。
- 渲染层检测缺口 → 重新握手 + 快照重建；不做增量回放。
- 会话创建、换代、状态、错误与应用事件共用同一序列。

### 5.3 扩展 UI 上下文

| 族         | 内容                                            |
| ---------- | ----------------------------------------------- |
| 对话框     | 选择 / 确认 / 输入 / 编辑（请求 + 应答 + 超时） |
| 状态       | 通知 · 状态文本 · 工作态 · 标题                 |
| 命令上下文 | 等待空闲 · 新建 / 分支 / 切换会话               |
| 退出回调   | 冲刷会话域并标记退出意向                        |

对话框走原生浮层；UI 状态在主进程留快照，渲染层重连时重放。

## 六、命令目录

命令名 = `域.动作`，统一路由与信封。

| 域    | 命令                                                                                                                 |
| ----- | -------------------------------------------------------------------------------------------------------------------- |
| 会话  | 提示 · 插话 · 追加 · 中断 · 清队列 · 新建 · 切换 · 分支 · 列表 · 删除 · 重命名 · 取消息 · 压缩 · 控制模式 · 可用命令 |
| Agent | 状态 · 模型 · 档位 · 配置 · 工作区切换 / 选择 / 清单                                                                 |
| 模型  | 目录 · 供应商 · 登录 / 登出 · 保存 / 删除                                                                            |
| 设置  | 视图 · 写全局层 · 写工作区层 · 重新载入                                                                              |
| 插件  | 来源清单 · 安装 · 卸载 · 已加载清单                                                                                  |
| Pi 包 | 社区目录 · 已配置 · 已加载资源 · 安装 · 卸载                                                                         |
| 资源  | 列表 · 分组 · 打开 · 读取 · 检索 / 查询 · 写会话 · 订阅 · 同步 · 技能                                                |
| 壳层  | 用户状态 · 存储视图 / 打开 · 调试                                                                                    |

命令按会话封装；配置写入先经官方加载链校验，失败回滚。

## 七、存储与配置

| 数据     | 位置                | 说明                                                       |
| -------- | ------------------- | ---------------------------------------------------------- |
| 会话     | 会话目录（可配置）  | JSONL；空会话不落盘                                        |
| 模型目录 | 应用数据目录        | 供应商 / 模型清单，密钥不落此处                            |
| 凭证     | 官方凭证链          | 运行时覆盖仅内存                                           |
| 设置     | 应用 / 工作区两层   | 深度合并；置空删键；未知字段保真                           |
| 工作区   | 自描述文件          | 路径 / 创建时间 / 最近打开                                 |
| 用户状态 | 工作区              | 主题 / 栏宽 / 打开集合 / 助手形态，可重建                  |
| 派生数据 | 工作区              | 资源地图 / 结构化索引 / 页面缓存，可重建；网页快照不在此列 |
| 插件     | 安装目录 + 来源声明 | 本地来源原地加载                                           |

- **当前工作区 = 最近打开者**，没有第二份「当前选中」状态。
- **切换即换代**：重建运行时，重绑 URA、用户状态、浏览器策略与会话索引。
- **隔离粒度**：会话、用户状态、派生数据、工作区设置按工作区隔离；模型目录与凭证属应用级。
- **写策略**：内存 + 标脏 + 防抖 + 退出强制落盘；先写临时文件再原子替换；派生数据带版本，格式变化时后台重建。

## 八、生态

三块能力分开管理：

| 分区    | 内容                                 | 页面           |
| ------- | ------------------------------------ | -------------- |
| 插件    | 可安装（清单 md）· 已加载 · 内置插件 | 设置 → 插件    |
| Pi 扩展 | 社区包安装 / 卸载；已加载 extensions | 设置 → Pi 扩展 |
| 技能    | 技能清单 / 诊断 / 激活集             | 设置 → 技能    |

- 插件安装由 npm 完成；本地来源直接加载，依赖由作者维护。
- Pi 包走 pi 的社区目录与热重载；插件安装 / 卸载重启生效。
- 三类配置都写应用自持目录，不污染用户全局 pi 环境。

## 九、页面数据面

- 页面只持语义桥：白名单命令 + 视图总线；无 Node、无裸 IPC。
- 页面来源校验后按映射转发到同一条命令实现；未映射命令不存在。
- 设置页与插件页共用同一套桥；设置页只放行会话 / 工作区 / 存储 / 资源等需要的命令。
- 页面偏好存本插件分区；主题由主进程广播。

### 9.1 信任边界

```
主进程（自家）        全量能力
插件（外部）          主进程代码，安装即授权
页面 / 网页（外部）   沙箱渲染进程，无 Node
设置页（自家）        与页面同一沙箱，只能调白名单命令
```

- 信任在安装期：插件能执行主进程代码，来源必须明示。
- 运行时靠边界：页面只能走页面数据面；凭证不出主进程；模型侧只拿 schema 与 query。
- 网页无桥；导航与窗口打开由视图宿主收束（网页链接转应用内标签，外链交系统）。
- 自动化只经侧车：CDP 能力不向页面、插件与命令开放。

## 十、验收

1. **同源**：工具集合 = 7 个资源工具 + 操作型工具；默认模型与 pi 命令行读同一条设置链。
2. **单一扩展体系**：新增能力只经资源轴与注册轴，没有第三套清单或加载器。
3. **管道唯一**：人 / AI / 页面都经 URA；页面无 Node；工具不直连来源。
4. **表现层可选**：同一文档可按能力选择文本、插件页面或浏览器视图。
5. **写控制**：同键串行；后写覆盖先写；外部变更经 watch 提示。
6. **上下文同源**：AGENTS.md 与资源地图来自 URA；外部改动下一轮生效。
7. **生态分离**：插件、Pi 扩展、技能各自安装与管理，互不混淆。
