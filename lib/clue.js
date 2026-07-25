// Check if a clue has a complete answer (answer length matches pattern length)
export function hasCompleteAnswer(clue) {
  const answer = clue.answer || '';
  const pattern = clue.pattern || '';
  return answer.length > 0 && answer.length === pattern.length;
}
