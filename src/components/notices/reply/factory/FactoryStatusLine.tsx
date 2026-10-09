// The Reply Factory's status line: only a problem (the AI reader stopped, or
// today's spending cap reached); nothing on a normal day (the firm's request of
// 9 October 2026). The figures it used to repeat are on the AI and Overview tabs.
import React from 'react';
import { ProblemLine } from '@/components/notices/ui/ProblemLine';
import { factoryHref, type ReplyFactoryStatus } from '@/lib/replyFactory';
import { runnerWords } from '@/lib/noticeAi';

export const FactoryStatusLine: React.FC<{ s: ReplyFactoryStatus | undefined }> = ({ s }) => {
  if (!s) return null;
  const ai = s.ai;
  const on = !!ai.settings?.read_enabled;
  const cap = ai.settings?.daily_cap_usd ?? 0;
  const capped = on && cap > 0 && ai.spend_today_usd >= cap;
  const edge = (ai.settings?.runner ?? 'edge') === 'edge';
  const reader = edge ? runnerWords(ai.runner, on) : null;
  const readerOk = edge ? reader?.tone === 'success' : ai.agent_online;
  return (
    <ProblemLine problems={[
      on && !readerOk && { key: 'reader', text: edge ? `The AI reader is not running: ${reader?.text.toLowerCase()}` : 'The office agent that reads notices is offline', to: factoryHref('ai') },
      capped && { key: 'cap', text: 'Today\'s AI spending cap is reached; reading resumes tomorrow', to: factoryHref('ai') },
    ]} />
  );
};

export default FactoryStatusLine;
