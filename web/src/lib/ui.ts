export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/** Shared class primitives. They intentionally contain roles, never raw palette colors. */
export const ui = {
  card: "rounded-xl border border-line bg-panel/80 shadow-sm shadow-black/20",
  cardInteractive:
    "rounded-xl border border-line bg-panel/80 shadow-sm shadow-black/20 transition hover:border-line-strong hover:bg-panel-raised/80",
  input:
    "min-h-11 rounded-md border border-line-strong bg-panel px-3 text-ink placeholder:text-ink-subtle hover:border-ink-subtle focus:border-focus disabled:cursor-not-allowed disabled:opacity-50",
  buttonPrimary:
    "inline-flex min-h-11 items-center justify-center rounded-md bg-action px-4 font-semibold text-action-ink transition hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-50",
  buttonSecondary:
    "inline-flex min-h-11 items-center justify-center rounded-md border border-line-strong bg-panel px-4 font-medium text-ink-secondary transition hover:border-ink-subtle hover:bg-panel-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
  buttonDanger:
    "inline-flex min-h-11 items-center justify-center rounded-md border border-danger/50 bg-danger/10 px-4 font-medium text-danger transition hover:border-danger hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-50",
  eyebrow: "text-xs font-semibold uppercase tracking-[0.16em] text-action",
  label: "text-sm font-medium text-ink-secondary",
  muted: "text-ink-muted",
  subtle: "text-ink-subtle",
} as const;
