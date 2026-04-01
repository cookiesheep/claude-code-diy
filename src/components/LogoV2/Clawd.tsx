import { c as _c } from "react/compiler-runtime";
import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { env } from '../../utils/env.js';
export type ClawdPose = 'default' | 'arms-up' | 'look-left' | 'look-right';

type Props = {
  pose?: ClawdPose;
};

// CookieSheep — pixel art sheep logo
// 19 wide x 18 tall pixel grid, rendered as 9 rows using half-block chars
// Colors: .=空 B=蓝描边 W=白羊毛 F=粉脸 E=深蓝眼 P=桃色耳
type EyeVariant = { row6: string };
const EYES: Record<ClawdPose, EyeVariant> = {
  default:      { row6: '.BWWWFEEFFFFEEFWB..' },
  'look-left':  { row6: '.BWWFEEFFFFF.EEFWB.' },
  'look-right': { row6: '.BWWWF.EEFFFEEFWB..' },
  'arms-up':    { row6: '.BWWWFEEFFFFEEFWB..' },
};

const BASE_GRID = [
  '.....PP.WWW.PP.....',  // 0  ears
  '....BWWWWWWWWB.....',  // 1  wool top
  '...BWWWWWWWWWWB....',  // 2  wool expand
  '..BWWWWWWWWWWWWB...',  // 3  full wool
  '.BWWWWWWWWWWWWWWB..',  // 4  wool wide
  '.BWWWWFFFFFFWWWWB..',  // 5  face appears
  '.BWWWFEEFFFFEEFWB..',  // 6  eyes (replaced per pose)
  '.BWWWWFFFFFFWWWWB..',  // 7  face
  '..BWWWFF.B.FFWWB...',  // 8  nose
  '..BWWWWFFFFFFWWB...',  // 9  lower face
  '...BWWWWWWWWWWB....',  // 10 body
  '...BWWWWWWWWWWB....',  // 11 body
  '....BWWWWWWWWB.....',  // 12 narrowing
  '.....BWWWWWWB......',  // 13 bottom
  '.....BBBBBBBB......',  // 14 leg join
  '......BB.BB........',  // 15 legs
  '......BB.BB........',  // 16 legs
  '......BB.BB........',  // 17 feet
];

const COLOR_MAP: Record<string, [number,number,number] | null> = {
  '.': null,
  'B': [120,165,210],   // blue outline
  'W': [245,245,250],   // white wool
  'F': [235,205,190],   // pink face
  'E': [55,75,125],     // dark blue eyes
  'P': [225,185,155],   // peach ears
};

function renderSheep(pose: ClawdPose): string[] {
  const grid = [...BASE_GRID];
  grid[6] = EYES[pose].row6;

  // Arms-up: modify ears row
  if (pose === 'arms-up') {
    grid[0] = '..PP.PP.WWW.PP.PP..';
  }

  const lines: string[] = [];
  for (let y = 0; y < grid.length; y += 2) {
    const top = grid[y];
    const bot = grid[y + 1] || '.'.repeat(19);
    let line = '';
    for (let x = 0; x < 19; x++) {
      const t = top[x], b = bot[x];
      const tc = COLOR_MAP[t], bc = COLOR_MAP[b];
      if (!tc && !bc) {
        line += ' ';
      } else if (t === b && tc) {
        line += `\x1b[38;2;${tc[0]};${tc[1]};${tc[2]}m█\x1b[0m`;
      } else if (tc && !bc) {
        line += `\x1b[38;2;${tc[0]};${tc[1]};${tc[2]}m▀\x1b[0m`;
      } else if (!tc && bc) {
        line += `\x1b[38;2;${bc[0]};${bc[1]};${bc[2]}m▄\x1b[0m`;
      } else if (tc && bc) {
        line += `\x1b[38;2;${tc[0]};${tc[1]};${tc[2]}m\x1b[48;2;${bc[0]};${bc[1]};${bc[2]}m▀\x1b[0m`;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function Clawd(t0: Props = {}): React.ReactNode {
  const { pose = 'default' } = t0;
  const lines = renderSheep(pose);

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
}
