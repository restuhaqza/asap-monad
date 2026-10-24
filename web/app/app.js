import {
  createPublicClient, createWalletClient, custom, http,
  formatEther, parseEther, parseAbi, parseAbiItem,
} from 'https://esm.sh/viem@2';

import { CHAIN, REGISTRY, BOUNTY, FROM_BLOCK, EXPLORER, STATUS } from './config.js';

/* ── clients ─────────────────────────────────────────────────────────── */

// The public RPC allows 15 requests/sec, so reads are batched and paced.
const publicClient = createPublicClient({ chain: CHAIN, transport: http() });
let wallet = null;
let account = null;

/* ── abi ─────────────────────────────────────────────────────────────── */

const registryAbi = parseAbi([
  'event HotspotPublished(uint256 indexed id, int32 latE6, int32 lonE6, uint16 frpDeci, uint32 acqTime, uint8 confidence, bytes32 indexed batchId)',
  'function hotspotCount() view returns (uint256)',
  'function getHotspot(uint256 id) view returns ((int32 latE6, int32 lonE6, uint16 frpDeci, uint32 acqTime, uint8 confidence, bool exists, bytes32 batchId))',
]);

const bountyAbi = parseAbi([
  'event BountyOpened(uint256 indexed bountyId, uint256 indexed hotspotId, address indexed backer, uint96 pool, uint64 deadline)',
  'function bountyCount() view returns (uint256)',
  'function getBounty(uint256 bountyId) view returns ((uint256 hotspotId, address backer, uint96 pool, uint64 deadline, uint256 activeClaim, uint8 status))',
  'function getClaim(uint256 claimId) view returns ((uint256 bountyId, address responder, uint96 bond, int32 latE6, int32 lonE6, uint32 capturedAt, bytes32 evidenceHash, uint16 approvals, uint16 rejections, bool settled))',
  'function requiredBond(uint256 bountyId) view returns (uint256)',
  'function isVerifier(address who) view returns (bool)',
  'function openBounty(uint256 hotspotId, uint32 ttl) payable returns (uint256)',
  'function claim(uint256 bountyId, string evidenceCid, int32 latE6, int32 lonE6, uint32 capturedAt) payable returns (uint256)',
  'function attest(uint256 claimId, bool approve)',
]);

/* ── state ───────────────────────────────────────────────────────────── */

const hotspots = new Map();   // id -> { id, lat, lon, frp, acqTime, confidence }
const bounties = new Map();   // bountyId -> { bountyId, hotspotId, pool, deadline, activeClaim, status }
const byHotspot = new Map();  // hotspotId -> bountyId
let selected = null;
let verifier = false;
let totalCount = 0;

/* ── helpers ─────────────────────────────────────────────────────────── */

const $ = (id) => document.getElementById(id);
const short = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
const statusOf = (hotspotId) => {
  const bid = byHotspot.get(hotspotId);
  if (!bid) return 0;
  return bounties.get(bid)?.status ?? 0;
};
const poolOf = (hotspotId) => {
  const bid = byHotspot.get(hotspotId);
  return bid ? bounties.get(bid).pool : 0n;
};

function toast(msg, busy = false) {
  const el = $('toast');
  $('toast-msg').textContent = msg;
  $('toast-icon').innerHTML = busy ? '<span class="spin"></span>' : '<span class="dot"></span>';
  el.classList.add('on');
  return () => el.classList.remove('on');
}

function timeWIB(unix) {
  return new Date(unix * 1000).toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

/* ── wallet ──────────────────────────────────────────────────────────── */

async function ensureChain() {
  const hex = '0x' + CHAIN.id.toString(16);
  try {
    await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (err) {
    if (err.code !== 4902) throw err;
    await window.ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hex,
        chainName: CHAIN.name,
        nativeCurrency: CHAIN.nativeCurrency,
        rpcUrls: CHAIN.rpcUrls.default.http,
        blockExplorerUrls: [CHAIN.blockExplorers.default.url],
      }],
    });
  }
}

