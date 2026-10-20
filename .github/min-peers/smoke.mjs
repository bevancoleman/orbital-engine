// Minimum-peer smoke test, run by the `min-peers` CI job from a scratch
// consumer project holding the packed tarball plus the OLDEST peer versions
// package.json claims to support. Nothing renders: it proves the published
// ESM entry points link and evaluate against those peers, and catches two
// things a plain link/evaluate pass can't:
//  - three APIs used via `import * as THREE` — a missing member is just
//    `undefined` until first use, so it never fails at import time;
//  - drei's transitive camera-controls major — CameraRig relies on the 2.x
//    `getPosition/getTarget(out, receiveEndValue)` signature and the
//    `smoothTime` property, both of which 1.x silently ignores.
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import * as THREE from 'three'
import * as core from 'orbital-engine'
import * as react from 'orbital-engine/react'

const require = createRequire(import.meta.url)
const failures = []

function check(ok, message) {
  if (!ok) failures.push(message)
}

check(typeof core.positionAtTime === 'function', "ESM 'orbital-engine' is missing positionAtTime")
check(Array.isArray(core.SOLAR_SYSTEM?.bodies), "ESM 'orbital-engine' is missing SOLAR_SYSTEM.bodies")
check(react.OrbitalSystemScene != null, "ESM 'orbital-engine/react' is missing OrbitalSystemScene")

// Every `THREE<n>.Member` the bundle touches must exist in this three.
const distDir = join(dirname(require.resolve('orbital-engine/package.json')), 'dist')
const used = new Set()
for (const file of readdirSync(distDir).filter((name) => /\.c?js$/.test(name))) {
  const code = readFileSync(join(distDir, file), 'utf8')
  for (const match of code.matchAll(/\bTHREE\d*\.([A-Za-z_]\w*)/g)) used.add(match[1])
}
check(used.size > 0, 'found no THREE.* references in dist/ (the scan itself is broken)')
for (const name of used) check(name in THREE, `three r${THREE.REVISION} has no THREE.${name}`)

// Resolve camera-controls the way drei itself does: from drei's own directory.
const dreiRequire = createRequire(require.resolve('@react-three/drei/package.json'))
const cameraControls = dreiRequire('camera-controls/package.json').version
check(
  Number(cameraControls.split('.')[0]) >= 2,
  `@react-three/drei resolves camera-controls@${cameraControls}; orbital-engine needs >=2 (receiveEndValue, smoothTime)`,
)

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join('\n'))
  process.exit(1)
}
console.log(`ESM OK: three r${THREE.REVISION}, camera-controls ${cameraControls}, ${used.size} THREE members checked`)
