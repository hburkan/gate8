interface EmptyStateProps {
  children: React.ReactNode;
}

/** Reuses the Phase 16 empty-state visual pattern. */
export function EmptyState({ children }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed bg-white p-6 text-center text-sm text-zinc-500">
      {children}
    </div>
  );
}