async function connect() {
  if (!window.ethereum) throw new Error('No injected wallet found — install MetaMask or Rabby');
  const [addr] = await window.ethereum.request({ method: 'eth_requestAccounts' });
  await ensureChain();
  account = addr;
  wallet = createWalletClient({ account, chain: CHAIN, transport: custom(window.ethereum) });
  $('connect').textContent = short(addr);
  $('connect').classList.remove('btn-primary');
  verifier = await publicClient.readContract({
    address: BOUNTY, abi: bountyAbi, functionName: 'isVerifier', args: [addr],
  }).catch(() => false);
  render();
}

/* ── data ────────────────────────────────────────────────────────────── */

/* Reads are paced: the public RPC allows 15 requests/sec and caps eth_getLogs at
   100 blocks. So we read state id by id in small waves, paint progressively, and
   cache the result locally so a reload is instant. */
const CACHE_KEY = 'asap.hotspots.v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function load() {
  const count = Number(await publicClient.readContract({
    address: REGISTRY, abi: registryAbi, functionName: 'hotspotCount',
  }));
  totalCount = count;

  const cached = readCache();
  if (cached && cached.count === count) {
    cached.rows.forEach((h) => hotspots.set(h.id, h));
  }

  await refreshBounties();

  // ids are ordered by FRP at publish time, so the first N are the biggest fires.
  const MAX_SHOWN = 80;
  const wanted = Number((location.hash.match(/h=(\d+)/) || [])[1]);
  const ids = Array.from({ length: count }, (_, i) => i + 1)
    .filter((id) => !hotspots.has(id)).slice(0, MAX_SHOWN);
  const wave = 10;

  for (let i = 0; i < ids.length; i += wave) {
    const slice = ids.slice(i, i + wave);
    const rows = await Promise.all(slice.map((id) =>
      publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'getHotspot', args: [BigInt(id)] })
        .catch(() => null)));

    rows.forEach((d, k) => {
      if (!d || !d.exists) return;
      hotspots.set(slice[k], {
        id: slice[k],
        lat: Number(d.latE6) / 1e6,
        lon: Number(d.lonE6) / 1e6,
        latE6: Number(d.latE6),
        lonE6: Number(d.lonE6),
        frp: Number(d.frpDeci) / 10,
        acqTime: Number(d.acqTime),
        confidence: Number(d.confidence),
      });
    });

    if (i === 0) drawMarkers();
    if (wanted && !selected && hotspots.has(wanted)) select(wanted);
    render();
    if (i + wave < ids.length) await sleep(1100);
  }

  // one retry pass for anything the limiter rejected
  const missing = ids.filter((id) => !hotspots.has(id));
  for (let i = 0; i < missing.length; i += 6) {
    const slice = missing.slice(i, i + 6);
    const rows = await Promise.all(slice.map((id) =>
      publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'getHotspot', args: [BigInt(id)] })
        .catch(() => null)));
    rows.forEach((d, k) => {
      if (!d || !d.exists) return;
      hotspots.set(slice[k], {
        id: slice[k], lat: Number(d.latE6) / 1e6, lon: Number(d.lonE6) / 1e6,
        latE6: Number(d.latE6), lonE6: Number(d.lonE6),
        frp: Number(d.frpDeci) / 10, acqTime: Number(d.acqTime), confidence: Number(d.confidence),
      });
    });
    if (i + 6 < missing.length) await sleep(1200);
  }

  drawMarkers();
  render();
  writeCache(count);
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.at > 15 * 60 * 1000) return null;
    return parsed;
  } catch { return null; }
}

function writeCache(count) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      at: Date.now(), count, rows: [...hotspots.values()],
    }));
  } catch { /* private mode, ignore */ }
}

async function refreshBounties() {
  bounties.clear();
  byHotspot.clear();
  const total = Number(await publicClient.readContract({
    address: BOUNTY, abi: bountyAbi, functionName: 'bountyCount',
  }));
  if (!total) return;

  const ids = Array.from({ length: total }, (_, i) => i + 1);
  const wave = 12;
  for (let i = 0; i < ids.length; i += wave) {
    const slice = ids.slice(i, i + wave);
    const rows = await Promise.all(slice.map((id) =>
      publicClient.readContract({ address: BOUNTY, abi: bountyAbi, functionName: 'getBounty', args: [BigInt(id)] })
        .catch(() => null)));
    rows.forEach((d, k) => {
      if (!d) return;
      const id = slice[k];
      bounties.set(id, {
        bountyId: id,
        hotspotId: Number(d.hotspotId),
        backer: d.backer,
        pool: d.pool,
        deadline: Number(d.deadline),
        activeClaim: Number(d.activeClaim),
        status: Number(d.status),
      });
      const prev = byHotspot.get(Number(d.hotspotId));
      // one hotspot can collect several bounties; surface the biggest one
      if (prev === undefined || d.pool > bounties.get(prev).pool) byHotspot.set(Number(d.hotspotId), id);
    });
    if (i + wave < ids.length) await sleep(850);
  }
}

