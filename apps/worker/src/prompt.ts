import { createInterface, type Interface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Minimal interactive prompts over readline — no external deps.
 * Used only by `aiw worker init`.
 */
export class Prompt {
  private rl: Interface;

  constructor() {
    this.rl = createInterface({ input: stdin, output: stdout });
  }

  async text(question: string, fallback = ""): Promise<string> {
    const suffix = fallback ? ` (${fallback})` : "";
    const answer = (await this.rl.question(`${question}${suffix}: `)).trim();
    return answer || fallback;
  }

  async confirm(question: string, defaultYes = true): Promise<boolean> {
    const hint = defaultYes ? "Y/n" : "y/N";
    const answer = (await this.rl.question(`${question} [${hint}]: `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer.startsWith("y");
  }

  /** Single choice from a list; returns the selected option's value. */
  async select<T extends string>(
    question: string,
    options: { label: string; value: T }[],
    defaultIndex = 0,
  ): Promise<T> {
    stdout.write(`${question}\n`);
    options.forEach((o, i) => {
      const marker = i === defaultIndex ? "›" : " ";
      stdout.write(`  ${marker} ${i + 1}) ${o.label}\n`);
    });
    const raw = (await this.rl.question(`Choose [1-${options.length}] (${defaultIndex + 1}): `)).trim();
    const idx = raw ? Number(raw) - 1 : defaultIndex;
    const chosen = options[Number.isInteger(idx) && idx >= 0 && idx < options.length ? idx : defaultIndex];
    return chosen!.value;
  }

  /** Multi-select by comma-separated numbers; returns selected values. */
  async multiSelect<T extends string>(
    question: string,
    options: { label: string; value: T; preselected?: boolean }[],
  ): Promise<T[]> {
    stdout.write(`${question} (comma-separated numbers)\n`);
    options.forEach((o, i) => {
      const marker = o.preselected ? "✓" : " ";
      stdout.write(`  [${marker}] ${i + 1}) ${o.label}\n`);
    });
    const preselected = options.filter((o) => o.preselected).map((o) => o.value);
    const defaultLabel = preselected.length ? "all detected" : "none";
    const raw = (await this.rl.question(`Select [${defaultLabel}]: `)).trim();
    if (!raw) return preselected;
    const picks = raw
      .split(",")
      .map((s) => Number(s.trim()) - 1)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < options.length)
      .map((i) => options[i]!.value);
    return picks;
  }

  close(): void {
    this.rl.close();
  }
}
