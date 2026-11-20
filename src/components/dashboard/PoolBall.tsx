import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

// Pool ball colors (1–15, 0 = cue white). Ink-outlined to match the neobrutalist style.
const BALL_COLORS: Record<number, number> = {
  1: 0xffd700,
  2: 0x0000ff,
  3: 0xff0000,
  4: 0x800080,
  5: 0xffa500,
  6: 0x008000,
  7: 0x800000,
  8: 0x000000,
  9: 0xffd700,
  10: 0x0000ff,
  11: 0xff0000,
  12: 0x800080,
  13: 0xffa500,
  14: 0x008000,
  15: 0x800000,
  0: 0xffffff,
};

interface Props {
  ball: number | null;
  spinning: boolean;
  size?: number;
}

export default function PoolBall({ ball, spinning, size = 140 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [, setSize] = useState({ w: size, h: size });

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const color = BALL_COLORS[ball ?? 0] ?? 0xffffff;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 3;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(setSize.w, setSize.h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(3, 5, 5);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const geometry = new THREE.SphereGeometry(1, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.2,
      metalness: 0.1,
      flatShading: true,
    });
    const sphere = new THREE.Mesh(geometry, material);
    scene.add(sphere);

    // Ink outline: scaled-up wireframe sphere behind the solid one.
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x171717, linewidth: 2 })
    );
    line.scale.setScalar(1.02);
    scene.add(line);

    let frame: number;
    const tick = () => {
      const t = performance.now() * 0.002;
      if (!reduced) {
        const speed = spinning ? 0.06 : 0.02;
        sphere.rotation.x = t * speed;
        sphere.rotation.y = t * speed * 0.7;
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(tick);
    };
    tick();

    const onResize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const w = rect.width * dpr;
      const h = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      renderer.setSize(w, h, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      geometry.dispose();
      material.dispose();
    };
  }, [ball, spinning, setSize.w, setSize.h]);

  return (
    <div
      className="pool-ball-wrap"
      style={{ width: size, height: size, position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <canvas className="pool-ball" ref={ref} style={{ width: size, height: size }} />
      {ball != null && (
        <span
          className="pool-ball__number"
          style={{
            position: 'absolute',
            fontFamily: 'Chango, Arial Black, sans-serif',
            fontSize: size * 0.5,
            lineHeight: 1,
            color: ball === 8 ? '#fffdf2' : '#171717',
            userSelect: 'none',
          }}
        >
          {ball}
        </span>
      )}
    </div>
  );
}
