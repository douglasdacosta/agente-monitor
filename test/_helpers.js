import { readFileSync } from 'node:fs';
export const fixture = (name) =>
  readFileSync(new URL(`../fixtures/${name}.jsonl`, import.meta.url), 'utf8');
