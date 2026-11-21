import { useGameSocket } from '../../features/game/GameSocket';

export default function Toasts() {
  const { toasts } = useGameSocket();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) =>
        t.href ? (
          <a key={t.id} className="toast toast--link" href={t.href} target="_blank" rel="noopener noreferrer">
            {t.message} ↗
          </a>
        ) : (
          <div key={t.id} className="toast">
            {t.message}
          </div>
        ),
      )}
    </div>
  );
}
