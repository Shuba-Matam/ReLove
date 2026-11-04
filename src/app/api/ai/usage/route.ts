import { readAiUsageSnapshot } from "@/lib/ai/usage";
import { requireUser } from "@/lib/server/auth";
import { ApiProblem, json, withApi } from "@/lib/server/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const featureSchema = z.enum(["draft", "transcribe", "cutout"]);

export const GET = withApi(async (request: Request) => {
  const { user } = await requireUser();
  const parsedFeature = featureSchema.safeParse(new URL(request.url).searchParams.get("feature") ?? "draft");
  if (!parsedFeature.success) throw new ApiProblem(400, "AI_FEATURE_INVALID", "Choose a supported AI feature.");
  try {
    return json(await readAiUsageSnapshot(user, parsedFeature.data));
  } catch (error) {
    if (error instanceof ApiProblem) throw error;
    throw new ApiProblem(503, "AI_USAGE_UNAVAILABLE", "AI try availability is unavailable right now.");
  }
});
