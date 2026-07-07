import { describe, it, expect } from 'vitest';
import { formatSetupFacts, overlaySetupFactChips } from './setupFactLabels';

describe('formatSetupFacts', () => {
  it('renders degree facts with the ° symbol', () => {
    expect(formatSetupFacts({ bench_angle_deg: 30 })).toEqual(['bench 30°']);
    expect(formatSetupFacts({ toe_angle_deg: 20 })).toEqual(['toe 20°']);
  });

  it('renders string facts as label: value', () => {
    expect(formatSetupFacts({ stance: 'shoulder-width' })).toEqual(['stance: shoulder-width']);
    expect(formatSetupFacts({ grip_width: 'just outside shoulders' })).toEqual([
      'grip width: just outside shoulders',
    ]);
  });

  it('renders plain numeric facts without a unit', () => {
    expect(formatSetupFacts({ notch: 2 })).toEqual(['notch 2']);
  });

  it('preserves authoring order across multiple facts', () => {
    expect(formatSetupFacts({ toe_angle_deg: 20, stance: 'shoulder-width' })).toEqual([
      'toe 20°',
      'stance: shoulder-width',
    ]);
  });

  it('returns [] for no facts', () => {
    expect(formatSetupFacts({})).toEqual([]);
  });

  it('overlay chips keep numeric facts only — prose facts duplicate the callout', () => {
    expect(overlaySetupFactChips({ bench_angle_deg: 30, stance: 'shoulder-width' })).toEqual([
      'bench 30°',
    ]);
  });

  it('overlay chips suppress zero-degree facts ("bench 0°" reads odd — flat is the callout\'s job)', () => {
    expect(overlaySetupFactChips({ bench_angle_deg: 0 })).toEqual([]);
  });
});
