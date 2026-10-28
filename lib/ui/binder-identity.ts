export type BinderIdentity = {
  binderKey?: string;
  license: string;
  origin?: "series" | "source";
};

export type CardBinder = {
  key: string;
  name: string;
  origin: "series" | "source";
  searchNames?: string[];
};

// Legacy previews remain readable; live stable-binder RPCs always return a key.
export const binderIdentity = (binder: BinderIdentity) =>
  binder.binderKey ?? binder.license;
export const isStableBinderKey = (value: string) =>
  /^(series:[0-9a-f-]{36}|source:[0-9a-f]{64})$/.test(value);
export const binderWidgetLabel = (
  widget: { labels?: Record<string, string> },
  key: string
) =>
  widget.labels?.[key] ?? (isStableBinderKey(key) ? "Unavailable binder" : key);
