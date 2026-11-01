import { getCategories } from "@/lib/server/queries";
import { json, withApi } from "@/lib/server/http";
export const GET = withApi(async () => { const result = await getCategories(); return json(result.data, { mode: result.mode }); });
