const houses = [
  { x: 200, y: 107 },
  { x: 106, y: 58 },
  { x: 58, y: 106 },
  { x: 98, y: 200 },
  { x: 58, y: 294 },
  { x: 106, y: 342 },
  { x: 200, y: 302 },
  { x: 294, y: 342 },
  { x: 342, y: 294 },
  { x: 302, y: 200 },
  { x: 342, y: 106 },
  { x: 294, y: 58 },
];

function KundliPlate() {
  return (
    <figure className="atlas-plate">
      <div className="atlas-plate-header">
        <span>FIG. 01</span>
        <span lang="sa">जन्मपत्रिका</span>
        <span>12 HOUSES</span>
      </div>
      <svg
        viewBox="0 0 400 400"
        role="img"
        aria-label="Illustrative North Indian kundli layout. The twelve houses run counterclockwise from Lagna, the first house at the top."
      >
        <defs>
          <pattern id="kundli-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <path d="M0 0V5" stroke="currentColor" strokeWidth=".7" />
          </pattern>
        </defs>
        <path d="M200 32 284 116 200 200 116 116Z" fill="currentColor" />
        <path d="M32 32H200L116 116ZM200 368H368L284 284Z" fill="url(#kundli-hatch)" opacity=".22" />
        <g fill="none" stroke="currentColor">
          <path d="M32 32H368V368H32ZM32 32 368 368M368 32 32 368M200 32 368 200 200 368 32 200Z" />
          <path d="M16 32h9m7-16v9m336-9v9m7 7h9M16 368h9m7 7v9m336-9v9m7-16h9" />
          <path d="M200 10v15m0 350v15M10 200h15m350 0h15" />
          <path d="M200 163v-9m-4 4h8" stroke="var(--lime)" />
        </g>
        <g className="atlas-chart-numerals" textAnchor="middle" dominantBaseline="middle">
          {houses.map(({ x, y }, index) => (
            <text key={index} x={x} y={y} fill={index === 0 ? 'var(--lime)' : 'currentColor'}>
              {String(index + 1).padStart(2, '0')}
            </text>
          ))}
        </g>
        <text className="atlas-chart-lagna" x="200" y="133" textAnchor="middle" fill="var(--lime)">LAGNA</text>
        <circle cx="200" cy="200" r="3" fill="currentColor" />
      </svg>
      <figcaption>
        <span>NORTH INDIAN KUNDLI</span>
        <span>HOUSE POSITIONS</span>
      </figcaption>
    </figure>
  );
}

export function BirthAtlasHero({ onBook }: { onBook: () => void }) {
  return (
    <section className="birth-atlas wrap" aria-labelledby="hero-title">
      <div className="atlas-index">
        <span><span className="atlas-index-dot" aria-hidden="true" /> VEDIC ASTROLOGY STUDIO</span>
        <span className="atlas-index-title">THE BIRTH ATLAS</span>
        <span lang="sa">ज्योतिष</span>
      </div>
      <div className="atlas-composition">
        <h1 id="hero-title" className="atlas-title">
          <span className="atlas-title-first">The sky</span>{' '}
          <span className="atlas-title-last">you were <em>born under.</em></span>
        </h1>
        <KundliPlate />
      </div>
      <div className="atlas-footer">
        <p>Read your birth chart with a Vedic astrologer. Bring a question about work, relationships, or what comes next.</p>
        <button className="atlas-book" onClick={onBook}>
          <span><strong>Book a consultation</strong><small>Online sessions from ₹200</small></span>
          <span className="atlas-book-arrow" aria-hidden="true">↗</span>
        </button>
        <a className="atlas-approach" href="#about">
          Our approach <span aria-hidden="true">↓</span>
        </a>
      </div>
    </section>
  );
}
