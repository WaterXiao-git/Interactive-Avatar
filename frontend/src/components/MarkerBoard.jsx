import { useEffect, useMemo, useRef, useState } from "react";
import { MARKER_LABELS, MARKER_ORDER } from "../context/FlowContext";

const defaultMap = MARKER_ORDER.reduce((acc, key, index) => {
  const col = index % 2;
  const row = Math.floor(index / 2);
  acc[key] = [10 + col * 14, 68 + row * 8];
  return acc;
}, {});

function markerPart(key) {
  if (String(key).includes("wrist")) return "wrist";
  if (String(key).includes("elbow")) return "elbow";
  if (String(key).includes("knee")) return "knee";
  if (String(key).includes("chin")) return "chin";
  if (String(key).includes("groin")) return "groin";
  return "general";
}

export default function MarkerBoard({
  markers,
  setMarkers,
  activeMarker,
  backgroundImage = "",
  mirrorMode = false,
  onMarkerPlaced,
  onMarkerCancel,
}) {
  const boardRef = useRef(null);
  const zoomCanvasRef = useRef(null);
  const zoomImageRef = useRef(null);
  const [hoverPoint, setHoverPoint] = useState(null);
  const [pointerVisual, setPointerVisual] = useState(null);
  const [boardSize, setBoardSize] = useState({ width: 1, height: 1 });
  const [imageRatio, setImageRatio] = useState(null);
  const [imageReady, setImageReady] = useState(false);

  useEffect(() => {
    if (!boardRef.current) return undefined;
    const update = () => {
      const rect = boardRef.current?.getBoundingClientRect();
      if (!rect) return;
      setBoardSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(boardRef.current);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!backgroundImage) {
      setImageRatio(null);
      zoomImageRef.current = null;
      setImageReady(false);
      return;
    }
    const img = new Image();
    img.onload = () => {
      if (!img.width || !img.height) return;
      setImageRatio(img.width / img.height);
      zoomImageRef.current = img;
      setImageReady(true);
    };
    img.onerror = () => {
      setImageRatio(null);
      zoomImageRef.current = null;
      setImageReady(false);
    };
    img.src = backgroundImage;
  }, [backgroundImage]);

  function getContentBox() {
    const { width, height } = boardSize;
    if (!imageRatio || !backgroundImage) {
      return { leftPct: 0, topPct: 0, widthPct: 100, heightPct: 100 };
    }

    const boardRatio = width / height;
    if (boardRatio > imageRatio) {
      const contentWidth = (height * imageRatio) / width;
      const left = (1 - contentWidth) / 2;
      return { leftPct: left * 100, topPct: 0, widthPct: contentWidth * 100, heightPct: 100 };
    }

    const contentHeight = (width / imageRatio) / height;
    const top = (1 - contentHeight) / 2;
    return { leftPct: 0, topPct: top * 100, widthPct: 100, heightPct: contentHeight * 100 };
  }

  const contentBox = useMemo(getContentBox, [boardSize, imageRatio, backgroundImage]);

  useEffect(() => {
    const canvas = zoomCanvasRef.current;
    const image = zoomImageRef.current;
    if (!canvas || !image || !pointerVisual || !imageReady) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const zoom = 2.6;
    const contentWidthPx = boardSize.width * (contentBox.widthPct / 100);
    const contentHeightPx = boardSize.height * (contentBox.heightPct / 100);
    const mapScaleX = image.width / Math.max(1, contentWidthPx);
    const mapScaleY = image.height / Math.max(1, contentHeightPx);

    const lensWidthCss = Math.max(1, rect.width);
    const lensHeightCss = Math.max(1, rect.height);
    const srcW = (lensWidthCss / zoom) * mapScaleX;
    const srcH = (lensHeightCss / zoom) * mapScaleY;
    const cx = (pointerVisual.imageX / 100) * image.width;
    const cy = (pointerVisual.imageY / 100) * image.height;
    const sx = Math.max(0, Math.min(image.width - srcW, cx - srcW / 2));
    const sy = Math.max(0, Math.min(image.height - srcH, cy - srcH / 2));

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, sx, sy, srcW, srcH, 0, 0, width, height);
  }, [pointerVisual, imageReady, boardSize, contentBox]);

  function toBoardPosition(value) {
    const x = contentBox.leftPct + (value[0] / 100) * contentBox.widthPct;
    const y = contentBox.topPct + (value[1] / 100) * contentBox.heightPct;
    return [x, y];
  }

  const stagingZoneStyle = useMemo(() => {
    const pts = MARKER_ORDER.map((key) => toBoardPosition(defaultMap[key] || [50, 50]));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const padX = 3.2;
    const padY = 2.2;
    const left = Math.max(0, Math.min(...xs) - padX);
    const right = Math.min(100, Math.max(...xs) + padX);
    const top = Math.max(0, Math.min(...ys) - padY);
    const bottom = Math.min(100, Math.max(...ys) + padY);
    return {
      left: `${left}%`,
      top: `${top}%`,
      width: `${Math.max(8, right - left)}%`,
      height: `${Math.max(8, bottom - top)}%`,
    };
  }, [contentBox]);

  const points = useMemo(() => {
    return MARKER_ORDER.map((key) => {
      const val = markers[key] || defaultMap[key];
      return { key, x: val[0], y: val[1] };
    });
  }, [markers]);

  function eventToPercent(event) {
    const rect = boardRef.current.getBoundingClientRect();
    const rawX = ((event.clientX - rect.left) / rect.width) * 100;
    const rawY = ((event.clientY - rect.top) / rect.height) * 100;
    const localX = (rawX - contentBox.leftPct) / Math.max(0.001, contentBox.widthPct);
    const localY = (rawY - contentBox.topPct) / Math.max(0.001, contentBox.heightPct);
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) {
      return null;
    }
    let x = localX * 100;
    const y = localY * 100;
    if (mirrorMode) {
      x = 100 - x;
    }
    return [Math.max(4, Math.min(96, x)), Math.max(4, Math.min(96, y))];
  }

  function eventToVisualPercent(event) {
    const rect = boardRef.current.getBoundingClientRect();
    const rawX = ((event.clientX - rect.left) / rect.width) * 100;
    const rawY = ((event.clientY - rect.top) / rect.height) * 100;
    const localX = (rawX - contentBox.leftPct) / Math.max(0.001, contentBox.widthPct);
    const localY = (rawY - contentBox.topPct) / Math.max(0.001, contentBox.heightPct);
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) {
      return null;
    }
    const xInImage = localX * 100;
    const yInImage = localY * 100;
    return {
      imageX: mirrorMode ? 100 - xInImage : xInImage,
      imageY: yInImage,
    };
  }

  function commitMarker(key, value, autoAdvance = false) {
    setMarkers((prev) => ({ ...prev, [key]: [Number(value[0].toFixed(2)), Number(value[1].toFixed(2))] }));
    if (autoAdvance) {
      onMarkerPlaced?.(key);
    }
  }

  function onBoardClick(event) {
    if (!activeMarker) {
      return;
    }
    const point = eventToPercent(event);
    if (!point) return;
    setHoverPoint(point);
    setPointerVisual(eventToVisualPercent(event));
    commitMarker(activeMarker, point, true);
  }

  function onBoardMove(event) {
    setHoverPoint(eventToPercent(event));
    setPointerVisual(eventToVisualPercent(event));
  }

  function onBoardLeave() {
    setHoverPoint(null);
    setPointerVisual(null);
  }

  function onContextMenu(event) {
    event.preventDefault();
    if (!activeMarker) return;
    onMarkerCancel?.(activeMarker);
  }

  const activePoint = markers[activeMarker] || defaultMap[activeMarker] || [50, 50];
  const focusPoint = hoverPoint || activePoint;
  const lensPoint = pointerVisual;

  return (
    <div
      ref={boardRef}
      className={mirrorMode ? "marker-board mirror" : "marker-board"}
      style={
        backgroundImage
          ? {
              backgroundImage: `linear-gradient(170deg, rgba(247,253,255,0.45), rgba(222,239,250,0.45)), url(${backgroundImage})`,
              backgroundSize: "contain",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            }
          : undefined
      }
      onClick={onBoardClick}
      onPointerMove={onBoardMove}
      onPointerLeave={onBoardLeave}
      onContextMenu={onContextMenu}
      role="presentation"
    >
      {!backgroundImage ? <div className="marker-silhouette" /> : null}
      <div className="marker-staging-zone" style={stagingZoneStyle} aria-hidden="true" />

      {points.map((point) => {
        const isActive = point.key === activeMarker;
        const isPlaced = !!markers[point.key];
        const part = markerPart(point.key);
        const [boardX, boardY] = toBoardPosition([point.x, point.y]);
        return (
          <button
            key={point.key}
            className={`marker-dot marker-part-${part}${isActive ? " active" : ""}${isPlaced ? " placed" : ""}`}
            style={{ left: `${boardX}%`, top: `${boardY}%` }}
            type="button"
            title={MARKER_LABELS[point.key]}
          >
            <span>{MARKER_LABELS[point.key]}</span>
          </button>
        );
      })}

      <div
        className="target-hint"
        style={{
          left: `${toBoardPosition(activePoint)[0]}%`,
          top: `${toBoardPosition(activePoint)[1]}%`,
        }}
      />

      <div className={`zoom-lens${lensPoint && imageReady ? "" : " hidden"}`}>
        <canvas ref={zoomCanvasRef} className="zoom-canvas" />
        <div className="zoom-crosshair" />
        <div className="zoom-label">
          <strong>{MARKER_LABELS[activeMarker]}</strong>
          <span>
            中心点 {(lensPoint?.imageX ?? focusPoint[0]).toFixed(1)}%, {(lensPoint?.imageY ?? focusPoint[1]).toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}
