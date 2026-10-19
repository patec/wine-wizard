export function LogoMark({ className = 'mark' }: { className?: string }) {
  // A tulip glass with a four-point star — the "wizard" in the glass.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 2.5h10c.4 3.6-.4 6.6-2.2 8.4A4 4 0 0 1 12 12a4 4 0 0 1-2.8-1.1C7.4 9.1 6.6 6.1 7 2.5Z" />
      <path d="M7.4 6.4c1.6.6 3.2.6 4.6 0s3-.6 4.6 0" opacity=".55" />
      <path d="M12 12v7.5M8.5 21.5h7" />
      <path d="M19.5 13.5l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
