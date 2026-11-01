import { notFound } from "next/navigation";
import { getListing } from "@/lib/server/queries";
import { ApiProblem } from "@/lib/server/http";
import { ListingDetailClient } from "./detail-client";
export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params;
 let result;
 try { result = await getListing(id); } catch (error) { if (error instanceof ApiProblem && error.status === 404) notFound(); throw error; }
 return <ListingDetailClient listing={result.data} mode={result.mode} />;
}
