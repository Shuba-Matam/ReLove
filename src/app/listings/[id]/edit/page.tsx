import { notFound, redirect } from "next/navigation";
import { getListing } from "@/lib/server/queries";
import { getOptionalUser } from "@/lib/server/auth";
import { ApiProblem } from "@/lib/server/http";
import { SellForm } from "@/components/forms/sell-form";
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params; const { user } = await getOptionalUser();
 if (!user) redirect(`/login?next=${encodeURIComponent(`/listings/${id}/edit`)}`);
 let result; try { result = await getListing(id); } catch(error) { if(error instanceof ApiProblem && error.status === 404) notFound(); throw error; }
 if(result.data.seller_id !== user.id) notFound();
 return <div><h1 className="mb-5 text-2xl font-semibold">Edit listing</h1><SellForm initialListing={result.data as unknown as Record<string, unknown>} /></div>;
}
