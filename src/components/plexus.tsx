/** Decoração "plexus" (pontos ligados por linhas finas) no topo das telas. Estática e só visual. */
const POINTS: [number, number][] = [
  [20, 40], [70, 18], [120, 62], [180, 30], [235, 78], [290, 22], [340, 64], [380, 120],
  [40, 120], [150, 130], [260, 150], [330, 190], [90, 190], [200, 210],
];
const LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [0, 8], [8, 2], [2, 9], [9, 4],
  [4, 10], [10, 6], [10, 11], [7, 11], [8, 12], [12, 9], [9, 13], [13, 10],
];

export function Plexus() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-x-0 top-0 -z-0 h-[240px] w-full text-[var(--plexus)] opacity-[var(--plexus-opacity)]"
      viewBox="0 0 400 240"
      preserveAspectRatio="xMidYMin slice"
    >
      <g stroke="currentColor" strokeWidth="0.6">
        {LINKS.map(([a, b]) => (
          <line key={`${a}-${b}`} x1={POINTS[a][0]} y1={POINTS[a][1]} x2={POINTS[b][0]} y2={POINTS[b][1]} />
        ))}
      </g>
      <g fill="currentColor">
        {POINTS.map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2" />
        ))}
      </g>
    </svg>
  );
}
