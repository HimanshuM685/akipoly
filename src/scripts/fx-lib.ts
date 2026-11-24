/** Shared decorative-motion helpers (confetti stars). */
export const COLORS = ['#FFF500', '#FF80B5', '#9DB7FB', '#B8F28B', '#A78BFA', '#FF6B4A'];
export const STAR = (fill: string, size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 72 72" aria-hidden="true"><polygon points="36,2 41.5,26.5 66,32 41.5,37.5 36,62 30.5,37.5 6,32 30.5,26.5" fill="${fill}" stroke="#171717" stroke-width="5" stroke-linejoin="round"/></svg>`;

export const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

export function bit(x: number, y: number, size: number) {
  const el = document.createElement('span');
  el.className = 'fx-bit';
  el.innerHTML = STAR(pick(COLORS), size);
  document.body.appendChild(el);
  return el;
}

export function burst(x: number, y: number, count = 16) {
  for (let i = 0; i < count; i++) {
    const el = bit(x, y, 12 + Math.random() * 16);
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = 70 + Math.random() * 110;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist - 30;
    const spin = (Math.random() - 0.5) * 540;
    el.animate(
      [
        { transform: `translate(${x}px, ${y}px) scale(0.2) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${x + dx}px, ${y + dy}px) scale(1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.55 },
        { transform: `translate(${x + dx}px, ${y + dy + 90}px) scale(0.6) rotate(${spin}deg)`, opacity: 0 },
      ],
      { duration: 900 + Math.random() * 400, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
    ).finished.then(() => el.remove(), () => el.remove());
  }
}
