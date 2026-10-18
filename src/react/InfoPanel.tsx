import type { ReactNode } from 'react'
import type { BeltRegion, CelestialBody } from '../types'
import { beltExtentText, bodyRadiusText, bodyTypeLabel, coOrbitalText, formatAu } from './infoPanelText'
import { uiStyles } from './theme'

/**
 * The shared frame of the top-right info panel — title, subtitle, a
 * kind-specific body, then the note / wiki summary / "Read more" footer
 * every body and belt can carry. aria-live so a screen reader announces
 * what was just selected (selection can also come from a map click or an
 * external focus request, not only the focused dropdown).
 */
function InfoPanel({
  name,
  subtitle,
  note,
  wikiSummary,
  wikiUrl,
  children,
}: {
  name: string
  subtitle: string
  note?: string
  wikiSummary?: string
  wikiUrl?: string
  children?: ReactNode
}) {
  return (
    <div style={uiStyles.infoPanel} aria-live="polite">
      <div style={uiStyles.infoPanelTitle}>{name}</div>
      <div style={uiStyles.muted}>{subtitle}</div>
      {children}
      {note && <div style={uiStyles.mutedItalic}>{note}</div>}
      {wikiSummary && <div style={uiStyles.wikiSummary}>{wikiSummary}</div>}
      {wikiUrl && (
        <a href={wikiUrl} target="_blank" rel="noopener noreferrer" style={uiStyles.wikiLink}>
          Read more →
        </a>
      )}
    </div>
  )
}

export function BodyInfoPanel({ body, hasOrbitalMotion }: { body: CelestialBody; hasOrbitalMotion: boolean }) {
  return (
    <InfoPanel name={body.name} subtitle={bodyTypeLabel(body.type)} note={body.note} wikiSummary={body.wikiSummary} wikiUrl={body.wikiUrl}>
      <div style={uiStyles.muted}>{bodyRadiusText(body, hasOrbitalMotion)}</div>
      {body.orbit && (
        <>
          <div style={uiStyles.muted}>a: {formatAu(body.orbit.semiMajorAxisKm, 3)}</div>
          <div style={uiStyles.muted}>e: {body.orbit.eccentricity}</div>
          <div style={uiStyles.muted}>i: {body.orbit.inclinationDeg}°</div>
          <div style={uiStyles.muted}>period: {body.orbit.orbitalPeriodDays.toLocaleString()} days</div>
        </>
      )}
    </InfoPanel>
  )
}

export function BeltInfoPanel({
  belt,
  hasOrbitalMotion,
  bodiesById,
}: {
  belt: BeltRegion
  hasOrbitalMotion: boolean
  bodiesById: ReadonlyMap<string, CelestialBody>
}) {
  const coOrbital = coOrbitalText(belt, bodiesById)
  return (
    <InfoPanel name={belt.name} subtitle={belt.type} note={belt.note} wikiSummary={belt.wikiSummary} wikiUrl={belt.wikiUrl}>
      <div style={uiStyles.muted}>{beltExtentText(belt, hasOrbitalMotion)}</div>
      {coOrbital && <div style={uiStyles.muted}>{coOrbital}</div>}
    </InfoPanel>
  )
}
