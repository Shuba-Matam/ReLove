"use client";

import Link from "next/link";
import * as React from "react";
import { BoxSelect, Check, LoaderCircle, RefreshCw, Upload, X } from "lucide-react";
import { SellForm, type SellFormSeed } from "@/components/forms/sell-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { compressImage, formatBytes } from "@/lib/client/compress";
import { boxToPercent, containedImageRect, defaultItemBox, normalizeDraggedBox, percentBoundsToBox, pointToNormalizedBoxPoint, type NormalizedCutoutBox } from "@/lib/client/multi-cutout";
import { useSession } from "@/lib/client/session";

type CutoutResult = { operation_id: string; source_image_path: string; cutout_path: string; cutout_url: string; item_id: string };
type Candidate = {
  id: string;
  number: number;
  label: string;
  box: NormalizedCutoutBox;
  phase: "marked" | "pending" | "ready" | "error" | "published";
  error: string;
  errorCode: string;
  result: CutoutResult | null;
  previewLoaded: boolean;
  previewVersion: number;
  listingId: string | null;
};

const STOP_QUEUE_CODES = new Set(["AI_DISABLED", "AI_LIMIT", "AI_LIMIT_UNAVAILABLE", "AI_UNAVAILABLE", "AI_CREDENTIALS", "AI_PAYMENT", "AI_FORBIDDEN", "MULTI_CUTOUT_DISABLED"]);

function newCandidate(box: NormalizedCutoutBox, number: number): Candidate {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return { id: `item-${suffix.toLowerCase()}`, number, label: `Item ${number}`, box, phase: "marked", error: "", errorCode: "", result: null, previewLoaded: false, previewVersion: 0, listingId: null };
}

