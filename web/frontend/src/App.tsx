/** The whole dashboard: header, map, rail, detail panel and one global toast. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DetailPanel } from './components/DetailPanel';
import { Header } from './components/Header';
import { HotspotList } from './components/HotspotList';
import { MapView, type MapViewHandle } from './components/MapView';
import { Toast } from './components/Toast';
import { useBountyActions } from './hooks/useBountyActions';
import { useDeepLink } from './hooks/useDeepLink';
import { useHotspots } from './hooks/useHotspots';
import { useToast } from './hooks/useToast';
import { useWallet } from './hooks/useWallet';
import { countOpen, sortByFrpDesc, statusMap, totalEscrow } from './lib/bounties';
import { errorMessage } from './lib/errors';

export default function App() {
  const { toast, show } = useToast();
  const wallet = useWallet();
  const data = useHotspots();

  const [selected, setSelected] = useState<number | null>(null);
  const mapRef = useRef<MapViewHandle | null>(null);

  const select = useCallback(
    (id: number) => {
      setSelected(id);
      const hotspot = data.byId.get(id);
      if (hotspot) mapRef.current?.flyTo(hotspot.lat, hotspot.lon);
    },
    [data.byId],
  );

  // `#h=<id>` opens the hotspot the moment its row lands, not at the end of the load.
  useDeepLink(data.hotspots, select);

  const sorted = useMemo(() => sortByFrpDesc(data.hotspots), [data.hotspots]);
  const statuses = useMemo(() => statusMap(data.byHotspot), [data.byHotspot]);
  const openCount = useMemo(() => countOpen(data.bounties), [data.bounties]);
  const escrow = useMemo(() => totalEscrow(data.bounties), [data.bounties]);

  const selectedHotspot = selected === null ? null : (data.byId.get(selected) ?? null);
  const selectedBounty = selected === null ? null : (data.byHotspot.get(selected) ?? null);

  const actions = useBountyActions({
    account: wallet.account,
    walletClient: wallet.walletClient,
    show,
    onConfirmed: data.refreshBounties,
  });

  const handleConnect = useCallback(() => {
    void wallet.connect().catch((error: unknown) => show(errorMessage(error)));
  }, [show, wallet]);

  // Busy toast for the whole paced read, then a one-line summary.
  useEffect(() => {
    if (!data.loading) return;
    return show('Reading hotspots from Monad…', true);
  }, [data.loading, show]);

  const summarised = useRef(false);
  useEffect(() => {
    if (data.loading) return;
    if (data.error) {
      show(`RPC error: ${data.error}`);
      return;
    }
    if (summarised.current) return;
    summarised.current = true;
    show(`${data.hotspots.length} hotspots on-chain · ${data.bounties.length} bounties`);
  }, [data.loading, data.error, data.hotspots.length, data.bounties.length, show]);

  return (
    <>
      <div className="app">
        <Header
          hotspotCount={data.hotspots.length}
          openCount={openCount}
          escrowWei={escrow}
          loading={data.loading}
          account={wallet.account}
          connecting={wallet.connecting}
          onConnect={handleConnect}
        />

        <main>
          <MapView
            ref={mapRef}
            hotspots={data.hotspots}
            statuses={statuses}
            selected={selected}
            hotspotCount={data.hotspots.length}
            totalCount={data.totalCount}
            onSelect={select}
          />

          <aside>
            <div className="rail-head">
              <h2>Hotspots</h2>
              <p>
                Read directly from <span className="mono">HotspotRegistry</span> · no indexer
              </p>
            </div>

            <HotspotList
              hotspots={sorted}
              byHotspot={data.byHotspot}
              selected={selected}
              onSelect={select}
            />

            {selectedHotspot && (
              <DetailPanel
                key={selectedHotspot.id}
                hotspot={selectedHotspot}
                bounty={selectedBounty}
                isVerifier={wallet.isVerifier}
                account={wallet.account}
                onOpenBounty={(hotspotId, ttlSeconds, amountWei) => {
                  void actions.openBounty(hotspotId, ttlSeconds, amountWei);
                }}
                onClaim={(bountyId, evidence, latE6, lonE6, capturedAt, bondWei) => {
                  void actions.claim(bountyId, evidence, latE6, lonE6, capturedAt, bondWei);
                }}
                onAttest={(claimId, approve) => {
                  void actions.attest(claimId, approve);
                }}
              />
            )}
          </aside>
        </main>
      </div>

      <Toast toast={toast} />
    </>
  );
}