/* ── map ─────────────────────────────────────────────────────────────── */

const map = L.map('map', { zoomControl: false, attributionControl: true }).setView([-2.2, 113.5], 5);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 14, minZoom: 3, attribution: 'Tiles © Esri · hotspots © NASA FIRMS',
}).addTo(map);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
  maxZoom: 14, minZoom: 3,
}).addTo(map);

const markers = new Map();

function drawMarkers() {
  for (const h of hotspots.values()) {
    if (markers.has(h.id)) continue;
    const st = statusOf(h.id);
    const color = STATUS[st].color;
    const r = Math.max(3, Math.min(10, 3 + Math.sqrt(h.frp) / 3));
    const m = L.circleMarker([h.lat, h.lon], {
      radius: r, color, weight: 1, fillColor: color, fillOpacity: st === 4 ? 0.5 : 0.8,
    }).addTo(map);
    m.bindTooltip(
      `<span style="font-family:'JetBrains Mono',monospace;font-size:10px">#${h.id} · ${h.frp.toFixed(0)} MW</span>`,
      { direction: 'top' },
    );
    m.on('click', () => select(h.id));
    markers.set(h.id, m);
  }
}

function recolor() {
  for (const [id, m] of markers) {
    const c = STATUS[statusOf(id)].color;
    m.setStyle({ color: c, fillColor: c, weight: selected === id ? 3 : 1 });
    if (selected === id) m.setStyle({ color: '#fff' });
  }
}

/* ── render ──────────────────────────────────────────────────────────── */

function render() {
  const list = [...hotspots.values()].sort((a, b) => b.frp - a.frp);
  const open = [...bounties.values()].filter((b) => b.status === 1);
  const escrow = [...bounties.values()].reduce((s, b) => s + b.pool, 0n);

  $('s-hotspots').textContent = hotspots.size;
  $('s-open').textContent = open.length;
  $('s-escrow').textContent = Number(formatEther(escrow)).toFixed(3);
  $('b-count').textContent = hotspots.size;
  $('b-total').textContent = totalCount || hotspots.size;

  $('list').innerHTML = list.map((h) => {
    const st = statusOf(h.id);
    const s = STATUS[st];
    const pool = poolOf(h.id);
    return `<button class="row ${selected === h.id ? 'sel' : ''}" data-id="${h.id}">
      <span class="sw" style="background:${s.color}"></span>
      <span>
        <span class="coords mono">${h.lat.toFixed(3)}, ${h.lon.toFixed(3)}</span>
        <span class="sub block">${h.frp.toFixed(0)} MW · ${timeWIB(h.acqTime)}</span>
      </span>
      <span class="right">
        <span class="coords mono">${pool ? Number(formatEther(pool)).toFixed(3) + ' MON' : '—'}</span>
        <span class="sub block" style="color:${s.color}">${st === 4 ? 'no responder' : s.label}</span>
      </span>
    </button>`;
  }).join('');

  document.querySelectorAll('.row').forEach((el) =>
    el.addEventListener('click', () => select(Number(el.dataset.id))));

  if (selected) openDetail(selected);
  recolor();
}

async function select(id) {
  selected = id;
  const h = hotspots.get(id);
  map.flyTo([h.lat, h.lon], Math.max(map.getZoom(), 7), { duration: 0.6 });
  render();
}

