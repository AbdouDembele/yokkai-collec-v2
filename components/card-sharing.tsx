"use client";
import { useTranslations } from "next-intl";

import { cardRarityLabel } from "@/lib/ui/card-rarity-label";
import { useEffect, useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import {
  cardShareUrl,
  createCardShare,
  deleteCardShare,
  listCardShares,
  type CardShare
} from "@/lib/data/card-shares";

const previewWarning =
  "Previews already posted on Discord, WhatsApp, or X may remain visible after you delete the link.";

export function CardShareButton({
  instanceId,
  name,
  iconOnly = false
}: {
  iconOnly?: boolean;
  instanceId: string;
  name: string;
}) {
  const tu = useTranslations("collectionShared");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="secondary"
        aria-label={iconOnly ? tu("shareNamedCard", { name }) : undefined}
        title={iconOnly ? tu("share") : undefined}
        onClick={() => setOpen(true)}
      >
        {iconOnly ? (
          <svg
            aria-hidden="true"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 16V3m-5 5 5-5 5 5M5 13v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
          </svg>
        ) : (
          tu("share")
        )}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={tu("shareNamedCard", { name })}
      >
        {open && (
          <ShareSheet key={instanceId} instanceId={instanceId} name={name} />
        )}
      </Modal>
    </>
  );
}

function ShareSheet({
  instanceId,
  name
}: {
  instanceId: string;
  name: string;
}) {
  const [showPseudo, setShowPseudo] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const nativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(
          reason instanceof Error ? reason.message : "Action unavailable."
        );
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function download(format: "story" | "square") {
    const response = await fetch(`${url}/image/${format}`, {
      cache: "no-store"
    });
    if (!response.ok || response.headers.get("Content-Type") !== "image/png") {
      throw new Error(
        "The image is unavailable. Please try again in a moment."
      );
    }
    const blobUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = `yokkai-${format}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-2">
        The image shown on your card will be published, including your custom
        image if you have one. An existing link will be updated with this image.
        You can create up to 10 new links per UTC day.
      </p>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={showPseudo}
          disabled={busy}
          onChange={event => {
            setShowPseudo(event.target.checked);
            setUrl("");
            setMessage("");
          }}
        />
        Show my username
      </label>
      {!url ? (
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () =>
              setUrl(
                cardShareUrl(await createCardShare(instanceId, showPseudo))
              )
            )
          }
        >
          {busy ? "Creating…" : "Create link"}
        </Button>
      ) : (
        <>
          <label className="block text-sm">
            Public link
            <input
              className="auth-input mt-2"
              readOnly
              value={url}
              onFocus={event => event.currentTarget.select()}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(url);
                  setMessage("Link copied");
                })
              }
            >
              Copy link
            </Button>
            {nativeShare && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await navigator.share({ title: name, url });
                  })
                }
              >
                Share link
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => download("story"))}
            >
              Download story
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void run(() => download("square"))}
            >
              Download square image
            </Button>
          </div>
        </>
      )}
      {message && (
        <p role="status" className="text-sm text-ink-2">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <p className="text-xs text-ink-3">{previewWarning}</p>
    </div>
  );
}

export function MyCardShares() {
  const tu = useTranslations("collectionShared");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {tu("mySharedLinks")}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={tu("mySharedLinks")}
      >
        {open && <ShareList />}
      </Modal>
    </>
  );
}

function ShareList() {
  const [rows, setRows] = useState<CardShare[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<CardShare | null>(null);
  const [deleting, setDeleting] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void listCardShares(offset).then(
      value => {
        if (active) {
          setRows(value);
          setLoading(false);
        }
      },
      reason => {
        if (active) {
          setError(reason.message);
          setLoading(false);
        }
      }
    );
    return () => {
      active = false;
    };
  }, [offset, revision]);
  function page(value: number) {
    setLoading(true);
    setError("");
    setOffset(value);
  }
  async function remove() {
    if (!candidate || lock.current) return;
    lock.current = true;
    setDeleting(true);
    setError("");
    try {
      await deleteCardShare(candidate.id);
      setRows(current => current.filter(row => row.id !== candidate.id));
      setCandidate(null);
      setLoading(true);
      setRevision(value => value + 1);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Suppression indisponible."
      );
    } finally {
      lock.current = false;
      setDeleting(false);
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-xs text-ink-3">{previewWarning}</p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Loading…</p>
      ) : rows.length ? (
        <ul className="space-y-4">
          {rows.map(row => (
            <li key={row.id} className="rounded-panel border border-veil p-4">
              <a
                href={cardShareUrl(row.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-gold"
              >
                {row.cardName} ·{" "}
                {cardRarityLabel(row.rarity, row.shiny, row.isEvolved)}
              </a>
              <p className="my-2 text-xs text-ink-3">
                {row.showPseudo ? "Username shown" : "Sans pseudo"} ·{" "}
                {new Date(row.createdAt).toLocaleDateString("en-US")}
              </p>
              <Button variant="danger" onClick={() => setCandidate(row)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No shared links on this page.</p>
      )}
      <div className="flex gap-3">
        <Button
          variant="secondary"
          disabled={loading || offset === 0}
          onClick={() => page(Math.max(0, offset - 50))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={loading || rows.length < 50}
          onClick={() => page(offset + 50)}
        >
          Next
        </Button>
      </div>
      <Modal
        open={!!candidate}
        onClose={() => {
          if (!deleting) setCandidate(null);
        }}
        title="Delete this link?"
      >
        <p className="text-sm text-ink-2">
          The link for {candidate?.cardName} will no longer be available.{" "}
          {previewWarning}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex gap-3">
          <Button
            variant="secondary"
            disabled={deleting}
            onClick={() => setCandidate(null)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={deleting}
            onClick={() => void remove()}
          >
            {deleting ? "Suppression…" : "Confirm deletion"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
