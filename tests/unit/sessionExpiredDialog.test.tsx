import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// Use vi.hoisted to declare mock variables that can be used in vi.mock factories
const mocks = vi.hoisted(() => ({
  reset: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  setLogoutAnimationActive: vi.fn(),
  navigate: vi.fn().mockResolvedValue(undefined),
  isExpiring: false,
}));

vi.mock('../../src/store/useSessionExpiryStore', () => ({
  useSessionExpiryStore: (selector: (state: any) => any) => 
    selector({ isExpiring: mocks.isExpiring, reset: mocks.reset }),
}));

vi.mock('../../src/store/useAuthStore', () => ({
  useAuthStore: {
    getState: () => ({
      logout: mocks.logout,
      setLogoutAnimationActive: mocks.setLogoutAnimationActive,
    }),
  },
}));

vi.mock('../../src/app/router', () => ({
  router: {
    navigate: mocks.navigate,
  },
}));

// Import after mocks
import SessionExpiredDialog from '../../src/components/SessionExpiredDialog';

describe('SessionExpiredDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isExpiring = false;
  });

  it('renders nothing when isExpiring is false', () => {
    render(<SessionExpiredDialog />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('renders dialog when isExpiring is true', () => {
    mocks.isExpiring = true;
    render(<SessionExpiredDialog />);
    
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Sesi Anda telah berakhir')).toBeInTheDocument();
    expect(screen.getByText(/Demi keamanan, Anda akan keluar secara otomatis dalam/)).toBeInTheDocument();
  });

  it('displays countdown timer', () => {
    mocks.isExpiring = true;
    render(<SessionExpiredDialog />);
    
    // Initial countdown should be 5
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls performLogout when logout button is clicked', async () => {
    mocks.isExpiring = true;
    render(<SessionExpiredDialog />);
    
    // Find the logout button using role
    const logoutButton = screen.getByRole('button', { name: /keluar sekarang/i });
    await act(async () => {
      fireEvent.click(logoutButton);
    });
    
    expect(mocks.logout).toHaveBeenCalled();
  });

  it('has proper ARIA attributes for accessibility', () => {
    mocks.isExpiring = true;
    render(<SessionExpiredDialog />);
    
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('session-expired-title');
    expect(dialog.getAttribute('aria-describedby')).toBe('session-expired-desc');
  });

  it('displays countdown progress bar', () => {
    mocks.isExpiring = true;
    render(<SessionExpiredDialog />);
    
    // The countdown text should be present
    expect(screen.getByText(/detik/)).toBeInTheDocument();
  });
});
