import { createReadStream, createWriteStream, existsSync } from "node:fs";

/**
 * JSONL writer.
 *
 * IMPORTANT — escapes U+2028 / U+2029 in the serialised JSON.  Both are
 * valid characters inside JSON strings, but Node treats them as line
 * terminators in the `readline` module (ECMAScript line-terminator
 * semantics include them).  Polish judgment HTML from SAOS occasionally
 * contains a literal U+2028, and unescaped output causes a `readline`-
 * based reader to split a single record across multiple "lines".  Every
 * line emitted here MUST be one full JSON object.
 *
 * We build the regex via `new RegExp(...)` so the `\u`-escapes are
 * parsed at *string* level; a regex literal would refuse the raw chars
 * because regex grammar still treats them as line terminators.
 */
const RE_UNICODE_LS_PS = new RegExp("[\\u2028\\u2029]", "g");

function safeStringify(obj: unknown): string {
  return JSON.stringify(obj).replace(RE_UNICODE_LS_PS, (c) =>
    c === " " ? "\\u2028" : "\\u2029",
  );
}

export function openJsonlWriter(path: string) {
  const stream = createWriteStream(path, { encoding: "utf8" });
  return {
    write(obj: unknown) {
      stream.write(`${safeStringify(obj)}\n`);
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.end(() => resolve());
        stream.once("error", reject);
      });
    },
  };
}

/**
 * JSONL reader that splits ONLY on `\n` — never on `\r`, U+2028, or
 * U+2029.  Trailing `\r` on a line (CRLF input) is trimmed.  Streams
 * chunk-by-chunk, so memory stays bounded for arbitrarily large files.
 */
export async function* readJsonl<T>(path: string): AsyncGenerator<T> {
  if (!existsSync(path)) return;
  const stream = createReadStream(path, { encoding: "utf8" });
  let buffer = "";
  for await (const chunk of stream) {
    buffer += chunk;
    let newlineAt: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard chunk-scan
    while ((newlineAt = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineAt);
      buffer = buffer.slice(newlineAt + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.trim()) continue;
      yield JSON.parse(line) as T;
    }
  }
  if (buffer.trim()) {
    yield JSON.parse(buffer) as T;
  }
}
