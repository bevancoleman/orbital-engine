/**
 * Maps a linear slider position [0, 1] to a camera distance, and back —
 * logarithmically, not linearly, because the distances this engine's
 * camera actually spans (MIN_CAMERA_DISTANCE to MAX_CAMERA_DISTANCE, see
 * camera.ts) cover about 5 orders of magnitude. A linear slider across that
 * range would spend 99%+ of its travel on distances beyond anything
 * anyone's actually looking at, and have no usable resolution at all down
 * where a true-scale body (see scale.ts's trueRadius) actually lives.
 */

export function sliderPositionToDistance(position: number, min: number, max: number): number {
  const clamped = Math.min(1, Math.max(0, position))
  return min * Math.pow(max / min, clamped)
}

export function distanceToSliderPosition(distance: number, min: number, max: number): number {
  const clamped = Math.min(max, Math.max(min, distance))
  return Math.log(clamped / min) / Math.log(max / min)
}
