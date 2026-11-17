import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One request the fake identity provider received (tests). */
export interface IdpRequest {
  method: string;
  path: string;
  /** The `application/x-www-form-urlencoded` body of a POST, decoded. */
  form: Record<string, string>;
}

/** What a fake IdP route answers: a JSON `body`, or `raw` text. */
export interface IdpAnswer {
  status?: number;
  body?: unknown;
  raw?: string;
}

export type IdpRoute = (request: IdpRequest) => IdpAnswer | Promise<IdpAnswer>;

/**
 * A fake OpenID provider on `http://127.0.0.1:<free port>` (loopback http is allowed for the IdP):
 * serves a discovery document naming its own issuer and endpoints (`/auth`, `/token`, `/device`),
 * records every request, and answers each path with a replaceable route. Unknown paths answer 404.
 */
export class FakeIdp {
  readonly requests: IdpRequest[] = [];
  private readonly routes = new Map<string, IdpRoute>();

  private constructor(
    private readonly server: Server,
    readonly issuer: string,
  ) {
    this.routes.set('/.well-known/openid-configuration', () => ({ body: this.metadata() }));
    server.on('request', (req, res) => {
      void this.answer(req).then(
        ({ status = 200, body, raw }) => {
          const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
          res.writeHead(status, { 'content-type': 'application/json' }).end(text);
        },
        (error: unknown) => res.writeHead(500).end(String(error)),
      );
    });
  }

  static async start(): Promise<FakeIdp> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return new FakeIdp(server, `http://127.0.0.1:${String(port)}`);
  }

  /** The discovery document this IdP serves by default. */
  metadata(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/auth`,
      token_endpoint: `${this.issuer}/token`,
      device_authorization_endpoint: `${this.issuer}/device`,
    };
  }

  on(path: string, route: IdpRoute): this {
    this.routes.set(path, route);
    return this;
  }

  /** The recorded requests to `path`. */
  to(path: string): IdpRequest[] {
    return this.requests.filter((r) => r.path === path);
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private async answer(req: IncomingMessage): Promise<IdpAnswer> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const url = new URL(req.url ?? '/', this.issuer);
    const request: IdpRequest = {
      method: req.method ?? '',
      path: url.pathname,
      form: Object.fromEntries(new URLSearchParams(text)),
    };
    this.requests.push(request);
    const route = this.routes.get(url.pathname);
    return route ? route(request) : { status: 404, body: { error: 'not_found' } };
  }
}

/**
 * Plays the browser coming back to the loopback redirect of an authorization URL: GETs its
 * `redirect_uri` with `extra` query parameters and (unless overridden) the request's `state`.
 */
export async function redirectBack(
  authUrl: string,
  extra: Record<string, string>,
  path?: string,
): Promise<{ status: number; text: string }> {
  const auth = new URL(authUrl);
  const target = new URL(auth.searchParams.get('redirect_uri') ?? '');
  if (path !== undefined) target.pathname = path;
  const state = auth.searchParams.get('state');
  if (state !== null) target.searchParams.set('state', state);
  for (const [key, value] of Object.entries(extra)) target.searchParams.set(key, value);
  const response = await fetch(target);
  return { status: response.status, text: await response.text() };
}
