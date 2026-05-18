import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Pricing from '../pages/Pricing'
import { renderWithProviders } from '../test/renderWithProviders'

describe('pricing smoke tests', () => {
  it('renders the current solo clinician plans and prices', () => {
    renderWithProviders(<Pricing />, { route: '/pricing' })

    expect(screen.getByRole('heading', { name: /^trainee$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /associate/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /licensed therapist/i })).toBeInTheDocument()
    expect(screen.getByText('$39')).toBeInTheDocument()
    expect(screen.getByText('$69')).toBeInTheDocument()
    expect(screen.getByText('$129')).toBeInTheDocument()
  })

  it('links plan CTAs to registration and keeps group practice out of the main plan UI', () => {
    renderWithProviders(<Pricing />, { route: '/pricing' })

    const planLinks = screen.getAllByRole('link', { name: /start free trial/i })
    expect(planLinks).toHaveLength(3)
    expect(planLinks.map(link => link.getAttribute('href'))).toEqual([
      '/register?tier=trainee',
      '/register?tier=associate',
      '/register?tier=licensed',
    ])

    expect(screen.queryByText(/group practice/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /group/i })).not.toBeInTheDocument()
  })

  it('keeps the trainee CTA separate from purchasable group plans', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Pricing />, { route: '/pricing' })

    const traineeInfo = screen.getByRole('link', { name: /i'm pre-licensed/i })
    expect(traineeInfo).toHaveAttribute('href', '/for-trainees')

    await user.click(traineeInfo)
    expect(screen.queryByText(/group practice/i)).not.toBeInTheDocument()
  })
})
