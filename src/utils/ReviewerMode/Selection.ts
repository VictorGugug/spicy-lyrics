import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import Logger from "../Logger.ts";
import { LyricsObject } from "../Lyrics/lyrics.ts";
import { $reviewerModeActive, GetCachedAnnotation } from "./state.ts";
import type { TrackMeta } from "./state.ts";
import type { Annotation } from "./types.ts";

const reviewerLogger = new Logger("Reviewer Mode");

export interface LinePart {
  el: Element;
  text: string;
  syllables: string[];
}

export type SelectionGranularity = "syllable" | "word" | "line";

export interface ResolvedSelection {
  trackUri: string;
  timestampMs: number | null;
  timestampLabel: string;
  quotedLine: string;
  plainLine: string;
  selectedText?: string;
  segmentation?: string;
  granularity: SelectionGranularity;
  /** Full word text when a single split of a multi-syllable word is selected. */
  wordText?: string;
  existingAnnotation?: Annotation;
  anchorRect: DOMRect;
}

export type SelectionListener = (selection: ResolvedSelection) => void;

let listener: SelectionListener | null = null;

export function OnReviewerSelection(cb: SelectionListener): void {
  listener = cb;
}

function formatTimestamp(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "-";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getLineParts(lineEl: Element): LinePart[] {
  const parts: LinePart[] = [];

  Array.from(lineEl.children).forEach((child) => {
    if (child.classList.contains("dotGroup")) return;

    if (child.classList.contains("word-group")) {
      const syllables = Array.from(child.children)
        .map((c) => (c.textContent || "").trim())
        .filter((t) => t.length > 0);
      if (syllables.length === 0) return;
      parts.push({ el: child, text: syllables.join(""), syllables });
      return;
    }

    const text = (child.textContent || "").trim();
    if (!text) return;
    parts.push({ el: child, text, syllables: [text] });
  });

  return parts;
}

function findPartContaining(parts: LinePart[], target: Element): LinePart | null {
  return parts.find((p) => p.el === target || p.el.contains(target)) ?? null;
}

function escapeMd(text: string): string {
  return text.replace(/([`*])/g, "\\$1");
}

function formatPart(part: LinePart, isSelected: boolean): string {
  const isMultiSyllable = part.syllables.length > 1;
  const raw = isMultiSyllable ? part.syllables.map(escapeMd).join("\\") : escapeMd(part.text);
  const wrapped = isMultiSyllable ? `\`${raw}\`` : raw;
  return isSelected ? `**${wrapped}**` : wrapped;
}

/**
 * Bold only one split inside a multi-syllable word, keeping the `\`
 * segmentation visible: `un\**der**`. The composer shows source, so the
 * flagged split stays obvious even though bold-in-code doesn't render.
 */
function formatSyllablePart(part: LinePart, selectedSyllableIdx: number): string {
  const raw = part.syllables
    .map((s, i) => (i === selectedSyllableIdx ? `**${escapeMd(s)}**` : escapeMd(s)))
    .join("\\");
  return `\`${raw}\``;
}

function findLineRecord(lineEl: Element): { StartTime?: number; lyricsType: string } | undefined {
  const syl = LyricsObject.Types.Syllable?.Lines?.find((l) => l.HTMLElement === lineEl);
  if (syl && typeof syl.StartTime === "number") return { StartTime: syl.StartTime, lyricsType: "Syllable" };

  const line = LyricsObject.Types.Line?.Lines?.find((l) => l.HTMLElement === lineEl);
  if (line && typeof line.StartTime === "number") return { StartTime: line.StartTime, lyricsType: "Line" };

  const allLines = Array.from(document.querySelectorAll("#SpicyLyricsPage .LyricsContainer .line:not(.musical-line)"));
  const idx = allLines.indexOf(lineEl);
  if (idx !== -1) {
    const sylLine = LyricsObject.Types.Syllable?.Lines?.filter((l) => !l.DotLine)?.[idx];
    if (sylLine && typeof sylLine.StartTime === "number") return { StartTime: sylLine.StartTime, lyricsType: "Syllable" };
    const lineLine = LyricsObject.Types.Line?.Lines?.filter((l) => !l.DotLine)?.[idx];
    if (lineLine && typeof lineLine.StartTime === "number") return { StartTime: lineLine.StartTime, lyricsType: "Line" };
  }

  const stat = LyricsObject.Types.Static?.Lines?.find((l) => l.HTMLElement === lineEl);
  if (stat) return { lyricsType: "Static" };

  const domType = lineEl.closest("[data-lyrics-type]")?.getAttribute("data-lyrics-type") ?? "Static";
  return { lyricsType: domType };
}

function resolveClick(event: MouseEvent): ResolvedSelection | null {
  const target = event.target as Element | null;
  if (!target) return null;

  const lineEl = target.closest(".line") as HTMLElement | null;
  if (!lineEl) return null;

  const trackUri = SpotifyPlayer.GetUri();
  if (!trackUri) return null;

  const lineRecord = findLineRecord(lineEl);
  const timestampMs = typeof lineRecord?.StartTime === "number" ? lineRecord.StartTime : null;
  const timestampLabel = formatTimestamp(timestampMs);

  if (lineEl.classList.contains("musical-line")) {
    const plainLine = "(instrumental)";
    return {
      trackUri,
      timestampMs,
      timestampLabel,
      quotedLine: plainLine,
      plainLine,
      granularity: "line",
      anchorRect: lineEl.getBoundingClientRect(),
    };
  }

  const annotatedEl = target.closest(".sl-reviewer-annotated") as HTMLElement | null;
  const existingId = annotatedEl?.getAttribute("data-reviewer-annotation-id");
  const existingAnnotation = existingId ? GetCachedAnnotation(existingId, trackUri) : undefined;

  const parts = getLineParts(lineEl);
  if (parts.length > 0) {
    const selectedPart = findPartContaining(parts, target);
    let selectedText: string | undefined;
    let segmentation: string | undefined;
    let granularity: SelectionGranularity = "word";
    let wordText: string | undefined;
    let selectedSyllableIdx = -1;
    let anchorEl: Element | null = null;

    if (selectedPart) {
      anchorEl = selectedPart.el;
      if (selectedPart.syllables.length > 1) {
        segmentation = selectedPart.syllables.join("\\");
        const children = Array.from(selectedPart.el.children);
        const syllableChild = children.find((c) => c === target || c.contains(target)) ?? null;
        selectedSyllableIdx = syllableChild ? children.indexOf(syllableChild) : -1;

        // Plain click selects the whole word so it can actually be reported;
        // Shift+click drills into a single split for segmentation/sync issues.
        if (event.shiftKey && syllableChild) {
          granularity = "syllable";
          wordText = selectedPart.text;
          selectedText = (syllableChild.textContent || "").trim() || selectedPart.text;
          anchorEl = syllableChild;
        } else {
          granularity = "word";
          selectedText = selectedPart.text;
        }
      } else {
        granularity = "word";
        selectedText = selectedPart.text;
      }
    }

    const quotedLine =
      existingAnnotation?.quotedLine ??
      parts
        .map((p) => {
          if (p !== selectedPart) return formatPart(p, false);
          if (granularity === "syllable" && p.syllables.length > 1 && selectedSyllableIdx >= 0)
            return formatSyllablePart(p, selectedSyllableIdx);
          return formatPart(p, true);
        })
        .join(" ");
    const plainLine = existingAnnotation?.plainLine ?? parts.map((p) => p.text).join(" ");
    return {
      trackUri,
      timestampMs: existingAnnotation?.timestampMs ?? timestampMs,
      timestampLabel: existingAnnotation?.timestampLabel ?? timestampLabel,
      quotedLine,
      plainLine,
      selectedText: existingAnnotation?.selectedText ?? selectedText,
      segmentation,
      granularity: existingAnnotation?.granularity ?? granularity,
      wordText,
      existingAnnotation,
      anchorRect: (anchorEl as HTMLElement)?.getBoundingClientRect?.() ?? lineEl.getBoundingClientRect(),
    };
  }

  const rawText = lineEl.innerText || lineEl.textContent || "";
  const plainLine = existingAnnotation?.plainLine ?? (rawText.replace(/\s+/g, " ").trim() || "(instrumental)");
  const quotedLine = existingAnnotation?.quotedLine ?? escapeMd(plainLine);
  return {
    trackUri,
    timestampMs: existingAnnotation?.timestampMs ?? timestampMs,
    timestampLabel: existingAnnotation?.timestampLabel ?? timestampLabel,
    quotedLine,
    plainLine,
    granularity: existingAnnotation?.granularity ?? "line",
    existingAnnotation,
    anchorRect: lineEl.getBoundingClientRect(),
  };
}

function onDocumentClickCapture(event: MouseEvent): void {
  if (!$reviewerModeActive.get()) return;
  const target = event.target as Element | null;
  if (!target || !target.closest(".LyricsContainer")) return;

  event.preventDefault();
  event.stopPropagation();

  try {
    const selection = resolveClick(event);
    if (selection && listener) listener(selection);
  } catch (err) {
    reviewerLogger.error("Failed to resolve reviewer selection", err);
  }
}

let attached = false;

export function InitReviewerSelection(): void {
  if (attached || typeof document === "undefined") return;
  document.addEventListener("click", onDocumentClickCapture, true);
  attached = true;
}

export function GetCurrentTrackMeta(): TrackMeta {
  const uri = SpotifyPlayer.GetUri() ?? "";
  const item = (globalThis as any)?.Spicetify?.Player?.data?.item;
  const name = item?.name ?? "Unknown track";
  const artists = Array.isArray(item?.artists)
    ? item.artists.map((a: { name?: string }) => a?.name).filter(Boolean).join(", ")
    : "Unknown artist";
  const duration = SpotifyPlayer.GetDuration();
  const durationMs = typeof duration === "number" && duration > 0 ? duration : undefined;
  return { uri, name, artists: artists || "Unknown artist", durationMs };
}
