"use client";

import { RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export function PaperListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="paper-list" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="skeleton-card">
          <div className="skeleton-line" style={{ width: "78%" }} />
          <div className="skeleton-line" style={{ width: "42%" }} />
          <div className="skeleton-line" style={{ width: "95%" }} />
          <div className="skeleton-line" style={{ width: "88%" }} />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon />
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-box" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn--small" onClick={onRetry}>
          <RefreshCw />
          Try again
        </button>
      ) : null}
    </div>
  );
}
