import * as React from 'react';
import { Box, Text } from '../../ink.js';

export type ClawdPose = 'default' | 'arms-up' | 'look-left' | 'look-right';

type Props = {
  pose?: ClawdPose;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TODO-Lab0: 修改下面的 COLOR_MAP，给你的吉祥物换颜色
//
// 每个颜色是一个 [R, G, B] 数组，取值 0-255
// 试试改几个值，重新构建 (node build.mjs --lab 0)，看看变化
//
// 提示:
//   红色 = [255, 0, 0]
//   金色 = [255, 215, 0]
//   绿色 = [0, 200, 0]
//   紫色 = [180, 100, 255]
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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

// TODO-Lab0: 修改下面的颜色值！
// 'W' 是羊毛颜色，试试把它从白色换成你喜欢的颜色
// 'B' 是描边颜色，'F' 是脸色，'E' 是眼睛颜色，'P' 是耳朵颜色
const COLOR_MAP: Record<string, [number, number, number] | null> = {
  '.': null,
  'B': [120, 165, 210],   // 描边
  'W': [255, 215, 0],     // 羊毛 ← 改这里试试（当前是金色）
  'F': [235, 205, 190],   // 脸
  'E': [55, 75, 125],     // 眼睛
  'P': [225, 185, 155],   // 耳朵
};

function renderSheep(pose: ClawdPose): string[] {
  const grid = [...BASE_GRID];
  grid[6] = EYES[pose].row6;

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
