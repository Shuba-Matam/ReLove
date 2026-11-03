"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES, CONDITIONS, CONDITION_LABELS } from "@/lib/marketplace";
import { recordingToWav } from "@/lib/client/audio";
import { listingSchema } from "@/lib/validation";
import { priceWarning as validatePrice } from "@/lib/ai/rules";
import { compressImage, formatBytes } from "@/lib/client/compress";
import { useSession } from "@/lib/client/session";
import { Mic, Sparkles, Upload, X, AlertTriangle } from "lucide-react";

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
  const [previewLoaded, setPreviewLoaded] = React.useState(false);
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

  const [recording, setRecording] = React.useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const recordingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const mounted = React.useRef(true);
  const imagePathRef = React.useRef(imagePath);
  const chunksRef = React.useRef<Blob[]>([]);

  const priceNum = Number(price);
  const priceWarning = price.trim() ? validatePrice(priceNum) : null;
  React.useEffect(() => { imagePathRef.current = imagePath; }, [imagePath]);
  React.useEffect(() => { mounted.current=true; return () => { mounted.current=false; if(recordingTimer.current) clearTimeout(recordingTimer.current); if(mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop(); streamRef.current?.getTracks().forEach((track) => track.stop()); }; },[]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!canWrite) { setError("Sign in before adding a photo."); return; }
    setError("");
    setUploadInfo(`Original: ${formatBytes(f.size)} — compressing…`);
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
      setAiDraft(null); setSuggestedFields([]); setConfirmed(false); setCutout(null); setPhotoDisplayMode("original"); setCutoutError(""); setPreviewLoaded(false);
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
    setCutoutLoading(true); setCutoutError(""); setPreviewLoaded(false);
    try {
      const response = await fetch("/api/ai/cutout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_path: requestedPath, prompt }) });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "Cutout unavailable. Your original is unchanged.");
      const result = (json.data ?? json) as CutoutPreview;
      if (imagePathRef.current !== requestedPath || result.source_image_path !== requestedPath) return;
      setCutout(result); setPhotoDisplayMode("both"); setConfirmed(false);
    } catch (err) {
      if (imagePathRef.current === requestedPath) setCutoutError(err instanceof Error ? err.message : "Cutout unavailable. Your original is unchanged.");
    } finally { setCutoutLoading(false); }
  }

  async function handleAiDraft() {
    if (!canWrite || !draftAvailable) { setAiError(session?.ai_enabled === false || !anyAi ? "AI assistance is off. You can fill in the listing yourself." : "Draft generation is not configured. Fill fields manually."); return; }
    setAiLoading(true);
    setAiError("");
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image_path: imagePath || undefined, transcript: transcript || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? json?.message ?? "AI draft unavailable. Fill fields manually.");
      const data = (json.data ?? json) as DraftSuggestion;
      setAiDraft(data.draft);
      setSuggestedFields((data.suggested_fields ?? []).filter((field) => ["title", "description", "category_slug", "tags"].includes(field)));
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI assistance unavailable — continue manually.");
    } finally {
      setAiLoading(false);
    }
  }

  function applySuggestion(field: string) {
    if (!aiDraft) return;
    setConfirmed(false);
    if (field === "title" && aiDraft.title) setTitle(aiDraft.title);
    if (field === "description" && aiDraft.description) setDescription(aiDraft.description);
    if (field === "category_slug" && aiDraft.category_slug) {
      const cat = CATEGORIES.find((c) => c.slug === aiDraft.category_slug);
      if (cat) setCategoryId(cat.id);
    }
    if (field === "tags" && aiDraft.tags) setTags(aiDraft.tags.slice(0, 12));
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    if (!canWrite || !voiceAvailable) { setAiError(session?.ai_enabled === false || !anyAi ? "Voice assistance is off. Type your description below." : "Voice transcription is not configured. Type your description below."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const supported = ["audio/webm;codecs=opus","audio/mp4","audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const mr = new MediaRecorder(stream, supported ? { mimeType:supported } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      mr.onstop = async () => {
        if(recordingTimer.current) clearTimeout(recordingTimer.current);
        const blob = new Blob(chunksRef.current, { type: mr.mimeType });
        stream.getTracks().forEach((t) => t.stop());
        if(!mounted.current) return;
        setRecording(false);
        setAiLoading(true);
        try {
          const wav = await recordingToWav(blob);
          const fd = new FormData(); fd.append("file", wav);
          const res = await fetch("/api/ai/transcribe", { method: "POST", body: fd });
          const json = await res.json();
          if (res.ok) setTranscript((prev) => (prev ? prev + "\n" : "") + (json.data?.transcript ?? json.transcript ?? ""));
          else setAiError(json?.error?.message ?? "Transcription unavailable — type your description instead.");
        } catch {
          setAiError("Microphone transcription unavailable — type your description instead.");
        } finally { if(mounted.current) setAiLoading(false); }
      };
      mr.start();
      recordingTimer.current = setTimeout(() => { if(mr.state === "recording") mr.stop(); },59000);
      mediaRecorderRef.current = mr;
      setRecording(true);
      setAiError("");
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setAiError("Microphone access denied or unavailable — type your description instead.");
    }
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

  return (
    <form onSubmit={onSubmit} onChangeCapture={(event) => { if(!(event.target instanceof HTMLInputElement && event.target.type === "checkbox")) setConfirmed(false); }} className="space-y-6">
      {!canWrite && !isDemo && <p role="status" className="rounded-xl bg-[#01071d] p-3 text-sm leading-5 text-[#9AA4B8] ring-1 ring-[#021640]/60">{sessionLoading ? "Checking your session…" : "Sign in to add photos and publish. You can look through the form below."}</p>}
      {isDemo && (
        <div className="rounded-xl bg-[#220815] p-3 text-sm leading-5 text-[#f5c6d8] ring-1 ring-[#4a102f]">
          Sample preview — publishing and messages will be available once the marketplace is connected.
        </div>
      )}

      <div className="space-y-6">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-[#F5F5F7]">{initialListing ? "Edit listing" : "List an item"}</h2>
          <p className="mt-1 text-xs leading-5 text-[#9AA4B8]">A clear photo first. Your original stays visible alongside any optional cutout.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="image">Photo *</Label>
          {imageUrl ? (
            <div className="relative w-full max-w-sm overflow-hidden rounded-xl ring-1 ring-[#021640]/60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Listing preview — original photo" className="h-auto w-full object-cover" />
              <button type="button" onClick={() => { imagePathRef.current = ""; setImageUrl(""); setImagePath(""); setUploadInfo(""); setConfirmed(false); setAiDraft(null); setSuggestedFields([]); setCutout(null); setPhotoDisplayMode("original"); setCutoutError(""); setPreviewLoaded(false); }} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white backdrop-blur focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Remove image"><X className="size-4" /></button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-[#020102] px-6 py-10 text-center ring-1 ring-dashed ring-[#021640] transition hover:ring-[#03245e] focus-within:ring-[#03245e]">
              <Upload className="size-5 text-[#9AA4B8]" />
              <span className="text-sm font-medium text-[#F5F5F7]">{uploading ? "Compressing…" : "Choose photo"}</span>
              <span className="text-xs text-[#9AA4B8]">JPEG, PNG or WebP — auto-compressed</span>
              <input type="file" id="image" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleFile} disabled={uploading || !canWrite} />
            </label>
          )}
          {imageUrl && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#020102] px-3 py-1.5 text-xs font-medium text-[#9AA4B8] ring-1 ring-[#021640]/60 hover:text-[#F5F5F7] hover:ring-[#03245e]">
              <Upload className="size-3.5" /> Replace photo
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleFile} disabled={uploading || !canWrite} />
            </label>
          )}
          {uploadInfo && <p className="text-xs leading-5 text-[#9AA4B8]" role="status" aria-live="polite">{uploadInfo}</p>}
          {fieldErrors.image_path && <p className="text-xs text-red-400" role="alert">{fieldErrors.image_path}</p>}
          {!imagePath && !uploading && <p className="text-xs text-[#9AA4B8]">Photo required. Original remains the source of truth.</p>}
        </div>

        <div className="space-y-3 rounded-xl bg-[#01071d] p-3.5 ring-1 ring-[#021640]/50">
          <div><h3 className="text-sm font-medium text-[#F5F5F7]">Optional background cutout</h3><p className="mt-1 text-xs leading-5 text-[#9AA4B8]">Create and inspect it before publishing. One clear item only; your original upload is always preserved.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={cutoutPrompt} onChange={(event) => setCutoutPrompt(event.target.value)} maxLength={80} placeholder="Short item name, e.g. desk chair" className="bg-[#020102]" />
            <Button type="button" variant="secondary" size="sm" onClick={handleCutout} disabled={!imagePath || !canWrite || !cutoutAvailable || cutoutLoading}>{cutoutLoading ? "Creating…" : cutout ? "Regenerate cutout" : "Create cutout"}</Button>
          </div>
          {cutoutLoading && <p role="status" className="text-xs text-[#9AA4B8]">Finding one clear item and preparing your preview… This counted attempt is never published automatically.</p>}
          {cutoutError && <p role="alert" className="text-xs leading-5 text-amber-300">{cutoutError}</p>}
          {cutout && <div className="space-y-3">
            <div className="relative aspect-[4/3] w-full max-w-sm overflow-hidden rounded-xl bg-[#020102] ring-1 ring-[#03245e]/70">
              {!previewLoaded && <div className="absolute inset-0 grid place-items-center text-xs text-[#9AA4B8]">Loading generated preview…</div>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cutout.cutout_url} alt="Generated cutout preview" className="relative h-full w-full object-contain" onLoad={() => setPreviewLoaded(true)} onError={() => { setPreviewLoaded(false); setPhotoDisplayMode("original"); setCutoutError("The generated preview could not be loaded. Use the original or generate again."); }} />
            </div>
            <fieldset className="space-y-2"><legend className="text-xs font-medium text-[#F5F5F7]">Display on listing</legend><div className="grid gap-2 sm:grid-cols-3">{([['original','Original only'],['cutout','Cutout only'],['both','Both']] as const).map(([value,label]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#020102] px-3 py-2 text-xs text-[#cbd5e1] ring-1 ring-[#021640]/60 has-[:checked]:ring-[#60a5fa]"><input type="radio" name="photo-display-mode" value={value} checked={photoDisplayMode===value} disabled={value !== "original" && !previewLoaded} onChange={() => { setPhotoDisplayMode(value); setConfirmed(false); }} />{label}</label>)}</div></fieldset>
          </div>}
          {!cutoutAvailable && canWrite && <p className="text-xs text-[#9AA4B8]">Cutout generation is currently unavailable. Original-only publishing still works.</p>}
        </div>

        <div className="rounded-xl bg-[#01071d] p-3.5 ring-1 ring-[#021640]/50">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-[#9AA4B8]"><Sparkles className="size-3.5 text-[#82b7ff]" /> Optional AI help</div>
          <p className="mt-1 text-xs leading-5 text-[#9AA4B8]">Never auto-publishes. Apply suggestions one by one and verify. Drafts and voice happen before Publish; each regenerate or retry counts against daily limits.</p>
          <p className="mt-1 text-[11px] leading-4 text-[#9AA4B8]">Original is truth; seller confirms. Uncertain brand/edition/condition remain blank; AI never sets price.</p>
          {!anyAi && canWrite && !sessionLoading && <p className="mt-2 text-xs leading-5 text-amber-300/90">AI is off or not configured — fill fields manually below.</p>}
          {anyAi && !draftAvailable && canWrite && <p className="mt-2 text-xs leading-5 text-amber-300/80">Draft generation unavailable with current provider. Voice may still work; otherwise fill manually.</p>}
          {anyAi && draftAvailable && !voiceAvailable && canWrite && <p className="mt-2 text-xs leading-5 text-amber-300/80">Voice transcription unavailable with current provider. Type description directly.</p>}
          <div className="mt-3 space-y-2.5">
            <div>
              <Label htmlFor="transcript" className="normal-case tracking-normal">Describe the item (for AI draft)</Label>
              <div className="mt-1.5 flex gap-2">
                <Textarea id="transcript" placeholder="e.g. Used engineering mechanics book, 3rd edition…" value={transcript} onChange={(e)=>setTranscript(e.target.value)} className="flex-1 bg-[#020102]" rows={2} />
                <Button type="button" variant="secondary" size="icon" onClick={toggleRecording} disabled={!canWrite || (!recording && aiLoading) || !voiceAvailable} aria-label={recording ? "Stop recording" : "Start voice recording"} title={recording ? "Stop" : voiceAvailable ? "Record voice" : "Voice unavailable"} className="shrink-0">
                  <Mic className={recording ? "text-red-400 animate-pulse" : ""} />
                </Button>
              </div>
              {!voiceAvailable && canWrite && <p className="mt-1 text-[11px] text-[#9AA4B8]">Voice off — type your description. Each recording is a counted AI call if enabled.</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="primary" size="sm" onClick={handleAiDraft} disabled={aiLoading || !canWrite || !draftAvailable || (!imagePath && !transcript)}>{aiLoading ? "Generating…" : "Generate draft"}</Button>
              {aiLoading && <span className="text-xs text-[#9AA4B8]" role="status">Working… (counts toward limit)</span>}
              {!aiLoading && aiDraft && suggestedFields.length > 0 && <span className="text-xs text-[#9AA4B8]">Suggestions ready — confirm before publishing</span>}
            </div>
            {aiError && <p className="text-xs leading-5 text-amber-300" role="alert">{aiError}</p>}
            {aiDraft && suggestedFields.length > 0 && (
              <div className="space-y-2 rounded-lg bg-[#020102] p-2.5 ring-1 ring-[#021640]/50">
                <p className="text-xs font-medium text-[#F5F5F7]">Suggestions — tap Apply to use:</p>
                {suggestedFields.map((f) => (
                  <div key={f} className="flex items-center justify-between gap-2 rounded-full bg-[#01071d] px-3 py-2 text-xs ring-1 ring-[#021640]/40">
                    <span className="min-w-0 flex-1 truncate text-[#9AA4B8]">{f}: <span className="text-[#F5F5F7]">{String((aiDraft as Record<string, unknown>)[f] ?? aiDraft[f as keyof typeof aiDraft] ?? "")}</span></span>
                    <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => applySuggestion(f)}>Apply</Button>
                  </div>
                ))}
                <p className="text-[11px] leading-4 text-[#9AA4B8]">Manual entry always works if AI is unavailable. Original photo is source of truth.</p>
              </div>
            )}
            {!draftAvailable && canWrite && anyAi && <p className="text-xs text-[#9AA4B8]">Drafts unavailable with current config — enter title/description manually.</p>}
            {!anyAi && canWrite && <p className="text-xs text-[#9AA4B8]">AI is off — fill fields manually below.</p>}
            <p className="text-[10px] leading-4 text-[#6B7280]">AI use is limited. Manual listing remains available at all times.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label htmlFor="title">Title *</Label>
            <Input id="title" value={title} onChange={(e)=>setTitle(e.target.value)} maxLength={100} required className="mt-1.5 bg-[#020102]" placeholder="e.g. Engineering Mechanics by R.S. Khurmi" />
            {suggestedFields.includes("title") && <Badge variant="outline" className="mt-1.5">AI suggested — confirm</Badge>}
            {fieldErrors.title && <p className="mt-1 text-xs text-red-400" role="alert">{String(fieldErrors.title)}</p>}
          </div>

          <div>
            <Label htmlFor="description">Description *</Label>
            <Textarea id="description" value={description} onChange={(e)=>setDescription(e.target.value)} maxLength={3000} required className="mt-1.5 bg-[#020102]" placeholder="Condition, usage, defects, pickup details…" rows={5} />
            <p className="mt-1 text-xs text-[#9AA4B8]">{description.length}/3000</p>
            {fieldErrors.description && <p className="text-xs text-red-400" role="alert">{String(fieldErrors.description)}</p>}
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <div>
              <Label htmlFor="price">Price (₹) *</Label>
              <Input id="price" type="number" step={1} inputMode="numeric" min={0} max={10000000} value={price} onChange={(e)=>setPrice(e.target.value)} required className="mt-1.5 bg-[#020102]" placeholder="500" />
              {priceWarning && <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-300"><AlertTriangle className="size-3" />{priceWarning}</p>}
              {fieldErrors.price_inr && <p className="mt-1 text-xs text-red-400" role="alert">{String(fieldErrors.price_inr)}</p>}
            </div>
            <div>
              <Label htmlFor="category">Category *</Label>
              <Select id="category" required value={categoryId} onChange={(e)=>setCategoryId(e.target.value)} className="mt-1.5 bg-[#020102]">
                <option value="" disabled>Choose a category</option>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="condition">Condition *</Label>
              <Select id="condition" required value={condition} onChange={(e)=>setCondition(e.target.value)} className="mt-1.5 bg-[#020102]">
                <option value="" disabled>Choose a condition</option>
                {CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABELS[c]}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="block">Hostel block *</Label>
              <Input id="block" value={block} onChange={(e)=>setBlock(e.target.value)} maxLength={60} required className="mt-1.5 bg-[#020102]" placeholder="E.g. A Block, GH-2" />
              {fieldErrors.hostel_block && <p className="mt-1 text-xs text-red-400" role="alert">{String(fieldErrors.hostel_block)}</p>}
            </div>
          </div>

          <div>
            <Label htmlFor="tags">Tags (optional, max 12)</Label>
            <div className="mt-1.5 flex gap-2">
              <Input id="tags" value={tagInput} onChange={(e)=>setTagInput(e.target.value)} placeholder="Add tag and press Enter" maxLength={32} onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); if(tagInput.trim() && tags.length<12){ setTags([...tags, tagInput.trim()]); setTagInput(""); setConfirmed(false); }}}} className="bg-[#020102]" />
              <Button type="button" variant="secondary" size="sm" onClick={()=>{ if(tagInput.trim() && tags.length<12){ setTags([...tags, tagInput.trim()]); setTagInput(""); setConfirmed(false); }}} disabled={tags.length>=12}>Add</Button>
            </div>
            {tags.length>0 && <div className="mt-2 flex flex-wrap gap-1.5">{tags.map((t,i)=><span key={i} className="inline-flex items-center gap-1 rounded-full bg-[#01071d] px-2.5 py-1 text-xs text-[#F5F5F7] ring-1 ring-[#021640]/40">{t}<button type="button" onClick={()=>{ setTags(tags.filter((_,idx)=>idx!==i)); setConfirmed(false); }} aria-label={`Remove ${t}`} className="rounded-full p-0.5 hover:bg-[#03245e] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"><X className="size-3" /></button></span>)}</div>}
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-[#020102] p-3 text-sm leading-5 ring-1 ring-[#021640]/60 has-[:checked]:ring-[#03245e]">
            <input type="checkbox" checked={confirmed} onChange={(e)=>setConfirmed(e.target.checked)} required className="mt-0.5 size-4 accent-[#03245e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa]" />
            <span className="text-[#9AA4B8]">I confirm details are accurate. AI suggestions are verified. The original photo is the source of truth.</span>
          </label>

          {error && <p role="alert" className="rounded-xl bg-[#220815] p-3 text-sm leading-5 text-[#f5c6d8] ring-1 ring-[#4a102f]">{error}</p>}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" variant="primary" disabled={submitting || !canWrite || !imagePath || !confirmed || uploading}>{submitting ? "Saving…" : initialListing ? "Save changes" : "Publish listing"}</Button>
            <Button type="button" variant="ghost" onClick={()=>router.back()}>Cancel</Button>
          </div>
        </div>
      </div>
    </form>
  );
}
