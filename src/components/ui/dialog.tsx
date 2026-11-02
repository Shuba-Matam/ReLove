"use client";
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
const DialogIds = createContext({ title: "dialog-title", description: "dialog-description" });
export function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
 const ref = useRef<HTMLDialogElement>(null); const id = useId();
 useEffect(() => { const dialog = ref.current; if(!dialog) return; const previous = document.activeElement as HTMLElement | null; if(open && !dialog.open) dialog.showModal(); if(!open && dialog.open) dialog.close(); return () => { if(dialog.open) dialog.close(); if(open) previous?.focus(); }; },[open]);
 return <DialogIds.Provider value={{ title:id+"-title", description:id+"-description" }}><dialog ref={ref} aria-labelledby={id+"-title"} aria-describedby={id+"-description"} onCancel={(event) => { event.preventDefault(); onOpenChange(false); }} onClick={(event) => { if(event.target === event.currentTarget) onOpenChange(false); }} className="fixed m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-xl border-0 bg-transparent p-0 text-[#F5F5F7] backdrop:bg-black/70 backdrop:backdrop-blur-sm">{open ? children : null}</dialog></DialogIds.Provider>;
}
export function DialogContent({ className, children, onClose }: { className?:string; children:React.ReactNode; onClose?:()=>void }) { return <div className={cn("relative rounded-xl bg-[#01071d] p-6 shadow-xl ring-1 ring-[#021640]/50",className)}>{onClose && <button type="button" aria-label="Close dialog" onClick={onClose} className="absolute right-3 top-3 rounded-full p-2 text-[#9AA4B8] hover:bg-[#021640] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#60a5fa]"><X className="size-4" /></button>}{children}</div>; }
export function DialogHeader({ children,className }: { children:React.ReactNode; className?:string }) { return <div className={cn("mb-4 space-y-1",className)}>{children}</div>; }
export function DialogTitle({ children,className }: { children:React.ReactNode; className?:string }) { const ids = useContext(DialogIds); return <h2 id={ids.title} className={cn("pr-6 text-lg font-semibold",className)}>{children}</h2>; }
export function DialogDescription({ children,className }: { children:React.ReactNode; className?:string }) { const ids = useContext(DialogIds); return <p id={ids.description} className={cn("text-sm text-[#9AA4B8]",className)}>{children}</p>; }
