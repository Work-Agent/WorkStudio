/**
 * 状态 / 事件句柄：注册即入表，句柄只负责填参数与发布。
 *
 * 用类而不是工厂：模块把它作为字段持有，生命周期与模块实例一致。
 */

import type { Bus } from './bus';
import { fill, split } from './paths';
import type { Owner, PathTable } from './table';
import type { Params } from './types';

export interface HandleDeps {
  table: PathTable;
  bus: Bus;
  template: string;
  base: string;
  owner: Owner;
  view?: boolean;
  validate?: (value: unknown) => boolean;
}

export class StateHandle<T> {
  private readonly templated: boolean;

  constructor(private readonly deps: HandleDeps) {
    deps.table.addState({
      template: deps.template,
      base: deps.base,
      owner: deps.owner,
    });
    this.templated = split(deps.template).some((segment) =>
      segment.startsWith(':'),
    );
  }

  publish(params: Params, value: T): void;
  publish(value: T): void;
  publish(paramsOrValue: Params | T, maybeValue?: T): void {
    if (arguments.length > 1) {
      this.deps.bus.publish(
        fill(this.deps.template, paramsOrValue as Params),
        maybeValue,
      );
      return;
    }
    if (this.templated) {
      throw new Error(`path ${this.deps.template} requires params for publish`);
    }
    this.deps.bus.publish(this.deps.template, paramsOrValue);
  }

  peek(params: Params = {}): T | null {
    return this.deps.bus.read<T>(fill(this.deps.template, params));
  }

  drop(params: Params = {}): void {
    this.deps.bus.drop(fill(this.deps.template, params));
  }
}

export class EventHandle<T> {
  private readonly templated: boolean;

  constructor(private readonly deps: HandleDeps) {
    deps.table.addEvent({
      template: deps.template,
      base: deps.base,
      owner: deps.owner,
      view: deps.view,
    });
    this.templated = split(deps.template).some((segment) =>
      segment.startsWith(':'),
    );
  }

  emit(params: Params, value: T): void;
  emit(value: T): void;
  emit(paramsOrValue: Params | T, maybeValue?: T): void {
    const value = arguments.length > 1 ? maybeValue : paramsOrValue;
    if (this.deps.validate && !this.deps.validate(value)) {
      throw new Error(`invalid event payload for ${this.deps.template}`);
    }
    if (arguments.length > 1) {
      this.deps.bus.emit(
        fill(this.deps.template, paramsOrValue as Params),
        maybeValue,
      );
      return;
    }
    if (this.templated) {
      throw new Error(`path ${this.deps.template} requires params for emit`);
    }
    this.deps.bus.emit(this.deps.template, paramsOrValue);
  }
}
