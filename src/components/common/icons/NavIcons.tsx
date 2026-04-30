// src/components/common/icons/NavIcons.tsx
// ナビゲーションで使用する SVG アイコン群。

export function DashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

export function KanbanIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <rect x="1" y="2" width="3" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="5.5" y="2" width="3" height="7" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="10" y="2" width="3" height="4" rx="1" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

export function GanttIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <line x1="1" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="1" y1="10" x2="13" y2="10" stroke="currentColor" strokeWidth="1.2"/>
      <rect x="2" y="2.5" width="4" height="3" rx="0.5" fill="currentColor" opacity="0.4"/>
      <rect x="5" y="5.5" width="5" height="3" rx="0.5" fill="currentColor" opacity="0.4"/>
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <line x1="4" y1="3.5" x2="13" y2="3.5" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="4" y1="7" x2="13" y2="7" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="4" y1="10.5" x2="13" y2="10.5" stroke="currentColor" strokeWidth="1.2"/>
      <circle cx="2" cy="3.5" r="1" fill="currentColor"/>
      <circle cx="2" cy="7" r="1" fill="currentColor"/>
      <circle cx="2" cy="10.5" r="1" fill="currentColor"/>
    </svg>
  );
}

export function AdminIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="4" r="2.2" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2 12c0-2.8 2.2-4 5-4s5 1.2 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
      <circle cx="11" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1"/>
      <path d="M11 9v1l.6.6" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"/>
    </svg>
  );
}

export function GraphIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7"  cy="2"  r="1.5" fill="currentColor"/>
      <circle cx="2"  cy="10" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="10" r="1.5" fill="currentColor"/>
      <circle cx="7"  cy="7"  r="1.2" fill="currentColor" opacity="0.7"/>
      <line x1="7" y1="3.5" x2="7"  y2="5.8"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      <line x1="7" y1="3.5" x2="2"  y2="8.5"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      <line x1="7" y1="3.5" x2="12" y2="8.5"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      <line x1="7" y1="7"   x2="2"  y2="8.5"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
      <line x1="7" y1="7"   x2="12" y2="8.5"  stroke="currentColor" strokeWidth="1" opacity="0.6"/>
    </svg>
  );
}

export function AIIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2"/>
      <text x="7" y="9.5" textAnchor="middle" fontSize="5.2" fontWeight="700" fontFamily="system-ui,sans-serif" fill="currentColor" letterSpacing="0.3">AI</text>
    </svg>
  );
}
