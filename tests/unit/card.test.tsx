import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Card from '../../src/components/ui/Card';

describe('Card', () => {
  it('renders children correctly', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('renders with default variant', () => {
    render(<Card>Default Card</Card>);
    expect(screen.getByText('Default Card')).toBeInTheDocument();
  });

  it('renders with gradient variant', () => {
    render(<Card variant="gradient">Gradient Card</Card>);
    expect(screen.getByText('Gradient Card')).toBeInTheDocument();
  });

  it('renders with outlined variant', () => {
    render(<Card variant="outlined">Outlined Card</Card>);
    expect(screen.getByText('Outlined Card')).toBeInTheDocument();
  });

  it('handles click events', async () => {
    const handleClick = vi.fn();
    render(<Card onClick={handleClick}>Clickable Card</Card>);
    
    await fireEvent.click(screen.getByText('Clickable Card'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('handles keyboard navigation', async () => {
    const handleKeyDown = vi.fn();
    render(<Card onKeyDown={handleKeyDown} tabIndex={0}>Keyboard Card</Card>);
    
    const card = screen.getByText('Keyboard Card');
    await fireEvent.keyDown(card, { key: 'Enter' });
    expect(handleKeyDown).toHaveBeenCalledTimes(1);
  });

  it('renders with role and aria-label for accessibility', () => {
    render(
      <Card role="article" aria-label="Test article">
        <h2>Article Title</h2>
        <p>Article content</p>
      </Card>
    );
    
    const card = screen.getByRole('article');
    expect(card.getAttribute('aria-label')).toBe('Test article');
    expect(screen.getByText('Article Title')).toBeInTheDocument();
    expect(screen.getByText('Article content')).toBeInTheDocument();
  });

  it('supports interactive cards with tabIndex', () => {
    render(<Card tabIndex={0} role="button">Interactive Card</Card>);
    const card = screen.getByRole('button');
    expect(card.getAttribute('tabindex')).toBe('0');
  });

  it('calls onClick when interactive card is clicked', async () => {
    const handleClick = vi.fn();
    render(<Card onClick={handleClick} role="button">Interactive</Card>);
    
    await fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
