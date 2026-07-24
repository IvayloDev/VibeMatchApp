// Circular progress ring (0..1) drawn with SVG. Sits absolutely over/around a
// circular button; caller sizes it to wrap the button.
import React from 'react';
import Svg, { Circle } from 'react-native-svg';

export function ProgressRing({
  size,
  stroke,
  progress,
  color,
  trackColor,
}: {
  size: number;
  stroke: number;
  progress: number;
  color: string;
  trackColor?: string;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  const half = size / 2;
  return (
    <Svg width={size} height={size} style={{ position: 'absolute' }} pointerEvents="none">
      {trackColor ? (
        <Circle cx={half} cy={half} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
      ) : null}
      <Circle
        cx={half}
        cy={half}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - p)}
        strokeLinecap="round"
        transform={`rotate(-90 ${half} ${half})`}
      />
    </Svg>
  );
}
