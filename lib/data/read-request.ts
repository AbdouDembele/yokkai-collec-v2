export const READ_TIMEOUT_MS = 15_000;

// Read-only: mutations must never be cancelled or retried by this helper.
export async function readRequest<T>(load: (signal: AbortSignal) => PromiseLike<T>, timeout = READ_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("The request timed out after 15 seconds. Please try again."));
    }, timeout);
  });
  try { return await Promise.race([Promise.resolve().then(() => load(controller.signal)), expired]); }
  finally { clearTimeout(timer!); }
}

export type PageCheckpoint<T> = { rows: T[]; cursor?: string };
export async function resumePages<T extends { id: string }>(checkpoint: PageCheckpoint<T>, size: number, read: (cursor?: string) => Promise<T[]>): Promise<T[]> {
  while (true) {
    const page = await read(checkpoint.cursor);
    checkpoint.rows.push(...page);
    if (page.length < size) return checkpoint.rows;
    checkpoint.cursor = page[page.length - 1].id;
  }
}
