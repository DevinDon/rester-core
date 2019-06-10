import { IncomingMessage, ServerResponse } from 'http';
import { MetadataKey, Method } from '../@types';
import { ParamInjection, ParamInjectionType } from '../decorator';
import { HTTP400Exception, HTTP404Exception } from '../Exception';
import { Route, Router } from '../Router';
import { BaseHandler } from './BaseHandler';

/**
 * Parameter handler.
 *
 * Inject parameter to controller method.
 *
 * @extends BaseHandler
 */
export class ParameterHandler extends BaseHandler {

  /** Parameter injectors, function. */
  private parameterInjectors: { [index in ParamInjectionType]: (name: string, route: Route) => any } = {
    /**
     * Inject HTTP request instance.
     *
     * @returns {IncomingMessage} Request instance.
     */
    PARAM$HTTP$REQUEST: (): IncomingMessage => this.request,
    /**
     * Inject HTTP response instance.
     *
     * @returns {ServerResponse} Response instance.
     */
    PARAM$HTTP$RESPONSE: (): ServerResponse => this.response,
    /**
     * Inject path query object.
     *
     * @returns {string | undefined} Query value of special key, maybe undefined.
     */
    PARAM$PATH$QUERY: (key: string): string | undefined => {
      const queryObject = Router.format({ method: this.request.method as Method, path: this.request.url! }).queryObject;
      return queryObject && queryObject[key];
    },
    /**
     * Inject path variable.
     *
     * @returns {string} Path variable.
     */
    PARAM$PATH$VARIABLE: (key: string, route: Route): string => Router.format({ method: this.request.method as Method, path: this.request.url! }).pathArray![route.mapping.pathArray!.indexOf(`{{${key}}}`)],
    /**
     * Inject request body object, should await it to get result.
     *
     * @returns {Promise<any>} Request body promise object.
     */
    PARAM$REQUEST$BODY: (type?: string): Promise<any> => new Promise<any>((resolve, reject) => {
      let data: Buffer = Buffer.allocUnsafe(0);
      this.request.on('data', (chunk: Buffer) => data = Buffer.concat([data, chunk]));
      // TODO: JSON schema & validate
      this.request.on('end', () => {
        let result;
        switch (type || this.request.headers['content-type']) {
          case 'application/json': result = JSON.parse(data.toString()); break;
          case 'application/octet-stream': result = data; break;
          default: result = data.toString(); break;
        }
        resolve(result);
      });
      this.request.on('error', error => reject(error));
    }),
    /**
     * Inject special request header.
     *
     * @returns {string | string[] | undefined} Header value of special key, or undefined.
     */
    PARAM$REQUEST$HEADER: (key: string): string | string[] | undefined => this.request.headers[key.toLowerCase()]
  };

  /**
   * Parameter handle method.
   *
   * @param {Next<T>} next Next function, to go to next handler.
   * @returns {Promise<T>} Result for this handler.
   * @throws {HTTP404Exception} Not found exception.
   */
  async handle<T>(next: () => Promise<T>): Promise<T> {
    // TODO: refactor by content-type handler
    // content-type default to application/json
    this.response.setHeader('content-type', 'application/json');
    // if route exist
    if (this.route) {
      /** Parameter injection array. */
      const parameterInjections: ParamInjection[] | undefined = Reflect.getMetadata(MetadataKey.Parameter, this.route.target.prototype, this.route.name);
      /** Arguments, or undefined. */
      this.args = parameterInjections
        ? parameterInjections.map(v => this.parameterInjectors[v.type](v.value, this.route))
        : [];
      try {
        // await promise args, such as `body`
        for (let i = 0; i < this.args.length; i++) {
          if (this.args[i] instanceof Promise) {
            this.args[i] = await this.args[i];
          }
        }
      } catch (error) {
        // bad request cannot be parsed, throw 400
        throw new HTTP400Exception(`Bad request ${error}.`);
      }
      return next();
    }
    // throw 404 not found exception
    throw new HTTP404Exception(`Can't ${this.request.method} ${this.request.url!}`, { request: this.request, response: this.response });
  }

}
