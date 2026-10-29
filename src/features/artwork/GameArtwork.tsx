import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  selectArtworkImage,
  type ArtworkImage,
  type ArtworkLookup,
  type ArtworkSource,
} from '../../domain/artwork/types.ts';
import {
  loadPreferences,
  updatePreferences,
} from '../../services/storage/index.ts';
import { artworkClient } from '../../services/artwork/steamGridDb.ts';

interface GameArtworkProps {
  gameId: string;
  gameName: string;
  source: ArtworkSource;
  /** When true, renders the per-image SteamGridDB picker. Off by default. */
  allowChoice?: boolean;
}

type LookupState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; lookup: ArtworkLookup | null };

function savedChoice(gameId: string): number | undefined {
  try {
    const choices = loadPreferences().preferences.artworkChoices;
    return choices[gameId];
  } catch {
    return undefined;
  }
}

function saveChoice(gameId: string, imageId: number | undefined): boolean {
  try {
    const current = loadPreferences().preferences;
    const choices = { ...current.artworkChoices };
    if (imageId === undefined) {
      delete choices[gameId];
    } else {
      choices[gameId] = imageId;
    }
    updatePreferences({ artworkChoices: choices });
    return true;
  } catch {
    return false;
  }
}

function fallbackLabel(gameName: string): string {
  return `${gameName} artwork is unavailable`;
}

/**
 * Renders optional artwork for one game. It is lazy: no request is made unless
 * the user selected the SteamGridDB source. The per-image swatch grid renders
 * only when `allowChoice` is true (the Games page). Every failure keeps the
 * neutral initial placeholder and never blocks the rest of the page.
 */
export function GameArtwork({
  gameId,
  gameName,
  source,
  allowChoice = false,
}: GameArtworkProps) {
  const [state, setState] = useState<LookupState>({ status: 'idle' });
  const [choice, setChoice] = useState<number | undefined>(() =>
    savedChoice(gameId),
  );
  const [imageFailed, setImageFailed] = useState(false);
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState<{
    image: ArtworkImage;
    swatch: HTMLElement;
  } | null>(null);
  const pickerId = useId();
  const previewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setChoice(savedChoice(gameId));
    setImageFailed(false);
    setChoiceError(null);
    setPickerOpen(false);

    if (source !== 'steamgriddb') {
      setState({ status: 'idle' });
      return;
    }

    let active = true;
    setState({ status: 'loading' });
    void artworkClient.lookup(gameName).then((lookup) => {
      if (active) setState({ status: 'ready', lookup });
    });

    return () => {
      active = false;
    };
  }, [gameId, gameName, source]);

  // Floating hover preview: fixed positioning next to the swatch, clamped to
  // the viewport and repositioned on scroll/resize (matches the swatch while
  // the page moves underneath it).
  useLayoutEffect(() => {
    if (preview === null) return;
    const { swatch } = preview;

    function position(): void {
      const pop = previewRef.current;
      if (pop === null) return;
      const rect = swatch.getBoundingClientRect();
      const gap = 12;
      let left = rect.right + gap;
      if (left + pop.offsetWidth > window.innerWidth - 8) {
        left = rect.left - gap - pop.offsetWidth;
      }
      if (left < 8) {
        left = Math.max(8, (window.innerWidth - pop.offsetWidth) / 2);
      }
      const top = Math.min(
        Math.max(8, rect.top + rect.height / 2 - pop.offsetHeight / 2),
        window.innerHeight - pop.offsetHeight - 8,
      );
      pop.style.left = `${left}px`;
      pop.style.top = `${top}px`;
    }

    position();
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [preview]);

  if (source !== 'steamgriddb') return null;

  const lookup = state.status === 'ready' ? state.lookup : null;
  const images = lookup?.images ?? [];
  const chosen =
    choice !== undefined && images.some((image) => image.id === choice)
      ? choice
      : undefined;
  // While a swatch is hovered (or focused), the card temporarily shows that
  // image; leaving restores the committed choice — the saved choice state is
  // the "commit", so no explicit click handling is needed here.
  const image =
    preview !== null
      ? preview.image
      : imageFailed
        ? undefined
        : selectArtworkImage(images, chosen);
  const autoImage = selectArtworkImage(images);
  const fallback = gameName.trim().slice(0, 1).toLocaleUpperCase();

  function choose(value: string): void {
    const next = value === '' ? undefined : Number(value);
    if (saveChoice(gameId, next)) {
      setChoice(next);
      setImageFailed(false);
      setChoiceError(null);
    } else {
      setChoiceError('The artwork choice could not be saved.');
    }
  }

  function startPreview(swatch: HTMLElement, image: ArtworkImage): void {
    setPreview({ image, swatch });
  }

  function endPreview(): void {
    setPreview(null);
  }

  return (
    <div className="game-artwork">
      {image === undefined ? (
        <div
          className="game-artwork-image game-artwork-fallback"
          role="img"
          aria-label={fallbackLabel(gameName)}
        >
          <span aria-hidden="true">{fallback || '?'}</span>
        </div>
      ) : (
        <img
          className="game-artwork-image"
          src={image.thumb}
          alt={`${gameName} artwork from SteamGridDB`}
          width={image.width}
          height={image.height}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
        />
      )}

      {allowChoice && images.length > 1 ? (
        <>
          <button
            type="button"
            className="game-artwork-picker-toggle"
            aria-expanded={pickerOpen}
            aria-controls={pickerId}
            aria-label={
              pickerOpen
                ? `Hide artwork for ${gameName}`
                : `Choose artwork for ${gameName}`
            }
            onClick={() => {
              setPickerOpen((open) => !open);
              setPreview(null);
            }}
          >
            Artwork
          </button>
          <div
            id={pickerId}
            className="game-artwork-picker"
            role="group"
            aria-label={`Artwork for ${gameName}`}
            hidden={!pickerOpen}
          >
            <button
              type="button"
              className="game-artwork-swatch"
              aria-pressed={chosen === undefined}
              aria-label={`Use top rated artwork for ${gameName}`}
              onClick={() => choose('')}
              onPointerEnter={(event) => {
                if (autoImage !== undefined) {
                  startPreview(event.currentTarget, autoImage);
                }
              }}
              onPointerLeave={endPreview}
              onFocus={(event) => {
                if (autoImage !== undefined) {
                  startPreview(event.currentTarget, autoImage);
                }
              }}
              onBlur={endPreview}
            >
              {autoImage === undefined ? null : (
                <img
                  src={autoImage.thumb}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              )}
              <span className="game-artwork-swatch-badge" aria-hidden="true">
                ★
              </span>
            </button>
            {images.slice(0, 24).map((item) => (
              <button
                key={item.id}
                type="button"
                className="game-artwork-swatch"
                aria-pressed={chosen === item.id}
                aria-label={`Use artwork ${item.width}×${item.height} for ${gameName}`}
                onClick={() => choose(String(item.id))}
                onPointerEnter={(event) =>
                  startPreview(event.currentTarget, item)
                }
                onPointerLeave={endPreview}
                onFocus={(event) => startPreview(event.currentTarget, item)}
                onBlur={endPreview}
              >
                <img
                  src={item.thumb}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                />
              </button>
            ))}
          </div>
        </>
      ) : null}

      {choiceError !== null ? (
        <p role="alert" className="reset-meta">
          {choiceError}
        </p>
      ) : null}

      {preview === null
        ? null
        : createPortal(
            <div
              ref={previewRef}
              className="artwork-hover-preview"
              aria-hidden="true"
            >
              <img src={preview.image.thumb} alt="" />
            </div>,
            document.body,
          )}
    </div>
  );
}
