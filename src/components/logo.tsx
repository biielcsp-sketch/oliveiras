/** Marca: ramo de oliveira minimalista. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="20" fill="var(--primary)" />
      <path d="M19 47 Q30 33 45 17" stroke="var(--surface-solid)" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <ellipse cx="23.6" cy="31.4" rx="6.8" ry="2.7" transform="rotate(70 23.6 31.4)" fill="var(--surface-solid)" />
      <ellipse cx="38.8" cy="29.6" rx="6.8" ry="2.7" transform="rotate(-12 38.8 29.6)" fill="var(--surface-solid)" />
      <ellipse cx="35.6" cy="17" rx="6" ry="2.5" transform="rotate(70 35.6 17)" fill="var(--surface-solid)" />
      <circle cx="34" cy="42.5" r="3.6" fill="var(--accent-soft)" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-3">
      <LogoMark size={32} />
      <span className="text-[18px] font-semibold tracking-tight">Oliveira&apos;s</span>
    </span>
  );
}
