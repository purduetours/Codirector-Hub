/* ============================================================ icons
   One line-icon set for the whole hub, drawn on a 24px grid with a 1.8 stroke
   so they sit together. Modules still declare an emoji `icon` — that remains
   the fallback for anything added later without an entry here, so a new tool
   never renders with a hole where its icon should be.
============================================================================ */
const svg = body =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  today:         svg('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.8V20h13V9.8"/><path d="M10 20v-5.5h4V20"/>'),
  announcements: svg('<path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M18.8 6a8.5 8.5 0 0 1 0 12"/>'),
  evals:         svg('<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 4.2V3h6v1.2"/><path d="m9 12 2 2 4-4.5"/><path d="M9 17.5h6"/>'),
  interviews:    svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/><path d="M8.5 21h7"/>'),
  training:      svg('<path d="m2.5 9 9.5-5 9.5 5-9.5 5-9.5-5Z"/><path d="M6.5 11.2V16c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3v-4.8"/><path d="M21.5 9v5"/>'),
  schedule:      svg('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M8 14h2"/><path d="M14 14h2"/><path d="M8 17h2"/>'),
  directory:     svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.7-3.2 3.2-5 6-5s5.3 1.8 6 5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M16.2 14.6c2.5.1 4.2 1.7 4.8 4.4"/>'),
  desks:         svg('<path d="M4 17h16"/><path d="M6 17a6 6 0 0 1 12 0"/><path d="M12 8.5V11"/><path d="M10.5 8.5h3"/><path d="M3 20h18"/>'),
  people:        svg('<circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 8.1-8.1"/><path d="m16 7 2.5 2.5"/><path d="m18.5 4.5 2 2"/>'),
  health:        svg('<path d="M3 12h4l2.2-5.5L13 18l2.3-6H21"/>'),

  search:  svg('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/>'),
  menu:    svg('<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/>'),
  close:   svg('<path d="M6 6l12 12"/><path d="M18 6 6 18"/>'),
  moon:    svg('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'),
  sun:     svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  signout: svg('<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16.5 5.5 12 10 7.5"/><path d="M5.5 12H15"/>'),
  rollover:svg('<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/>'),
  arrow:   svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>'),
  send:    svg('<path d="M5 12h13"/><path d="m12 5 7 7-7 7"/>'),
  spark:   svg('<path d="M12 3.5 13.9 10 20.5 12l-6.6 2L12 20.5 10.1 14 3.5 12l6.6-2L12 3.5Z"/>'),
  clock:   svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  check:   svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  users:   svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.7-3.2 3.2-5 6-5s5.3 1.8 6 5"/><path d="M15.5 5.4a3.2 3.2 0 0 1 0 6.2"/><path d="M17.5 14.7c1.9.5 3.1 2 3.5 4.8"/>')
};

/** A module's icon: the line icon if there is one, else its own emoji. */
export function iconFor(mod) {
  return ICONS[mod?.id] || `<span class="ico-emoji" aria-hidden="true">${mod?.icon || '•'}</span>`;
}
