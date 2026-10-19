// PreToolUse gate: pesquisa needs the keyword "Buscar"; security-audit/security-fix need "Banana".
// The keyword must appear in the delegation prompt, which only happens when the user asked for it.
// Allowing = exit 0 with no output. Blocking = print a PreToolUse deny decision.
const GATES = { pesquisa: 'Buscar', 'security-audit': 'Banana', 'security-fix': 'Banana' };

let raw = '';
process.stdin.on('data', d => raw += d);
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); } // not our concern -> allow
  const { subagent_type: agent, prompt = '' } = input.tool_input ?? {};
  const keyword = GATES[agent];
  if (!keyword || prompt.toLowerCase().includes(keyword.toLowerCase())) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `O agente "${agent}" só é ativado quando o usuário usa a palavra-chave "${keyword}".`,
    },
  }));
  process.exit(0);
});
