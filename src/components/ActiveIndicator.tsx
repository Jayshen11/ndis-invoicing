/** Active / inactive badge used in admin listing tables (matches provider listing). */
export function ActiveIndicator({ active }: Readonly<{ active: boolean }>) {
  if (!active) {
    return (
      <span
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-slate-500"
        title="Inactive"
        aria-label="Inactive"
        role="img"
      >
        <span className="text-[15px] font-light leading-none" aria-hidden>
          ×
        </span>
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"
      title="Active"
      aria-label="Active"
      role="img"
    >
      <svg
        aria-hidden
        className="h-4 w-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.75"
      >
        <path
          d="M5 12l5 5L20 7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
