"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SuggestionRow } from "@/components/forms/suggestion-row";
import { CATEGORIES, CONDITIONS, CONDITION_LABELS } from "@/lib/marketplace";
import { recordingToWav } from "@/lib/client/audio";
import { formatVoiceElapsed, VoiceRecorderController, type VoicePhase } from "@/lib/client/voice-recorder";
import { listingSchema } from "@/lib/validation";
import { priceWarning as validatePrice } from "@/lib/ai/rules";
import { compressImage, formatBytes } from "@/lib/client/compress";
import { cutoutPreviewIdentity, reconcileLoadedPreview } from "@/lib/client/cutout-preview";
import { isSuggestionApplied, suggestionDisplayValue, type SuggestionField } from "@/lib/client/suggestion-state";
import { useSession } from "@/lib/client/session";
import { Mic, Sparkles, Upload, X, AlertTriangle, LoaderCircle, Square } from "lucide-react";

type DraftSuggestion = {
  draft: { title?: string | null; category_slug?: string | null; description?: string | null; condition_hint?: string | null; brand?: string | null; edition?: string | null; tags?: string[] | null };
  suggested_fields: string[];
};

type CutoutPreview = { operation_id: string; source_image_path: string; cutout_path: string; cutout_url: string };

export function SellForm({ initialListing }: { initialListing?: Record<string, unknown> }) {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const isDemo = session?.mode === "demo";
  const canWrite = session?.mode === "live" && Boolean(session.user);
  const draftAvailable = session?.ai_features?.draft ?? session?.ai_enabled ?? false;
  const voiceAvailable = session?.ai_features?.transcribe ?? session?.ai_enabled ?? false;
  const anyAi = session?.ai_features ? (session.ai_features.draft || session.ai_features.transcribe || session.ai_features.cutout) : (session?.ai_enabled ?? false);
  const cutoutAvailable = session?.ai_features?.cutout ?? session?.ai_enabled ?? false;

  const [title, setTitle] = React.useState((initialListing?.title as string) ?? "");
  const [description, setDescription] = React.useState((initialListing?.description as string) ?? "");
  const [price, setPrice] = React.useState(String((initialListing?.price_inr as number) ?? ""));
  const [categoryId, setCategoryId] = React.useState((initialListing?.category_id as string) ?? "");
  const [condition, setCondition] = React.useState((initialListing?.condition as string) ?? "");
  const [block, setBlock] = React.useState((initialListing?.hostel_block as string) ?? session?.user?.hostel_block ?? "");
  const [tags, setTags] = React.useState<string[]>(Array.isArray(initialListing?.tags) ? (initialListing!.tags as string[]) : []);
  const [tagInput, setTagInput] = React.useState("");
  const [imagePath, setImagePath] = React.useState((initialListing?.image_path as string) ?? "");
  const [imageUrl, setImageUrl] = React.useState((initialListing?.image_url as string) ?? "");
  const initialCutout = initialListing?.cutout_path && initialListing?.cutout_url ? {
    operation_id: "",
    source_image_path: (initialListing.image_path as string),
    cutout_path: initialListing.cutout_path as string,
    cutout_url: initialListing.cutout_url as string,
  } : null;
  const [cutout, setCutout] = React.useState<CutoutPreview | null>(initialCutout);
  const [photoDisplayMode, setPhotoDisplayMode] = React.useState<"original" | "cutout" | "both">((initialListing?.photo_display_mode as "original" | "cutout" | "both") ?? (initialCutout ? "both" : "original"));
  const [cutoutPrompt, setCutoutPrompt] = React.useState("");
  const [cutoutLoading, setCutoutLoading] = React.useState(false);
  const [cutoutError, setCutoutError] = React.useState("");
  const [loadedPreviewIdentity, setLoadedPreviewIdentity] = React.useState<string | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);

  const [uploading, setUploading] = React.useState(false);
  const [uploadInfo, setUploadInfo] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const [transcript, setTranscript] = React.useState("");
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState("");
  const [suggestedFields, setSuggestedFields] = React.useState<string[]>([]);
  const [aiDraft, setAiDraft] = React.useState<DraftSuggestion["draft"] | null>(null);
  const [applyAnnouncement, setApplyAnnouncement] = React.useState("");

  const [voicePhase, setVoicePhase] = React.useState<VoicePhase>("idle");
  const [voiceElapsed, setVoiceElapsed] = React.useState(0);
  const [voiceLevel, setVoiceLevel] = React.useState(0);
  const [voiceAnalyserAvailable, setVoiceAnalyserAvailable] = React.useState(false);
  const voiceRecorderRef = React.useRef<VoiceRecorderController | null>(null);
  const imagePathRef = React.useRef(imagePath);

  const priceNum = Number(price);
  const priceWarning = price.trim() ? validatePrice(priceNum) : null;
  const previewIdentity = cutout ? cutoutPreviewIdentity(cutout) : null;
  const previewLoaded = previewIdentity !== null && loadedPreviewIdentity === previewIdentity;
  React.useEffect(() => { imagePathRef.current = imagePath; }, [imagePath]);
  React.useEffect(() => {
    const controller = new VoiceRecorderController({
      onPhaseChange: setVoicePhase,
      onElapsedChange: setVoiceElapsed,
      onLevelChange: setVoiceLevel,
      onAnalyserChange: setVoiceAnalyserAvailable,
      onError: setAiError,
      onRecording: async (blob) => {
        const wav = await recordingToWav(blob);
        const fd = new FormData();
        fd.append("file", wav);
        const res = await fetch("/api/ai/transcribe", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Transcription unavailable. Type your description instead.");
        const nextTranscript = json.data?.transcript ?? json.transcript ?? "";
        setTranscript((previous) => (previous ? `${previous}\n` : "") + nextTranscript);
      },
    });
    voiceRecorderRef.current = controller;
    return () => {
      voiceRecorderRef.current = null;
      controller.dispose();
    };
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!canWrite) { setError("Sign in before adding a photo."); return; }
    setError("");
    setUploadInfo(`Selected: ${formatBytes(f.size)}. Compressing…`);
    setUploading(true);
    try {
      const compressed = await compressImage(f);
      setUploadInfo(`Compressed: ${formatBytes(compressed.size)} (from ${formatBytes(f.size)})`);
      const fd = new FormData();
      fd.append("file", compressed);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Upload failed");
      if(imagePath && imagePath !== initialListing?.image_path) void fetch("/api/uploads", { method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({path:imagePath}) }).catch(() => undefined);
      const nextPath = json.data.path ?? json.path;
      setAiDraft(null); setSuggestedFields([]); setApplyAnnouncement(""); setConfirmed(false); setCutout(null); setPhotoDisplayMode("original"); setCutoutError(""); setLoadedPreviewIdentity(null);
      imagePathRef.current = nextPath;
      setImagePath(nextPath);
      setImageUrl(json.data.url ?? json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleCutout() {
    if (!imagePath || !canWrite || !cutoutAvailable) { setCutoutError("Upload a photo and enter a short item name first."); return; }
    const prompt = cutoutPrompt.trim();
    if (!prompt) { setCutoutError("Enter a short item name, such as “desk chair” or “bicycle”."); return; }
    const requestedPath = imagePath;
    setCutoutLoading(true); setCutoutError("");
    try {
      const response = await fetch("/api/ai/cutout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_path: requestedPath, prompt }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Cutout unavailable. Your original is unchanged.");
      const result = (json.data ?? json) as CutoutPreview;
      if (imagePathRef.current !== requestedPath || result.source_image_path !== requestedPath) return;
      setLoadedPreviewIdentity((current) => reconcileLoadedPreview(current, result));
      setCutout(result); setPhotoDisplayMode("both"); setConfirmed(false);
    } catch (err) {
      if (imagePathRef.current === requestedPath) setCutoutError(err instanceof Error ? err.message : "Cutout unavailable. Your original is unchanged.");
    } finally { setCutoutLoading(false); }
  }

  async function handleAiDraft() {
    if (!canWrite || !draftAvailable) { setAiError(session?.ai_enabled === false || !anyAi ? "AI assistance is off. You can fill in the listing yourself." : "AI suggestions are not configured. Fill fields manually."); return; }
    setAiLoading(true);
    setAiError("");
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_path: imagePath || undefined, transcript: transcript || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? json?.message ?? "AI suggestions are unavailable. Fill fields manually.");
      const data = (json.data ?? json) as DraftSuggestion;
      setAiDraft(data.draft);
      setSuggestedFields((data.suggested_fields ?? []).filter((field) => ["title", "description", "category_slug", "tags"].includes(field)));
      setApplyAnnouncement("");
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI assistance is unavailable. Continue manually.");
    } finally {
      setAiLoading(false);
    }
  }

  const currentCategorySlug = CATEGORIES.find((category) => category.id === categoryId)?.slug ?? "";

  function suggestionIsApplied(field: SuggestionField) {
    return aiDraft ? isSuggestionApplied(field, aiDraft, { title, description, categorySlug: currentCategorySlug, tags }) : false;
  }

  function applySuggestion(field: SuggestionField) {
    if (!aiDraft) return;
    setConfirmed(false);
    if (field === "title" && aiDraft.title) setTitle(aiDraft.title);
    if (field === "description" && aiDraft.description) setDescription(aiDraft.description);
    if (field === "category_slug" && aiDraft.category_slug) {
      const cat = CATEGORIES.find((c) => c.slug === aiDraft.category_slug);
      if (cat) setCategoryId(cat.id);
    }
    if (field === "tags" && aiDraft.tags) setTags(aiDraft.tags.slice(0, 12));
    const label = field === "category_slug" ? "Category" : field.charAt(0).toUpperCase() + field.slice(1);
    setApplyAnnouncement(`${label} suggestion applied.`);
  }

  async function toggleRecording() {
    if (voicePhase === "recording") {
      voiceRecorderRef.current?.stop();
      return;
    }
    if (voicePhase !== "idle") return;
    if (!canWrite || !voiceAvailable) { setAiError(session?.ai_enabled === false || !anyAi ? "Voice assistance is off. Type your description below." : "Voice transcription is not configured. Type your description below."); return; }
    setAiError("");
    await voiceRecorderRef.current?.start();
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canWrite) {
      setError("Sign in to publish a listing when the marketplace opens.");
      return;
    }
    setError("");
    setFieldErrors({});
    if (photoDisplayMode !== "original" && (!cutout || !previewLoaded)) { setError("Wait for the generated preview to load, or choose Original only."); return; }
    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim(),
      price_inr: Number(price),
      category_id: categoryId,
      condition,
      hostel_block: block.trim(),
      image_path: imagePath,
      photo_display_mode: photoDisplayMode,
      cutout: cutout?.operation_id ? { operation_id: cutout.operation_id, cutout_path: cutout.cutout_path } : (initialListing?.cutout_path === cutout?.cutout_path ? undefined : null),
      tags,
      seller_confirmed: confirmed,
    };
    const validated = listingSchema.safeParse(payload);
    if(!validated.success) { setFieldErrors(Object.fromEntries(validated.error.issues.map((issue) => [issue.path.join("."),issue.message]))); setError("Check the highlighted fields before publishing."); return; }
    setSubmitting(true);
    try {
      const isEdit = Boolean(initialListing?.id);
      const url = isEdit ? `/api/listings/${initialListing!.id as string}` : "/api/listings";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(validated.data) });
      const json = await res.json();
      if (!res.ok) {
        if (json?.error?.fields) setFieldErrors(Object.fromEntries(Object.entries(json.error.fields as Record<string,string[]>).map(([field,messages]) => [field,messages.join(" ")])));
        throw new Error(json?.error?.message ?? "Failed to save listing");
      }
      const id = json.data?.id ?? (initialListing?.id as string);
      router.push(`/listings/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  const voiceBusy = voicePhase !== "idle";
  const recordingBars = [0.48, 0.8, 1, 0.68, 0.9];

  return (
    <form onSubmit={onSubmit} onChangeCapture={(event) => { if(!(event.target instanceof HTMLInputElement && event.target.type === "checkbox")) setConfirmed(false); }} className="min-w-0 max-w-full space-y-6">
      {!canWrite && !isDemo && <p role="status" className="rounded-xl bg-[#241712] p-3 text-sm leading-5 text-[#bba995] ring-1 ring-[#4a3025]/60">{sessionLoading ? "Checking your session…" : "Sign in to add a photo and publish. You can look through the form below."}</p>}
      {isDemo && (
        <div className="rounded-xl bg-[#32171a] p-3 text-sm leading-5 text-[#f1c7bd] ring-1 ring-[#6b3434]">
          Sample preview. Publishing and messages will be available once the marketplace is connected.
        </div>
      )}

      <div className="grid min-w-0 max-w-full items-start gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.35fr)] xl:gap-8">
        <section className="min-w-0 max-w-full space-y-5 rounded-[1.5rem] bg-[#241712] p-4 ring-1 ring-[#4a3025]/60 lg:sticky lg:top-24 lg:p-5">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-[#f6ead8]">Photo workspace</h2>
            <p className="mt-1 text-xs leading-5 text-[#bba995]">Add one clear photo. A background cutout is optional.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="image">Photo *</Label>
            {imageUrl ? (
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-[#1a100c] ring-1 ring-[#4a3025]/70">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageUrl} alt="Listing photo preview" className="h-full w-full object-contain" />
                <button type="button" onClick={() => { imagePathRef.current = ""; setImageUrl(""); setImagePath(""); setUploadInfo(""); setConfirmed(false); setAiDraft(null); setSuggestedFields([]); setApplyAnnouncement(""); setCutout(null); setPhotoDisplayMode("original"); setCutoutError(""); setLoadedPreviewIdentity(null); }} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Remove image"><X className="size-4" /></button>
              </div>
            ) : (
              <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl bg-[#1a100c] px-6 text-center ring-1 ring-dashed ring-[#75513e] transition hover:bg-[#21140f] hover:ring-[#ead7b7] focus-within:ring-[#ead7b7]">
                <Upload className="size-6 text-[#ead7b7]" />
                <span className="text-sm font-medium text-[#f6ead8]">{uploading ? "Compressing…" : "Choose photo"}</span>
                <span className="text-xs text-[#bba995]">JPEG, PNG or WebP. Auto-compressed.</span>
                <input type="file" id="image" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleFile} disabled={uploading || !canWrite} />
              </label>
            )}
            {imageUrl && (
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#1a100c] px-3 py-1.5 text-xs font-medium text-[#bba995] ring-1 ring-[#4a3025]/60 hover:text-[#f6ead8] hover:ring-[#ead7b7]">
                <Upload className="size-3.5" /> Replace photo
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleFile} disabled={uploading || !canWrite} />
              </label>
            )}
            {uploadInfo && <p className="text-xs leading-5 text-[#bba995]" role="status" aria-live="polite">{uploadInfo}</p>}
            {fieldErrors.image_path && <p className="text-xs text-red-400" role="alert">{fieldErrors.image_path}</p>}
            {!imagePath && !uploading && <p className="text-xs text-[#bba995]">A photo is required to publish.</p>}
          </div>

          <div className="space-y-3 border-t border-[#4a3025]/60 pt-5">
            <div><h3 className="text-sm font-medium text-[#f6ead8]">Optional background cutout</h3><p className="mt-1 text-xs leading-5 text-[#bba995]">Enter a short item name, then inspect the generated preview.</p></div>
            <div className="flex min-w-0 max-w-full flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
              <Input value={cutoutPrompt} onChange={(event) => setCutoutPrompt(event.target.value)} maxLength={80} placeholder="Short item name, e.g. desk chair" className="bg-[#1a100c]" />
              <Button type="button" variant="secondary" size="sm" onClick={handleCutout} disabled={!imagePath || !canWrite || !cutoutAvailable || cutoutLoading}>{cutoutLoading ? "Creating…" : cutout ? "Regenerate" : "Create cutout"}</Button>
            </div>
            {cutoutLoading && <p role="status" className="text-xs text-[#bba995]">Preparing the preview… This counted attempt is never published automatically.</p>}
            {cutoutError && <p role="alert" className="text-xs leading-5 text-amber-300">{cutoutError}</p>}
            {cutout && <div className="space-y-3">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[#1a100c] ring-1 ring-[#75513e]">
                {!previewLoaded && <div className="absolute inset-0 grid place-items-center text-xs text-[#bba995]">Loading generated preview…</div>}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img key={previewIdentity} src={cutout.cutout_url} alt="Generated cutout preview" className="relative h-full w-full object-contain" onLoad={() => { if (previewIdentity) setLoadedPreviewIdentity(previewIdentity); }} onError={() => { setLoadedPreviewIdentity(null); setPhotoDisplayMode("original"); setCutoutError("The generated preview could not be loaded. Use the uploaded photo or generate again."); }} />
              </div>
              <fieldset className="space-y-2"><legend className="text-xs font-medium text-[#f6ead8]">Display on listing</legend><div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">{([['original','Photo'],['cutout','Cutout'],['both','Both']] as const).map(([value,label]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#1a100c] px-3 py-2 text-xs text-[#e1d2c0] ring-1 ring-[#4a3025]/60 has-[:checked]:ring-[#e6c79c]"><input type="radio" name="photo-display-mode" value={value} checked={photoDisplayMode===value} disabled={value !== "original" && !previewLoaded} onChange={() => { setPhotoDisplayMode(value); setConfirmed(false); }} />{label}</label>)}</div></fieldset>
            </div>}
            {!cutoutAvailable && canWrite && <p className="text-xs text-[#bba995]">Cutout generation is currently unavailable. You can still publish the uploaded photo.</p>}
          </div>
        </section>

        <div className="min-w-0 max-w-full space-y-6">
          <section className="min-w-0 max-w-full rounded-[1.5rem] bg-[#241712] p-4 ring-1 ring-[#4a3025]/60 sm:p-5">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-[#bba995]"><Sparkles className="size-3.5 text-[#ead7b7]" /> Optional AI help</div>
          <p className="mt-1 text-xs leading-5 text-[#bba995]">Generate optional suggestions, apply them one at a time, and review before publishing. Each generation or voice request counts toward daily limits.</p>
          {!anyAi && canWrite && !sessionLoading && <p className="mt-2 text-xs leading-5 text-amber-300/90">AI is off or not configured. Fill fields manually below.</p>}
          {anyAi && !draftAvailable && canWrite && <p className="mt-2 text-xs leading-5 text-amber-300/80">AI suggestions are unavailable with the current provider. Voice may still work; otherwise fill manually.</p>}
          {anyAi && draftAvailable && !voiceAvailable && canWrite && <p className="mt-2 text-xs leading-5 text-amber-300/80">Voice transcription unavailable with current provider. Type description directly.</p>}
          <div className="mt-3 space-y-2.5">
            <div>
              <Label htmlFor="transcript" className="normal-case tracking-normal">Describe the item</Label>
              <div className="mt-1.5 flex min-w-0 max-w-full gap-2">
                <Textarea id="transcript" placeholder="e.g. Used engineering mechanics book, 3rd edition…" value={transcript} onChange={(e)=>setTranscript(e.target.value)} className="min-w-0 flex-1 bg-[#1a100c]" rows={2} />
                <Button type="button" variant={voicePhase === "recording" ? "destructive" : "secondary"} size="icon" onClick={toggleRecording} disabled={!canWrite || voicePhase === "requesting" || voicePhase === "transcribing" || aiLoading || !voiceAvailable} aria-label={voicePhase === "recording" ? "Stop recording" : voicePhase === "requesting" ? "Requesting microphone access" : voicePhase === "transcribing" ? "Transcribing recording" : "Start voice recording"} title={voicePhase === "recording" ? "Stop" : voiceAvailable ? "Record voice" : "Voice unavailable"} className="shrink-0">
                  {voicePhase === "recording" ? <Square className="fill-current" /> : voicePhase === "requesting" || voicePhase === "transcribing" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : <Mic />}
                </Button>
              </div>
              {voiceBusy && (
                <div className="mt-2 rounded-xl bg-[#1a100c] p-3 ring-1 ring-[#4a3025]/60" role="status" aria-live="polite">
                  {voicePhase === "requesting" && <div className="flex items-center gap-2 text-xs text-[#e1d2c0]"><LoaderCircle className="size-4 animate-spin text-[#ead7b7] motion-reduce:animate-none" /> Requesting microphone access…</div>}
                  {voicePhase === "recording" && (
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                      <span className="relative flex size-3 shrink-0" aria-hidden="true"><span className="absolute inline-flex size-full animate-ping rounded-full bg-red-400 opacity-60 motion-reduce:animate-none" /><span className="relative inline-flex size-3 rounded-full bg-red-400" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3 text-xs"><span className="font-medium text-[#f6ead8]">Recording</span><span className="font-mono tabular-nums text-[#bba995]">{formatVoiceElapsed(voiceElapsed)} / 0:59</span></div>
                        <div className="mt-2 flex h-5 items-center gap-1" aria-hidden="true">
                          {recordingBars.map((weight, index) => <span key={weight} className={voiceAnalyserAvailable ? "w-1.5 rounded-full bg-[#ead7b7] transition-[height] duration-75 motion-reduce:transition-none" : "voice-fallback-bar w-1.5 rounded-full bg-[#ead7b7] motion-reduce:animate-none"} style={voiceAnalyserAvailable ? { height: `${Math.max(4, Math.round((0.2 + voiceLevel * weight) * 20))}px` } : { height: `${8 + index * 2}px`, animationDelay: `${index * 90}ms` }} />)}
                        </div>
                        <p className="mt-1 text-[11px] text-[#8f7d6d]">{voiceAnalyserAvailable ? "Live microphone level" : "Recording in progress"}</p>
                      </div>
                      <Button type="button" variant="destructive" size="sm" onClick={toggleRecording} className="min-h-9 shrink-0"><Square className="fill-current" /> Stop</Button>
                    </div>
                  )}
                  {voicePhase === "transcribing" && <div className="flex items-center gap-2 text-xs text-[#e1d2c0]"><LoaderCircle className="size-4 animate-spin text-[#ead7b7] motion-reduce:animate-none" /> Processing and transcribing recording…</div>}
                </div>
              )}
              {!voiceAvailable && canWrite && <p className="mt-1 text-[11px] text-[#bba995]">Voice is off. Type your description instead.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="primary" size="sm" onClick={handleAiDraft} disabled={aiLoading || voiceBusy || !canWrite || !draftAvailable || (!imagePath && !transcript)}>{aiLoading ? "Generating…" : "Generate suggestions"}</Button>
              {aiLoading && <span className="text-xs text-[#bba995]" role="status">Working… (counts toward limit)</span>}
              {!aiLoading && aiDraft && suggestedFields.length > 0 && <span className="text-xs text-[#bba995]">Suggestions ready. Review before publishing.</span>}
            </div>
            {aiError && <p className="text-xs leading-5 text-amber-300" role="alert">{aiError}</p>}
            {aiDraft && suggestedFields.length > 0 && (
              <div className="min-w-0 max-w-full space-y-2 rounded-lg bg-[#1a100c] p-2.5 ring-1 ring-[#4a3025]/50">
                <p className="text-xs font-medium text-[#f6ead8]">Suggestions</p>
                {suggestedFields.map((field) => {
                  const suggestionField = field as SuggestionField;
                  const applied = suggestionIsApplied(suggestionField);
                  const label = field === "category_slug" ? "Category" : field.charAt(0).toUpperCase() + field.slice(1);
                  return <SuggestionRow key={field} label={label} value={suggestionDisplayValue(suggestionField, aiDraft)} applied={applied} onApply={() => applySuggestion(suggestionField)} />;
                })}
                <p className="text-[11px] leading-4 text-[#bba995]">Manual entry remains available at all times.</p>
              </div>
            )}
            <p className="sr-only" role="status" aria-live="polite">{applyAnnouncement}</p>
            {!draftAvailable && canWrite && anyAi && <p className="text-xs text-[#bba995]">Suggestions are unavailable with the current configuration. Enter details manually.</p>}
            {!anyAi && canWrite && <p className="text-xs text-[#bba995]">AI is off. Fill fields manually below.</p>}
            <p className="text-[10px] leading-4 text-[#8f7d6d]">AI use is limited. Manual listing remains available at all times.</p>
          </div>
          </section>

          <section className="min-w-0 max-w-full space-y-4 rounded-[1.5rem] bg-[#241712] p-4 ring-1 ring-[#4a3025]/60 sm:p-5">
            <div><h2 className="text-base font-semibold tracking-tight text-[#f6ead8]">Listing details</h2><p className="mt-1 text-xs leading-5 text-[#bba995]">Add accurate details buyers can scan quickly.</p></div>
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input id="title" value={title} onChange={(e)=>setTitle(e.target.value)} maxLength={100} required className="mt-1.5 bg-[#1a100c]" placeholder="e.g. Engineering Mechanics by R.S. Khurmi" />
            {suggestedFields.includes("title") && <Badge variant="outline" className="mt-1.5">AI suggestion available</Badge>}
            {fieldErrors.title && <p className="mt-1 text-xs text-red-400" role="alert">{String(fieldErrors.title)}</p>}
          </div>

          <div>
            <Label htmlFor="description">Description *</Label>
            <Textarea id="description" value={description} onChange={(e)=>setDescription(e.target.value)} maxLength={3000} required className="mt-1.5 bg-[#1a100c]" placeholder="Condition, usage, defects, pickup details…" rows={5} />
            <p className="mt-1 text-xs text-[#bba995]">{description.length}/3000</p>
            {fieldErrors.description && <p className="text-xs text-red-400" role="alert">{String(fieldErrors.description)}</p>}
          </div>

          <div className="grid min-w-0 max-w-full gap-3.5 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor="price">Price (₹) *</Label>
              <Input id="price" type="number" step={1} inputMode="numeric" min={0} max={10000000} value={price} onChange={(e)=>setPrice(e.target.value)} required className="mt-1.5 bg-[#1a100c]" placeholder="500" />
              {priceWarning && <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-300"><AlertTriangle className="size-3" />{priceWarning}</p>}
              {fieldErrors.price_inr && <p className="mt-1 text-xs text-red-400" role="alert">{String(fieldErrors.price_inr)}</p>}
            </div>
            <div className="min-w-0">
              <Label htmlFor="category">Category *</Label>
              <Select id="category" required value={categoryId} onChange={(e)=>setCategoryId(e.target.value)} className="mt-1.5 bg-[#1a100c]">
                <option value="" disabled>Choose a category</option>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="condition">Condition *</Label>
              <Select id="condition" required value={condition} onChange={(e)=>setCondition(e.target.value)} className="mt-1.5 bg-[#1a100c]">
                <option value="" disabled>Choose a condition</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
              </Select>
            </div>
            <div className="min-w-0">
              <Label htmlFor="block">Hostel Block / Apartment Name *</Label>
              <Input id="block" value={block} onChange={(e)=>setBlock(e.target.value)} maxLength={60} required className="mt-1.5 bg-[#1a100c]" placeholder="e.g. A Block or Sunrise Apartments" />
              {fieldErrors.hostel_block && <p className="mt-1 text-xs text-red-400" role="alert">{String(fieldErrors.hostel_block)}</p>}
            </div>
          </div>

          <div>
            <Label htmlFor="tags">Tags (optional, max 12)</Label>
            <div className="mt-1.5 grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input id="tags" value={tagInput} onChange={(e)=>setTagInput(e.target.value)} placeholder="Add tag and press Enter" maxLength={32} onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); if(tagInput.trim() && tags.length<12){ setTags([...tags, tagInput.trim()]); setTagInput(""); setConfirmed(false); }}}} className="min-w-0 bg-[#1a100c]" />
              <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={()=>{ if(tagInput.trim() && tags.length<12){ setTags([...tags, tagInput.trim()]); setTagInput(""); setConfirmed(false); }}} disabled={tags.length>=12}>Add</Button>
            </div>
            {tags.length>0 && <div className="mt-2 flex min-w-0 max-w-full flex-wrap gap-1.5">{tags.map((t,i)=><span key={i} className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-xl bg-[#241712] px-2.5 py-1 text-xs text-[#f6ead8] ring-1 ring-[#4a3025]/40"><span className="min-w-0 break-all">{t}</span><button type="button" onClick={()=>{ setTags(tags.filter((_,idx)=>idx!==i)); setConfirmed(false); }} aria-label={`Remove ${t}`} className="shrink-0 rounded-full p-0.5 hover:bg-[#ead7b7] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"><X className="size-3" /></button></span>)}</div>}
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-[#1a100c] p-3 text-sm leading-5 ring-1 ring-[#4a3025]/60 has-[:checked]:ring-[#ead7b7]">
            <input type="checkbox" checked={confirmed} onChange={(e)=>setConfirmed(e.target.checked)} required className="mt-0.5 size-4 accent-[#ead7b7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#e6c79c]" />
            <span className="text-[#bba995]">I confirm the listing details and selected photo are accurate.</span>
          </label>

          {error && <p role="alert" className="rounded-xl bg-[#32171a] p-3 text-sm leading-5 text-[#f1c7bd] ring-1 ring-[#6b3434]">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" variant="primary" disabled={submitting || !canWrite || !imagePath || !confirmed || uploading}>{submitting ? "Saving…" : initialListing ? "Save changes" : "Publish listing"}</Button>
            <Button type="button" variant="ghost" onClick={()=>router.back()}>Cancel</Button>
          </div>
          </section>
        </div>
      </div>
    </form>
  );
}
