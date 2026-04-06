import type { Env, KVPayload } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/rpi") {
      const payload = await env.MAXPREPS_RPI.get("payload", "json") as KVPayload | null;
      if (!payload) {
        return new Response("RPI not yet computed", { status: 503 });
      }
      return Response.json(payload.result, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
