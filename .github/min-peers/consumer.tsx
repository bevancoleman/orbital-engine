// Typechecked (never run) by the `min-peers` CI job: a React 18 consumer
// using the published .d.ts files against the minimum peers' own types.
// This is the type surface a user on those peers actually sees, unlike
// `tsc` over src/, which is written against the React 19 devDependency
// types (see the job's comment in ci.yml).
import type { ReactElement } from 'react'

import { SOLAR_SYSTEM, positionAtTime, type CelestialBody, type StarSystemData } from 'orbital-engine'
import { OrbitalSystemScene, type OrbitalSystemSceneProps } from 'orbital-engine/react'

const system: StarSystemData = SOLAR_SYSTEM
const earth: CelestialBody | undefined = system.bodies.find((body) => body.id === 'earth')
export const earthNow = earth?.orbit ? positionAtTime(earth.orbit, new Date()) : null

const props: OrbitalSystemSceneProps = {
  system,
  onSelectBody: (body) => body.id,
}

export function App(): ReactElement {
  return <OrbitalSystemScene {...props} />
}
