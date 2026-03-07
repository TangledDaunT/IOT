/**
 * Test utilities — wrapper with all providers for testing components.
 */
import React from 'react'
import { render } from '@testing-library/react'

import { RelayProvider } from '../context/RelayContext'
import { ToastProvider } from '../context/ToastContext'
import { RobotProvider } from '../context/RobotContext'
import { LogProvider } from '../context/LogContext'
import { DeviceProvider } from '../context/DeviceContext'
import { SceneProvider } from '../context/SceneContext'
import { VoiceProvider } from '../context/VoiceContext'

/**
 * All providers wrapper for testing components that need context.
 */
function AllProviders({ children }) {
  return (
    <RobotProvider>
      <ToastProvider>
        <LogProvider>
          <RelayProvider>
            <DeviceProvider>
              <SceneProvider>
                <VoiceProvider>
                  {children}
                </VoiceProvider>
              </SceneProvider>
            </DeviceProvider>
          </RelayProvider>
        </LogProvider>
      </ToastProvider>
    </RobotProvider>
  )
}

/**
 * Custom render with providers.
 */
export function renderWithProviders(ui, options) {
  return render(ui, { wrapper: AllProviders, ...options })
}

/**
 * Create mock relay data.
 */
export function createMockRelay(overrides = {}) {
  return {
    id: 1,
    name: 'Test Relay',
    icon: '💡',
    isOn: false,
    loading: false,
    ...overrides,
  }
}

/**
 * Create mock device data.
 */
export function createMockDevice(overrides = {}) {
  return {
    id: 'esp32-test',
    name: 'Test Device',
    room: 'Test Room',
    online: true,
    rssi: -55,
    uptime: 3600,
    firmware: '1.0.0',
    ip: '192.168.1.100',
    relays: [1, 2],
    lastHeartbeat: Date.now(),
    ...overrides,
  }
}

/**
 * Create mock toast data.
 */
export function createMockToast(overrides = {}) {
  return {
    id: 'toast-1',
    message: 'Test message',
    type: 'info',
    ...overrides,
  }
}

// Re-export testing library utilities
export * from '@testing-library/react'
