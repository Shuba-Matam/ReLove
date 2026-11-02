import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync(new URL("../scripts/smoke-ai.mjs", import.meta.url), "utf8");

async function runSmoke(args: string[]) {
  const fetch = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({ data: { suggested_fields: ["title"] } }) }));
  const process = { argv: ["node", "smoke-ai.mjs", ...args], env: { SMOKE_SESSION_COOKIE: "test-cookie" }, exitCode: undefined as number | undefined };
  const console = { log: vi.fn(), error: vi.fn() };
  await runInNewContext(`(async () => { ${script} })()`, { process, fetch, console, URL, AbortSignal });
  return { fetch, process, console };
}

describe("AI smoke script", () => {
  it("sends the transcript value rather than the option name", async () => {
    const result = await runSmoke(["--transcript", "a chair"]);
    expect(result.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ body: JSON.stringify({ transcript: "a chair" }) }));
    expect(JSON.stringify(result.console.log.mock.calls)).not.toContain("a chair");
    expect(JSON.stringify(result.console.log.mock.calls)).not.toContain("test-cookie");
  });

  it("rejects missing transcript values before making a request", async () => {
    const result = await runSmoke(["--transcript"]);
    expect(result.fetch).not.toHaveBeenCalled();
    expect(result.process.exitCode).toBe(1);
  });

  it("keeps the owned-image path invocation working", async () => {
    const image_path = "11111111-1111-4111-8111-111111111111/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg";
    const result = await runSmoke([image_path]);
    expect(result.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ body: JSON.stringify({ image_path }) }));
  });
});
