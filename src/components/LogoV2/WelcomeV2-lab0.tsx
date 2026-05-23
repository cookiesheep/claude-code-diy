import React from 'react';
import { Box, Text } from '../../ink.js';
import { Clawd } from './Clawd.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TODO-Lab0: 默认保持 Claude Code。
//
// 如果你想做个性化，可以把 WELCOME_TEXT 改成自己的欢迎语。
// 改完之后重新构建 (node build.mjs --lab 0)
// 启动 TUI (node cli.js)，看看欢迎语是否变了
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const WELCOME_TEXT = "Welcome to Claude Code";

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
