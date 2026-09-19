import { compressDistance, trueRadius } from '../scale'

const EARTH_RADIUS_KM = 6371
const ISS_SEMI_MAJOR_AXIS_KM = EARTH_RADIUS_KM + 418 // ~418 km mean altitude
const HUBBLE_SEMI_MAJOR_AXIS_KM = EARTH_RADIUS_KM + 535
const MARS_RADIUS_KM = 3389.5
const PHOBOS_SEMI_MAJOR_AXIS_KM = 9376

describe('compressDistance', () => {
  it('maps 0 to 0', () => {
    expect(compressDistance(0)).toBe(0)
  })

  it('is monotonically increasing — farther real distance never plots closer', () => {
    // This is the property that broke as a "square orbit" bug when distance
    // was compressed per-axis instead of by radius: two points at the same
    // true distance from the origin must compress to the same output
    // regardless of direction, and strictly farther points must compress to
    // strictly farther output, preserving both ordering and shape.
    const samples = [1, 100, 10_000, 1_000_000, 1e8, 1e10, 1e13]
    for (let i = 1; i < samples.length; i++) {
      expect(compressDistance(samples[i]!)).toBeGreaterThan(compressDistance(samples[i - 1]!))
    }
  })

  it('compresses the Mercury-to-Oort-cloud range into a legible, bounded span', () => {
    const mercuryAu = 0.387 * 149_597_870.7
    const oortOuterAu = 100_000 * 149_597_870.7
    const near = compressDistance(mercuryAu)
    const far = compressDistance(oortOuterAu)
    // 6 orders of magnitude of real distance should not become 6 orders of
    // magnitude of world-space distance — that's the entire point of using
    // a log compression instead of a linear one.
    expect(far / near).toBeLessThan(20)
    expect(far).toBeLessThan(500) // stays in a camera-friendly range
  })
})

describe('trueRadius', () => {
  it('maps 0 to 0', () => {
    expect(trueRadius(0)).toBe(0)
  })

  it('is exactly linear — doubling the real size exactly doubles the rendered size', () => {
    const base = trueRadius(1000)
    const doubled = trueRadius(2000)
    expect(doubled).toBeCloseTo(base * 2, 10)
  })

  it('preserves real relative proportions exactly, with no compression', () => {
    // Jupiter really is ~10.97x Earth's radius — true scale must
    // reproduce that ratio exactly, unlike compressDistance's deliberate
    // narrowing of real distance ratios.
    const jupiter = trueRadius(69_911)
    const earth = trueRadius(6371)
    expect(jupiter / earth).toBeCloseTo(69_911 / 6371, 6)
  })

  it('has no artificial floor — a tiny real body renders at a genuinely tiny size', () => {
    // The whole point: nothing here rescues a small body up to some
    // minimum visible size. Selection support (proximity selection, the
    // always-legible label) is what makes that safe. The ISS's own real
    // radius (0.055 km) should render many orders of magnitude smaller
    // than a real planet.
    const iss = trueRadius(0.055)
    const earth = trueRadius(6371)
    expect(iss).toBeGreaterThan(0)
    expect(iss / earth).toBeLessThan(1e-4)
  })

  // The real, observed bug this calibration fixes: trueRadius used to be
  // calibrated independently (chosen only so the Sun "looked right"), which
  // put it on a different physical scale than compressDistance — so a real
  // satellite orbiting very close to its planet (relative to the planet's
  // own size) rendered INSIDE the planet's true-scale sphere despite
  // genuinely orbiting outside its real surface. Matching compressDistance's
  // own km-per-world-unit rate at the origin (see TRUE_RADIUS_KM_PER_UNIT's
  // own comment) fixes this for every real close-in satellite in this
  // dataset, including the Phobos/Mars case that an earlier, independently
  // calibrated version of this scale could not fix.
  it("renders the ISS outside Earth's own true-scale radius", () => {
    const earth = trueRadius(EARTH_RADIUS_KM)
    const iss = compressDistance(ISS_SEMI_MAJOR_AXIS_KM)
    expect(iss).toBeGreaterThan(earth)
  })

  it("renders Hubble outside Earth's own true-scale radius", () => {
    const earth = trueRadius(EARTH_RADIUS_KM)
    const hubble = compressDistance(HUBBLE_SEMI_MAJOR_AXIS_KM)
    expect(hubble).toBeGreaterThan(earth)
  })

  it("renders Phobos outside Mars's own true-scale radius — the case compressRadius could not fix", () => {
    const mars = trueRadius(MARS_RADIUS_KM)
    const phobos = compressDistance(PHOBOS_SEMI_MAJOR_AXIS_KM)
    expect(phobos).toBeGreaterThan(mars)
  })
})
