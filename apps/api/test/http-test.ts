import { PassThrough } from 'node:stream';
import { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { INestApplication } from '@nestjs/common';

export interface InProcessResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  text: string;
}

class RequestChain {
  private reqHeaders: Record<string, string> = {};
  private payload: unknown = undefined;

  constructor(
    private readonly app: INestApplication,
    private readonly method: string,
    private readonly url: string,
  ) {}

  set(keyOrObj: string | Record<string, string>, val?: string): this {
    if (typeof keyOrObj === 'string') {
      if (val !== undefined) this.reqHeaders[keyOrObj.toLowerCase()] = val;
    } else {
      for (const [k, v] of Object.entries(keyOrObj)) {
        this.reqHeaders[k.toLowerCase()] = v;
      }
    }
    return this;
  }

  send(body: unknown): this {
    this.payload = body;
    return this;
  }

  async expect(expectedStatus: number): Promise<InProcessResponse> {
    const res = await this.execute();
    if (res.status !== expectedStatus) {
      throw new Error(`Expected status ${expectedStatus} but got ${res.status}: ${res.text}`);
    }
    return res;
  }

  then<TResult1 = InProcessResponse, TResult2 = never>(
    onfulfilled?: ((value: InProcessResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private execute(): Promise<InProcessResponse> {
    const handler = this.app.getHttpAdapter().getInstance() as (
      req: IncomingMessage,
      res: ServerResponse,
    ) => void;

    return new Promise<InProcessResponse>((resolve, reject) => {
      const socket = new PassThrough() as unknown as Socket & { remoteAddress?: string };
      socket.remoteAddress = '127.0.0.1';

      const req = new IncomingMessage(socket);
      req.method = this.method;
      req.url = this.url;

      const rawBody =
        this.payload !== undefined
          ? typeof this.payload === 'string'
            ? Buffer.from(this.payload)
            : Buffer.from(JSON.stringify(this.payload))
          : null;

      const headers: Record<string, string> = { ...this.reqHeaders };
      if (rawBody && !headers['content-type']) {
        headers['content-type'] = 'application/json';
      }
      req.headers = headers;

      if (this.payload !== undefined && typeof this.payload === 'object') {
        (req as unknown as { body: unknown }).body = this.payload;
        (req as unknown as { _body: boolean })._body = true;
      }

      const res = new ServerResponse(req);
      res.assignSocket(socket);

      const chunks: Buffer[] = [];
      const origWrite = res.write.bind(res);
      const origEnd = res.end.bind(res);

      res.write = ((chunk: unknown, encodingOrCb?: unknown, cb?: unknown) => {
        if (chunk) {
          chunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(
                  String(chunk),
                  typeof encodingOrCb === 'string' ? (encodingOrCb as BufferEncoding) : 'utf8',
                ),
          );
        }
        return origWrite(chunk as any, encodingOrCb as any, cb as any);
      }) as typeof res.write;

      res.end = ((chunk?: unknown, encodingOrCb?: unknown, cb?: unknown) => {
        if (chunk && typeof chunk !== 'function') {
          chunks.push(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(
                  String(chunk),
                  typeof encodingOrCb === 'string' ? (encodingOrCb as BufferEncoding) : 'utf8',
                ),
          );
        }
        const ret = origEnd(chunk as any, encodingOrCb as any, cb as any);
        const fullBuf = Buffer.concat(chunks);
        const fullStr = fullBuf.toString('utf8');
        const headerIdx = fullStr.indexOf('\r\n\r\n');
        const text = headerIdx >= 0 ? fullStr.slice(headerIdx + 4) : fullStr;

        const outHeaders: Record<string, string | string[] | undefined> = {};
        for (const [k, v] of Object.entries(res.getHeaders())) {
          outHeaders[k.toLowerCase()] = Array.isArray(v)
            ? v.map(String)
            : v !== undefined
              ? String(v)
              : undefined;
        }

        let parsedBody: unknown = text;
        const ct = String(outHeaders['content-type'] ?? '');
        if (ct.includes('json') && text.trim().length > 0) {
          try {
            parsedBody = JSON.parse(text);
          } catch {
            parsedBody = text;
          }
        }

        resolve({
          status: res.statusCode,
          headers: outHeaders,
          body: parsedBody,
          text,
        });
        return ret;
      }) as typeof res.end;

      res.on('error', reject);

      handler(req, res);

      process.nextTick(() => {
        if (rawBody) req.push(rawBody);
        req.push(null);
      });
    });
  }
}

export function httpTest(app: INestApplication) {
  return {
    get: (url: string) => new RequestChain(app, 'GET', url),
    post: (url: string) => new RequestChain(app, 'POST', url),
    put: (url: string) => new RequestChain(app, 'PUT', url),
    patch: (url: string) => new RequestChain(app, 'PATCH', url),
    delete: (url: string) => new RequestChain(app, 'DELETE', url),
  };
}
