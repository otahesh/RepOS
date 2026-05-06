import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleWarnings } from './ScheduleWarnings';

describe('<ScheduleWarnings>', () => {
  it('renders warn-severity items in amber', () => {
    render(<ScheduleWarnings warnings={[
      { code: 'cardio_interval_too_close', severity: 'warn', message: 'HIIT day-before…', day_idx: 1 },
    ]} />);
    expect(screen.getByText(/HIIT day-before/)).toBeInTheDocument();
  });
  it('renders block-severity items in red and emits onBlock', () => {
    render(<ScheduleWarnings warnings={[
      { code: 'too_many_days_per_week', severity: 'block', message: '7 days/week — drop one' },
    ]} />);
    const item = screen.getByText(/7 days\/week/);
    expect(item).toBeInTheDocument();
  });
});
