import config from '../../capacitor.config.json'

describe('capacitor.config.json', () => {
  it('keeps appId as app.miwacare for Play Store consistency', () => {
    expect(config.appId).toBe('app.miwacare')
  })

  it('has a plugins block', () => {
    expect(config.plugins).toBeDefined()
    expect(typeof config.plugins).toBe('object')
  })

  it('declares Camera plugin config with permissions array', () => {
    expect(config.plugins.Camera).toBeDefined()
    expect(Array.isArray(config.plugins.Camera.permissions)).toBe(true)
    expect(config.plugins.Camera.permissions).toContain('camera')
    expect(config.plugins.Camera.permissions).toContain('photos')
  })

  it('declares LocalNotifications plugin config', () => {
    const ln = config.plugins.LocalNotifications
    expect(ln).toBeDefined()
    expect(typeof ln.smallIcon).toBe('string')
    expect(ln.iconColor).toBe('#0d1117')
  })

  it('preserves SplashScreen config unchanged', () => {
    const ss = config.plugins.SplashScreen
    expect(ss).toBeDefined()
    expect(ss.backgroundColor).toBe('#0d1117')
    expect(ss.launchShowDuration).toBe(2500)
  })

  it('preserves StatusBar config unchanged', () => {
    const sb = config.plugins.StatusBar
    expect(sb).toBeDefined()
    expect(sb.style).toBe('Dark')
  })

  it('does not declare PushNotifications (Phase 2 only)', () => {
    expect(config.plugins.PushNotifications).toBeUndefined()
  })
})
