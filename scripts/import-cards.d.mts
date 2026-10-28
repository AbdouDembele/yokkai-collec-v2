export type ImportedCard = Record<string, string | number | null> & {
  source: string;
  source_id: string;
  image_url: string;
};

export function deriveSourceId(row: Record<string, string>): string;
export function imageUrlFromCsvRow(row: Record<string, string>): string;
export function splitFranchises(value: string): string[];
export function validateCard(row: Record<string, string | null>): ImportedCard;
export function validateImageBytes(bytes: Buffer, contentType: string): void;
export function imagePath(card: ImportedCard): string;
export function downloadImage(
  url: string
): Promise<{ bytes: Buffer; contentType: string; finalUrl: string }>;
export function prepareStorage(client: unknown, bucket: string): Promise<void>;
export function importCards(options: Record<string, unknown>): Promise<{
  read: number;
  imported: number;
  valid: number;
  skipped: number;
  duplicates: number;
  batches: number;
}>;
