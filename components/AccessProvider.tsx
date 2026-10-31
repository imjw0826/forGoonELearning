"use client";

import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/client/api";
import { cn } from "@/lib/utils";

interface AccessCtx {
  unlocked: boolean;
  /** Runs `action` immediately when unlocked; otherwise asks for the code first. */
  guard: (action: () => void) => void;
  openDialog: () => void;
  lock: () => Promise<void>;
}

const Ctx = createContext<AccessCtx | null>(null);

export function useAccess() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAccess must be used inside <AccessProvider>");
  return ctx;
}

export function AccessProvider({ initialUnlocked, children }: { initialUnlocked: boolean; children: ReactNode }) {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(initialUnlocked);
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  const guard = useCallback(
    (action: () => void) => {
      if (unlocked) return action();
      pending.current = action;
      setOpen(true);
    },
    [unlocked],
  );

  const lock = useCallback(async () => {
    await api("/api/access", { method: "DELETE" });
    setUnlocked(false);
    router.refresh();
  }, [router]);

  const onUnlocked = () => {
    setUnlocked(true);
    setOpen(false);
    router.refresh();
    const action = pending.current;
    pending.current = null;
    // Let state settle so guarded callbacks see unlocked=true.
    if (action) setTimeout(action, 0);
  };

  return (
    <Ctx.Provider value={{ unlocked, guard, openDialog: () => setOpen(true), lock }}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) pending.current = null;
          setOpen(o);
        }}
      >
        <DialogContent className="max-w-sm">{open && <UnlockForm onUnlocked={onUnlocked} />}</DialogContent>
      </Dialog>
    </Ctx.Provider>
  );
}

function UnlockForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/access", { body: { code } });
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCode("");
      setShake((n) => n + 1);
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-brand-soft text-brand">
        <KeyRound className="size-[18px]" />
      </div>
      <DialogTitle>접근 코드</DialogTitle>
      <DialogDescription className="text-pretty">업로드·추출·요약은 코드를 아는 사람만 쓸 수 있어요.</DialogDescription>
      <input
        key={shake}
        ref={inputRef}
        autoFocus
        type="password"
        inputMode="numeric"
        autoComplete="off"
        aria-label="접근 코드"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className={cn(
          "mt-5 h-12 w-full rounded-lg border border-input bg-background text-center text-xl tracking-[0.6em] tabular shadow-xs outline-none",
          "transition-[border-color,box-shadow] focus:border-ring focus:ring-[3px] focus:ring-ring/25",
          shake > 0 && "animate-[shake_0.32s_var(--ease-out)]",
        )}
        placeholder="••••"
      />
      <p className={cn("mt-2 h-5 text-xs text-destructive transition-opacity", error ? "opacity-100" : "opacity-0")}>{error}</p>
      <Button type="submit" className="mt-2 w-full" size="lg" disabled={busy || !code.trim()}>
        {busy ? "확인 중…" : "잠금 해제"}
      </Button>
    </form>
  );
}
