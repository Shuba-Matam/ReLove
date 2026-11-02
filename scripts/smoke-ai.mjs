// Explicit manual smoke test through the authenticated application route.
// Every provider attempt still passes the kill switch and atomic database budget.
// No paid calls without owner explicitly running this script with their own session cookie.
// Do not copy secrets; SMOKE_SESSION_COOKIE stays in your shell only.
const origin = process.env.SMOKE_APP_ORIGIN || "http://localhost:3000";
const cookie = process.env.SMOKE_SESSION_COOKIE;
const args = process.argv.slice(2);
const transcriptFlag = args[0] === "--transcript";
const arg = transcriptFlag ? args[1] : args[0];
if (!cookie || !arg?.trim() || args.length !== (transcriptFlag ? 2 : 1) || (transcriptFlag && arg.length > 3000)) {
  console.error("Set SMOKE_SESSION_COOKIE privately, then run:");
  console.error("  npm run smoke:ai -- <owned-upload-path>");
  console.error("  npm run smoke:ai -- --transcript \"a short description\"");
  console.error("No credentials, image paths, or transcript content are printed in output.");
  process.exitCode = 1;
} else {
  const body = transcriptFlag ? { transcript: arg } : { image_path: arg };
  // Basic client-side guard; server still validates strictly.
  if (!transcriptFlag && !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/i.test(arg)) {
    console.error("image_path must match <user-id>/<uuid>.jpg (your own upload).");
    process.exitCode = 1;
  } else {
    const response = await fetch(new URL("/api/ai/draft", origin), {
      method: "POST", signal: AbortSignal.timeout(30000), redirect: "error",
      headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let parsed;
    try { parsed = await response.json(); } catch { parsed = {}; }
    // Do not print seller descriptions, image paths, session cookies, or provider keys.
    console.log(JSON.stringify({ status: response.status, ok: response.ok, suggested_fields: parsed.data?.suggested_fields ?? [], error: parsed.error?.code ?? null }));
    if (!response.ok) process.exitCode = 1;
  }
}
