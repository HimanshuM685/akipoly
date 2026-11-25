import { useEffect, useState } from 'react';
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { chain, network } from '../lib/arc';
import { GameSocketProvider, useGameSocket } from '../features/game/GameSocket';
import WalletPanel from './dashboard/WalletPanel';
import LobbyBrowser from './dashboard/LobbyBrowser';
import LobbyRoom from './dashboard/LobbyRoom';
import LiveGame from './dashboard/LiveGame';
import CareerPanel from './dashboard/CareerPanel';
import GameReview from './dashboard/GameReview';
import LeaderboardPanel from './dashboard/LeaderboardPanel';
import Toasts from './dashboard/Toasts';

const APP_ID = import.meta.env.PUBLIC_PRIVY_APP_ID as string | undefined;

type Screen =
  | { name: 'lobbies' }
  | { name: 'table'; lobbyId: string }
  | { name: 'career' }
  | { name: 'review'; gameId: string }
  | { name: 'leaderboard' };

type Tab = 'play' | 'career' | 'leaderboard';

const tabOf = (s: Screen): Tab =>
  s.name === 'career' || s.name === 'review' ? 'career' : s.name === 'leaderboard' ? 'leaderboard' : 'play';

/** A lobby before the game, the live game after. One subscription for both. */
function Table({ lobbyId, onLeave }: { lobbyId: string; onLeave: () => void }) {
  const { lobby, lobbyGone, game, watchLobby } = useGameSocket();

  useEffect(() => {
    watchLobby(lobbyId);
    return () => watchLobby(null);
  }, [lobbyId, watchLobby]);

  if (lobbyGone) {
    return (
      <div className="room">
        <p className="dash__copy">this room doesn&apos;t exist anymore.</p>
        <button type="button" className="btn dash__btn" onClick={onLeave}>
          back to rooms
        </button>
      </div>
    );
  }
  if (!lobby || lobby.id !== lobbyId) return <p className="room__loading">finding a seat…</p>;
  if (game) return <LiveGame lobby={lobby} game={game} onLeave={onLeave} />;
  return <LobbyRoom lobby={lobby} onLeave={onLeave} />;
}

function DashboardGate() {
  const { ready, authenticated, login } = usePrivy();
  const [screen, setScreen] = useState<Screen>({ name: 'lobbies' });
  const tab = tabOf(screen);

  if (!ready) {
    return (
      <div className="dash__loading" role="status">
        warming up the table…
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="dash__stack signin">
        <h2 className="dash__heading">sign in to claim your seat.</h2>
        <p className="dash__copy">
          sign in to claim it. your wallet is created on {network.name.toLowerCase()} — no seed
          phrases, no ceremony.
        </p>
        <ol className="signin__steps">
          <li className="signin__step signin__step--a">
            <span className="signin__num" aria-hidden="true">1</span>
            <strong>sign in</strong>
            <span>email or google. your wallet appears.</span>
          </li>
          <li className="signin__step signin__step--b">
            <span className="signin__num" aria-hidden="true">2</span>
            <strong>pick a room</strong>
            <span>create one or join with a code.</span>
          </li>
          <li className="signin__step signin__step--c">
            <span className="signin__num" aria-hidden="true">3</span>
            <strong>call it</strong>
            <span>higher or lower. last one standing wins.</span>
          </li>
        </ol>
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
            className={`dash__navbtn ${tab === 'play' ? 'dash__navbtn--active' : ''}`}
            onClick={() => setScreen({ name: 'lobbies' })}
          >
            play
          </button>
          <button
            type="button"
            className={`dash__navbtn ${tab === 'career' ? 'dash__navbtn--active' : ''}`}
            onClick={() => setScreen({ name: 'career' })}
          >
            career
          </button>
          <button
            type="button"
            className={`dash__navbtn ${tab === 'leaderboard' ? 'dash__navbtn--active' : ''}`}
            onClick={() => setScreen({ name: 'leaderboard' })}
          >
            leaderboard
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

      {screen.name === 'career' && (
        <CareerPanel
          onReview={(gameId) => setScreen({ name: 'review', gameId })}
          onOpenTable={(lobbyId) => setScreen({ name: 'table', lobbyId })}
        />
      )}

      {screen.name === 'review' && (
        <GameReview gameId={screen.gameId} onBack={() => setScreen({ name: 'career' })} />
      )}

      {screen.name === 'leaderboard' && <LeaderboardPanel />}
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
        // Coinbase Smart Wallet doesn't support Arc; only offer the regular
        // Coinbase Wallet (EOA). Also silences Privy's "chains are not
        // supported by Coinbase Smart Wallet" console notice.
        externalWallets: {
          coinbaseWallet: { config: { preference: { options: 'eoaOnly' } } },
        },
      }}
    >
      <DashboardGate />
    </PrivyProvider>
  );
}
