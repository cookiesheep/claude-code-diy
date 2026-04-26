import React from 'react';
import { Box, Text } from '../../ink.js';
import { Clawd } from './Clawd.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TODO-Lab0: 把 "YOUR_NAME" 换成你自己的名字
//
// 改完之后重新构建 (node build.mjs --lab 0)
// 启动 TUI (node cli.js)，看看欢迎语是否变了
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const OWNER = "YOUR_NAME";

const WELCOME_TEXT = `Welcome to ${OWNER}'s claude-code`;

export function WelcomeV2() {
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="claude">{WELCOME_TEXT}</Text>{' '}
        <Text dimColor>v{MACRO.VERSION}</Text>
      </Text>
      <Text>{' '}</Text>
      <Clawd />
    </Box>
  );
}
