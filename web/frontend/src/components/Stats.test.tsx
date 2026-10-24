import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Stats } from './Stats';

const MON = 10n ** 18n;

function statValue(label: string): HTMLElement {
  return screen.getByText(label).previousElementSibling as HTMLElement;
}

describe('Stats', () => {
  it('dashes every counter while the first read is in flight', () => {
    render(
      <Stats hotspotCount={0} openCount={0} expiredCount={0} escrowWei={0n} loading />,
    );

    expect(statValue('hotspots on-chain')).toHaveTextContent('—');
    expect(statValue('bounties open')).toHaveTextContent('—');
    expect(statValue('fires with no responder')).toHaveTextContent('—');
    expect(statValue('MON in escrow')).toHaveTextContent('—');
  });

  it('renders a real 0 once loading is done — an empty counter is a fact, not a gap', () => {
    render(
      <Stats hotspotCount={0} openCount={0} expiredCount={0} escrowWei={0n} loading={false} />,
    );

    expect(statValue('hotspots on-chain')).toHaveTextContent('0');
    expect(statValue('fires with no responder')).toHaveTextContent('0');
  });

  it('shows the expired count and the escrow amount', () => {
    render(
      <Stats
        hotspotCount={180}
        openCount={2}
        expiredCount={3}
        escrowWei={2n * MON}
        loading={false}
      />,
    );

    expect(statValue('hotspots on-chain')).toHaveTextContent('180');
    expect(statValue('bounties open')).toHaveTextContent('2');
    expect(statValue('fires with no responder')).toHaveTextContent('3');
    expect(statValue('MON in escrow')).toHaveTextContent('2.000');
  });
});
