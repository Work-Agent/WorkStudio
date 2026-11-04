# WorkStudio

> A desktop workbench that treats working material as a first-class citizen: manage every asset in a project space from a single screen, and let AI reason across all of it and act intelligently; people and AI read and write the same real content, deliverables stay where they live, and verification happens on the object itself.

![license](https://img.shields.io/badge/license-MIT-blue) ![node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen) ![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

[简体中文](./README.md) | **English**

> This document covers the requirements and key modules: why working material scatters across tools, how three claims respond, how the domain model, product shape and overall architecture follow, and finally the extension surfaces, state and communication, and development workflow. It answers why WorkStudio is what it is and how its key modules are designed; implementation details live in the code.
>
> The systematic design is in [`docs/architecture.md`](./docs/architecture.md): scopes · data models · contracts · AppHost · lists / views / resources / capabilities · extensions · acceptance. This document covers requirements and key modules; that one is the systematic design; the two do not overlap.

## Download

[![Download](https://img.shields.io/badge/Download-Releases-2ea44f?style=for-the-badge)](https://github.com/Work-Agent/WorkStudio/releases/latest)

The button opens the Releases page; pick the asset for your platform from the latest release: `WorkStudio-mac-arm64.dmg` (Apple Silicon) or `WorkStudio-mac-x64.dmg` (Intel) for macOS, `WorkStudio-win-x64.exe` for Windows, `WorkStudio-linux-x64.AppImage` for Linux.

## 1. Where we are

### 1.1 How vertical agents differ

| Dimension      | Personal Agent      | Coding Agent            | Work Agent (this project)                           |
| -------------- | ------------------- | ----------------------- | --------------------------------------------------- |
| Material       | Few sources, cloud  | Single code base        | Many sources, many formats, uneven permissions      |
| Content        | Text / chat         | Executable, verifiable  | Content + data (data exposed as schema only)        |
| Goal           | Finish a task       | Change code correctly   | Complete business operations within rules           |
| Execution path | Retrieve + generate | Generate → run → verify | Orchestrate deterministic tools, no code generation |

### 1.2 Problem analysis: the gap in both workarounds

The fragments are not defects — they are what a job looks like: work naturally spans sources (local files / cloud drives / business systems / web pages / email), formats (documents / spreadsheets / web pages / email / canvases), versions, permissions and contexts. The problem is **the cost of converging them** — every dimension crossed means someone locates, converts, cross-checks and pastes back; the actions are neither reusable nor traceable, so cost grows linearly with the number of tasks. Neither existing answer lowers that cost: without a workbench it is all borne by the person (A); with a coding agent it is converted into an interface mismatch (B).

#### A. Without a workbench: a person carries things between tools

| Stage      | What happens                                                                                                                                | What it costs                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Gather     | Material is scattered across local files, cloud drives, business systems, web pages and email; finding it relies on memory and search terms | You cannot be sure you found it all, or found it at all                         |
| Gather     | Downloaded copies, saved-as copies and mail attachments coexist with no authoritative version                                               | You work on a stale copy and notice only after editing                          |
| Gather     | Cloud links, system roles and mailbox delegation each define permissions their own way                                                      | Visibility must be confirmed by hand, item by item                              |
| Understand | docx, pdf, xlsx, email and web pages each have a dedicated viewer; the same content renders differently in each                             | Time goes into opening and converting; the judgement basis shifts with the tool |
| Understand | Converting to plain text or a screenshot loses table relations, hierarchy, comments and revision marks                                      | Evidence is lost, conclusions rest on impressions                               |
| Understand | Business data is visible only through the UI, never as fields                                                                               | Definitions, value ranges and relations are relayed verbally                    |
| Understand | Rules, templates and approval requirements live in documents and verbal agreements                                                          | Every task re-learns them, and what is learned is recorded nowhere              |
| Execute    | The person is the process engine, manually copying, comparing, filling and submitting across UIs                                            | Steps cannot be replayed; a handover starts from zero                           |
| Execute    | No idempotency and no serialization                                                                                                         | Retries create duplicate records; later writes silently overwrite earlier ones  |
| Deliver    | Output lands as a file first, then is carried back into the business system                                                                 | Attachment names, folder placement and field mapping rely on convention         |
| Deliver    | Export → edit → import round trips                                                                                                          | Styles, formulas, hyperlinks and revisions are broken                           |
| Trace      | Nobody can say which material and which version a conclusion rested on; operations are scattered across system logs                         | Review means redoing the work; the next person starts over                      |
| Security   | Material moves between people and tools as attachments, share links and screenshots                                                         | No record of who saw it or forwarded it; redaction is manual                    |

#### B. Delegate to a coding agent: every task becomes a programming task

A coding agent is shaped as “one repo + shell + generate code → run → verify”. Applied to work, every task is forced through three stages: **generate a script → run it → have a human check it**. None of the three is a business action; all of them are development actions.

| Stage    | What happens                                                                                          | What it costs                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Kickoff  | Every task starts by producing a script; before the task begins, the person is already programming    | Changing one cell or exporting one list waits for the script                                                     |
| Read     | Format parsing (docx layout, scanned pdf, merged xlsx cells, dynamic web content) is the script's job | Every source type needs its own parser; a wrong parse does not fail loudly, it silently drifts                   |
| Read     | The mapping from business fields to positions inside documents is guessed                             | A wrong mapping yields plausible but unusable output                                                             |
| Write    | There is no API back into the business system, so the script writes files or simulates clicks         | Write-back is unreliable; export → edit → import breaks styles, formulas and revisions                           |
| Locate   | Failures surface as stack traces and exceptions meant for developers                                  | The user cannot tell whether the script, the data or the system failed                                           |
| Verify   | No assertions; correctness depends on reading the script and comparing by hand                        | Verification costs more than doing it yourself; the script becomes one more artifact to check                    |
| Reuse    | The same intent produces a different implementation every time                                        | Actions cannot accumulate into tools, nor be granted per task or audited afterwards                              |
| Security | Data lands in working directories, script arguments, session logs and model context as copies         | Copies escape control: who read which fields, when, cannot be answered                                           |
| Security | Permissions are granted per directory, not per field or per record                                    | Either the whole directory opens up, or the job cannot be done; credentials and sensitive fields have no channel |
| Security | Redaction and temporary grants are done by hand beforehand, with no expiry                            | One outbound send cannot be recalled, and compliance has no evidence                                             |
| Barrier  | Judging whether a script is safe, or will corrupt data, requires programming skill                    | Ordinary users can neither confirm what the agent did nor verify it; they can only trust or refuse               |

#### Consolidation

| Pain cluster                                                     | Missing capability                                                                                  | Claim it maps to                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| A gather, understand, deliver, security; B read, write, security | Material has one identity, is interpreted once, and is written through one channel                  | **One resource pipeline**          |
| A execute, deliver; B write, reuse                               | One state, one entry point for human operations and AI execution, writes never overwrite each other | **One state tree, one projection** |
| A trace; B kickoff, locate, verify, barrier                      | Content is read, edited and verified in place, with actions recorded                                | **Content surfaces stand alone**   |

The five dimensions stay the same; what changes is who pays for convergence — A leaves it to the person, B turns it into programming. WorkStudio collects it into a pipeline.

### 1.3 Three design claims

| Claim                              | Mechanism                                                                                                                            | Problem it removes                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| **One resource pipeline**          | Workspace material is registered uniformly and interpreted once; people, pages and AI share one read/write channel                   | Multiple read/write stacks, format coupling, uncontrolled copies |
| **One state tree, one projection** | The main process holds the only state; manual operations and AI execution use the same entry point; the UI only consumes projections | Overwritten writes, two logics for human and AI, drifting state  |
| **Content surfaces stand alone**   | Tab content is always a native view, so people read, edit and verify in place                                                        | Shell occlusion, late verification                               |

## 2. Domain model

**The aggregate root is the workspace**: it is simultaneously the isolation boundary, the persistence boundary and the regeneration boundary. Below it run two lines — files (the human surface) and sessions (the AI surface) — consuming the same resources.

```
Workspace (aggregate root)
├─ Files
│   ├─ Groups / directories / find (derived, rebuildable)
│   └─ Documents: view · edit · save · search · subscribe
├─ Sessions
│   ├─ Context: system prompt · resource map · selected skill set
│   ├─ Messages and tool calls (truth lives in pi)
│   └─ Runtime: streaming · queue · model tier
├─ Scene: theme · column widths · open-set key · assistant form
└─ View collection: tab order · active slot · pinned slots

Cross-cutting capability
├─ Plugins: resource implementations + pages + lists + actions
├─ Settings: built-in page list
└─ Browser: online pages + automation
```

| Entity           | Identity                        | Source of truth                    | Persistence                 |
| ---------------- | ------------------------------- | ---------------------------------- | --------------------------- |
| Workspace        | Path                            | Workspace registry                 | Self-describing file        |
| Resource         | ref (scheme + authority + path) | Source                             | Source side + derived layer |
| Session          | Session file                    | pi session manager                 | Session file                |
| Plugin           | Plugin id                       | Plugin catalog                     | Plugin root / install dir   |
| Page             | Plugin id or settings page id   | Plugin catalog / settings registry | Page files                  |
| Model and config | provider / model id             | pi settings and credential chain   | Settings file               |

## 3. Product shape

The same resource has three subjects: files say “what I have”, sessions say “what I want to do”, plugins say “what capabilities I have”. The three are not equal — sessions hold no data, plugins hold no identity or state and do not execute directly — so once the primary subject is fixed, the product shape follows:

| Primary subject | Role     | Question the product answers                               | Shape           | Where the other two sit                          |
| --------------- | -------- | ---------------------------------------------------------- | --------------- | ------------------------------------------------ |
| Files           | Person   | What material do I have, and how do I process it           | **Studio**      | Sessions are the process, plugins are extensions |
| Sessions        | AI       | What am I doing, and which material do I need on the way   | Chat            | Files are context, plugins are tools             |
| Plugins         | Extender | What capabilities do I have, what desktop can be assembled | Virtual desktop | Files and sessions become capability windows     |

All three paths work; they serve different jobs. This project chooses Studio:

1. **The deliverable is material, not conversation.** A job delivers documents, spreadsheets and records in systems; conversation can be lost, deliverables cannot. With sessions as the primary subject, the deliverable must be carried out of the context a second time.
2. **Verification can only happen on the object.** Correctness is confirmed by a person on the final artifact; only when the file is present can it be the same copy, re-readable and verifiable in real time, without inferring from a process log.
3. **Extensions must not pollute state.** With plugins as the primary subject, the product falls back to a set of capability windows, and files and sessions are carved up by capabilities.

The price is a heavier product than a chat box: it needs a workspace, native views, local files and system integration before “AI acts on real material and a person verifies on the spot” holds.

Conclusion: the primary subject is files, sessions are the process, plugins are extensions — the product can only be Studio.

## 4. Overall architecture

```
┌─ Renderer ──────────────────────────────────────────────────────┐
│ Shell DOM · ListHost · system pages (assistant / overlay / capture) │
└───────────────────────────┬─────────────────────────────────────┘
                            │ AppSnapshot / AppCommand / AppEvent
┌─ Assembly / AppHost ──────▼─────────────────────────────────────┐
│ lifecycle · window · protocol · IPC · command routing            │
│ active workspace · epoch · snapshot outlet                       │
└───────────────────────────┬─────────────────────────────────────┘
┌─ Domain services ─────────▼─────────────────────────────────────┐
│ ViewHost · UiState · Interaction · EventBridge · SessionAdapter  │
└───────────────────────────┬─────────────────────────────────────┘
┌─ Capability layer ────────▼─────────────────────────────────────┐
│ surfaces: plugins · settings · browser                           │
│ Agent harness: AgentHost · prompts / AGENTS · skills · tools     │
└───────────────────────────┬─────────────────────────────────────┘
┌─ Resource pipeline URA ───▼─────────────────────────────────────┐
│ transport · codec · store · presenter / sidecar · sessions · map │
└───────────────────────────┬─────────────────────────────────────┘
                            │ official extension points
                         pi SDK
```

- **One system outside, layered inside**: the renderer only faces AppHost; assembly, domain services, capabilities and URA keep their own responsibilities.
- **Scopes are horizontal ownership**: AppScope owns app-level state; WorkspaceScope owns all data of the active workspace; Session is delegated to pi.
- **AppHost owns orchestration state**: active workspace, epochs, switching transactions and outlets; it does not absorb lower-layer state.
- **The capability layer keeps two blocks**: surfaces (plugins · settings · browser) sit side by side by delivery; Agent harness is organised vertically by session. Both share domain services and the pipeline.
- **List structure lives in App**: groups, row templates, fields and actions are defined by App; data is resolved in the workspace; the renderer uses ListHost against the spec.
- **Switch granularity**: extensions are installed globally and enabled per workspace; skills are installed globally, defaulted per workspace, and activated per session.
- **Resources / pages / skills load by level**: App loads global resources and plugins, the workspace loads workspace resources, the session only activates; all resource directories live under the app-private data directory.
- **Independent from the pi CLI**: pi runs only as a library; neither `~/.pi` nor the real workspace `.pi` is read.
- **One channel**: the renderer only consumes AppSnapshot and only sends AppCommand; events carry scope / epoch.
- **One-way dependencies**: assembly → domain services → capabilities → URA → pi; lower layers do not know upper layers.

## 5. Extension surfaces

### 5.1 One pipeline, three extensions

Every piece of software handles data through the same channel: obtain bytes → interpret into structure → present to a person or hand to a program to consume; modifications travel back the same binding table, encoded layer by layer. WorkStudio cuts it into three segments, and the cut is not by responsibility but by **identity marker**: each segment recognises exactly one marker, and a different marker means a different implementation.

| Segment   | Marker recognised                               | Where the marker comes from           | Replacing it means                       |
| --------- | ----------------------------------------------- | ------------------------------------- | ---------------------------------------- |
| transport | scheme                                          | ref `scheme://authority/path`         | Replacing the source                     |
| codec     | MIME                                            | canonical value returned by transport | Replacing the format interpretation      |
| consumer  | codec (result of resolving `(transport, mime)`) | Binding table                         | Replacing the outlet: page / text / data |

- **Two data identities, one implementation identity**: ref fixes the source, MIME fixes the format, codec says “who decoded this document”; outlets, stores and write-back all follow the codec, with no separate docType.
- **Segments meet through markers, not conventions**: with the marker present, the segment is replaceable and the rest stays put; a missing marker (unknown MIME, no codec) degrades to raw and drops out of the segmentation.
- **The channel is bidirectional**: reading walks down from the marker, writing walks back up the same binding table — locate → encode (minimal patch) → commit to source.

Plugins, settings and the browser are not three facilities but three positions on this channel: plugins replace segments, settings occupy only the endpoint, the browser bypasses the whole channel. The difference is who owns the code and lifecycle, and where it plugs in. The framework core builds in only `file` / `http` / `https` sources; all other sources and formats are registered by plugins.

| Surface      | Position                                                                                                                                         | Owner and lifecycle                     | Extension mode                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ---------------------------------------------- |
| **Plugins**  | Replace segments: register transport / codec / store / consumer, and ship pages                                                                  | Installer: installable, removable       | The only extension surface open to the outside |
| **Settings** | Endpoint only: framework pages, no codec / store                                                                                                 | Framework: ships with versions          | Add a page inside the framework                |
| **Browser**  | Full bypass: live view embedded directly; allowlisted domains organised into site collections and synced to the sidecar through the resource map | Framework: does not change with content | Built in, not configured per site              |

```
┌────────────────────────── WorkStudio ──────────────────────────┐
│                                                                │
│  Plugins                     Settings             Browser      │
│  installable package         built-in pages       built-in     │
│  ┌──────────────┐          ┌──────────────┐      ┌───────────┐ │
│  │ registration │          │ settings://  │      │ live page │ │
│  │ + pages      │          │ <id> pages   │      │ automation│ │
│  │ URA impls    │          └──────┬───────┘      └─────┬─────┘ │
│  └──────┬───────┘                 │                    │       │
│         │                         │                    │       │
│         └───────────┬─────────────┴────────────┬───────┘       │
│                     ▼                          ▼               │
│               URA resource pipeline      pages and view host   │
└────────────────────────────────────────────────────────────────┘
```

**Boundaries** (the three owners do not overlap):

| Dimension    | Pipeline (framework)                                              | Sidecar (pi + harness)                                 | Surfaces (plugins · settings · browser)                                                                          |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Owns         | refs, binding table, write queues, page sessions, derived indexes | sessions, turns, context, tool orchestration           | Plugins: the segments they fill and their own pages; settings: pages and list; browser: live view and automation |
| Does not own | The content itself (truth lives in the source)                    | Resource implementations, pages, state tree            | ref identity, binding table, write queues, sessions, other surfaces' belongings                                  |
| Entry        | Facade: read / write / edit / grep / find / ls / query            | 7 resource tools + action tools (injected by surfaces) | Plugins: SDK registration at load time; settings: `settings.list`; browser: `browser_*` contract                 |
| Exit         | Text / schema / page entry point                                  | Messages and tool calls (truth in pi)                  | Plugins and settings: page projection + whitelisted commands; browser: snapshot files and site collections       |

- **Facade only**: neither the sidecar nor pages touch the file system or source protocols; plugin implementations are called by the facade and never drive the sidecar in reverse.
- **Identity is not outsourced**: refs, bindings, write queues and dirty flags belong to the framework; plugins only declare what they can handle (`(transport, mime)` and codec), they do not create an identity space.
- **Pages stay inside**: plugin pages have no Node, do not connect to pi directly, and only get projections and whitelisted commands.
- **Capability is exposed as tools**: plugins add no code execution for the model; capability appears as deterministic tools and commands, and the sidecar only orchestrates.
- **Live views connect directly**: the browser is navigated by the view host and runs no transport / codec; web pages return to the pipeline only as snapshot files.

### 5.2 Browser: a full bypass

An online system has already done “fetch → interpret → present” on the server; the deliverable is a rendered page. Re-interpreting it on the client only yields a degraded copy of the same result. So online systems do not re-run the pipeline; the browser embeds the live view directly. transport / codec / store / bindings — it uses none of them.

```
Live (bypasses the pipeline):
URL ─► view host ─► WebContentsView navigation (shared browser session) ─► render consumer
                                                                         ├ text     ─► sidecar (read / snapshot)
                                                                         └ Markdown ─► sites/<domain>/

Action (bypasses the pipeline):
intent ─► automation click / type / submit ─► the site itself completes it

Into the resource map (bypasses transport / codec):
sites/<domain>/*.md (already Markdown) ─► site collection: domain → pages
                                         └─► resource map ─► sidecar (visible next turn)
```

| Step      | Browser                             | Plugin pipeline                                                     |
| --------- | ----------------------------------- | ------------------------------------------------------------------- |
| Fetch     | Navigation                          | transport                                                           |
| Interpret | The site itself (server + engine)   | codec                                                               |
| Structure | Two-level collection: domain → page | store                                                               |
| Selection | None: a single path                 | Two-level bindings `(transport, mime)` → `(transport, mime, codec)` |
| Write     | Automation drives the site UI       | Write session: draft → encode → commit                              |

- **Shared session**: all web tabs share one browser session, so login state, cookies and cache stay consistent; temporary tabs and organised site content are the same origin.
- **Direct navigation**: opening a page means the view host tells the WebContentsView to navigate; no prefetch, no decoding, no ref produced, no change subscription.
- **Snapshots skip transport / codec**: what the browser hands over is already Markdown and is registered as a document directly, with no interpretation step of its own; opening, searching and sidecar reads afterwards use exactly the same path as local documents.
- **Snapshots live in an app-managed space**: site content is written under the application-managed `sites/<domain>/`, written only by the browser; the user does not edit it, so there is no “external change” semantics and it does not enter the write queue.
- **Layered into the map**: a domain is a collection group and a page is an entry; the resource map is injected as two levels — “site → page” — so the sidecar does not receive a flat list of refs.
- **Allowlisted domain = collected domain**: multiple pages under a domain are converted to Markdown by the render consumer and enter the collection; anything outside the list stays a temporary tab, is not written and never enters the resource map.
- **Automation = CDP actions + injected extraction**: click / type / back go through `webContents.debugger` `Input.*`, screenshots through `Page.captureScreenshot`; body text (Readability), accessibility structure and interactivity markers come from injected traversal — all built-in modules of the browser capability, shipped with the app, requiring no cooperation from the page.
- **Injection does not alter the site**: extraction and marker layers take effect inside the page and are reverted on close, leaving no persistent side effect; the page still has no bridge and no Node.
- **Automation is sidecar-only**: `browser_*` is the only entry; pages, plugins and commands do not expose this layer. People operate the live view directly, and the tool layer depends only on the action contract.
- **No edit**: a web page has no draft or encoding step; writes happen only inside the site.
- **Local HTML goes to plugin pages**: only the `live` capability selects the browser presentation.

#### Snapshot files

One site page maps to one Markdown file, written in three parts at once:

```text
---
url: https://example.com/reports/2026-q1
title: Q1 2026 business review
excerpt: Revenue, cost and gross margin by quarter……
domain: example.com
capturedAt: 2026-04-02T09:31:00Z
---

<Readability body>

## Accessibility structure

main   "Business review"   #content > main
button "Export"            button.export
table  "Quarterly compare" table:nth-of-type(1)
```

| Part          | Content                                                                     | Used by                                              |
| ------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| Front matter  | `url` · Readability `title` / `excerpt` · `domain` · `capturedAt`           | Collection rows, tab titles, search excerpts, dedupe |
| Body          | Markdown body extracted by Readability                                      | Sidecar context, page rendering, search              |
| Accessibility | role · name · selector of landmarks / heading levels / interactive elements | Automation targeting, structure verification         |

- **File name = path slug + URL hash**: re-capturing the same URL overwrites the same file, no copies.
- **The body is a projection, not the source**: it is never used for write-back; site content is changed only on the site.
- **The accessibility section is an index**: the sidecar takes only the body by default and reads the tail when it needs to target or verify structure.
- **Each part has an owner**: `url` is the only proof for returning to the online page; Readability provides readable body and summary; the accessibility structure lets automation avoid guessing positions visually.

### 5.3 Plugins: fill the segments

A plugin is whatever can fill the three segments of 5.1: it registers transport / codec / store / consumer / presenter / sidecar, plus lists and actions. The framework core builds in only `file` / `http` / `https` and a few built-in codecs (which are themselves plugins); all other sources and formats are filled by plugins. This pipeline is URA; online pages do not enter it (see 5.2).

```
Read:
ref ─► transport ─► RawContent{mime, bytes}
    ─► binding(transport, mime) ─► codec ─► document ─► store ─► queryable data
    ─► binding(transport, mime, codec) ─► presenter
           ├ page      ─► resource page (render / edit)
           ├ settings  ─► plugin settings page (config / details, owned by settings)
           └ sidecar   ─► text / schema

Who fills each segment:
transport   built in: file / http / https; plugins may add or override
codec/store plugins (including built-ins)
presenter   page / settings / sidecar all registered by plugins; fallback is raw — text into the generic text page, binary reported as “no viewer available”

Selection order: binding ─► MIME ─► raw

Write:
change ─► locate ─► encode (minimal patch) ─► commit to source ─► data update ─► broadcast
```

| Segment   | Responsibility                                                             |
| --------- | -------------------------------------------------------------------------- |
| transport | Protocol → RawContent (mime, bytes); capabilities declared at registration |
| codec     | Declares `(transport, mime)` → document                                    |
| store     | Bound to a codec: document → structured query (derived)                    |
| consumer  | Declares `(transport, mime, codec)` → page (render / edit) · text outlet   |
| list      | Sidebar list definition + workspace data provider                          |
| action    | Address-bar action                                                         |

- **Segments can be filled separately**: a plugin may fill one segment (add a single codec) or the whole chain (source + format + page); which segment is filled is decided by the registration API, with no requirement to own everything.
- **Two kinds of page, two owners**: `page` is a resource page whose entry and key belong to URA; `settings` is a plugin configuration / detail page — the page comes from the plugin, but its list, entry and ref belong to settings (Settings → Plugins, install details). Both share the same page loading and whitelist bridge.
- **Filling segments does not change identity**: plugins only declare what they handle (`(transport, mime)` and codec); refs, the binding table and write queues stay with the framework.

Key decisions:

- **ref is identity**: `scheme://authority/path`; it carries no format, outlet or presentation.
- **MIME is the format identity**: MIME comes from the transport (files by extension; HTTP by normalised `Content-Type`, falling back to the URL extension when it is missing or plain `application/octet-stream`); a codec declares only which `(transport, mime)` pairs it interprets; bytes are never sniffed — no MIME means raw.
- **Bindings have two levels**: codec recognises `(transport, mime)`, presenter recognises `(transport, mime, codec)`. The outlet follows the codec — the same source and format can get a different page by switching codec, with no intent parameter. The later registration wins on the same key and leaves a diagnostic; user bindings are written to the application data directory and loaded at startup.
- **The agent read surface is the sidecar outlet**: it does not compete for pages; it always turns a document or raw bytes into text or schema. It does not scan the file system — what comes in is a ref selected by the resource map, what goes out is text.
- **Reading and writing share one facade**: AI tools, pages and commands all go through the same implementation; writes pass draft → commit → sharded queue, with later writes overwriting earlier ones.
- **Failure degrades to raw**: a missing link returns the raw content plus a fallback page, and the degradation point is recorded.

#### Plugin packages, zip, and the install catalog

A plugin is a self-contained directory: the `workstudio` field in `package.json` declares id / label / icon / page / settings / apiVersion, and `exports["./ura"]` points to the ESM registration entry; on load the entry is imported, module evaluation registers. Plugins ship as zip files, one plugin per zip.

```text
plugin-docx.zip
├── package.json
├── dist/ura.js
├── dist/page/...
└── node_modules/        # optional; the plugin bundles its own dependencies
```

| Source       | Syntax                              | Where it lands                      |
| ------------ | ----------------------------------- | ----------------------------------- |
| Remote zip   | `https://.../plugin.zip#sha256=...` | `<appData>/plugins/installed/<id>/` |
| Local zip    | `~/Downloads/plugin.zip`            | `<appData>/plugins/installed/<id>/` |
| Local folder | Absolute path / `./plugins/csv`     | Loaded in place, not copied         |

**The install catalog is a Markdown file kept in source** ([PLUGINS.md](PLUGINS.md)), one source per line; it is parsed at build time into a static list inlined into the main process and the plugin settings page, and Markdown is no longer read at runtime:

```markdown
# Installable plugins

- [Word documents](https://github.com/acme/plugin-docx/releases/download/v0.3.1/plugin-docx.zip#sha256=9f2c...)
- [Spreadsheets](https://github.com/acme/plugin-xlsx/releases/download/v0.2.0/plugin-xlsx.zip#sha256=41ab...)
- ./plugins/csv
```

- **The catalog is a compile-time asset**: adding or removing a plugin means editing this file and rebuilding; the runtime neither parses nor rewrites it, and an invalid catalog fails the build.
- **Rendered from build data**: the plugin settings page receives the catalog inlined at build time and never reads Markdown at runtime.
- **Installed state is tracked apart**: installed = found under `installed/` and registered successfully; uninstalling only deletes `installed/<id>`, the catalog entry remains.
- **Ad-hoc installs only record state**: manual URLs, dragged-in zips or folders, and community-catalog installs are recorded in the local install index, not in the catalog.
- **One plugin directory**: `<appData>/plugins/` holds `installed/`, `staging/`, and `installed.json`; it is independent of workspaces and separate from pi resources under `agent/`.
- **Remote zips must carry sha256**: download to `staging/` → verify → extract → validate manifest / entry / `apiVersion` → atomically replace `installed/<id>`; local zips follow the same extraction flow (nothing to compare a remote hash against, so only the content hash is recorded).
- **Zip is self-contained**: dependencies are bundled into `dist` or shipped inside the zip as `node_modules`; nothing runs npm at install time.
- **No auto-update**: change the catalog URL / hash, rebuild and reinstall; updates are never silent.
- **Assembly at startup, hot install at runtime**: at startup scan local paths and `installed/` → import `./ura` → register → build pages; install / uninstall take effect immediately — uninstall revokes registrations by owner and closes plugin pages; the ESM module body stays in process memory, a known limitation.
- **Local sources are not copied**: loaded in place during development; reinstalling the source makes changes effective without a restart.

### 5.4 Settings: endpoint only

Settings does not touch the pipeline: no transport / codec / store, only pages and a list. It hosts two kinds of page: framework built-ins and plugin settings pages.

- **Framework built-ins**: list and pages both owned by the main process, with the page directory separate from plugin pages;
- **Plugin settings pages**: the page is supplied by the plugin (`settings` entry) and manages that plugin's configuration; opened from the plugin list under Settings, and available as the plugin's detail page right after installation;
- `settings.list` projects the built-in list; plugin settings pages are reached from the plugin list, and `views.open({ type: 'settings' })` opens by ref;
- **The ref carries its own scheme**: built-ins are `settings://<id>`, plugin settings pages are `settings://plugin.<id>`; the tab set, address bar and page sessions all recognise it by ref;
- Physical loading shares the `app://page` protocol, preload bridge, theme broadcast and session lifecycle with plugin pages;
- Adding a built-in page = one page + one list entry; plugin settings pages follow the plugin version; neither enters installation or trust flows on its own;
- **Model and config page**: a newly added custom model is written with `compat.supportsDeveloperRole: false` by default, since third-party endpoints generally accept only the `system` instruction role; existing model entries are never rewritten or migrated.
- Pages read only their own partition and whitelisted commands, never connecting to sources directly.

## 6. State and communication

### 6.1 Three levels of state

| Level         | Owns                                                                                                                      | Lifetime       | Persistence                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| **App**       | model catalog, credentials, plugin installs, Pi packages, global settings, system views, workspace list, active workspace | process        | `agentDir` / official credential chain                                            |
| **Workspace** | project settings, URA, lists, tab views, UI scene, page/write sessions, session index, browser policy, derived data       | open workspace | `workspace.json` / `ui-state.json` / `settings.json` / `sessions/` / `resources/` |
| **Session**   | pi runtime, messages, turns, queue, context (resource-map version, AGENTS, skill activation)                              | session        | `sessions/*.jsonl`                                                                |

- **Workspace-level data lists are managed by AppHost**: AppHost creates, replaces and disposes them through WorkspaceManager; WorkspaceScope is only the active instance.
- **Session truth lives in pi**: switching delegates to pi; WorkStudio keeps only the projection, and skill activation is resolved per session context.
- **Resources, pages and skills are loading modes**: App loads global resources, the workspace loads workspace resources, the session activates; all directories live under the app-private data directory, never `~/.pi` or the real workspace `.pi`.
- **Switch granularity**: extensions inherit the workspace enable policy when a session is created and are not hot-switched mid-session; skills are activated per session.
- **Switch semantics**: workspace switch = dispose the old scope + load the new one; session switch = pi switch + event-bridge rebind.

### 6.2 Communication

| Channel         | Direction       | Semantics                                                      |
| --------------- | --------------- | -------------------------------------------------------------- |
| AppCommand      | renderer → main | `scope + domain.action` → `ok/data` or error                   |
| AppSnapshot     | main → renderer | `app` / `workspaces` / `workspace` / `ui` / `session` + epochs |
| AppEvent        | main → renderer | scope + epoch + seq; high-frequency deltas coalesced           |
| Page data plane | page → main     | whitelisted commands forwarded to the same implementation      |
| View bus        | bidirectional   | deliver / ready / dirty / commit / actions / theme             |

- **Handshake**: `app.sync` returns the full AppSnapshot; subscription precedes the snapshot.
- **Gaps**: run `app.sync` again; no incremental replay.
- **Epochs**: workspace / session switches bump epochs; stale events are dropped.
- **Single writer**: the renderer never mutates main-process state directly; pages have no Node and no raw IPC.

## 7. Development

### 7.1 Environment and startup

- Node.js ≥ 22.12, pnpm ≥ 12

```bash
pnpm install
pnpm dev      # development mode (Vite HMR)
```

The first install downloads the Electron binary. If that download is slow or fails, use a mirror or a proxy before running `pnpm install` (mainland China mirror settings are documented in the [Chinese README](./README.md#71-环境与启动)):

```bash
export ELECTRON_MIRROR=<your mirror>
pnpm install
```

If `Error: Electron uninstall` appears, or `node_modules/electron/path.txt` is empty, the binary provisioning step was skipped (e.g. `--ignore-scripts`). Electron 44 no longer ships its own install script, so the download is handled by this project's `postinstall`; re-run it once:

```bash
node node_modules/electron/install.js
```

### 7.2 Scripts

| Command              | Description                                                 |
| -------------------- | ----------------------------------------------------------- |
| `pnpm dev`           | Development mode with Vite HMR                              |
| `pnpm run build`     | Compile main / preload / renderer into `out/`, no packaging |
| `pnpm run preview`   | Start the app from built output (verify production build)   |
| `pnpm run package`   | Package an unpacked app directory into `dist/`              |
| `pnpm run make`      | Build the installer for the current platform into `dist/`   |
| `pnpm run release`   | Build and publish (needs publish credentials)               |
| `pnpm run typecheck` | TypeScript type check                                       |
| `pnpm run lint`      | oxlint + oxfmt checks                                       |
| `pnpm run lint:fix`  | Auto-fix style issues                                       |

### 7.3 Project layout

```
├── src/
│   ├── main/                 # main process (assembly · domain services · capability layer · URA pipeline)
│   ├── preload/              # preload scripts (multi-entry contract bridges)
│   ├── renderer/             # renderer (React + Tailwind)
│   ├── plugins/              # built-in plugins (shipped with the app)
│   └── shared/               # types and styles shared by main / renderer
├── PLUGINS.md                # installable plugin catalog (parsed at build time into main process and settings page)
├── docs/                     # systematic design (architecture)
├── index.html                # renderer page template
├── electron.vite.config.ts   # build config for the three targets (main / preload / renderer)
├── electron-builder.yml      # packaging config (targets, fuses, signing)
└── tsconfig.json
```

### 7.4 Build and packaging

- Build output `out/{main,preload,renderer}` and packaging output `dist/` are not committed.
- macOS local builds use ad-hoc signing (`identity: '-'`): fuses rewrite the binary, so it must be re-signed or the system kills the app; switch to a Developer ID or inject a certificate via `CSC_LINK` for distribution.
- Installers are produced on the matching platform (or in CI): a macOS host builds mac targets only by default; Windows / Linux targets belong to CI.

Releases are triggered by a tag: the tag version must match `version` in `package.json`, otherwise the packaging jobs fail.

```bash
# 1. bump version in package.json to match the tag you are about to create
git commit -am "chore: release v0.1.1"
git push

# 2. create and push the tag, which triggers the Release workflow
git tag v0.1.1
git push origin v0.1.1
```

The workflow first runs the same verify as CI (typecheck / lint / build), then packages on macOS (arm64 / x64), Windows and Linux, and collects everything into the GitHub Release for that tag. A tag containing `-` (e.g. `v0.2.0-beta.1`) is marked as a prerelease and does not become the release the download button points at. Merge `ci.yml` first, then `release.yml` together with the first tag.

### 7.5 Stack

- [Electron 44](https://www.electronjs.org/)
- [electron-vite 6](https://electron-vite.org/) (build)
- [electron-builder 26](https://www.electron.build/) (packaging)
- [Vite 8](https://vite.dev/)
- [TypeScript 6](https://www.typescriptlang.org/)
- [oxlint](https://oxc.rs/) / [oxfmt](https://oxc.rs/)
