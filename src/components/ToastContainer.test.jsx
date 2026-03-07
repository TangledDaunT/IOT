/**
 * ToastContainer tests — verifies toast rendering and dismissal.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ToastContainer from '../components/ToastContainer'
import { ToastProvider, useToast } from '../context/ToastContext'

// Test component that triggers toasts
function ToastTrigger({ message, type }) {
  const { toast } = useToast()
  return (
    <button onClick={() => toast(message, type)}>
      Show Toast
    </button>
  )
}

function renderWithToastProvider(ui) {
  return render(
    <ToastProvider>
      {ui}
      <ToastContainer />
    </ToastProvider>
  )
}

describe('ToastContainer', () => {
  it('does not render when no toasts', () => {
    render(
      <ToastProvider>
        <ToastContainer />
      </ToastProvider>
    )
    
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows success toast', async () => {
    renderWithToastProvider(
      <ToastTrigger message="Success message" type="success" />
    )
    
    await act(async () => {
      fireEvent.click(screen.getByText('Show Toast'))
    })
    
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Success message')).toBeInTheDocument()
    expect(screen.getByText('✓')).toBeInTheDocument()
  })

  it('shows error toast', async () => {
    renderWithToastProvider(
      <ToastTrigger message="Error message" type="error" />
    )
    
    await act(async () => {
      fireEvent.click(screen.getByText('Show Toast'))
    })
    
    expect(screen.getByText('Error message')).toBeInTheDocument()
    expect(screen.getByText('✕')).toBeInTheDocument()
  })

  it('shows warning toast', async () => {
    renderWithToastProvider(
      <ToastTrigger message="Warning message" type="warn" />
    )
    
    await act(async () => {
      fireEvent.click(screen.getByText('Show Toast'))
    })
    
    expect(screen.getByText('Warning message')).toBeInTheDocument()
    expect(screen.getByText('⚠')).toBeInTheDocument()
  })

  it('shows info toast', async () => {
    renderWithToastProvider(
      <ToastTrigger message="Info message" type="info" />
    )
    
    await act(async () => {
      fireEvent.click(screen.getByText('Show Toast'))
    })
    
    expect(screen.getByText('Info message')).toBeInTheDocument()
    expect(screen.getByText('ℹ')).toBeInTheDocument()
  })

  it('dismisses toast when × clicked', async () => {
    renderWithToastProvider(
      <ToastTrigger message="Dismissable toast" type="info" />
    )
    
    await act(async () => {
      fireEvent.click(screen.getByText('Show Toast'))
    })
    
    expect(screen.getByText('Dismissable toast')).toBeInTheDocument()
    
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Dismiss'))
    })
    
    expect(screen.queryByText('Dismissable toast')).not.toBeInTheDocument()
  })
})
