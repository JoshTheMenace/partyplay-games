/** Score disjoint complete sets and useful pairs, using only this seat's cards. */
export function handValue(cards: readonly number[]): number {
  const memo = new Map<number, number>();
  const color = (id: number) => Math.floor((id - 1) / 3);
  function visit(mask: number): number {
    if (!mask) return 0;
    if (memo.has(mask)) return memo.get(mask)!;
    const i = cards.findIndex((_, index) => mask & (1 << index)), rest = mask ^ (1 << i);
    let best = visit(rest);
    for (let j = i + 1; j < cards.length; j++) if (rest & (1 << j)) {
      if (color(cards[i]) === color(cards[j])) best = Math.max(best, 8 + visit(rest ^ (1 << j)));
      for (let k = j + 1; k < cards.length; k++) if (rest & (1 << k)) {
        if (cards[i] === cards[j] && cards[j] === cards[k] || color(cards[i]) === color(cards[j]) && color(cards[j]) === color(cards[k]) && new Set([cards[i], cards[j], cards[k]]).size === 3) best = Math.max(best, 100 + visit(rest ^ (1 << j) ^ (1 << k)));
      }
    }
    memo.set(mask, best); return best;
  }
  return visit((1 << cards.length) - 1);
}
export function chooseDraw(hand: readonly number[], piles: readonly number[][], ownSeat = -1): 'deck' | number {
  let from: 'deck' | number = 'deck', best = handValue(hand);
  piles.forEach((pile, index) => { const top = pile.at(-1); if (top === undefined) return; const value = handValue([...hand, top]); if (value > best && (index !== ownSeat || value >= 300)) { best = value; from = index; } });
  return from;
}
export function chooseDiscard(hand: readonly number[], random: number): number {
  const values = hand.map((_, i) => handValue(hand.filter((_, j) => i !== j))), best = Math.max(...values);
  const choices = hand.filter((_, i) => values[i] === best);
  return choices[Math.min(choices.length - 1, Math.floor(random * choices.length))];
}
