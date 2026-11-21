import { useEffect, useRef, useState } from 'react';
import { useExportWallet, usePrivy, useWallets } from '@privy-io/react-auth';
import { addressUrl, formatUsdc, network, readUsdcBalance } from '../../lib/arc';

const shorten = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Wallet chip with dropdown: balance, copy, export key, sign out. */
export default function WalletPanel() {
  const { logout } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { exportWallet } = useExportWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceErr, setBalanceErr] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const embedded = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0];
  const address = embedded?.address ?? null;

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setBalanceErr(false);
    const load = () =>
      readUsdcBalance(address)
        .then((v) => {
          if (!cancelled) setBalance(formatUsdc(v));
        })
        .catch(() => {
          if (!cancelled) setBalanceErr(true);
        });
    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [address]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="wallet-chip" ref={rootRef}>
      <button
        type="button"
        className="wallet-chip__btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Wallet menu"
      >
        <span className="wallet-chip__dot" aria-hidden="true" />
        {address ? shorten(address) : '…'}
      </button>

      {open && (
        <div className="wallet-chip__menu" role="menu">
          <div className="wallet-chip__row">
            <span className="wallet-chip__label">wallet</span>
            <span className="wallet-chip__tag">{network.name.toLowerCase()}</span>
          </div>
          {!walletsReady ? (
            <p className="wallet-chip__skeleton">loading…</p>
          ) : address ? (
            <>
              <div className="wallet-chip__address-row">
                <code>{shorten(address)}</code>
                <button type="button" className="wallet-chip__mini" onClick={copyAddress}>
                  {copied ? 'copied!' : 'copy'}
                </button>
              </div>
              <div className="wallet-chip__balance-row">
                <span className="wallet-chip__label">balance</span>
                {balanceErr ? (
                  <span className="wallet-chip__muted">read failed</span>
                ) : (
                  <span className="wallet-chip__balance">{balance ?? '…'} usdc</span>
                )}
              </div>
              <a
                className="wallet-chip__link"
                href={addressUrl(address)}
                target="_blank"
                rel="noopener noreferrer"
              >
                view on arc explorer ↗
              </a>
              {network.faucetUrl && (
                <a className="wallet-chip__link" href={network.faucetUrl} target="_blank" rel="noopener noreferrer">
                  get testnet usdc (circle faucet) ↗
                </a>
              )}
              <button type="button" className="wallet-chip__action" onClick={() => exportWallet({ address })}>
                export private key
              </button>
              <p className="wallet-chip__fine">opens privy's confirmation flow — your key stays yours.</p>
              <button type="button" className="wallet-chip__action wallet-chip__action--danger" onClick={() => logout()}>
                sign out
              </button>
            </>
          ) : (
            <p className="wallet-chip__fine">no embedded wallet linked yet — sign in again to create one.</p>
          )}
        </div>
      )}
    </div>
  );
}
