/**
 * RelayCard tests — verifies card rendering and interaction.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RelayCard from '../components/RelayCard'
import { createMockRelay } from '../test/utils'

describe('RelayCard', () => {
  it('renders relay name and icon', () => {
    const relay = createMockRelay({ name: 'Kitchen Light', icon: '💡' })
    const onToggle = vi.fn()
    
    render(<RelayCard relay={relay} onToggle={onToggle} />)
    
    expect(screen.getByText('Kitchen Light')).toBeInTheDocument()
    expect(screen.getByText('💡')).toBeInTheDocument()
  })

  it('shows OFF state correctly', () => {
    const relay = createMockRelay({ isOn: false })
    const onToggle = vi.fn()
    
    render(<RelayCard relay={relay} onToggle={onToggle} />)
    
    expect(screen.getByText('○ OFF')).toBeInTheDocument()
  })

  it('shows ON state correctly', () => {
    const relay = createMockRelay({ isOn: true })
    const onToggle = vi.fn()
    
    render(<RelayCard relay={relay} onToggle={onToggle} />)
    
    expect(screen.getByText('● ON')).toBeInTheDocument()
  })

  it('shows WAIT when loading', () => {
    const relay = createMockRelay({ loading: true })
    const onToggle = vi.fn()
    
    render(<RelayCard relay={relay} onToggle={onToggle} />)
    
    expect(screen.getByText('WAIT')).toBeInTheDocument()
  })

  it('calls onToggle when clicked', () => {
    const relay = createMockRelay({ id: 2, isOn: false })
    const onToggle = vi.fn()
    
    render(<RelayCard relay={relay} onToggle={onToggle} />)
    
    const button = screen.getByRole('button')
    fireEvent.click(button)
    
    expect(onToggle).toHaveBeenCalledWith(2, false)
  })

  it('does not call onToggle when loading', () => {
    const relay = createMockRelay({ id: 2, loading: true })
    const onToggle = vi.fn()
    
    render(<RelayCard relay={relay} onToggle={onToggle} />)
    
    const button = screen.getByRole('button')
    fireEvent.click(button)
    
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('shows relay ID badge', () => {
    const relay = createMockRelay({ id: 3 })
    const onToggle = vi.fn()
    
    render(<RelayCard relay={relay} onToggle={onToggle} />)
    
    expect(screen.getByText('R3')).toBeInTheDocument()
  })

  it('has correct accessibility attributes', () => {
    const relay = createMockRelay({ name: 'Test Relay', isOn: true })
    const onToggle = vi.fn()
    
    render(<RelayCard relay={relay} onToggle={onToggle} />)
    
    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('aria-label', expect.stringContaining('Test Relay'))
  })
})
