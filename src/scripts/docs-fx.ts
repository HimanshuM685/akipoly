/**
 * Docs page extras: reveal sections as they are read, pointer parallax on
 * the hero art, confetti on the mascot and the call-to-action.
 * Decorative only; skipped for reduced motion.
 */
import { burst } from './fx-lib';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

function init() {
  if (reduced) return;
  document.documentElement.classList.add('fx-ready');

  // Cards play their entrance (badge pop, marker draw, staggered text) once.
  const cards = document.querySelectorAll<HTMLElement>('.docs__card');
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
      { threshold: 0.18 },
    );
    cards.forEach((c) => io.observe(c));
  } else {
    cards.forEach((c) => c.classList.add('is-in'));
  }

  // Hero art follows the pointer a little.
  const art = document.querySelector<HTMLElement>('.docs__art');
  if (art && finePointer) {
    window.addEventListener(
      'pointermove',
      (e) => {
        art.style.setProperty('--px', ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
        art.style.setProperty('--py', ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
      },
      { passive: true },
    );
  }

  // Click the mascot: squish + confetti. The art block is aria-hidden, so
  // this is a pure bonus for people who poke at things.
  const head = document.querySelector<HTMLElement>('.docs__art-head');
  head?.addEventListener('click', () => {
    const r = head.getBoundingClientRect();
    head.animate([{ scale: 1 }, { scale: 0.85 }, { scale: 1.12 }, { scale: 1 }], {
      duration: 420,
      easing: 'cubic-bezier(0.3, 1.4, 0.5, 1)',
    });
    burst(r.left + r.width / 2, r.top + r.height / 2, 16);
  });

  // The CTA button throws a little confetti on its way to the home page.
  document.querySelector<HTMLElement>('.docs__cta .btn')?.addEventListener('pointerenter', (e) => {
    if (!finePointer) return;
    burst(e.clientX, e.clientY, 8);
  });
}

init();
