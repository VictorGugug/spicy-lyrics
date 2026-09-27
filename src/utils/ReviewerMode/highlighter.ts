import Global from "../../components/Global/Global.ts";
import Logger from "../Logger.ts";
import { LyricsObject } from "../Lyrics/lyrics.ts";
import { SpotifyPlayer } from "../../components/Global/SpotifyPlayer.ts";
import { GetAnnotations, $reviewerModeActive, OnAnnotationsChanged } from "./state.ts";
import { getIssueTypeInfo, type Annotation } from "./types.ts";

const highlighterLogger = new Logger("Reviewer Highlighter");

let activeTippies: any[] = [];

export function ClearReviewerHighlights(): void {
  activeTippies.forEach((t) => {
    try {
      t?.destroy?.();
    } catch (err) {
      highlighterLogger.error("Failed to destroy tippy", err);
    }
  });
  activeTippies = [];

  if (typeof document === "undefined") return;
  const elements = document.querySelectorAll(".sl-reviewer-annotated");
  elements.forEach((el) => {
    el.classList.remove("sl-reviewer-annotated");
    el.removeAttribute("data-reviewer-annotation-id");
    el.removeAttribute("data-reviewer-issue");
    el.removeAttribute("data-reviewer-note");
    el.removeAttribute("data-reviewer-time");
  });
}

function findMatchingLineElement(annotation: Annotation): HTMLElement | null {
  if (annotation.timestampMs !== null) {
    const sylLine = LyricsObject.Types.Syllable?.Lines?.find(
      (l) => Math.abs(l.StartTime - annotation.timestampMs!) < 100
    );
    if (sylLine?.HTMLElement) return sylLine.HTMLElement;

    const lineLine = LyricsObject.Types.Line?.Lines?.find(
      (l) => Math.abs(l.StartTime - annotation.timestampMs!) < 100
    );
    if (lineLine?.HTMLElement) return lineLine.HTMLElement;
  }

  const cleanPlain = annotation.plainLine.trim().toLowerCase();
  if (cleanPlain) {
    const allLines = [
      ...(LyricsObject.Types.Syllable?.Lines ?? []),
      ...(LyricsObject.Types.Line?.Lines ?? []),
      ...(LyricsObject.Types.Static?.Lines ?? []),
    ];
    const match = allLines.find((l) => (l.HTMLElement?.textContent || "").toLowerCase().includes(cleanPlain));
    if (match?.HTMLElement) return match.HTMLElement;
  }

  return null;
}

function extractTargetText(annotation: Annotation): string {
  if (annotation.selectedText) return annotation.selectedText.trim();
  const boldMatch = annotation.quotedLine.match(/\*\*([^*]+)\*\*/);
  if (boldMatch) {
    return boldMatch[1].replace(/[`\\]/g, "").trim();
  }
  return "";
}

function findTargetElement(
  lineEl: HTMLElement,
  targetText: string,
  granularity?: "syllable" | "word" | "line"
): HTMLElement {
  if (!targetText) return lineEl;

  const targetLower = targetText.toLowerCase();

  const wordGroups = Array.from(lineEl.querySelectorAll(".word-group"));
  const matchSyllable = (): HTMLElement | null => {
    for (const group of wordGroups) {
      for (const syl of Array.from(group.children)) {
        if ((syl.textContent || "").trim().toLowerCase() === targetLower) {
          return syl as HTMLElement;
        }
      }
    }
    return null;
  };
  const matchGroup = (): HTMLElement | null => {
    for (const group of wordGroups) {
      const groupText = Array.from(group.children)
        .map((c) => (c.textContent || "").trim())
        .join("")
        .toLowerCase();
      if (groupText === targetLower) {
        return group as HTMLElement;
      }
    }
    return null;
  };

  // Honor the granularity saved with the annotation so a syllable-level
  // selection highlights only its split and a word-level one the whole word.
  // Old annotations without granularity fall back to syllable-first matching.
  if (granularity === "word") {
    return matchGroup() ?? matchSyllable() ?? matchDirectChild() ?? lineEl;
  }
  if (granularity === "syllable") {
    return matchSyllable() ?? matchGroup() ?? matchDirectChild() ?? lineEl;
  }
  return matchSyllable() ?? matchGroup() ?? matchDirectChild() ?? lineEl;

  function matchDirectChild(): HTMLElement | null {
    for (const child of Array.from(lineEl.children)) {
      if (child.classList.contains("dotGroup")) continue;
      if ((child.textContent || "").trim().toLowerCase() === targetLower) {
        return child as HTMLElement;
      }
    }
    return null;
  }
}

export async function SyncReviewerHighlights(): Promise<void> {
  ClearReviewerHighlights();

  if (!$reviewerModeActive.get()) return;

  const uri = SpotifyPlayer.GetUri();
  if (!uri) return;

  let annotations: Annotation[];
  try {
    annotations = await GetAnnotations(uri);
  } catch (err) {
    highlighterLogger.error("Failed to load annotations for highlights", err);
    return;
  }

  if (annotations.length === 0) return;

  const spicetify = (globalThis as any).Spicetify;

  annotations.forEach((annotation) => {
    const lineEl = findMatchingLineElement(annotation);
    if (!lineEl) return;

    const targetText = extractTargetText(annotation);
    const targetEl = findTargetElement(lineEl, targetText, annotation.granularity);

    targetEl.classList.add("sl-reviewer-annotated");
    targetEl.setAttribute("data-reviewer-annotation-id", annotation.id);
    targetEl.setAttribute("data-reviewer-issue", annotation.issueType);
    targetEl.setAttribute("data-reviewer-note", annotation.note);
    targetEl.setAttribute("data-reviewer-time", annotation.timestampLabel);

    if (spicetify?.Tippy) {
      try {
        const issueInfo = getIssueTypeInfo(annotation.issueType);
        const contentText = annotation.note
          ? `Marked • ${issueInfo.label}: ${annotation.note}`
          : `Marked • ${issueInfo.label}`;

        const tippyInstance = spicetify.Tippy(targetEl, {
          ...spicetify.TippyProps,
          content: contentText,
          placement: "top",
        });
        activeTippies.push(tippyInstance);
      } catch (err) {
        highlighterLogger.error("Failed to attach tippy", err);
      }
    }
  });
}

let highlighterInitialized = false;

export function InitReviewerHighlighter(): void {
  if (highlighterInitialized) return;
  highlighterInitialized = true;

  OnAnnotationsChanged(() => {
    SyncReviewerHighlights();
  });

  $reviewerModeActive.listen((active) => {
    if (active) {
      SyncReviewerHighlights();
    } else {
      ClearReviewerHighlights();
    }
  });

  Global.Event.listen("lyrics:apply", () => {
    requestAnimationFrame(() => {
      SyncReviewerHighlights();
    });
  });
}