async function openDetail(id) {
  const h = hotspots.get(id);
  const st = statusOf(id);
  const bid = byHotspot.get(id);
  const b = bid ? bounties.get(bid) : null;
  const bond = b ? await publicClient.readContract({
    address: BOUNTY, abi: bountyAbi, functionName: 'requiredBond', args: [BigInt(bid)],
  }).catch(() => 0n) : 0n;

  $('detail').classList.add('on');
  $('d-id').textContent = '#' + id;
  $('d-coords').textContent = `${h.lat.toFixed(4)}, ${h.lon.toFixed(4)}`;
  $('d-frp').textContent = h.frp.toFixed(0) + ' MW';
  $('d-time').textContent = timeWIB(h.acqTime);
  $('d-pool').textContent = b ? Number(formatEther(b.pool)).toFixed(3) + ' MON' : '—';
  $('d-bond').textContent = b ? Number(formatEther(bond)).toFixed(3) + ' MON' : '—';

  const pill = $('d-status');
  pill.textContent = st === 4 ? 'no responder' : STATUS[st].label;
  pill.style.background = STATUS[st].color + '22';
  pill.style.color = STATUS[st].color;

  const c = $('controls');
  const renderKey = `${id}:${st}:${bid}:${account ? 1 : 0}`;
  if (c.dataset.key === renderKey) return;
  c.dataset.key = renderKey;
  const cta = account
    ? ''
    : `<div class="hint">Connect a wallet on Monad Testnet to fund, claim or attest.</div>`;

  if (!b) {
    c.innerHTML = `
      <div class="field">
        <input id="f-amount" value="0.05" placeholder="MON" />
        <input id="f-ttl" value="6" placeholder="hours" style="max-width:90px" />
      </div>
      <div class="actions"><button class="btn btn-primary" id="f-open" ${account ? '' : 'disabled'}>Open bounty</button></div>
      <div class="hint">Escrow is funded by whoever carries the risk — a concession, a carbon project, a CSR budget, or BPBD.</div>
      ${cta}`;
    const btn = $('f-open');
    if (btn) btn.onclick = () => tx('openBounty', [
      BigInt(id), BigInt(Math.round(Number($('f-ttl').value || 6) * 3600)),
    ], parseEther($('f-amount').value || '0'));
  } else if (st === 1) {
    c.innerHTML = `
      <div class="ev-row">
        <button type="button" class="ev-btn" id="f-pick"><span class="ev-ico">＋</span> Choose file</button>
        <button type="button" class="ev-btn" id="f-cam"><span class="ev-ico">◉</span> Take photo</button>
      </div>
      <input id="f-file" type="file" accept="image/*" class="sr-input" />
      <input id="f-cam-input" type="file" accept="image/*" capture="environment" class="sr-input" />
      <img id="f-preview" class="ev-preview" hidden alt="evidence preview" />
      <div class="hint" id="f-state">Evidence must be captured within 25 km of the hotspot and after the satellite pass.</div>
      <div class="field"><input id="f-cid" placeholder="or paste an IPFS CID / URL" /></div>
      <div class="actions"><button class="btn btn-primary" id="f-claim" disabled>Claim · bond ${Number(formatEther(bond)).toFixed(3)} MON</button></div>
      <div class="hint">Add evidence first — a photo or a URL. Bond ≥ pool is slashed if two verifiers reject.</div>
      ${cta}`;

    let evidenceRef = '';
    const claimBtn = $('f-claim');
    const gate = () => {
      const hasEvidence = Boolean(evidenceRef) || Boolean($('f-cid').value.trim());
      claimBtn.disabled = !account || !hasEvidence;
    };
    $('f-cid').addEventListener('input', gate);

    const handleFile = async (file) => {
      if (!file) return;
      $('f-state').textContent = 'Compressing…';
      try {
        const blob = await compress(file);
        $('f-preview').src = URL.createObjectURL(blob);
        $('f-preview').hidden = false;
        $('f-state').textContent = `Uploading ${(blob.size / 1024).toFixed(0)} KB…`;
        const res = await uploadEvidence(blob);
        evidenceRef = new URL(res.url, location.origin).href;
        $('f-state').innerHTML = `Stored · <span class="mono">sha256 ${res.sha256.slice(0, 12)}…</span>`;
        gate();
      } catch (err) {
        evidenceRef = '';
        $('f-state').textContent = 'Upload failed: ' + (err.message || err) + ' — paste a URL instead.';
        gate();
      }
    };

    // programmatic clicks: a display:none input is refused by some browsers,
    // so the inputs stay in the layout but visually hidden
    $('f-pick').onclick = () => $('f-file').click();
    $('f-cam').onclick = () => $('f-cam-input').click();
    for (const el of [$('f-file'), $('f-cam-input')]) {
      el.onchange = () => {
        const file = el.files?.[0];
        el.value = '';
        handleFile(file);
      };
    }

    gate();
    const btn = claimBtn;
    if (btn) btn.onclick = () => tx('claim', [
      BigInt(bid), evidenceRef || $('f-cid').value.trim() || 'ipfs://unset', h.latE6, h.lonE6, BigInt(Math.floor(Date.now() / 1000)),
    ], bond);
  } else if (st === 2) {
    const claimId = b.activeClaim;
    c.innerHTML = verifier
      ? `<div class="actions">
           <button class="btn btn-primary" id="f-yes">Approve · attest(${claimId}, true)</button>
           <button class="btn btn-ghost" id="f-no" style="color:var(--dead);border-color:rgba(255,92,92,.35)">Reject</button>
         </div>
         <div class="hint">Two approvals settle the claim and pay the responder. Two rejections slash the bond and reopen the bounty.</div>`
      : `<div class="hint">Claim #${claimId} is awaiting verifier quorum. Connect a verifier wallet to attest.</div>`;
    if (verifier) {
      $('f-yes').onclick = () => tx('attest', [BigInt(claimId), true], 0n);
      $('f-no').onclick = () => tx('attest', [BigInt(claimId), false], 0n);
    }
  } else {
    c.innerHTML = `<div class="hint">${st === 3
      ? 'Claim verified. The responder has been paid on-chain.'
      : 'Bounty expired — the backer was refunded, and the row stays public as a fire nobody answered.'}</div>`;
  }

  $('d-trail').innerHTML = bid
    ? `Bounty <a href="${EXPLORER}/address/${BOUNTY}" target="_blank" rel="noreferrer">#${bid}</a>
       · backer ${short(b.backer)} · deadline ${timeWIB(b.deadline)}`
    : `Hotspot record <a href="${EXPLORER}/address/${REGISTRY}" target="_blank" rel="noreferrer">#${id}</a> · anchored to the FIRMS source file hash`;
}


