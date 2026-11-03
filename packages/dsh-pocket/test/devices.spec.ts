import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DeviceRegistry, describeDevice } from '../src/host/devices.ts'

const MOTO =
  'Mozilla/5.0 (Linux; Android 10; moto g40 fusion) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const homes: string[] = []

async function newHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-pocket-devices-'))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

describe('describeDevice', () => {
  it('labels an Android phone with its model and browser', () => {
    expect(describeDevice(MOTO)).toBe('moto g40 fusion · Chrome')
  })

  it('uses the client model hint when Android freezes its UA to K', () => {
    const frozen =
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36'
    expect(describeDevice(frozen, 'moto g40 fusion')).toBe('moto g40 fusion · Chrome')
  })

  it('labels iPhone, Mac, and unknown agents', () => {
    expect(describeDevice(IPHONE)).toBe('iPhone · Safari')
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe(
      'Mac · Safari',
    )
    expect(describeDevice(undefined)).toBe('Unknown device')
  })
})

describe('DeviceRegistry', () => {
  it('registers, lists, normalizes the address, and persists', async () => {
    const home = await newHome()
    const first = new DeviceRegistry(home)
    await first.load()
    first.register({ id: 'sid-1', userAgent: MOTO, address: '::ffff:192.168.1.50' })
    const [device] = first.list()
    expect(device?.label).toBe('moto g40 fusion · Chrome')
    expect(device?.address).toBe('192.168.1.50')
    expect(first.has('sid-1')).toBe(true)
    await first.flush()

    const second = new DeviceRegistry(home)
    await second.load()
    expect(second.list()).toHaveLength(1)
    second.touch('sid-1', { userAgent: MOTO, address: '192.168.1.51' })
    expect(second.list()[0]?.address).toBe('192.168.1.51')
    expect(second.remove('sid-1')).toBe(true)
    await second.close()

    const third = new DeviceRegistry(home)
    await third.load()
    expect(third.list()).toEqual([])
  })

  it('keeps the model-derived label across last-seen touches', async () => {
    const home = await newHome()
    const registry = new DeviceRegistry(home)
    const frozen =
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36'
    registry.register({ id: 'moto', userAgent: frozen, model: 'moto g(40) fusion', address: '127.0.0.1' })
    expect(registry.list()[0]?.label).toBe('moto g(40) fusion · Chrome')
    registry.touch('moto', { userAgent: frozen, address: '127.0.0.1' })
    expect(registry.list()[0]?.label).toBe('moto g(40) fusion · Chrome')
    await registry.close()
  })

  it('rejects unknown sids and ignores a corrupt file', async () => {
    const home = await newHome()
    await mkdir(join(home, 'pocket'), { recursive: true })
    await writeFile(join(home, 'pocket', 'devices.json'), '{oops', 'utf8')
    const registry = new DeviceRegistry(home)
    await registry.load()
    expect(registry.list()).toEqual([])
    expect(registry.touch('nope', {})).toBe(false)
    expect(registry.remove('nope')).toBe(false)
    registry.register({ id: 'sid-2', userAgent: IPHONE })
    expect(registry.list()[0]?.label).toBe('iPhone · Safari')
  })

  it('clears all devices', async () => {
    const home = await newHome()
    const registry = new DeviceRegistry(home)
    registry.register({ id: 'a', userAgent: MOTO })
    registry.register({ id: 'b', userAgent: IPHONE })
    expect(registry.list()).toHaveLength(2)
    registry.clear()
    expect(registry.list()).toEqual([])
    await registry.close()
  })
})
