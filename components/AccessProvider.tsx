"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";

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
      {open && (
        <UnlockDialog
          onClose={() => {
            pending.current = null;
            setOpen(false);
          }}
          onUnlocked={onUnlocked}
        />
      )}
    </Ctx.Provider>
  );
}

function UnlockDialog({ onClose, onUnlocked }: { onClose: () => void; onUnlocked: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xs rounded-2xl bg-white p-6 shadow-xl ring-1 ring-zinc-200"
      >
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Lock className="h-5 w-5" />
        </div>
        <h2 className="text-base font-semibold">접근 코드 입력</h2>
        <p className="mt-1 text-sm text-zinc-500">업로드·추출·요약 기능은 코드를 아는 사람만 사용할 수 있어요.</p>
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-4 w-full rounded-lg border border-zinc-300 px-3 py-2 text-center text-lg tracking-[0.5em] outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          placeholder="••••"
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 rounded-lg px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100">
            취소
          </button>
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "확인 중…" : "잠금 해제"}
          </button>
        </div>
      </form>
    </div>
  );
}
