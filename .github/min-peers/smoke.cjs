// CJS half of the minimum-peer smoke test (see smoke.mjs): proves the
// `require` conditions link and evaluate against the minimum peers. The
// THREE member scan in smoke.mjs already covers the CJS chunks too.
const core = require('orbital-engine')
const react = require('orbital-engine/react')

const failures = []
if (typeof core.positionAtTime !== 'function') failures.push("CJS 'orbital-engine' is missing positionAtTime")
if (!Array.isArray(core.SOLAR_SYSTEM?.bodies)) failures.push("CJS 'orbital-engine' is missing SOLAR_SYSTEM.bodies")
if (react.OrbitalSystemScene == null) failures.push("CJS 'orbital-engine/react' is missing OrbitalSystemScene")

if (failures.length > 0) {
  console.error(failures.map((failure) => `FAIL ${failure}`).join('\n'))
  process.exit(1)
}
console.log('CJS OK')
