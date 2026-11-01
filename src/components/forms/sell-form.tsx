"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

export function SellForm({ initialListing }: { initialListing?: Record<string, unknown> }) {
  const router = useRouter();
  const { session, loading: sessionLoading } = useSession();
  const isDemo = session?.mode === "demo";
  const canWrite = session?.mode === "live" && Boolean(session.user);

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
  const [confirmed, setConfirmed] = React.useState(false);

  const [uploading, setUploading] = React.useState(false);
  const [uploadInfo, setUploadInfo] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  // AI state
  const [transcript, setTranscript] = React.useState("");
  const [aiLoading, setAiLoading] = React.useState(false);
  const [aiError, setAiError] = React.useState("");
  const [suggestedFields, setSuggestedFields] = React.useState<string[]>([]);
  const [aiDraft, setAiDraft] = React.useState<DraftSuggestion["draft"] | null>(null);

  // mic
  const [recording, setRecording] = React.useState(false);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const recordingTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const mounted = React.useRef(true);
  const chunksRef = React.useRef<Blob[]>([]);

  const priceNum = Number(price);
  const priceWarning = price.trim() ? validatePrice(priceNum) : null;
  const priceZeroWarning = null;
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
      setAiDraft(null); setSuggestedFields([]); setConfirmed(false);
      setImagePath(json.data.path ?? json.path);
      setImageUrl(json.data.url ?? json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleAiDraft() {
    if (!canWrite || !session?.ai_enabled) { setAiError("AI assistance is off. You can fill in the listing yourself."); return; }
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
      setSuggestedFields(data.suggested_fields ?? Object.keys(data.draft).filter((k) => (data.draft as Record<string, unknown>)[k] != null));
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
    if (field === "condition_hint" && aiDraft.condition_hint) setCondition(aiDraft.condition_hint);
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
    if (!canWrite || !session?.ai_enabled) { setAiError("Voice assistance is off. Type your description below."); return; }
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
    const payload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim(),
      price_inr: Number(price),
      category_id: categoryId,
      condition,
      hostel_block: block.trim(),
      image_path: imagePath,
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
      {!canWrite && !isDemo && <p role="status" className="rounded-2xl border border-[#021640] bg-[#01071d] p-4 text-sm leading-5 text-[#9AA4B8]">{sessionLoading ? "Checking your session…" : "Sign in to add photos and publish. You can look through the form below."}</p>}
      {isDemo && (
        <div className="rounded-2xl border border-[#4a102f] bg-[#220815] p-4 text-sm leading-5 text-[#f5c6d8]">
          Sample preview — publishing and messages will be available once the marketplace is connected.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{initialListing ? "Edit listing" : "List an item"}</CardTitle>
          <CardDescription>Choose a clear photo of your item. Your original photo stays visible alongside any optional cutout.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Image upload */}
            <div>
              <Label htmlFor="image">Photo *</Label>
              <div className="mt-1.5 flex flex-col gap-3">
                {imageUrl && (
                  <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-[#021640]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl} alt="Listing preview" className="h-auto w-full object-cover" />
                    <button type="button" onClick={() => { setImageUrl(""); setImagePath(""); }} className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white backdrop-blur" aria-label="Remove image"><X className="size-4" /></button>
                  </div>
                )}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-dashed border-[#03245e] bg-[#020102] px-4 py-2.5 text-sm font-medium text-[#9AA4B8] transition hover:border-[#04307d] hover:text-[#F5F5F7]">
                  <Upload className="size-4" /> {uploading ? "Compressing…" : "Choose photo"}
                  <input type="file" id="image" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={handleFile} disabled={uploading || !canWrite} />
                </label>
                {uploadInfo && <p className="text-xs leading-5 text-[#9AA4B8]">{uploadInfo}</p>}
                {fieldErrors.image_path && <p className="text-xs text-red-400">{fieldErrors.image_path}</p>}
              </div>
            </div>

            {/* AI assist - optional only */}
            <div className="rounded-2xl border border-[#021640] bg-[#020102] p-4">
              <div className="flex items-center gap-2 text-[13px] font-medium text-[#F5F5F7]"><Sparkles className="size-4 text-[#60a5fa]" /> Optional AI assistance</div>
              <p className="mt-1 text-xs leading-5 text-[#9AA4B8]">AI never auto-publishes. Suggestions are marked and require your confirmation. Manual entry works without AI.</p>
              <div className="mt-3 space-y-3">
                <div>
                  <Label htmlFor="transcript">Describe the item (for AI draft)</Label>
                  <div className="mt-1.5 flex gap-2">
                    <Textarea id="transcript" placeholder="e.g. Used engineering mechanics book, 3rd edition, some highlighting…" value={transcript} onChange={(e)=>setTranscript(e.target.value)} className="flex-1 bg-[#01071d]" rows={2} />
                    <Button type="button" variant="secondary" size="icon" onClick={toggleRecording} disabled={!canWrite || (!recording && aiLoading) || !session?.ai_enabled} aria-label={recording ? "Stop recording" : "Start voice recording"} title={recording ? "Stop" : "Record voice"}>
                      <Mic className={recording ? "text-red-400 animate-pulse" : ""} />
                    </Button>
                  </div>
                  <p className="mt-1.5 text-xs leading-5 text-[#9AA4B8]">Voice recording uses your microphone and falls back to typed text if unavailable.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={handleAiDraft} disabled={aiLoading || !canWrite || !session?.ai_enabled || (!imagePath && !transcript)}>{aiLoading ? "Generating…" : "Generate draft"}</Button>
                  {aiDraft && suggestedFields.length > 0 && <span className="self-center text-xs text-[#9AA4B8]">Suggestions ready — review below</span>}
                </div>
                {aiError && <p className="text-xs leading-5 text-amber-300">{aiError}</p>}
                {aiDraft && (
                  <div className="rounded-xl border border-[#03245e] bg-[#01071d] p-3 space-y-2">
                    <p className="text-xs font-semibold text-[#F5F5F7]">AI suggestions (click to apply):</p>
                    {suggestedFields.map((f) => (
                      <div key={f} className="flex items-center justify-between gap-2 rounded-xl border border-[#021640] bg-[#020102] px-3 py-2 text-xs">
                        <span className="text-[#9AA4B8]">{f}: <span className="text-[#F5F5F7]">{String((aiDraft as Record<string, unknown>)[f] ?? aiDraft[f as keyof typeof aiDraft] ?? "")}</span></span>
                        <Button type="button" variant="ghost" size="sm" onClick={() => applySuggestion(f)}>Apply</Button>
                      </div>
                    ))}
                    <p className="text-[11px] leading-4 text-[#9AA4B8]">Verify every field before publishing. If suggestions are unavailable, you can write every detail yourself.</p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label htmlFor="title">Title *</Label>
              <Input id="title" value={title} onChange={(e)=>setTitle(e.target.value)} maxLength={100} required className="mt-1.5 bg-[#020102]" placeholder="e.g. Engineering Mechanics by R.S. Khurmi" />
              {suggestedFields.includes("title") && <Badge variant="outline" className="mt-1.5">AI suggested — confirm</Badge>}
              {fieldErrors.title && <p className="mt-1 text-xs text-red-400">{String(fieldErrors.title)}</p>}
            </div>

            <div>
              <Label htmlFor="description">Description *</Label>
              <Textarea id="description" value={description} onChange={(e)=>setDescription(e.target.value)} maxLength={3000} required className="mt-1.5 bg-[#020102]" placeholder="Condition, usage, defects, pickup details…" rows={5} />
              <p className="mt-1.5 text-xs text-[#9AA4B8]">{description.length}/3000</p>
              {fieldErrors.description && <p className="text-xs text-red-400">{String(fieldErrors.description)}</p>}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="price">Price (₹) *</Label>
                <Input id="price" type="number" step={1} inputMode="numeric" min={0} max={10000000} value={price} onChange={(e)=>setPrice(e.target.value)} required className="mt-1.5 bg-[#020102]" placeholder="500" />
                {(priceWarning || priceZeroWarning) && <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-300"><AlertTriangle className="size-3" />{priceWarning ?? priceZeroWarning}</p>}
                {fieldErrors.price_inr && <p className="mt-1 text-xs text-red-400">{String(fieldErrors.price_inr)}</p>}
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
                {fieldErrors.hostel_block && <p className="mt-1 text-xs text-red-400">{String(fieldErrors.hostel_block)}</p>}
              </div>
            </div>

            <div>
              <Label htmlFor="tags">Tags (optional, max 12)</Label>
              <div className="mt-1.5 flex gap-2">
                <Input id="tags" value={tagInput} onChange={(e)=>setTagInput(e.target.value)} placeholder="Add tag and press Enter" maxLength={32} onKeyDown={(e)=>{ if(e.key==="Enter"){ e.preventDefault(); if(tagInput.trim() && tags.length<12){ setTags([...tags, tagInput.trim()]); setTagInput(""); }}}} className="bg-[#020102]" />
                <Button type="button" variant="secondary" onClick={()=>{ if(tagInput.trim() && tags.length<12){ setTags([...tags, tagInput.trim()]); setTagInput(""); }}} disabled={tags.length>=12}>Add</Button>
              </div>
              {tags.length>0 && <div className="mt-2 flex flex-wrap gap-1.5">{tags.map((t,i)=><span key={i} className="inline-flex items-center gap-1 rounded-full border border-[#021640] bg-[#021640] px-2.5 py-1 text-xs text-[#F5F5F7]">{t}<button type="button" onClick={()=>setTags(tags.filter((_,idx)=>idx!==i))} aria-label={`Remove ${t}`} className="rounded-full p-0.5 hover:bg-[#03245e]"><X className="size-3" /></button></span>)}</div>}
            </div>

            <label className="flex items-start gap-2.5 rounded-xl border border-[#021640] bg-[#020102] p-3 text-sm leading-5">
              <input type="checkbox" checked={confirmed} onChange={(e)=>setConfirmed(e.target.checked)} required className="mt-0.5 size-4 accent-[#03245e]" />
              <span className="text-[#9AA4B8]">I confirm the details above are accurate. I understand AI suggestions must be verified and the original photo is the source of truth.</span>
            </label>

            {error && <p role="alert" className="rounded-xl border border-[#4a102f] bg-[#220815] p-3 text-sm leading-5 text-[#f5c6d8]">{error}</p>}

            <div className="flex gap-2 pt-1">
              <Button type="submit" variant="primary" disabled={submitting || !canWrite || !imagePath || !confirmed || uploading}>{submitting ? "Saving…" : initialListing ? "Save changes" : "Publish listing"}</Button>
              <Button type="button" variant="ghost" onClick={()=>router.back()}>Cancel</Button>
            </div>
        </CardContent>
      </Card>
    </form>
  );
}
