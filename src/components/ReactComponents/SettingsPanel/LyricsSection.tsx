import { useStore } from "@nanostores/react";
import React from "react";
import { toast } from "sonner";
import { ClearAllReviewerStorage } from "../../../utils/ReviewerMode/state.ts";
import {
  $lineHoverBackground,
  $minimalLyricsMode,
  $reviewerModeEnabled,
  $simpleLyricsMode,
  $simpleLyricsModeRenderingType
} from "../../../utils/stores.ts";
import { matches, Row, Select, SectionTitle, Toggle } from "./components.tsx";

const SECTION_NAME = "Lyrics Display";
const renderingTypeOptions = ["calculate", "animate"];

interface Props {
  query: string;
  sectionFilter: string;
}

export default function LyricsSection({ query, sectionFilter }: Props) {
  const simpleLyricsMode = useStore($simpleLyricsMode);
  const simpleLyricsModeRenderingType = useStore($simpleLyricsModeRenderingType);
  const minimalLyricsMode = useStore($minimalLyricsMode);
  const lineHoverBackground = useStore($lineHoverBackground);
  const reviewerModeEnabled = useStore($reviewerModeEnabled);

  if (sectionFilter !== "All" && sectionFilter !== SECTION_NAME) return null;

  const r1 = matches(query, "Simple Lyrics Mode", "Remove extra visual effects from lyrics");
  const r2 = matches(query, "Simple Mode: Text Animation Style", "How lyrics text transitions are rendered in Simple Lyrics Mode.");
  const r3 = matches(query, "Minimal Lyrics Mode", "Hides sung lyrics lines in Fullscreen and Cinema Mode");
  const r4 = matches(query, "Line Hover Background", "Shows a highlight box behind a lyrics line when you hover over it");
  const r5 = matches(query, "Reviewer Mode", "Enable lyrics review tools and synchronization annotations directly in the player");
  const r6 = matches(query, "Clear Reviewer Storage", "Remove all saved reviewer annotations and progress across all tracks to free up local storage.");

  if (!r1 && !r2 && !r3 && !r4 && !r5 && !r6) return null;

  return (
    <>
      <SectionTitle>Lyrics Display</SectionTitle>

      {r1 && (
        <Row label="Simple Lyrics Mode" description="Remove extra visual effects from lyrics">
          <Toggle checked={simpleLyricsMode} onChange={(v) => $simpleLyricsMode.set(v)} />
        </Row>
      )}

      {r2 && (
        <Row
          label="Simple Mode: Text Animation Style"
          description="How lyrics text transitions are rendered in Simple Lyrics Mode."
          disabled={!simpleLyricsMode}
          disabledReason="Enable Simple Lyrics Mode to modify this setting"
        >
          <Select
            value={simpleLyricsModeRenderingType}
            options={renderingTypeOptions}
            onChange={(v) => $simpleLyricsModeRenderingType.set(v)}
            disabled={!simpleLyricsMode}
          />
        </Row>
      )}

      {r3 && (
        <Row
          label="Minimal Lyrics Mode"
          description="Hides sung lyrics lines in Fullscreen and Cinema Mode"
        >
          <Toggle checked={minimalLyricsMode} onChange={(v) => $minimalLyricsMode.set(v)} />
        </Row>
      )}

      {r4 && (
        <Row
          label="Line Hover Background"
          description="Shows a highlight box behind a lyrics line when you hover over it"
        >
          <Toggle checked={lineHoverBackground} onChange={(v) => $lineHoverBackground.set(v)} />
        </Row>
      )}

      {r5 && (
        <Row
          label="Reviewer Mode"
          description="Enable lyrics review tools and synchronization annotations directly in the player"
        >
          <Toggle checked={reviewerModeEnabled} onChange={(v) => $reviewerModeEnabled.set(v)} />
        </Row>
      )}

      {r6 && reviewerModeEnabled && (
        <Row
          label="Clear Reviewer Storage"
          description="Remove all saved reviewer annotations and progress across all tracks to free up local storage."
        >
          <button
            className="sl-sp-btn"
            onClick={async () => {
              await ClearAllReviewerStorage();
              toast.success("Reviewer storage cleared");
            }}
          >
            Clear All
          </button>
        </Row>
      )}
    </>
  );
}
