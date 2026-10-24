import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readRequiredBondMock } = vi.hoisted(() => ({ readRequiredBondMock: vi.fn() }));

vi.mock('../lib/chain', () => ({ readRequiredBond: readRequiredBondMock }));

import { useRequiredBond } from './useRequiredBond';

const BOND = 50_000_000_000_000_000n; // 0.05 MON

/** Let pending promise callbacks run. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  readRequiredBondMock.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useRequiredBond', () => {
  it('is not ready and reports no bond before the read settles', () => {
    readRequiredBondMock.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRequiredBond(7));

    expect(result.current).toEqual({ bond: 0n, ready: false });
  });

  it('is ready with the real bond after a successful read', async () => {
    readRequiredBondMock.mockResolvedValue(BOND);

    const { result } = renderHook(() => useRequiredBond(7));
    await flush();

    expect(readRequiredBondMock).toHaveBeenCalledWith(7);
    expect(result.current).toEqual({ bond: BOND, ready: true });
  });

  it('retries once after a rejection and ends ready with the real bond', async () => {
    readRequiredBondMock.mockRejectedValueOnce(new Error('429 too many requests'));
    readRequiredBondMock.mockResolvedValueOnce(BOND);

    const { result } = renderHook(() => useRequiredBond(7));
    await flush();

    // First attempt failed: still not ready, and never a fake 0n ready state.
    expect(result.current.ready).toBe(false);
    expect(readRequiredBondMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(readRequiredBondMock).toHaveBeenCalledTimes(2);
    expect(result.current.ready).toBe(true);
    expect(result.current.bond).toBe(BOND);
  });

  it('stays not-ready after two rejections — nothing is treated as a valid bond', async () => {
    readRequiredBondMock.mockRejectedValue(new Error('rpc down'));

    const { result } = renderHook(() => useRequiredBond(7));
    await flush();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(readRequiredBondMock).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ bond: 0n, ready: false });

    // No third attempt: the retry budget is exactly one.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(readRequiredBondMock).toHaveBeenCalledTimes(2);
    expect(result.current.ready).toBe(false);
  });

  it('does not read anything when there is no bounty', async () => {
    const { result } = renderHook(() => useRequiredBond(null));
    await flush();

    expect(readRequiredBondMock).not.toHaveBeenCalled();
    expect(result.current).toEqual({ bond: 0n, ready: false });
  });

  it('resets to not-ready when the bounty id changes, then resolves the new bond', async () => {
    readRequiredBondMock.mockResolvedValueOnce(BOND).mockResolvedValueOnce(2n * BOND);

    const { result, rerender } = renderHook(({ id }: { id: number | null }) => useRequiredBond(id), {
      initialProps: { id: 7 as number | null },
    });
    await flush();
    expect(result.current.bond).toBe(BOND);

    rerender({ id: null });
    expect(result.current).toEqual({ bond: 0n, ready: false });

    rerender({ id: 9 });
    await flush();
    expect(readRequiredBondMock).toHaveBeenLastCalledWith(9);
    expect(result.current).toEqual({ bond: 2n * BOND, ready: true });
  });

  it('drops the result of a read that finishes after unmount', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolve: (value: bigint) => void = () => {};
    readRequiredBondMock.mockReturnValue(
      new Promise<bigint>((r) => {
        resolve = r;
      }),
    );

    const { unmount } = renderHook(() => useRequiredBond(7));
    unmount();

    await act(async () => {
      resolve(BOND);
      await Promise.resolve();
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
