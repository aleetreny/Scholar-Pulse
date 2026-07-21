"use client";

import { Check, Plus } from "lucide-react";

import { CATEGORY_GROUPS } from "@/lib/categories";

export function TopicPicker({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      {CATEGORY_GROUPS.map((group) => (
        <section key={group.label} className="topic-group">
          <h2>{group.label}</h2>
          <div className="topic-grid">
            {group.categories.map(({ id, label }) => {
              const active = selected.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className="topic-chip"
                  data-active={active}
                  aria-pressed={active}
                  onClick={() => onToggle(id)}
                >
                  {active ? <Check /> : <Plus />}
                  {label}
                  <code>{id}</code>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
