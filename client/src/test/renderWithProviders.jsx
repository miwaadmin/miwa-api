import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

export function renderWithProviders(ui, { route = '/', routerProps = {}, ...options } = {}) {
  window.history.pushState({}, 'Test page', route)

  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]} {...routerProps}>
        {children}
      </MemoryRouter>
    ),
    ...options,
  })
}
