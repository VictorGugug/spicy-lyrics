import ReactDOM from "react-dom/client";
import { toast } from "sonner";
import AnnotationComposer from "../../components/ReactComponents/ReviewerMode/AnnotationComposer.tsx";
import { InitReviewerHighlighter } from "./highlighter.ts";
import { OnReviewerSelection, InitReviewerSelection, type ResolvedSelection } from "./Selection.ts";
import { AddAnnotation, DeleteAnnotation, UpdateAnnotation } from "./state.ts";

let host: HTMLDivElement | null = null;
let root: ReturnType<typeof ReactDOM.createRoot> | null = null;
let outsideClickHandler: ((e: MouseEvent) => void) | null = null;

function ensureHost(): HTMLDivElement {
  if (host) return host;
  host = document.createElement("div");
  host.className = "sl-reviewer-composer-host";
  document.body.appendChild(host);
  root = ReactDOM.createRoot(host);
  return host;
}

function closeComposer(): void {
  if (outsideClickHandler) {
    document.removeEventListener("mousedown", outsideClickHandler, true);
    outsideClickHandler = null;
  }
  if (host) {
    host.classList.remove("Active");
    host.style.visibility = "hidden";
  }
  root?.render(null as any);
}

function positionHost(anchorRect: DOMRect): void {
  if (!host) return;
  const width = 320;
  const margin = 12;
  let left = anchorRect.left + anchorRect.width / 2 - width / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));

  const spaceBelow = window.innerHeight - anchorRect.bottom;
  const openUpward = spaceBelow < 260 && anchorRect.top > 260;

  host.style.left = `${left}px`;
  host.style.width = `${width}px`;
  if (openUpward) {
    host.style.top = "";
    host.style.bottom = `${window.innerHeight - anchorRect.top + margin}px`;
  } else {
    host.style.bottom = "";
    host.style.top = `${anchorRect.bottom + margin}px`;
  }
}

function openComposer(selection: ResolvedSelection): void {
  const el = ensureHost();
  positionHost(selection.anchorRect);
  el.style.visibility = "visible";
  requestAnimationFrame(() => el.classList.add("Active"));

  root?.render(
    <AnnotationComposer
      quotedLine={selection.quotedLine}
      timestampLabel={selection.timestampLabel}
      selectedText={selection.selectedText}
      segmentation={selection.segmentation}
      granularity={selection.existingAnnotation?.granularity ?? selection.granularity}
      existingAnnotation={selection.existingAnnotation}
      onCancel={closeComposer}
      onDelete={async (id) => {
        await DeleteAnnotation(id, selection.trackUri);
        toast.success("Annotation deleted");
        closeComposer();
      }}
      onSave={async ({ issueType, note, quotedLine }) => {
        if (selection.existingAnnotation) {
          await UpdateAnnotation(selection.existingAnnotation.id, selection.trackUri, {
            issueType,
            note,
            quotedLine,
          });
          toast.success("Annotation updated");
        } else {
          await AddAnnotation({
            trackUri: selection.trackUri,
            timestampMs: selection.timestampMs,
            timestampLabel: selection.timestampLabel,
            quotedLine,
            plainLine: selection.plainLine,
            selectedText: selection.selectedText,
            granularity: selection.granularity,
            issueType,
            note,
          });
          toast.success("Annotation added");
        }
        closeComposer();
      }}
    />
  );

  setTimeout(() => {
    outsideClickHandler = (e: MouseEvent) => {
      if (host && !host.contains(e.target as Node)) closeComposer();
    };
    document.addEventListener("mousedown", outsideClickHandler, true);
  }, 0);
}

let initialized = false;

export function InitReviewerComposer(): void {
  if (initialized) return;
  initialized = true;
  InitReviewerSelection();
  InitReviewerHighlighter();
  OnReviewerSelection(openComposer);
}
