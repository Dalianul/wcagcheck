// Cloudflare Workers runtime globals. Declared locally so the editor stops
// flagging them without pulling in a dependency (this project has none).
declare class HTMLRewriter {
  on(selector: string, handlers: Record<string, unknown>): HTMLRewriter;
  transform(response: Response): Response;
}
