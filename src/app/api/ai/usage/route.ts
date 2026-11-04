import { readAiUsageSnapshot } from "@/lib/ai/usage";
import { requireUser } from "@/lib/server/auth";
import { ApiProblem, json, withApi } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = withApi(async () => {
  const { user } = await requireUser();
  try {
    return json(await readAiUsageSnapshot(user));
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    throw new ApiProblem(503, "AI_USAGE_UNAVAILABLE", "AI try availability is unavailable right now.");
  }
});