/* ── evidence upload ─────────────────────────────────────────────────── */

function compress(file, max = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('compress failed'))), 'image/jpeg', quality);
    };
    img.onerror = () => reject(new Error('cannot read image'));
    img.src = URL.createObjectURL(file);
  });
}

async function uploadEvidence(blob) {
  const res = await fetch('/api/evidence', {
    method: 'POST',
    headers: { 'content-type': 'image/jpeg' },
    body: blob,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `upload failed (${res.status})`);
  return body;
}

/* ── transactions ────────────────────────────────────────────────────── */

async function tx(fn, args, value) {
  if (!wallet) return;
  const done = toast('Confirm in your wallet…', true);
  try {
    const hash = await wallet.writeContract({
      address: BOUNTY, abi: bountyAbi, functionName: fn, args,
      value, account, chain: CHAIN,
    });
    done();
    const t = toast(`Sent ${hash.slice(0, 10)}… waiting for settlement`, true);
    await publicClient.waitForTransactionReceipt({ hash });
    t();
    toast(`Settled · ${hash.slice(0, 10)}…`);
    // refresh only the changed bounty
    await refreshBounties();
    render();
    openDetail(selected);
  } catch (err) {
    done();
    toast(short(err.shortMessage || err.message || String(err)));
  }
}

/* ── boot ────────────────────────────────────────────────────────────── */

$('connect').onclick = () => connect().catch((e) => toast(short(e.message)));

(async () => {
  const done = toast('Reading hotspots from Monad…', true);
  try {
    await load();
    drawMarkers();
    render();
    done();
    toast(`${hotspots.size} hotspots on-chain · ${bounties.size} bounties`);
    if (wanted && hotspots.has(wanted)) select(wanted);
  } catch (err) {
    done();
    const detail = err.details || err.cause?.message || '';
    toast(`RPC error: ${err.shortMessage || err.message} ${detail} ${err.status || ''}`.trim());
    console.error(err);
  }
})();
