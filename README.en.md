# WorkStudio

> A desktop workbench that treats working material as a first-class citizen: manage every asset in a project space from a single screen, and let AI reason across all of it and act intelligently; people and AI read and write the same real content, deliverables stay where they live, and verification happens on the object itself.

![license](https://img.shields.io/badge/license-MIT-blue) ![node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen) ![platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)

[简体中文](./README.md) | **English**

> This document covers the requirements and key modules: why working material scatters across tools, how three claims respond, how the domain model, product shape and overall architecture follow, and finally the extension surfaces, state and communication, and development workflow. It answers why WorkStudio is what it is and how its key modules are designed; implementation details live in the code.
>
> The systematic design is in [`docs/architecture.md`](./docs/architecture.md): scopes · data models · contracts · App runtime · lists / views / resources / capabilities · extensions · acceptance. This document covers requirements and key modules; that one is the systematic design; the two do not overlap.

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

Fragmentation in daily work concentrates along five dimensions: source, format, version, permission and context. They are the shape of the work, not a defect. The real cost is convergence: one deliverable passes through six stages — gather, understand, execute, deliver, trace and secure — and at every stage a person must find, convert, cross-check and confirm again.

The actions are neither reusable nor traceable, so the cost scales with the number of tasks (×N). Neither existing answer lowers it: without a workbench, all six costs are borne by the person; with a coding agent, the six costs are rewritten as one programming task.

#### Five dimensions: one deliverable, five identities

| Dimension  | What coexists in one task                                                          | Action each crossing adds | Cost without convergence                                                                    |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| Source     | Local folders, cloud shares, business systems, web pages, email                    | Locate                    | You cannot find it all, nor tell whether you did                                            |
| Format     | docx, xlsx, pdf, email, web pages, canvases                                        | Convert                   | Converting to text or a screenshot loses table relations, hierarchy, comments and revisions |
| Version    | Final, final(2), system export, mail copy, cloud copy                              | Compare                   | No authoritative version; you edit a stale file and notice afterwards                       |
| Permission | Cloud links, system roles, mailbox delegation, directory ACLs                      | Confirm                   | Visibility is confirmed by hand; permissions narrow only per directory                      |
| Context    | Templates, approval rules, departmental definitions, verbal agreements, precedents | Restate                   | Every task re-learns them; what is learned is recorded nowhere                              |

#### Six costs: every stage makes the person converge again

| Stage      | What the person does without convergence                                                                                                    | What it costs                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Gather     | Searches all five entry points; downloaded, saved-as and attached copies coexist                                                            | Cannot find it all or tell whether it did; works on a stale copy                                                |
| Understand | Opens six formats six ways; converts to text or screenshots; business data exists only as UI; rules live in documents and verbal agreements | Judgement shifts with the tool; table relations, comments and revisions vanish; rules are re-learned every task |
| Execute    | The person is the process engine: copying, comparing, filling and submitting across UIs; no idempotency, no serialization                   | Steps cannot be replayed; retries duplicate records; later writes overwrite earlier ones                        |
| Deliver    | Output lands as a file and is carried back; export → edit → import round trips                                                              | Styles, formulas, hyperlinks and revisions break                                                                |
| Trace      | Cannot say which material and which version a conclusion rested on; operations are scattered across logs                                    | Review means redoing the work; a handover starts from zero                                                      |
| Security   | Material moves as attachments, share links and screenshots; permissions are per directory; redaction is manual                              | No record of who saw it; no expiry, no evidence for compliance                                                  |

The six stages are not one-off: every new task starts again at gather, actions do not accumulate, and the process cannot be traced, so cost grows linearly with the number of tasks.

#### Two workarounds: the cost only changes payer

| Workaround     | Who pays       | What the cost becomes                                         | Where it falls short                                                                                       |
| -------------- | -------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| A No workbench | The person     | All six stages redone by hand                                 | The person becomes the process engine; actions are neither reusable nor traceable                          |
| B Coding agent | Model + person | The six stages become a script: generate → run → human checks | Parsing, field mapping, write-back and verification are the script's job; ordinary users cannot confirm it |

B does not remove the six stages; it adds one round of programming to each: every source type needs its own parser, field mapping is guessed, write-back lands as files or simulated clicks, failures surface as stack traces, and correctness depends on reading the script.

#### Consolidation

| Pain cluster                          | Missing capability                                                                                  | Claim it maps to                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Gather, understand, deliver, security | Material has one identity, is interpreted once, and is written through one channel                  | **One resource pipeline**          |
| Execute, deliver                      | One state, one entry point for human operations and AI execution, writes never overwrite each other | **One state tree, one projection** |
| Trace, reuse and barrier              | Content is read, edited and verified in place, with actions recorded                                | **Content surfaces stand alone**   |

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
├─ Scene: column widths · open-set key · assistant form
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

The workbench follows “material → processing → checking deliverables”:

| Area                  | Responsibility                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Left material sidebar | Expand sources inline and find by name or path; keep material accessible while management pages are open            |
| Central content       | Documents, websites and welcome; capability management and settings each reuse a management tab                     |
| Right assistant       | Open conversation tabs, execution state, tool steps and deliverables to inspect; full history is managed separately |

The title-bar background and address display move the main window between displays. Buttons retain normal clicks, and a dedicated action copies the address.
The welcome page selects registered workspaces or another directory. Unavailable directories are identified and custom names survive switching.
Closing, rereading, bulk closing, switching workspaces and quitting protect drafts with save/discard/cancel. External changes and failed saves preserve drafts and allow saving a copy.

## 4. Overall architecture

The renderer is a multi-page application: the shell, assistant, overlay, settings and welcome page have independent entries and share the same `window.workStudio` bridge and shared styles. Each page subscribes only to the resources it consumes.

```text
Renderer pages
  shell / assistant / overlay / settings / welcome
        │ window.workStudio
        │ subscribe / command / notify / onUpdate
Runtime
  DomainRegistry · Dispatcher · storage / logging / network adapters
Domains
  workspaces · resources · plugins
  shell · settings
  sessions · models · skills · thinking · extensions · tools · prompts · themes
Domain modules
  workspace: workspace lifecycle (workspaces + resources + lists + plugins)
  shell / settings / agent
Agent layer
  pi runtime · harness · tools · session persistence
        │ official extension points
     pi SDK / URA
```

- **Domain / Resource is the runtime unit**: domains follow capabilities (workspaces / resources / lists / plugins / shell / settings, plus sessions / models / skills / thinking / extensions / tools / prompts / themes under agent); lifecycle is grouped into four DomainModules — workspace / shell / settings / agent. There is no Capability, controller or separate lifecycle interface.
- **Workspace is a scope, not a domain**: workspace-scoped resources carry the wsId in the resource name (for example `workspace/<wsId>/resources`); windows map 1:1 to workspaces and subscribe to the workspace they are bound to.
- **Runtime owns the framework**: DomainRegistry, Dispatcher and storage / logging / network adapters provide cross-domain mechanics and hold no business state.
- **DomainModules own implementations**: the workspace module manages resources / URA / the resource forest; the plugin registry is App-level; shell manages windows / views / layout / theme; settings manages settings / updates; the agent engine lives in a separate Agent layer owned by AgentDomain, split into sessions / models / skills / thinking / extensions / tools / prompts / themes domains.
- **Dependencies are explicit**: DomainModule declares `dependencies`; DomainRegistry starts in topological order and stops in reverse. No DI container.
- **App is the composition root**: it only owns process lifecycle, windows, view providers, IPC and assembly of the four DomainModules.
- **Views have two layers**: window-level system views (assistant / overlay / capture) and content tabs (resource pages / web) are separate; Views only handles hosting, geometry, visibility and stacking.
- **Layout / Scene is a window-level contract**: the main process computes layout; dragging only produces a preview. Committing writes the scene, and DOM and native views consume the same geometry.
- **Lists are a provider pipeline**: documents, sessions, plugins, settings and sites share one provider → snapshot flow; the renderer only consumes snapshots.
- **Settings is a consumer of domains on one page**: every card expands in place, and update state is the `updates` resource of the `settings` domain.
- **IPC logging is built in**: the Dispatcher records request address, origin, duration and result; there is no middleware and input is never logged.
- **Resource pages and the browser are separate**: resource pages use URA transport / codec / presenter; the browser bypasses the pipeline and is navigated directly by the view host.
- **One communication surface**: the renderer uses `workStudio`; resource and plugin pages expose restricted capabilities through `window.extension`; no raw IPC.
- **One-way dependencies**: Renderer → workStudio → Runtime / Domains → Agent layer / URA → pi SDK.

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

A person's entry (bypasses transport / codec):
site entry (title + URL) ─► view host ─► WebContentsView navigation ─► live view (the real page)
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
- **Snapshots skip transport / codec**: what the browser hands over is already Markdown and is registered as a document directly, with no interpretation step of its own; searching and sidecar reads use the same path as local documents.
- **People see the live page, the sidecar sees the projection**: a sidebar site entry shows the snapshot's page title and URL; opening it navigates the live view to that URL (activating the tab if it is already open). The Markdown snapshot (body + accessibility structure) serves only the sidecar and the resource map and is not a reading surface for people.
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

| Part          | Content                                                                     | Used by                                            |
| ------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| Front matter  | `url` · Readability `title` / `excerpt` · `domain` · `capturedAt`           | Collection rows (title + URL), open target, dedupe |
| Body          | Markdown body extracted by Readability                                      | Sidecar context, search                            |
| Accessibility | role · name · selector of landmarks / heading levels / interactive elements | Automation targeting, structure verification       |

- **File name = path slug + URL hash**: re-capturing the same URL overwrites the same file, no copies.
- **The body is a projection, not the source**: it is never used for write-back and is not a reading surface for people; site content is changed only on the site, and people look at the live page.
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
- **Two kinds of page, two owners**: `page` is a resource page whose entry and key are resolved by the plugin; `settings` is a plugin configuration / detail page — the page comes from the plugin, but its list, entry and ref belong to settings (Settings → Plugins, install details). Both share the same page loading and whitelist bridge.
- **Filling segments does not change identity**: plugins only declare what they handle (`(transport, mime)` and codec); refs, the binding table and write queues stay with the framework.

Key decisions:

- **ref is identity**: `scheme://authority/path`; it carries no format, outlet or presentation.
- **MIME is the format identity**: MIME comes from the transport (files by extension; HTTP by normalised `Content-Type`, falling back to the URL extension when it is missing or plain `application/octet-stream`); a codec declares only which `(transport, mime)` pairs it interprets; bytes are never sniffed — no MIME means raw.
- **Bindings have two levels**: codec recognises `(transport, mime)`, presenter recognises `(transport, mime, codec)`. The outlet follows the codec — the same source and format can get a different page by switching codec, with no intent parameter. The later registration wins on the same key and leaves a diagnostic; user bindings are written to the application data directory and loaded at startup.
- **The agent read surface is the sidecar outlet**: it does not compete for pages; it always turns a document or raw bytes into text or schema. It does not scan the file system — what comes in is a ref selected by the resource map, what goes out is text.
- **Reading and writing share one facade**: AI tools, pages and commands all go through the same implementation; writes pass draft → commit → sharded queue, with later writes overwriting earlier ones.
- **Failure degrades to raw**: a missing link returns the raw content plus a fallback page, and the degradation point is recorded.

#### Plugin packages, zip, and the install catalog

A plugin is a self-contained directory: the `workstudio` field in `package.json` declares id / label / pages / skills / claims; `exports["./workstudio"]` points to the `definePlugin` ESM entry, and `commands.json` is generated by the build. Plugins ship as zip files, one plugin per zip.

```text
plugin-docx.zip
├── package.json
├── dist/engine.js
├── commands.json
├── dist/page/...
└── node_modules/        # optional; the plugin bundles its own dependencies
```

| Source       | Syntax                                             | Where it lands                                |
| ------------ | -------------------------------------------------- | --------------------------------------------- |
| Remote zip   | `https://.../plugin.zip#sha256=...`                | `<appData>/plugins/installed/<id>/`           |
| Local zip    | `~/Downloads/plugin.zip`                           | `<appData>/plugins/installed/<id>/`           |
| Local folder | Absolute path                                      | Copied to `installed/<id>/`; source untouched |
| Registry     | `catalog:<id>`, with URL and sha256 from the entry | `<appData>/plugins/installed/<id>/`           |

**The install catalog is a separate registry** (Work Studio Plugin Registry), no longer kept in the app source tree:

- One JSON entry per plugin; CI validates fields, id, version and sha256, then generates `index.json` on merge;
- Entry fields: `id` / `name` / `description` / `version` / `source` / `sha256` / `repo` / `tags` / `category`; `source` must be a self-contained zip and `sha256` pins the exact artifact;
- The app reads only its cache at startup; it fetches `index.json` when the plugin settings page opens or on manual refresh. It uses GitHub raw by default, busts the branch cache on explicit refresh, sends conditional requests, and falls back to the stale cache;
- The catalog is for discovery only: installation always trusts the zip manifest, and the catalog id must match the manifest id;
- The registry marks plugins that ship with the installer with `builtin: true`; packaging downloads each entry, verifies sha256, places it under `out/plugins/`, and startup seeds it into `installed/`. Their ids are reserved and external packages cannot replace them;
- No auto-update: when the catalog version is newer than the installed version the UI shows "update"; installation only happens when the user clicks.

The registry contract is in [`docs/plugin-registry.md`](./docs/plugin-registry.md).

Install pipeline:

```text
source (catalog:<id> / URL / zip / directory)
  ─► download ─► verify sha256 ─► unpack ─► validate manifest / entry / commands.json
  ─► staging ─► atomically replace installed/<id> ─► activate
```

- **The directory is the source of truth**: no `installed.json`; startup scans `installed/<id>/package.json` and reads id, version and pages from the package;
- **Broken packages stay visible**: parse failures or a manifest id mismatch are kept as `broken` and can still be uninstalled;
- **Install and load are reported separately**: commit means the package has been atomically swapped into `installed/<id>`; an activation failure keeps the package with an error and supports reload or uninstall; a failed install restores the previous version;
- **Atomic replacement**: the old package moves to `recovery/` before the new one is swapped in; interrupted swaps are restored at startup;
- **Remote artifacts must pin sha256**: registry entries carry it, manual URLs use `#sha256=`, local zips are hashed but not compared;
- **Zip is self-contained**: dependencies are bundled into `dist` or shipped as `node_modules`; nothing runs npm at install time;
- **One plugin directory**: `<appData>/plugins/` holds only `installed/`, `staging/`, `recovery/`, `tmp/`, `data/`, `catalog/`; independent of workspaces and separate from pi resources under `agent/`;
- **Uninstall**: revoke registrations, close plugin pages, delete the package directory; configuration is kept by default and removed only with an explicit purge;
- **Tasks belong to the current process**: byte progress, verification, commit and activation are reported by phase; cancellation only applies before commit; no resume across restarts;
- **Hot install/uninstall**: changes take effect immediately; the ESM module body stays in process memory, and reload uses a new module URL to obtain a fresh instance — a known limitation.

### 5.4 Settings: endpoint only

Settings does not touch the pipeline: no transport / codec / store, only pages and a list. It hosts two kinds of page: framework built-ins and plugin settings pages.

- **Framework built-ins**: list and pages both owned by the main process, with the page directory separate from plugin pages;
- **Plugin settings pages**: the page is supplied by the plugin (`settings` entry) and manages that plugin's configuration; opened from the sidebar plugin list and available as the plugin home after installation;
- `settings.list` projects the built-in list; plugin settings pages are reached from the sidebar plugin list, and `views.open({ type: 'settings' })` opens by ref;
- **The ref carries its own scheme**: built-ins are `settings://<id>`, plugin settings pages are `settings://plugin.<id>`; the tab set, address bar and page sessions all recognise it by ref;
- Physical loading shares the `app://page` protocol, preload bridge, theme broadcast and session lifecycle with plugin pages;
- Adding a built-in page = one page + one list entry; plugin settings pages follow the plugin version; neither enters installation or trust flows on its own;
- **Model and config page**: a newly added custom model is written with `compat.supportsDeveloperRole: false` by default, since third-party endpoints generally accept only the `system` instruction role; existing model entries are never rewritten or migrated.
- Pages read only their own partition and whitelisted commands, never connecting to sources directly.

| Settings entry             | User task                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Appearance                 | Black (pure black default), Graphite, Porcelain and Mist; follow the system with separate light/dark choices; shared editor font size |
| Preferences                | Distinguish app defaults from workspace overrides; restore inheritance and protect unsaved form changes                               |
| Model connections          | Connect a provider before selecting an available default model; custom endpoints are advanced options                                 |
| Capabilities               | Keep document plugins, skills and assistant extensions distinct, with their sources, scopes and actual runtime states                 |
| Resource diagnostics       | Use the sidebar's source state, counts and errors; reveal registry details on demand                                                  |
| Storage, About and updates | Common locations and version status first; advanced paths and access tokens on demand                                                 |

Appearance is an app preference that survives workspace changes and restarts. The shell, built-in pages, assistant and editors stay in sync. Websites and document previews retain their own colors; third-party pages can still receive light/dark themes.

## 6. State and communication

### 6.1 Three levels of state

| Level         | Owns                                                                                                                      | Lifetime       | Persistence                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| **App**       | model catalog, credentials, plugin installs, Pi packages, global settings, system views, workspace list, active workspace | process        | `agentDir` / official credential chain                                            |
| **Workspace** | project settings, URA, lists, tab views, UI scene, page/write sessions, session index, browser policy, derived data       | open workspace | `workspace.json` / `ui-state.json` / `settings.json` / `sessions/` / `resources/` |
| **Session**   | pi runtime, messages, turns, queue, context (resource-map version, AGENTS, skill activation)                              | session        | `sessions/*.jsonl`                                                                |

- **Workspace-level data lists are managed by App runtime**: App runtime creates, replaces and disposes them through WorkspaceManager; WorkspaceScope is only the active instance.
- **Session truth lives in pi**: switching delegates to pi; WorkStudio keeps only the projection, and skill activation is resolved per session context.
- **Resources, pages and skills are loading modes**: App loads global resources, the workspace loads workspace resources, the session activates; all directories live under the app-private data directory, never `~/.pi` or the real workspace `.pi`.
- **Capability scopes**: assistant extensions retain Pi package user/project configuration; skill enablement belongs to a workspace, while the turn selection limits the current request.
- **Switch semantics**: workspace switch = dispose the old scope + load the new one; session switch = pi switch + event-bridge rebind.
- **Task state**: the assistant reports running, stopping, stopped, unconfirmed, failed and ended from actual execution. Stopping waits for runtime confirmation and does not undo completed file operations. Retry sends the original request again; potential side effects require checking existing results first. Execution ending does not mean the deliverables have been reviewed.
- **Install state**: downloads show actual byte progress, followed by separate validation, installation and loading stages. Cancellation waits for the current step. Failures support retry or changing the source; integrity failures require a different source. The sidebar retains access to the current task while management pages change; closing waits for cancellation confirmation. Progress belongs to the current process and does not promise restart resumption.

### 6.2 Communication

| Channel                  | Direction                     | Semantics                                                                  |
| ------------------------ | ----------------------------- | -------------------------------------------------------------------------- |
| `workStudio.subscribe`   | renderer → main               | Subscribe `(domain, resource)`, return a snapshot and keep pushing updates |
| `workStudio.unsubscribe` | renderer → main               | Cancel a subscription                                                      |
| `workStudio.command`     | renderer → main               | Command with a reply: `ok/data` or an error                                |
| `workStudio.notify`      | renderer → main               | Command without a reply                                                    |
| `workStudio.onUpdate`    | main → renderer               | snapshot / patch / event frames                                            |
| `window.extension`       | resource / plugin page → main | Restricted resource-page commands and content bus                          |

- **snapshot / patch / event**: subscription returns a full snapshot first; later frames carry only changes. A resource is the smallest unit of subscription and push.
- **Command acknowledgement**: `command` always returns an `ok` envelope; `notify` does not wait.
- **Content pages**: resource and plugin pages only expose `window.extension`; internally they use workStudio resource commands and `ws:bus` for content delivery, saving, reloading and actions.
- **Single writer**: the renderer never mutates main-process state directly; pages have no Node and no raw IPC.
- **Switch semantics**: a workspace switch releases the old runtime and rebinds the new one; a session switch rebinds the agent runtime, and old subscriptions converge through resource lifecycle.

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
| `pnpm plugins:sync`  | Sync registry `builtin` plugins into `out/plugins/`         |
| `pnpm run make`      | Build the installer for the current platform into `dist/`   |
| `pnpm run release`   | Build and publish (needs publish credentials)               |
| `pnpm run typecheck` | TypeScript type check                                       |
| `pnpm run lint`      | oxlint + oxfmt checks                                       |
| `pnpm run lint:fix`  | Auto-fix style issues                                       |
| `pnpm run verify`    | Run the same checks as CI (typecheck / lint / build)        |

`pnpm verify` runs `typecheck → lint → build`, the same order as the CI `js` job.

### 7.3 Project layout

```
├── src/
│   ├── main/
│   │   ├── app.ts / index.ts      # composition root / Electron entry
│   │   ├── runtime/               # DomainRegistry / Dispatcher / storage / log / net
│   │   ├── domains/               # workspaces / resources / plugins / shell / settings / agent
│   │   └── agent/                 # Agent layer: pi runtime / harness / tools / sessions
│   ├── preload/                   # preload contracts for pages and content views
│   ├── renderer/
│   │   ├── pages/                 # shell / assistant / overlay / settings / welcome
│   │   └── shared/                # cross-page API, domains and styles
│   └── shared/                    # types and styles shared by main / renderer
├── scripts/                       # release and built-in plugin sync scripts
├── RELEASING.md                   # release and SDK publishing rules
├── docs/                          # systematic design (architecture / plugin-registry)
├── electron.vite.config.ts        # build config for main / preload / renderer
├── electron-builder.yml           # packaging config (targets, fuses, signing)
└── tsconfig.json
```

### 7.4 Build and packaging

- Build output `out/{main,preload,renderer}` and packaging output `dist/` are not committed.
- macOS builds are signed with a **Developer ID Application** certificate (hardened runtime + notarization): local builds discover the certificate from the keychain (create it in Apple Developer and import first); CI imports the p12 from secrets in the Release workflow. Fuses rewrite the binary and electron-builder re-signs afterwards. Signing is a prerequisite for in-app silent updates — Squirrel.Mac verifies that the update bundle's code signature matches the running app (Team ID); ad-hoc signed copies cannot silently upgrade to a signed version.
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

The workflow first runs the same verify as CI (typecheck / lint / build), then packages on macOS (a single dual-arch job producing the one `latest-mac.yml` update feed), Windows and Linux, and collects everything into the GitHub Release for that tag. A tag containing `-` (e.g. `v0.2.0-beta.1`) is marked as a prerelease and does not become the release the download button points at. Once the workflows are merged, pushing the first tag produces the first Release.

The macOS build requires the following repository Actions secrets:

| Secret                        | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `MAC_CERTIFICATE`             | base64-encoded Developer ID Application certificate (.p12)      |
| `MAC_CERT_PASSWORD`           | The password set when exporting the p12                         |
| `APPLE_ID`                    | Apple ID email (for notarization)                               |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com (for notarization) |
| `APPLE_TEAM_ID`               | Team ID (for notarization)                                      |

After packaging, CI verifies the signing identity (Developer ID Application) and the Gatekeeper verdict, so a missing notarization credential or an ad-hoc fallback fails the build instead of shipping an installer that cannot update silently. Local manual packaging does not inject notarization credentials, so it signs but does not notarize.

In-app updates on macOS installed builds are silent replacements: electron-updater (Squirrel.Mac) downloads the zip, replaces the app automatically on quit, or updates immediately via "Restart and Install" on the settings page. `latest-mac.yml` ships with the Release as the update feed; the first upgrade from an ad-hoc build requires installing a signed dmg manually once.

### 7.5 Stack

- [Electron 44](https://www.electronjs.org/)
- [electron-vite 6](https://electron-vite.org/) (build)
- [electron-builder 26](https://www.electron.build/) (packaging)
- [Vite 8](https://vite.dev/)
- [TypeScript 6](https://www.typescriptlang.org/)
- [oxlint](https://oxc.rs/) / [oxfmt](https://oxc.rs/)
