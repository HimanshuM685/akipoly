import { useEffect, useState } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { chain, network } from '../lib/arc';
import { GameSocketProvider, useGameSocket } from '../features/game/GameSocket';
import WalletPanel from './dashboard/WalletPanel';
import LobbyBrowser from './dashboard/LobbyBrowser';
import LobbyRoom from './dashboard/LobbyRoom';
import LiveGame from './dashboard/LiveGame';
import CareerPanel from './dashboard/CareerPanel';
import Toasts from './dashboard/Toasts';

const APP_ID = import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined;

type Screen = { name: 'lobbies' } | { name: 'table'; lobbyId: string } | { name: 'career' };

/** A lobby before the game, the live game after. One subscription for both. */
function Table({ lobbyId, onLeave }: { lobbyId: string; onLeave: () => void }) {
  const { lobby, game, watchLobby } = useGameSocket();

  useEffect(() => {
    watchLobby(lobbyId);
    return () => watchLobby(null);
  }, [lobbyId, watchLobby]);

  if (!lobby || lobby.id !== lobbyId) return <p className="room__loading">finding a seat…</p>;
  if (game) return <LiveGame lobby={lobby} game={game} onLeave={onLeave} />;
  return <LobbyRoom lobby={lobby} onLeave={onLeave} />;
}

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
          sign in to claim it. your wallet is created on {network.name.toLowerCase()} — no seed
          phrases, no ceremony.
        </p>
        <button type="button" className="btn btn--lg dash__btn" onClick={login}>
          sign in
        </button>
        <p className="dash__fineprint">
          first sign in creates your akipoly wallet on {network.name.toLowerCase()}. games are played in real
          usdc{network.faucetUrl ? ' (free test usdc from the circle faucet)' : ''}.
        </p>
      </div>
    );
  }

  return (
    <GameSocketProvider>
    <div className="dash__shell">
      <Toasts />
      <div className="dash__topbar">
        <nav className="dash__nav" aria-label="Dashboard sections">
          <button
            type="button"
            className={`dash__navbtn ${screen.name !== 'career' ? 'dash__navbtn--active' : ''}`}
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
        <LobbyBrowser onOpen={(lobbyId) => setScreen({ name: 'table', lobbyId })} />
      )}

      {screen.name === 'table' && (
        <Table lobbyId={screen.lobbyId} onLeave={() => setScreen({ name: 'lobbies' })} />
      )}

      {screen.name === 'career' && <CareerPanel />}
    </div>
    </GameSocketProvider>
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
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <DashboardGate />
    </PrivyProvider>
  );
}
