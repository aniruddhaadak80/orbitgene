import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

export const alt = `${site.name} — ${site.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * OpenGraph card.
 *
 * Drawn with the same plate metaphor as the product rather than a stock gradient:
 * a 96-well grid with one lit well and the score ring from the same visual scale.
 */
export default function OpengraphImage() {
  const wells = [];
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 12; col += 1) {
      const lit = row === 3 && col === 6;
      wells.push(
        <circle
          key={`${row}-${col}`}
          cx={140 + col * 78}
          cy={210 + row * 46}
          r={17}
          fill={lit ? '#a3e635' : '#0d1117'}
          stroke={lit ? '#a3e635' : '#1c2430'}
          strokeWidth={2}
        />,
      );
    }
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: '#07090c',
          color: '#e6edf3',
          fontFamily: 'monospace',
          flexDirection: 'column',
          padding: 56,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 14, height: 14, borderRadius: 999, background: '#22d3ee' }} />
          <div style={{ fontSize: 26, letterSpacing: 6, fontWeight: 700 }}>{site.name}</div>
        </div>

        <div style={{ fontSize: 60, fontWeight: 700, marginTop: 34, lineHeight: 1.08, maxWidth: 900 }}>
          Should this mutation get an oligo, a photodiode and a launch slot?
        </div>

        <div style={{ fontSize: 22, color: '#9aa7b4', marginTop: 18, maxWidth: 860 }}>
          Flight-readiness triage for DNA assay hardware, with the arithmetic shown.
        </div>

        <div style={{ display: 'flex', marginTop: 44, alignItems: 'flex-start' }}>
          {wells}
        </div>

        <div style={{ display: 'flex', gap: 34, marginTop: 'auto', fontSize: 19, color: '#6b7885' }}>
          <span>UniProt</span>
          <span>RefSeq</span>
          <span>NOAA SWPC</span>
          <span style={{ color: '#22d3ee' }}>SHA-384 sealed</span>
          <span>MCP JSON-RPC</span>
        </div>
      </div>
    ),
    size,
  );
}