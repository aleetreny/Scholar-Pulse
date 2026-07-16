"use client";

import { Check } from "lucide-react";
import { useSyncExternalStore } from "react";

type ToastState = { message: string; id: number } | null;

let state: ToastState = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function showToast(message: string) {
  state = { message, id: Date.now() };
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  timeoutId = setTimeout(() => {
    state = null;
    emit();
  }, 2200);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function Toaster() {
  const toast = useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );

  if (!toast) {
    return null;
  }

  return (
    <div className="toast" role="status" key={toast.id}>
      <Check />
      {toast.message}
    </div>
  );
}
