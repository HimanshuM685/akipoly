import { useState } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { arcTestnet } from 'viem/chains';
import WalletPanel from './dashboard/WalletPanel';
import LobbyBrowser from './dashboard/LobbyBrowser';
import LobbyRoom from './dashboard/LobbyRoom';
import LiveGame from './dashboard/LiveGame';
import CareerPanel from './dashboard/CareerPanel';

const APP_ID = import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined;

type Screen =
  | { name: 'lobbies' }
  | { name: 'lobby'; lobbyId: string }
  | { name: 'game'; gameId: string; lobbyId: string }
  | { name: 'career' };

function DashboardGate() {
  const { ready, authenticated, login } = usePrivy();
  const [screen, setScreen] = useState<Screen>({ name: 'lobbies' });

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

  return (
    <div className="dash__shell">
      <div className="dash__topbar">
        <nav className="dash__nav" aria-label="Dashboard sections">
          <button
            type="button"
            className={`dash__navbtn ${screen.name === 'lobbies' || screen.name === 'lobby' || screen.name === 'game' ? 'dash__navbtn--active' : ''}`}
            onClick={() => setScreen({ name: 'lobbies' })}
          >
            play
          </button>
          <button
            type="button"
            className={`dash__navbtn ${screen.name === 'career' ? 'dash__navbtn--active' : ''}`}
            onClick={() => setScreen({ name: 'career' })}
          >
            career
          </button>
        </nav>
        <WalletPanel />
      </div>

      {screen.name === 'lobbies' && (
        <LobbyBrowser onOpen={(lobbyId) => setScreen({ name: 'lobby', lobbyId })} />
      )}

      {screen.name === 'lobby' && (
        <LobbyRoom
          lobbyId={screen.lobbyId}
          onDone={() => setScreen({ name: 'lobbies' })}
          onGameStarted={(gameId) => setScreen({ name: 'game', lobbyId: screen.lobbyId, gameId })}
        />
      )}

      {screen.name === 'game' && (
        <LiveGame gameId={screen.gameId} onLobbyLeft={() => setScreen({ name: 'lobbies' })} />
      )}

      {screen.name === 'career' && <CareerPanel />}
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
