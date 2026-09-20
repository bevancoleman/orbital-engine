// This component's own chrome (toolbar, zoom slider, info panels) is styled
// with plain inline styles rather than CSS classes — a published library
// has no guarantee its consumer uses Tailwind (or any particular design
// system), so it can't depend on utility classes or theme tokens the way
// this engine's own internal dev app does. Colors are a standard dark
// UI palette (Tailwind's own gray/cyan scale, as literal hex), not tied to
// any host app's theme.
export const UI_COLORS = {
  panelBg: '#111827', // gray-900
  surfaceBg: '#1f2937', // gray-800
  elevatedBg: '#374151', // gray-700
  elevatedHoverBg: '#4b5563', // gray-600
  text: '#f3f4f6', // gray-100
  textMuted: '#9ca3af', // gray-400
  accent: '#22d3ee', // cyan-400
} as const

export const uiStyles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'system-ui, sans-serif' } as const,
  toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12 } as const,
  select: {
    background: UI_COLORS.surfaceBg,
    border: `1px solid ${UI_COLORS.elevatedBg}`,
    borderRadius: 4,
    padding: '6px 8px',
    color: UI_COLORS.text,
  } as const,
  button: {
    padding: '6px 8px',
    borderRadius: 4,
    background: UI_COLORS.elevatedBg,
    color: UI_COLORS.text,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
  } as const,
  buttonDisabled: { opacity: 0.3, cursor: 'default' } as const,
  zoomLabel: { display: 'flex', alignItems: 'center', gap: 8, color: UI_COLORS.textMuted, marginLeft: 'auto' } as const,
  canvasWrap: {
    position: 'relative',
    flex: 1,
    borderRadius: 8,
    overflow: 'hidden',
    background: '#000',
    touchAction: 'none',
  } as const,
  timeBar: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontSize: 12,
    background: 'rgba(17, 24, 39, 0.8)', // panelBg/80
    borderRadius: 4,
    padding: '8px 12px',
  } as const,
  infoPanel: {
    position: 'absolute',
    top: 8,
    right: 8,
    background: 'rgba(17, 24, 39, 0.9)', // panelBg/90
    border: `1px solid ${UI_COLORS.elevatedBg}`,
    borderRadius: 8,
    padding: 12,
    fontSize: 12,
    color: UI_COLORS.text,
    maxWidth: 260,
  } as const,
  infoPanelTitle: { fontWeight: 600, fontSize: 14, marginBottom: 4 } as const,
  muted: { color: UI_COLORS.textMuted } as const,
  mutedItalic: { color: UI_COLORS.textMuted, marginTop: 4, fontStyle: 'italic' } as const,
  devPanel: {
    position: 'absolute',
    top: 8,
    left: 8,
    background: 'rgba(17, 24, 39, 0.9)', // panelBg/90
    border: `1px solid ${UI_COLORS.elevatedBg}`,
    borderRadius: 8,
    padding: 10,
    fontSize: 11,
    lineHeight: 1.5,
    color: UI_COLORS.text,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    minWidth: 190,
    pointerEvents: 'none',
  } as const,
  devPanelTitle: {
    fontWeight: 600,
    fontSize: 11,
    marginBottom: 4,
    color: UI_COLORS.accent,
    letterSpacing: '0.05em',
  } as const,
  devPanelRow: { display: 'flex', justifyContent: 'space-between', gap: 12 } as const,
} as const

export function buttonStyle(disabled?: boolean) {
  return disabled ? { ...uiStyles.button, ...uiStyles.buttonDisabled } : uiStyles.button
}
