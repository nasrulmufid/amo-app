import { describe, expect, it } from 'vitest'
import { normalizeDevice } from '../src/modules/genieacs/genieacs.mapper'
import { redactParameters } from '../src/modules/genieacs/sync.service'

/**
 * Test sinkronisasi (PRD §8.3, §11.1) — bagian murni tanpa I/O.
 * Alur penuh (upsert/autolink) diuji di integration test bila DB tersedia.
 */
describe('pemetaan parameter tambahan (device_parameter_map)', () => {
  const device = {
    _id: 'dev-1',
    _lastInform: '2026-10-18T10:00:00.000Z',
    DeviceID: { SerialNumber: { _value: 'SN-1' } },
    Custom: { Vendor: { _value: 'VendorX' }, Model: { _value: 'ModelY' } },
  }

  it('path dari admin dicoba LEBIH DULU daripada fallback bawaan', () => {
    const n = normalizeDevice(device, {
      manufacturer: ['Custom.Vendor'],
      model: ['Custom.Model'],
    })
    expect(n.manufacturer).toBe('VendorX')
    expect(n.model).toBe('ModelY')
  })

  it('tanpa path tambahan, fallback bawaan tetap dipakai', () => {
    const n = normalizeDevice(device)
    expect(n.serialNumber).toBe('SN-1')
    expect(n.manufacturer).toBeNull()
  })
})

describe('redaksi parameter sebelum disimpan', () => {
  it('menyamarkan password/secret/psk secara rekursif', () => {
    const out = redactParameters({
      InternetGatewayDevice: {
        ManagementServer: { Password: { _value: 'rahasia' } },
        WLANConfiguration: { PreSharedKey: { _value: 'psk-123' } },
        DeviceInfo: { ModelName: { _value: 'F663NV3A' } },
      },
    }) as Record<string, Record<string, Record<string, unknown>>>

    const igd = out.InternetGatewayDevice!
    expect(igd.ManagementServer!.Password).toBe('[REDACTED]')
    expect(igd.WLANConfiguration!.PreSharedKey).toBe('[REDACTED]')
    expect(igd.DeviceInfo!.ModelName).toEqual({ _value: 'F663NV3A' })
  })
})
