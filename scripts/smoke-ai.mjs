// Explicit manual smoke test through the authenticated application route.
// Every provider attempt still passes the kill switch and database budget.
const origin = process.env.SMOKE_APP_ORIGIN || "http://localhost:3000";
const cookie = process.env.SMOKE_SESSION_COOKIE;
const imagePath = process.argv[2];
if (!cookie || !imagePath) {
  console.error("Set SMOKE_SESSION_COOKIE privately, then run npm run smoke:ai -- <owned-upload-path>. No credentials are printed.");
  process.exitCode = 1;
} else {
  const response = await fetch(new URL("/api/ai/draft", origin), {
    method: "POST", signal: AbortSignal.timeout(30000), redirect: "error",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ image_path: imagePath }),
  });
  const body = await response.json();
  // Do not print seller descriptions, image paths, session cookies, or provider keys.
  console.log(JSON.stringify({ status: response.status, ok: response.ok, suggested_fields: body.data?.suggested_fields ?? [], error: body.error?.code ?? null }));
  if (!response.ok) process.exitCode = 1;
}
