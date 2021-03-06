import { IncomingMessage, ServerResponse } from 'http';
import { Readable } from 'stream';
import { Rester } from '../core/rester';
import { HandlerType } from '../decorators';
import { pipelines, writes } from '../utils';
import { BaseHandler } from './base.handler';

/**
 * Handler pool.
 */
export class HandlerPool {

  /** Maximum number of handlers per category, default to 1024. */
  private max: number;
  /** Pools. */
  private pools: Map<symbol, BaseHandler[]> = new Map();

  /**
   * Create a new handler pool.
   *
   * @param rester The rester instance to which this handler belongs.
   */
  constructor(private rester: Rester) {
    this.max = rester.config.handlerPool.max ?? 1024;
  }

  /**
   * Take one hander instance with special type.
   *
   * @param {HandlerType} handler Handler type.
   * @returns {T} A handler instance with special type.
   */
  take<T = BaseHandler>(handler: HandlerType): T {
    const key = handler.key;
    const pool = this.pools.get(key) || this.pools.set(key, []).get(key)!;
    return pool.pop() || new handler(this.rester) as any;
  }

  /**
   * Give back this handler to pool.
   *
   * @param {BaseHandler} handler Handler instance.
   * @returns {number} Number of handlers in pool.
   */
  give(handler: BaseHandler): number {
    const key = (handler.constructor as typeof BaseHandler).key;
    const pool = this.pools.has(key)
      ? this.pools.get(key)!
      : this.pools.set(key, []).get(key)!;
    return pool.length < this.max ? pool.push(handler.from()) : pool.length;
  }

  /**
   * Process request & response in HTTP/S/2 server.
   *
   * @param {IncomingMessage} request Request.
   * @param {ServerResponse} response Response.
   */
  async process(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // take & compose these handlers
    this.compose(this.take(this.rester.handlers[0]!).from(request, response), 0, this.rester.handlers)()
      .then(
        value => value && value instanceof Readable
          ? pipelines(value, response)
          : writes(value, response),
      )
      .catch(reason => this.rester.logger.trace('Error while compose:', reason))
      .finally(() => response.end());
  }

  /**
   * Compose all handler.
   *
   * @param {THandler extends BaseHandler} current Current handler instance.
   * @param {number} i Index of handler types in this request.
   * @param {HandlerType[]} handlers Handler types in this request.
   * @returns {() => Promise<any>} Composed function.
   */
  compose(current: BaseHandler, i: number, handlers: HandlerType[]): () => Promise<any> {
    // 根据 handlers 的数量进行组合 compose
    if (i + 1 < handlers.length) {
      // 如果存在下一个 handler
      // next 继承 current 的属性
      return async () => current.handle(
        () => this.compose(this.take(handlers[++i]!).inherit(current), i, handlers)(),
      ).finally(() => this.give(current));
    } else if (handlers === this.rester.handlers && current.route?.handlers.length) {
      // 当前的 handler 为 global handler 的最后一个，且当前路由还存在局部 handler
      const handlersOnRoute = [...current.route.handlers];
      return async () => current.handle(
        () => this.compose(this.take(handlersOnRoute[0]!).inherit(current), 0, handlersOnRoute)(),
      ).finally(() => this.give(current));
    } else {
      // 最后一个 handler 执行 view 的对应方法
      return async () => current.handle(
        current.run.bind(current),
      ).finally(() => this.give(current));
    }
  }

}
