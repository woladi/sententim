import { createReadStream, createWriteStream } from "node:fs";
import { existsSync } from "node:fs";
import readline from "node:readline";

export function openJsonlWriter(path: string) {
  const stream = createWriteStream(path, { encoding: "utf8" });
  return {
    write(obj: unknown) {
      stream.write(`${JSON.stringify(obj)}\n`);
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.end(() => resolve());
        stream.once("error", reject);
      });
    },
  };
}

export async function* readJsonl<T>(path: string): AsyncGenerator<T> {
  if (!existsSync(path)) return;
  const rl = readline.createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    yield JSON.parse(line) as T;
  }
}