export function MultiCutoutSell() {
  const { session, loading: sessionLoading } = useSession();
  const canWrite = session?.mode === "live" && Boolean(session.user);
  const available = Boolean(session?.multi_cutout_enabled && session?.ai_features?.cutout);
  const [imagePath, setImagePath] = React.useState("");
  const [imageUrl, setImageUrl] = React.useState("");
  const [imageSize, setImageSize] = React.useState({ width: 0, height: 0 });
  const [surfaceSize, setSurfaceSize] = React.useState({ width: 0, height: 0 });
  const [uploading, setUploading] = React.useState(false);
  const [uploadInfo, setUploadInfo] = React.useState("");
  const [pageError, setPageError] = React.useState("");
  const [candidates, setCandidates] = React.useState<Candidate[]>([]);
  const [draftBox, setDraftBox] = React.useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null);
  const [activeCandidateId, setActiveCandidateId] = React.useState<string | null>(null);
  const [queueRunning, setQueueRunning] = React.useState(false);
  const surfaceRef = React.useRef<HTMLDivElement | null>(null);
  const sourceRef = React.useRef(imagePath);
  const uploadVersionRef = React.useRef(0);
  const generationVersionRef = React.useRef(0);
  const uploadAbortRef = React.useRef<AbortController | null>(null);
  const generationAbortRef = React.useRef<AbortController | null>(null);
  const mountedRef = React.useRef(true);
  const previousUserIdRef = React.useRef<string | null | undefined>(undefined);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadAbortRef.current?.abort();
      generationAbortRef.current?.abort();
    };
  }, []);
  React.useEffect(() => { sourceRef.current = imagePath; }, [imagePath]);
  React.useEffect(() => {
    const currentUserId = session?.user?.id ?? null;
    if (previousUserIdRef.current !== undefined && previousUserIdRef.current !== currentUserId) {
      generationVersionRef.current++;
      uploadVersionRef.current++;
      uploadAbortRef.current?.abort();
      generationAbortRef.current?.abort();
      sourceRef.current = "";
      setImagePath("");
      setImageUrl("");
      setImageSize({ width: 0, height: 0 });
      setCandidates([]);
      setActiveCandidateId(null);
      setDraftBox(null);
      setUploadInfo("");
      setPageError("");
      setUploading(false);
      setQueueRunning(false);
    }
    previousUserIdRef.current = currentUserId;
  }, [session?.user?.id]);
  React.useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSurfaceSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(surface);
    return () => observer.disconnect();
  }, [imageUrl]);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!canWrite) { setPageError("Sign in before uploading a photo."); return; }
    const uploadVersion = ++uploadVersionRef.current;
    generationVersionRef.current++;
    uploadAbortRef.current?.abort();
    generationAbortRef.current?.abort();
    const uploadController = new AbortController();
    uploadAbortRef.current = uploadController;
    setUploading(true);
    setPageError("");
    setUploadInfo(`Selected: ${formatBytes(file.size)}. Compressing…`);
    try {
      const compressed = await compressImage(file);
      if (!mountedRef.current || uploadVersionRef.current !== uploadVersion) return;
      setUploadInfo(`Compressed: ${formatBytes(compressed.size)} (from ${formatBytes(file.size)})`);
      const form = new FormData();
      form.append("file", compressed);
      const response = await fetch("/api/uploads", { method: "POST", body: form, signal: uploadController.signal });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Upload failed.");
      if (!mountedRef.current || uploadVersionRef.current !== uploadVersion) return;
      const nextPath = json.data?.path ?? json.path;
      sourceRef.current = nextPath;
      setImagePath(nextPath);
      setImageUrl(json.data?.url ?? json.url);
      setImageSize({ width: 0, height: 0 });
      setCandidates([]);
      setActiveCandidateId(null);
      setDraftBox(null);
      setUploadInfo("Photo uploaded. Mark up to 3 items before generating cutouts.");
    } catch (error) {
      if (mountedRef.current && uploadVersionRef.current === uploadVersion && !uploadController.signal.aborted) setPageError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      if (mountedRef.current && uploadVersionRef.current === uploadVersion) setUploading(false);
      if (uploadAbortRef.current === uploadController) uploadAbortRef.current = null;
      event.target.value = "";
    }
  }

  function pointFromEvent(event: React.PointerEvent) {
    const surface = surfaceRef.current;
    if (!surface || !imageSize.width || !imageSize.height) return null;
    const rect = surface.getBoundingClientRect();
    return pointToNormalizedBoxPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      containerLeft: rect.left,
      containerTop: rect.top,
      containerWidth: rect.width,
      containerHeight: rect.height,
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
    });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (!imagePath || candidates.length >= 3 || queueRunning) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraftBox({ start: point, end: point });
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!draftBox || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const point = pointFromEvent(event);
    if (point) setDraftBox((current) => current ? { ...current, end: point } : current);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (!draftBox) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const end = pointFromEvent(event) ?? draftBox.end;
    const box = normalizeDraggedBox(draftBox.start, end);
    setDraftBox(null);
    if (!box) { setPageError("Draw a larger box fully inside the photo."); return; }
    setPageError("");
    setCandidates((current) => {
      if (current.length >= 3) return current;
      const used = new Set(current.map((candidate) => candidate.number));
      const number = [1, 2, 3].find((value) => !used.has(value)) ?? current.length + 1;
      return [...current, newCandidate(box, number)];
    });
  }

  function updateCandidate(id: string, update: (candidate: Candidate) => Candidate) {
    setCandidates((current) => current.map((candidate) => candidate.id === id ? update(candidate) : candidate));
  }

  function addDefaultBox() {
    setCandidates((current) => {
      if (current.length >= 3 || queueRunning) return current;
      const used = new Set(current.map((candidate) => candidate.number));
      const number = [1, 2, 3].find((value) => !used.has(value)) ?? current.length + 1;
      return [...current, newCandidate(defaultItemBox(number), number)];
    });
    setPageError("");
  }

  async function generateCandidate(candidateId: string, version: number, snapshotPath: string, signal: AbortSignal): Promise<string | null> {
    const candidate = candidates.find((item) => item.id === candidateId);
    if (!candidate || candidate.phase === "ready" || candidate.phase === "published") return null;
    updateCandidate(candidateId, (item) => ({ ...item, phase: "pending", error: "", errorCode: "", previewLoaded: false, previewVersion: item.previewVersion + 1 }));
    try {
      const response = await fetch("/api/ai/cutout/item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_path: snapshotPath, item_id: candidate.id, box: candidate.box }),
        signal,
      });
      const json = await response.json();
      if (!response.ok) {
        const error = new Error(json?.error?.message ?? "Cutout unavailable.") as Error & { code?: string };
        error.code = json?.error?.code ?? "CUTOUT_FAILED";
        throw error;
      }
      const result = (json.data ?? json) as CutoutResult;
      if (!mountedRef.current || generationVersionRef.current !== version || sourceRef.current !== snapshotPath || signal.aborted || result.source_image_path !== snapshotPath || result.item_id !== candidate.id) return null;
      updateCandidate(candidateId, (item) => ({ ...item, phase: "ready", result, error: "", errorCode: "", previewLoaded: false, previewVersion: item.previewVersion + 1 }));
      return null;
    } catch (error) {
      if (!mountedRef.current || generationVersionRef.current !== version || sourceRef.current !== snapshotPath || signal.aborted) return null;
      const code = (error as Error & { code?: string }).code ?? "CUTOUT_FAILED";
      updateCandidate(candidateId, (item) => ({ ...item, phase: "error", error: error instanceof Error ? error.message : "Cutout unavailable.", errorCode: code }));
      return STOP_QUEUE_CODES.has(code) ? code : null;
    }
  }

  async function generateAll() {
    if (!available || !imagePath || queueRunning) return;
    const snapshotPath = imagePath;
    const version = ++generationVersionRef.current;
    generationAbortRef.current?.abort();
    const generationController = new AbortController();
    generationAbortRef.current = generationController;
    const pendingIds = candidates.filter((candidate) => candidate.phase === "marked" || candidate.phase === "error").map((candidate) => candidate.id);
    if (!pendingIds.length) { generationAbortRef.current = null; return; }
    setQueueRunning(true);
    setPageError("");
    for (let index = 0; index < pendingIds.length; index++) {
      if (!mountedRef.current || generationVersionRef.current !== version || sourceRef.current !== snapshotPath) break;
      const stopCode = await generateCandidate(pendingIds[index], version, snapshotPath, generationController.signal);
      if (stopCode) {
        const remaining = new Set(pendingIds.slice(index + 1));
        setCandidates((current) => current.map((candidate) => remaining.has(candidate.id) ? { ...candidate, phase: "error", errorCode: stopCode, error: "Not attempted because cutout access or budget became unavailable. Existing results were kept." } : candidate));
        break;
      }
    }
    if (mountedRef.current && generationVersionRef.current === version) setQueueRunning(false);
    if (generationAbortRef.current === generationController) generationAbortRef.current = null;
  }

  async function retryCandidate(id: string) {
    if (!available || !imagePath || queueRunning) return;
    const version = ++generationVersionRef.current;
    const snapshotPath = imagePath;
    generationAbortRef.current?.abort();
    const generationController = new AbortController();
    generationAbortRef.current = generationController;
    setQueueRunning(true);
    await generateCandidate(id, version, snapshotPath, generationController.signal);
    if (mountedRef.current && generationVersionRef.current === version) setQueueRunning(false);
    if (generationAbortRef.current === generationController) generationAbortRef.current = null;
  }

  const activeCandidate = candidates.find((candidate) => candidate.id === activeCandidateId) ?? null;
  const draftPercent = draftBox ? boxToPercent(normalizeDraggedBox(draftBox.start, draftBox.end) ?? { left: draftBox.start.x, top: draftBox.start.y, right: draftBox.start.x + 1, bottom: draftBox.start.y + 1 }) : null;
  const displayedImage = containedImageRect(surfaceSize.width, surfaceSize.height, imageSize.width, imageSize.height);

  return <div className="space-y-6">
    {!canWrite && <p role="status" className="rounded-xl bg-[#241712] p-3 text-sm text-[#bba995] ring-1 ring-[#4a3025]/60">{sessionLoading ? "Checking your session…" : "Sign in to upload and publish multiple items."}</p>}
    {!available && !sessionLoading && <p role="alert" className="rounded-xl bg-[#32171a] p-3 text-sm leading-5 text-[#f1c7bd] ring-1 ring-[#6b3434]">Multiple-item cutouts are currently off. The regular <Link className="underline underline-offset-4" href="/sell">single-item sell form</Link> is still available.</p>}

    <section className="space-y-4 rounded-[1.5rem] bg-[#241712] p-4 ring-1 ring-[#4a3025]/60 sm:p-5">
      <div><h2 className="text-base font-semibold text-[#f6ead8]">1. Upload one photo</h2><p className="mt-1 text-xs leading-5 text-[#bba995]">Upload once, then make a separate listing for each marked item.</p></div>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#1a100c] px-4 py-2 text-sm text-[#f6ead8] ring-1 ring-[#4a3025] hover:ring-[#ead7b7]">
        <Upload className="size-4" /> {uploading ? "Uploading…" : imagePath ? "Replace original" : "Choose photo"}
        <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} disabled={!canWrite || !available || uploading || queueRunning} />
      </label>
      {uploadInfo && <p role="status" className="text-xs text-[#bba995]">{uploadInfo}</p>}
      {pageError && <p role="alert" className="text-xs leading-5 text-amber-300">{pageError}</p>}
    </section>

    {imageUrl && <section className="space-y-4 rounded-[1.5rem] bg-[#241712] p-4 ring-1 ring-[#4a3025]/60 sm:p-5">
      <div><h2 className="text-base font-semibold text-[#f6ead8]">2. Mark up to 3 items</h2><p className="mt-1 text-xs leading-5 text-[#bba995]">Drag around an item, or add a box and edit its numbers.</p></div>
      <div ref={surfaceRef} className="relative aspect-[4/3] touch-none overflow-hidden rounded-2xl bg-[#1a100c] ring-1 ring-[#75513e] select-none" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => setDraftBox(null)} aria-label="Photo marking surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt="Uploaded photo for marking items" draggable={false} className="pointer-events-none h-full w-full object-contain" onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        {displayedImage && <div className="pointer-events-none absolute" style={{ left: displayedImage.left, top: displayedImage.top, width: displayedImage.width, height: displayedImage.height }}>
          {candidates.map((candidate) => { const box = boxToPercent(candidate.box); return <div key={candidate.id} className="absolute border-2 border-[#ead7b7] bg-[#ead7b7]/10" style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}><span className="absolute left-0 top-0 bg-[#ead7b7] px-1.5 py-0.5 text-[10px] font-semibold text-[#241712]">{candidate.number}</span></div>; })}
          {draftPercent && <div className="absolute border-2 border-dashed border-white bg-white/10" style={{ left: `${draftPercent.left}%`, top: `${draftPercent.top}%`, width: `${draftPercent.width}%`, height: `${draftPercent.height}%` }} />}
        </div>}
        {candidates.length === 0 && <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="rounded-full bg-black/65 px-3 py-2 text-xs text-white"><BoxSelect className="mr-1 inline size-4" /> Drag around an item</span></div>}
      </div>
      <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="secondary" size="sm" onClick={addDefaultBox} disabled={candidates.length >= 3 || queueRunning}><BoxSelect /> Add item box</Button><p className="text-xs text-[#bba995]">{candidates.length}/3 items marked.</p></div>
      <div className="grid gap-3 lg:grid-cols-3">{candidates.map((candidate) => {
        const percent = boxToPercent(candidate.box);
        return <article key={candidate.id} className="space-y-3 rounded-xl bg-[#1a100c] p-3 ring-1 ring-[#4a3025]/60">
          <div className="flex items-center gap-2"><Input aria-label={`Item ${candidate.number} label`} value={candidate.label} maxLength={40} onChange={(event) => updateCandidate(candidate.id, (item) => ({ ...item, label: event.target.value }))} className="h-8 bg-[#241712]" /><button type="button" aria-label={`Remove ${candidate.label || `item ${candidate.number}`}`} className="rounded-full p-1 text-[#bba995] hover:bg-[#241712] hover:text-white" disabled={queueRunning || candidate.phase === "published"} onClick={() => { setCandidates((current) => current.filter((item) => item.id !== candidate.id)); if (activeCandidateId === candidate.id) setActiveCandidateId(null); }}><X className="size-4" /></button></div>
          <fieldset className="grid grid-cols-2 gap-2"><legend className="col-span-2 text-[11px] text-[#bba995]">Accessible bounds (% of actual photo)</legend>{(["left", "top", "right", "bottom"] as const).map((edge) => <label key={edge} className="text-[10px] uppercase tracking-wide text-[#8f7d6d]">{edge}<Input type="number" min={0} max={100} step="0.1" value={(edge === "right" ? percent.left + percent.width : edge === "bottom" ? percent.top + percent.height : percent[edge]).toFixed(1)} onChange={(event) => {
            const values = { left: percent.left, top: percent.top, right: percent.left + percent.width, bottom: percent.top + percent.height, [edge]: Number(event.target.value) };
            const next = percentBoundsToBox(values);
            if (next) updateCandidate(candidate.id, (item) => ({ ...item, box: next, phase: item.phase === "published" ? item.phase : "marked", result: item.phase === "published" ? item.result : null, previewLoaded: false, previewVersion: item.previewVersion + 1, error: "", errorCode: "" }));
          }} disabled={queueRunning || candidate.phase === "published"} className="mt-1 h-8 bg-[#241712]" /></label>)}</fieldset>
          <Button type="button" variant="ghost" size="sm" disabled={queueRunning || candidate.phase === "published"} onClick={() => updateCandidate(candidate.id, (item) => ({ ...item, box: defaultItemBox(item.number), phase: "marked", result: null, previewLoaded: false, previewVersion: item.previewVersion + 1, error: "", errorCode: "" }))}>Reset bounds</Button>
        </article>;
      })}</div>
      <Button type="button" variant="primary" onClick={generateAll} disabled={!available || queueRunning || !candidates.some((candidate) => candidate.phase === "marked" || candidate.phase === "error")}>{queueRunning ? <><LoaderCircle className="animate-spin" /> Generating sequentially…</> : "Generate marked cutouts"}</Button>
      <p className="text-[11px] leading-5 text-[#bba995]">Each new cutout uses 1 AI try. A failed item retries only when you choose Retry.</p>
      <p className="text-[11px] font-medium leading-5 text-amber-300">Finish before leaving; unfinished work isn&apos;t saved.</p>
    </section>}

    {candidates.length > 0 && <section className="space-y-4 rounded-[1.5rem] bg-[#241712] p-4 ring-1 ring-[#4a3025]/60 sm:p-5">
      <div><h2 className="text-base font-semibold text-[#f6ead8]">3. Review and publish</h2><p className="mt-1 text-xs leading-5 text-[#bba995]">Publish one item, then continue with the next.</p></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{candidates.map((candidate) => <article key={candidate.id} className="min-w-0 space-y-3 rounded-xl bg-[#1a100c] p-3 ring-1 ring-[#4a3025]/60">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 flex-1 break-words font-medium text-[#f6ead8] [overflow-wrap:anywhere]">{candidate.label || "Untitled item"}</h3><span className="shrink-0 text-[10px] uppercase tracking-wide text-[#bba995]">{candidate.phase}</span></div>
        {candidate.phase === "pending" && <p role="status" className="flex items-center gap-2 text-xs text-[#bba995]"><LoaderCircle className="animate-spin" /> Creating cutout…</p>}
        {candidate.result && <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-[#241712] ring-1 ring-[#4a3025]"><>{!candidate.previewLoaded && <div className="absolute inset-0 grid place-items-center text-xs text-[#bba995]">Loading preview…</div>}</>{/* eslint-disable-next-line @next/next/no-img-element */}
          <img key={`${candidate.result.operation_id}:${candidate.previewVersion}`} src={candidate.result.cutout_url} alt={`${candidate.label} cutout preview`} className="relative h-full w-full object-contain" onLoad={() => updateCandidate(candidate.id, (item) => ({ ...item, previewLoaded: true }))} onError={() => updateCandidate(candidate.id, (item) => ({ ...item, previewLoaded: false, phase: "error", errorCode: "PREVIEW_LOAD", error: "The preview could not be loaded. Retry this item." }))} />
        </div>}
        {candidate.error && <p role="alert" className="text-xs leading-5 text-amber-300">{candidate.error}</p>}
        {candidate.phase === "error" && <Button type="button" variant="secondary" size="sm" disabled={queueRunning} onClick={() => retryCandidate(candidate.id)}><RefreshCw /> Retry this item</Button>}
        {candidate.phase === "ready" && <Button type="button" variant="primary" size="sm" disabled={!candidate.previewLoaded || queueRunning} onClick={() => setActiveCandidateId(candidate.id)}>Create listing</Button>}
        {candidate.phase === "published" && candidate.listingId && <p className="flex items-center gap-2 text-xs text-emerald-300"><Check className="size-4" /> Published. <Link href={`/listings/${candidate.listingId}`} className="underline underline-offset-4">View listing</Link></p>}
      </article>)}</div>
    </section>}

    {activeCandidate?.result && activeCandidate.previewLoaded && <section className="space-y-4 border-t border-[#4a3025]/60 pt-6">
      <div><h2 className="break-words text-lg font-semibold text-[#f6ead8] [overflow-wrap:anywhere]">Listing details for {activeCandidate.label}</h2><p className="mt-1 text-xs leading-5 text-[#bba995]">This is a fresh form for this item. Optional suggestions use its cutout.</p></div>
      <SellForm
        key={`${activeCandidate.id}:${activeCandidate.result.operation_id}`}
        initialData={{ image_path: imagePath, image_url: imageUrl, cutout: activeCandidate.result, photo_display_mode: "both", title: activeCandidate.label, suggestion_image_path: activeCandidate.result.cutout_path } satisfies SellFormSeed}
        lockPhoto
        preserveInitialPhoto
        onCancel={() => setActiveCandidateId(null)}
        onPublished={(listing) => {
          const listingId = typeof listing.id === "string" ? listing.id : null;
          updateCandidate(activeCandidate.id, (item) => ({ ...item, phase: "published", listingId }));
          setActiveCandidateId(null);
        }}
      />
    </section>}
  </div>;
}
