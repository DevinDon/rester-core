import { MetadataKey } from '../constants';
import { BaseHandler } from '../handlers';

/** Handler class type. */
export type HandlerType = Function & typeof BaseHandler;

/**
 * Class / Method decorator.
 *
 * Specify the handler to use for this view / method.
 *
 * If there are handlers on both view & method, handlers on method will
 * run first, and then run those on view.
 *
 * @param {HandlerType} handler Handler class type.
 */
export const Handler = <THandler extends typeof BaseHandler>(handler: THandler, config?: any): ClassDecorator | MethodDecorator | any => {
  config && handler && handler.config(config);
  return (target: Function | Object, name: string | symbol, descriptor: PropertyDecorator) => {
    if (target instanceof Function) {
      // if on class
      const handlers: HandlerType[] = (Reflect.getMetadata(MetadataKey.Handler, target) || []);
      Reflect.defineMetadata(MetadataKey.Handler, [...handlers, handler], target);
    } else {
      // if on method
      const handlers: HandlerType[] = (Reflect.getMetadata(MetadataKey.Handler, target, name) || []);
      Reflect.defineMetadata(MetadataKey.Handler, [...handlers, handler], target, name);
    }
  };
};
