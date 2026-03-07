/**
 * RelayContext tests — verifies state management.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { RelayProvider, useRelayContext } from '../context/RelayContext'

// Test component to access relay context
function RelayConsumer() {
  const { state, setRelayState, setRelayLoading, setAllRelays, setGlobalLoading } = useRelayContext()
  
  return (
    <div>
      <div data-testid="relay-1-state">{state.relays[1]?.isOn ? 'ON' : 'OFF'}</div>
      <div data-testid="relay-1-loading">{state.relays[1]?.loading ? 'LOADING' : 'IDLE'}</div>
      <div data-testid="global-loading">{state.globalLoading ? 'LOADING' : 'IDLE'}</div>
      <button onClick={() => setRelayState(1, true)}>Turn On</button>
      <button onClick={() => setRelayLoading(1, true)}>Set Loading</button>
      <button onClick={() => setAllRelays([{ id: 1, isOn: true }, { id: 2, isOn: true }])}>
        Bulk Update
      </button>
      <button onClick={() => setGlobalLoading(true)}>Global Loading</button>
    </div>
  )
}

describe('RelayContext', () => {
  it('initializes with relays from config', () => {
    render(
      <RelayProvider>
        <RelayConsumer />
      </RelayProvider>
    )
    
    expect(screen.getByTestId('relay-1-state')).toHaveTextContent('OFF')
    expect(screen.getByTestId('relay-1-loading')).toHaveTextContent('IDLE')
  })

  it('updates single relay state', async () => {
    render(
      <RelayProvider>
        <RelayConsumer />
      </RelayProvider>
    )
    
    expect(screen.getByTestId('relay-1-state')).toHaveTextContent('OFF')
    
    await act(async () => {
      screen.getByText('Turn On').click()
    })
    
    expect(screen.getByTestId('relay-1-state')).toHaveTextContent('ON')
  })

  it('sets relay loading state', async () => {
    render(
      <RelayProvider>
        <RelayConsumer />
      </RelayProvider>
    )
    
    expect(screen.getByTestId('relay-1-loading')).toHaveTextContent('IDLE')
    
    await act(async () => {
      screen.getByText('Set Loading').click()
    })
    
    expect(screen.getByTestId('relay-1-loading')).toHaveTextContent('LOADING')
  })

  it('bulk updates all relays', async () => {
    render(
      <RelayProvider>
        <RelayConsumer />
      </RelayProvider>
    )
    
    await act(async () => {
      screen.getByText('Bulk Update').click()
    })
    
    expect(screen.getByTestId('relay-1-state')).toHaveTextContent('ON')
  })

  it('sets global loading state', async () => {
    render(
      <RelayProvider>
        <RelayConsumer />
      </RelayProvider>
    )
    
    expect(screen.getByTestId('global-loading')).toHaveTextContent('IDLE')
    
    await act(async () => {
      screen.getByText('Global Loading').click()
    })
    
    expect(screen.getByTestId('global-loading')).toHaveTextContent('LOADING')
  })

  it('throws error when used outside provider', () => {
    // Suppress React error boundary log
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    expect(() => render(<RelayConsumer />)).toThrow()
    
    consoleSpy.mockRestore()
  })
})
