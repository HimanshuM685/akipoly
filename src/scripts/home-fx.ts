/**
 * Home page extras: scroll reveal, pointer parallax, sparkle trail and
 * confetti bursts. Purely decorative; skipped entirely for reduced motion.
 */
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

import { bit, burst } from './fx-lib';

function init() {
  if (reduced) return;
  document.documentElement.classList.add('fx-ready');

  // Step cards pop in as they scroll into view.
  const steps = document.querySelectorAll<HTMLElement>('.home__step');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.2 },
    );
    steps.forEach((s) => io.observe(s));
  } else {
    steps.forEach((s) => s.classList.add('is-in'));
  }

  // Medallion parallax follows the pointer.
  const art = document.querySelector<HTMLElement>('.home__art');
  if (art && finePointer) {
    window.addEventListener(
      'pointermove',
      (e) => {
        const nx = (e.clientX / window.innerWidth - 0.5) * 2;
        const ny = (e.clientY / window.innerHeight - 0.5) * 2;
        art.style.setProperty('--px', nx.toFixed(3));
        art.style.setProperty('--py', ny.toFixed(3));
      },
      { passive: true },
    );
  }

  // Click the logo: squish + confetti.
  const brand = document.querySelector<HTMLElement>('.home__brand');
  brand?.addEventListener('click', (e) => {
    const r = brand.getBoundingClientRect();
    brand.animate(
      [{ scale: 1 }, { scale: 0.88 }, { scale: 1.1 }, { scale: 1 }],
      { duration: 420, easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)' },
    );
    burst(r.left + r.width / 2, r.top + r.height / 2, 18);
    void e;
  });

  // Sparkle trail behind the pointer (desktop only, throttled).
  if (finePointer) {
    let last = 0;
    window.addEventListener(
      'pointermove',
      (e) => {
        const now = performance.now();
        if (now - last < 70) return;
        last = now;
        const size = 10 + Math.random() * 10;
        const el = bit(e.clientX, e.clientY, size);
        const dx = (Math.random() - 0.5) * 40;
        el.animate(
          [
            { transform: `translate(${e.clientX}px, ${e.clientY}px) scale(0.3) rotate(0deg)`, opacity: 0.9 },
            { transform: `translate(${e.clientX + dx}px, ${e.clientY + 34}px) scale(1) rotate(120deg)`, opacity: 0 },
          ],
          { duration: 700, easing: 'ease-out' },
        ).finished.then(() => el.remove(), () => el.remove());
      },
      { passive: true },
    );
  }

  // Waitlist success: celebrate.
  const success = document.getElementById('waitlist-success');
  if (success) {
    new MutationObserver(() => {
      if (!success.hidden) {
        const r = success.getBoundingClientRect();
        burst(r.left + r.width / 2, r.top + Math.min(r.height / 2, 80), 28);
      }
    }).observe(success, { attributes: true, attributeFilter: ['hidden'] });
  }
}

init();
