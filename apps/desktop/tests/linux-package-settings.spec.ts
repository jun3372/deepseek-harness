import { describe, expect, it } from 'vitest'
import { resolveLinuxPackageSettings } from '../scripts/linux-package-settings.mjs'

describe('Linux package settings', () => {
  it('defaults packing to four workers without ambient tuning', () => {
    expect(resolveLinuxPackageSettings({})).toEqual({ packConcurrency: 4 })
  })

  it.each(['1', '2', '8'])('accepts pack concurrency %s', (value) => {
    expect(resolveLinuxPackageSettings({ DSH_DESKTOP_LINUX_PACK_CONCURRENCY: value })).toEqual({ packConcurrency: Number(value) })
  })

  it.each(['', '0', '-1', '1.5', 'Infinity', '01', '9007199254740992', 'four'])('rejects pack concurrency %j', (value) => {
    expect(() => resolveLinuxPackageSettings({ DSH_DESKTOP_LINUX_PACK_CONCURRENCY: value }))
      .toThrow('desktop package: DSH_DESKTOP_LINUX_PACK_CONCURRENCY must be a positive integer')
  })
})
