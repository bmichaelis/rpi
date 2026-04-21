import type { Env, KVPayload } from "./types";

const FOCUS_SLUGS: Record<string, string> = {
  "rpi.kindacoach.com": "ut/orem/timpanogos-timberwolves",
  "rpi.oremsoccer.com": "ut/orem/orem-tigers",
};
const DEFAULT_FOCUS = "ut/orem/timpanogos-timberwolves";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/config") {
      const focusSlug = FOCUS_SLUGS[url.hostname] ?? DEFAULT_FOCUS;
      return Response.json({ focusSlug }, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    if (url.pathname === "/api/schedule") {
      const payload = await env.MAXPREPS_RPI.get("payload", "json") as KVPayload | null;
      if (!payload) return new Response("Not ready", { status: 503 });
      const team = url.searchParams.get("team");
      if (!team) return new Response("team param required", { status: 400 });
      const sched = payload.scheduleCache[team] ?? null;
      if (!sched) return new Response("Team not found", { status: 404 });
      return Response.json(sched, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (url.pathname === "/api/rpi") {
      const payload = await env.MAXPREPS_RPI.get("payload", "json") as KVPayload | null;
      if (!payload) {
        return new Response("RPI not yet computed", { status: 503 });
      }
      const team = url.searchParams.get("team");
      const data = team ? payload.results[team] ?? null : payload.results;
      if (data === null) {
        return new Response("Team not found", { status: 404 });
      }
      return Response.json(data, {
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
