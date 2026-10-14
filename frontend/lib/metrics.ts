// data/metrics.json, read defensively. It is edited by hand, so anything missing, null or
// the wrong shape becomes null here and renders "Not measured yet". Nothing is estimated.

export interface ConfusionMatrix {
  labels: string[];
  /** rows[actual][predicted] */
  rows: number[][];
}

export interface WiringRow {
  from: string;
  to: string;
  note: string | null;
}

export interface Credit {
  name: string;
  licence: string;
  url: string | null;
}

export interface Metrics {
  test_images_per_class: Record<string, number> | null;
  test_accuracy_per_class: Record<string, number> | null;
  overall_test_accuracy: number | null;
  latency_ms_p50: number | null;
  latency_ms_p95: number | null;
  ram_kb_peak: number | null;
  flash_kb: number | null;
  model_input: string | null;
  model_architecture: string | null;
  dataset_notes: string | null;
  confusion_matrix: ConfusionMatrix | null;
  ir_sensor: string | null;
  wiring: WiringRow[] | null;
  datasets: Credit[] | null;
  credits: Credit[] | null;
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function numberRecord(v: unknown): Record<string, number> | null {
  if (!isObject(v)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(v)) {
    const n = finite(value);
    if (n === null) return null;
    out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function fraction(v: unknown): number | null {
  const n = finite(v);
  return n !== null && n >= 0 && n <= 1 ? n : null;
}

function fractionRecord(v: unknown): Record<string, number> | null {
  const record = numberRecord(v);
  if (record === null) return null;
  return Object.values(record).every((n) => n >= 0 && n <= 1) ? record : null;
}

function confusion(v: unknown): ConfusionMatrix | null {
  if (!isObject(v) || !Array.isArray(v.labels) || !Array.isArray(v.rows)) return null;
  const labels = v.labels.map(text);
  if (labels.length === 0 || labels.some((l) => l === null)) return null;
  const size = labels.length;
  const rows: number[][] = [];
  for (const row of v.rows) {
    if (!Array.isArray(row) || row.length !== size) return null;
    const cells = row.map(finite);
    if (cells.some((c) => c === null || c < 0)) return null;
    rows.push(cells as number[]);
  }
  return rows.length === size ? { labels: labels as string[], rows } : null;
}

function list<T>(v: unknown, item: (entry: Json) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const entry of v) {
    const parsed = isObject(entry) ? item(entry) : null;
    if (parsed === null) return null;
    out.push(parsed);
  }
  return out.length > 0 ? out : null;
}

const credit = (e: Json): Credit | null => {
  const name = text(e.name);
  const licence = text(e.licence);
  return name && licence ? { name, licence, url: text(e.url) } : null;
};

export function parseMetrics(raw: unknown): Metrics {
  const m = isObject(raw) ? raw : {};
  return {
    test_images_per_class: numberRecord(m.test_images_per_class),
    test_accuracy_per_class: fractionRecord(m.test_accuracy_per_class),
    overall_test_accuracy: fraction(m.overall_test_accuracy),
    latency_ms_p50: finite(m.latency_ms_p50),
    latency_ms_p95: finite(m.latency_ms_p95),
    ram_kb_peak: finite(m.ram_kb_peak),
    flash_kb: finite(m.flash_kb),
    model_input: text(m.model_input),
    model_architecture: text(m.model_architecture),
    dataset_notes: text(m.dataset_notes),
    confusion_matrix: confusion(m.confusion_matrix),
    ir_sensor: text(m.ir_sensor),
    wiring: list(m.wiring, (e) => {
      const from = text(e.from);
      const to = text(e.to);
      return from && to ? { from, to, note: text(e.note) } : null;
    }),
    datasets: list(m.datasets, credit),
    credits: list(m.credits, credit),
  };
}

/** "glass_bottle" -> "Glass bottle". Formatting only; the item table lives on the server. */
export function labelText(label: string): string {
  const words = label.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
