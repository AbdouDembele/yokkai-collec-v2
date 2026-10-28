"use client";
import { useTranslations } from "next-intl";

import { useRef, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { BannerImage } from "@/components/banner-image";
import {
  bannerGeometry,
  DEFAULT_BANNER_FRAME,
  normalizeBannerFrame,
  panBanner,
  rotateBanner,
  type BannerFrame
} from "@/lib/ui/banner-frame";

export function BannerCrop({
  src,
  initial,
  onCancel,
  onApply
}: {
  src: string;
  initial?: BannerFrame | null;
  onCancel: () => void;
  onApply: (frame: BannerFrame) => void;
}) {
  const t = useTranslations();
  const [frame, setFrame] = useState(() =>
    normalizeBannerFrame(initial ?? DEFAULT_BANNER_FRAME)
  );
  const [aspect, setAspect] = useState<number>();
  const [failed, setFailed] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    frame: BannerFrame;
  } | null>(null);
  const geometry = bannerGeometry(aspect ?? 2.3, frame);
  const ready = !!aspect && !failed;
  return (
    <Modal
      open
      onClose={onCancel}
      title={t("profileUi.cropBanner")}
      className="yk-banner-crop-modal"
    >
      <p className="yk-profile-muted" id="banner-crop-help">
        {t("profileUi.bannerCropHint")}{" "}
      </p>
      <div className="yk-banner-crop-mat">
        <div
          className="yk-banner-crop-stage"
          role="group"
          tabIndex={0}
          aria-label={t("profileUi.bannerCropPosition")}
          aria-describedby="banner-crop-help"
          onKeyDown={event => {
            const movement: Record<string, [number, number]> = {
              ArrowLeft: [-0.02, 0],
              ArrowRight: [0.02, 0],
              ArrowUp: [0, -0.02],
              ArrowDown: [0, 0.02]
            };
            const delta = movement[event.key];
            if (!delta || !ready) return;
            event.preventDefault();
            setFrame(current =>
              panBanner(current, aspect!, delta[0], delta[1])
            );
          }}
          onPointerDown={event => {
            if (!ready || drag.current || event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              frame
            };
          }}
          onPointerMove={event => {
            const start = drag.current;
            if (!start || start.id !== event.pointerId || !aspect) return;
            const box = event.currentTarget.getBoundingClientRect();
            setFrame(
              panBanner(
                start.frame,
                aspect,
                (event.clientX - start.x) / box.width,
                (event.clientY - start.y) / box.height
              )
            );
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <BannerImage
            src={src}
            frame={frame}
            onReady={setAspect}
            onError={() => setFailed(true)}
          />
          <span className="yk-banner-crop-grid" aria-hidden="true" />
          {!ready && (
            <span
              className="yk-banner-crop-state"
              role={failed ? "alert" : "status"}
            >
              {failed
                ? t("profileUi.cropImageLoadFailed")
                : t("profileUi.loadingImage")}
            </span>
          )}
        </div>
      </div>
      <label className="yk-banner-crop-zoom">
        <span>
          {t("profileUi.zoom")} <output>{Math.round(frame.zoom * 100)}%</output>
        </span>
        <input
          type="range"
          aria-label={t("profileUi.bannerZoom")}
          min={Math.min(geometry.minZoom, frame.zoom)}
          max={4}
          step="any"
          value={frame.zoom}
          disabled={!ready}
          onChange={event =>
            setFrame(current => ({
              ...current,
              zoom: Number(event.target.value)
            }))
          }
        />
      </label>
      <div className="yk-banner-crop-tools">
        <Button
          variant="secondary"
          disabled={!ready}
          onClick={() =>
            setFrame(current => ({
              ...current,
              x: 50,
              y: 50,
              zoom: geometry.minZoom
            }))
          }
        >
          {t("profileUi.fitEntireImage")}{" "}
        </Button>
        <Button
          variant="secondary"
          disabled={!ready}
          aria-label={t("profileUi.rotateImageClockwise")}
          onClick={() => setFrame(current => rotateBanner(current, aspect!))}
        >
          {t("profileUi.rotate90")}{" "}
        </Button>
        <Button
          variant="secondary"
          disabled={!ready}
          onClick={() => setFrame({ ...DEFAULT_BANNER_FRAME })}
        >
          {t("profileUi.reset")}{" "}
        </Button>
      </div>
      <div className="yk-banner-crop-actions">
        <Button variant="secondary" onClick={onCancel}>
          {t("packs.cancel")}{" "}
        </Button>
        <Button
          disabled={!ready}
          onClick={() => onApply(normalizeBannerFrame(frame))}
        >
          {t("profileUi.applyCrop")}{" "}
        </Button>
      </div>
    </Modal>
  );
}
