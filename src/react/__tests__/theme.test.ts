import { buttonStyle, uiStyles } from '../theme'

describe('buttonStyle', () => {
  it('returns the plain button style when not disabled', () => {
    expect(buttonStyle(false)).toEqual(uiStyles.button)
    expect(buttonStyle()).toEqual(uiStyles.button)
  })

  it('merges in the disabled style (lower opacity, default cursor) when disabled', () => {
    const style = buttonStyle(true)
    expect(style).toEqual({ ...uiStyles.button, ...uiStyles.buttonDisabled })
    expect(style).toMatchObject(uiStyles.buttonDisabled)
  })

  it('the disabled style never loses the base button styling it overlays', () => {
    // Confirms buttonDisabled is additive (opacity/cursor only), not a
    // replacement that could accidentally drop e.g. the background color.
    const style = buttonStyle(true)
    expect(style).toMatchObject({ background: uiStyles.button.background, borderRadius: uiStyles.button.borderRadius })
  })
})
