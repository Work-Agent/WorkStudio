/**
 * 路径表：命令 / 状态 / 事件三张表，共用一套模板匹配。
 *
 * 注册制：模块与 App 层都往自己的前缀下注册；同一路径只能有一个 owner。
 * 匹配：静态段优先，其次更长的模板，最后按注册顺序。
 */

import { match, specificity } from './paths';
import type { Params, RouteCall } from './types';

export type Owner = { type: 'app' } | { type: 'service'; id: string };

export type RouteHandler = (call: RouteCall) => unknown;

interface EntryBase {
  template: string;
  base: string;
  owner: Owner;
  order: number;
  score: number;
}

export interface CommandEntry extends EntryBase {
  handler: RouteHandler;
}

export interface StateEntry extends EntryBase {}
export interface EventEntry extends EntryBase {
  /** 是否允许视图 watch；默认 false，仅主进程内部事件。 */
  view: boolean;
}

export interface MatchResult<T extends EntryBase> {
  entry: T;
  params: Params;
}

export interface PathTableSnapshot {
  commands: string[];
  states: string[];
  events: string[];
}

export class PathTable {
  private readonly commands: CommandEntry[] = [];
  private readonly states: StateEntry[] = [];
  private readonly events: EventEntry[] = [];
  private readonly templates = new Map<string, Owner>();
  private order = 0;

  addCommand(input: {
    template: string;
    base: string;
    owner: Owner;
    handler: RouteHandler;
  }): void {
    this.claim(input.template, input.owner);
    this.commands.push({
      ...input,
      order: (this.order += 1),
      score: specificity(input.template),
    });
  }

  addState(input: { template: string; base: string; owner: Owner }): void {
    this.claim(input.template, input.owner);
    this.states.push({
      ...input,
      order: (this.order += 1),
      score: specificity(input.template),
    });
  }

  addEvent(input: {
    template: string;
    base: string;
    owner: Owner;
    view?: boolean;
  }): void {
    this.claim(input.template, input.owner);
    this.events.push({
      ...input,
      view: input.view === true,
      order: (this.order += 1),
      score: specificity(input.template),
    });
  }

  matchCommand(path: string): MatchResult<CommandEntry> | null {
    return this.pick(this.commands, path);
  }

  matchState(path: string): MatchResult<StateEntry> | null {
    return this.pick(this.states, path);
  }

  matchEvent(path: string): MatchResult<EventEntry> | null {
    return this.pick(this.events, path);
  }

  /** watch 前的存在性判断：状态或 view:true 的事件可被视图订阅。 */
  knownView(path: string): boolean {
    if (this.matchState(path)) return true;
    const event = this.matchEvent(path);
    return event ? event.entry.view : false;
  }

  snapshot(): PathTableSnapshot {
    return {
      commands: this.commands.map((entry) => entry.template),
      states: this.states.map((entry) => entry.template),
      events: this.events.map((entry) => entry.template),
    };
  }

  private claim(template: string, owner: Owner): void {
    const existing = this.templates.get(template);
    if (existing) {
      throw new Error(
        `duplicate path "${template}" (owner=${describe(existing)}, again by ${describe(owner)})`,
      );
    }
    this.templates.set(template, owner);
  }

  private pick<T extends EntryBase>(
    entries: T[],
    path: string,
  ): MatchResult<T> | null {
    let best: MatchResult<T> | null = null;
    for (const entry of entries) {
      const params = match(entry.template, path);
      if (!params) continue;
      if (!best || better(entry, best.entry)) best = { entry, params };
    }
    return best;
  }
}

function better(left: EntryBase, right: EntryBase): boolean {
  if (left.score !== right.score) return left.score > right.score;
  if (left.template.length !== right.template.length) {
    return left.template.length > right.template.length;
  }
  return left.order < right.order;
}

function describe(owner: Owner): string {
  return owner.type === 'app' ? 'app' : `service:${owner.id}`;
}
