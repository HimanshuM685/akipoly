import { useEffect, useState } from 'react';
import { PrivyProvider, usePrivy, useWallets } from '@privy-io/react-auth';
import { createPublicClient, formatUnits, getAddress, http } from 'viem';
import { arcTestnet } from 'viem/chains';

const APP_ID = import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined;
const arcClient = createPublicClient({ chain: arcTestnet, transport: http() });
const EXPLORER =
  arcTestnet.blockExplorers?.default.url ?? 'https://explorer.testnet.arc.io';

const shorten = (address: string) =>
  `${address.slice(0, 6)}…${address.slice(-4)}`;

function ArcBalance({ address }: { address: string }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [balance, setBalance] = useState<string | null>(null);

  const load = () => {
    setState('loading');
    arcClient
      .getBalance({ address: getAddress(address) })
      .then((value) => {
        setBalance(Number(formatUnits(value, 18)).toFixed(4));
        setState('ok');
      })
      .catch(() => setState('error'));
  };

  useEffect(load, [address]);

  if (state === 'loading') return <span className="dash__balance-skeleton">…</span>;
  if (state === 'error')
    return (
      <button type="button" className="dash__linklike" onClick={load}>
        couldn't read arc right now — try again
      </button>
    );
  return <span className="dash__balance">{balance} usdc</span>;
}

function DashboardGate() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const [copied, setCopied] = useState(false);

  if (!ready) {
    return (
      <div className="dash__loading" role="status">
        warming up the table…
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="dash__stack">
        <h2 className="dash__heading">sign in to claim your seat.</h2>
        <p className="dash__copy">
          sign in to claim it. your wallet is created on arc testnet — no seed
          phrases, no ceremony.
        </p>
        <button type="button" className="btn btn--lg dash__btn" onClick={login}>
          sign in
        </button>
        <p className="dash__fineprint">
          first sign in creates your akipoly wallet on arc testnet. that's it.
        </p>
      </div>
    );
  }

  const embedded = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0];
  const address =
    embedded?.address ??
    (user?.linkedAccounts.find((account) => account.type === 'wallet') as
      | { address?: string }
      | undefined)?.address ??
    null;
  const email =
    user?.linkedAccounts.find((account) => account.type === 'email') as
      | { address?: string }
      | undefined;

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — the address is on screen regardless */
    }
  };

  return (
    <div className="dash__stack">
      <h2 className="dash__heading">you're in.</h2>
      <p className="dash__copy">
        welcome to the board. this is your wallet, on arc testnet — play
        money, real moves.
      </p>

      <div className="dash__wallet">
        <div className="dash__wallet-row">
          <span className="dash__wallet-label">wallet</span>
          <span className="dash__wallet-tag">arc testnet</span>
        </div>
        {!walletsReady ? (
          <span className="dash__balance-skeleton">…</span>
        ) : address ? (
          <>
            <div className="dash__address-row">
              <code className="dash__address">{shorten(address)}</code>
              <button type="button" className="dash__copybtn" onClick={copyAddress}>
                {copied ? 'copied!' : 'copy'}
              </button>
            </div>
            <div className="dash__balance-row">
              <span className="dash__wallet-label">balance</span>
              <ArcBalance address={address} />
            </div>
            <a
              className="dash__explorer"
              href={`${EXPLORER}/address/${address}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              view on arc explorer ↗
            </a>
          </>
        ) : (
          <p className="dash__fineprint">
            your wallet is still provisioning — give it a second.
          </p>
        )}
        {email?.address && (
          <p className="dash__fineprint">signed in as {email.address}</p>
        )}
      </div>

      <button type="button" className="btn dash__btn dash__signout" onClick={logout}>
        sign out
      </button>
      <p className="dash__fineprint">
        leaving the table loses nothing — your wallet stays linked to this account.
      </p>
    </div>
  );
}

export default function Dashboard() {
  if (!APP_ID) {
    return (
      <div className="dash__stack">
        <h2 className="dash__heading">not configured yet.</h2>
        <p className="dash__copy">
          set <code>PUBLIC_PRIVY_APP_ID</code> in your environment and reload.
          the app secret never goes in the client, so it can't be the fallback.
        </p>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
        loginMethods: ['email', 'google'],
        defaultChain: arcTestnet,
        supportedChains: [arcTestnet],
      }}
    >
      <DashboardGate />
    </PrivyProvider>
  );
}
