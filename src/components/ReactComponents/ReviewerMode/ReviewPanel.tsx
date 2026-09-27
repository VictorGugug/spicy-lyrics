import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Logger from "../../../utils/Logger.ts";
import {
  AddAnnotation,
  ClearTrackReview,
  DeleteAnnotation,
  GetAnnotations,
  GetTrackLyricsSyncInfo,
  IsTrackLyricsCompleted,
  SetTrackCompleted,
  BuildReviewMarkdown,
  UpdateAnnotation,
  type TrackMeta,
} from "../../../utils/ReviewerMode/state.ts";
import { ISSUE_TYPES, getIssueTypeInfo, type Annotation, type IssueType } from "../../../utils/ReviewerMode/types.ts";
import {
  ScanAllLyricsAgainstGuidelines,
  formatTime,
  type ScannedLineIssue,
} from "../../../utils/ReviewerMode/guidelines.ts";
import { SpotifyPlayer } from "../../Global/SpotifyPlayer.ts";
import { LyricsObject } from "../../../utils/Lyrics/lyrics.ts";

const panelLogger = new Logger("Reviewer Panel");

function jumpToLyricLine(timestampMs: number | null, lineIndex?: number): void {
  if (typeof timestampMs === "number" && Number.isFinite(timestampMs) && timestampMs >= 0) {
    try {
      if (typeof SpotifyPlayer !== "undefined" && SpotifyPlayer.Seek) {
        SpotifyPlayer.Seek(timestampMs);
      } else {
        (window as any).Spicetify?.Player?.seek(timestampMs);
      }
    } catch {
      try {
        (window as any).Spicetify?.Player?.seek(timestampMs);
      } catch {}
    }
  }

  try {
    const domLines = document.querySelectorAll<HTMLElement>("#SpicyLyricsPage .LyricsContainer .line");
    let targetEl: HTMLElement | null = null;
    if (typeof lineIndex === "number" && domLines[lineIndex]) {
      targetEl = domLines[lineIndex];
    } else if (typeof timestampMs === "number") {
      const sylLines = LyricsObject.Types.Syllable?.Lines;
      const match = sylLines?.find(
        (l) => typeof l.StartTime === "number" && Math.abs(l.StartTime - timestampMs) < 1500
      );
      if (match?.HTMLElement) {
        targetEl = match.HTMLElement;
      }
    }

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      targetEl.classList.add("sl-reviewer-line-flash");
      setTimeout(() => {
        targetEl?.classList.remove("sl-reviewer-line-flash");
      }, 1600);
    }
  } catch (err) {
    panelLogger.error("Failed to jump to lyric line", err);
  }
}

function findMatchingAnnotation(list: Annotation[], issue: ScannedLineIssue): Annotation | undefined {
  return list.find((a) => {
    const quoteMatches =
      a.quotedLine.trim() === issue.originalLine.trim() ||
      (Boolean(a.plainLine) && a.plainLine.trim() === issue.originalLine.trim());
    const timeMatches =
      a.timestampLabel === issue.timestampLabel ||
      (a.timestampMs !== null &&
        issue.timestampMs !== null &&
        Math.abs(a.timestampMs - issue.timestampMs) < 1500);
    return quoteMatches && timeMatches;
  });
}

interface Props {
  track: TrackMeta;
  initialCompleted: boolean;
  onClose?: () => void;
}

export default function ReviewPanel({ track, initialCompleted, onClose }: Props) {
  const [annotations, setAnnotations] = useState<Annotation[] | null>(null);
  const [completed, setCompleted] = useState(initialCompleted);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"annotations" | "markdown">("annotations");
  const [customMarkdown, setCustomMarkdown] = useState<string | null>(null);
  const [showScanWarning, setShowScanWarning] = useState(false);
  const [scanIssues, setScanIssues] = useState<ScannedLineIssue[] | null>(null);
  const [scanClean, setScanClean] = useState(false);

  const syncInfo = useMemo(() => GetTrackLyricsSyncInfo(track.uri), [track.uri]);
  const isPublished = useMemo(
    () => syncInfo.isPublished || IsTrackLyricsCompleted(track.uri),
    [syncInfo.isPublished, track.uri]
  );
  const isThirdParty = useMemo(
    () => syncInfo.provider === "Spotify" || syncInfo.provider === "Apple Music",
    [syncInfo.provider]
  );

  useEffect(() => {
    GetAnnotations(track.uri)
      .then(setAnnotations)
      .catch((err) => {
        panelLogger.error("Failed to load annotations for track", err);
        setAnnotations([]);
      });
  }, [track.uri]);

  const markdown = useMemo(
    () => (annotations ? BuildReviewMarkdown(annotations, track, completed) : ""),
    [annotations, track, completed]
  );

  const activeMarkdown = customMarkdown ?? markdown;

  const handleDelete = async (id: string) => {
    try {
      await DeleteAnnotation(id, track.uri);
      setAnnotations((prev) => (prev ? prev.filter((a) => a.id !== id) : prev));
      toast.success("Annotation removed");
    } catch (err) {
      panelLogger.error("Failed to delete annotation", err);
      toast.error("Could not delete annotation");
    }
  };

  const handleClearTrack = async () => {
    try {
      await ClearTrackReview(track.uri);
      setAnnotations([]);
      setCompleted(false);
      setCustomMarkdown(null);
      setScanIssues(null);
      setScanClean(false);
      toast.success("Track annotations cleared");
    } catch (err) {
      panelLogger.error("Failed to clear track review", err);
      toast.error("Could not clear annotations");
    }
  };

  const handleUpdate = async (id: string, patch: { issueType?: IssueType; note?: string; quotedLine?: string }) => {
    try {
      await UpdateAnnotation(id, track.uri, patch);
      setAnnotations((prev) => (prev ? prev.map((a) => (a.id === id ? { ...a, ...patch } : a)) : prev));
    } catch (err) {
      panelLogger.error("Failed to update annotation", err);
      toast.error("Could not save changes");
    }
  };

  const handleToggleCompleted = async () => {
    const next = !completed;
    try {
      await SetTrackCompleted(track.uri, next);
      setCompleted(next);
      toast.success(next ? "Marked as review completed" : "Review marked as in progress");
    } catch (err) {
      panelLogger.error("Failed to toggle review status", err);
      toast.error("Could not update review status");
    }
  };

  const executeScan = () => {
    try {
      const issues = ScanAllLyricsAgainstGuidelines();
      if (issues.length === 0) {
        setScanIssues(null);
        setScanClean(true);
        toast.success("This looks correct! Please confirm manually with audio.");
      } else {
        setScanClean(false);
        setScanIssues(issues);
        toast.info(`Found ${issues.length} guideline ${issues.length === 1 ? "issue" : "issues"}`);
      }
    } catch (err) {
      panelLogger.error("Failed to scan lyrics against guidelines", err);
      toast.error("Could not complete scan");
    }
  };

  const handleScanClick = () => {
    if (isPublished) {
      setShowScanWarning(true);
    } else {
      executeScan();
    }
  };

  const handleConfirmScan = () => {
    setShowScanWarning(false);
    executeScan();
  };

  const handleAddScanIssue = async (issue: ScannedLineIssue) => {
    try {
      const note = issue.fixedLine !== issue.originalLine
        ? `${issue.message}\nSuggested fix: ${issue.fixedLine}`
        : (issue.suggestion ? `${issue.message}\n${issue.suggestion}` : issue.message);

      const existing = findMatchingAnnotation(annotations ?? [], issue);
      if (existing) {
        await UpdateAnnotation(existing.id, track.uri, {
          issueType: issue.issueType,
          note,
          quotedLine: issue.originalLine,
        });
        setAnnotations((prev) =>
          prev
            ? prev.map((a) =>
                a.id === existing.id
                  ? { ...a, issueType: issue.issueType, note, quotedLine: issue.originalLine }
                  : a
              )
            : prev
        );
        setScanIssues((prev) => (prev ? prev.filter((i) => i !== issue) : null));
        toast.success("Updated existing review annotation");
        return;
      }

      const added = await AddAnnotation({
        trackUri: track.uri,
        timestampMs: issue.timestampMs,
        timestampLabel: issue.timestampLabel,
        quotedLine: issue.originalLine,
        plainLine: issue.originalLine,
        issueType: issue.issueType,
        note,
      });

      setAnnotations((prev) => (prev ? [...prev, added] : [added]));
      setScanIssues((prev) => (prev ? prev.filter((i) => i !== issue) : null));
      toast.success("Added issue to review");
    } catch (err) {
      panelLogger.error("Failed to add scan issue to annotations", err);
      toast.error("Could not add annotation");
    }
  };

  const handleAutoFixAll = async () => {
    if (!scanIssues || scanIssues.length === 0) return;
    try {
      let currentAnnotations = annotations ?? [];
      let updatedCount = 0;
      let addedCount = 0;

      for (const issue of scanIssues) {
        const note = issue.fixedLine !== issue.originalLine
          ? `${issue.message}\nSuggested fix: ${issue.fixedLine}`
          : (issue.suggestion ? `${issue.message}\n${issue.suggestion}` : issue.message);

        const existing = findMatchingAnnotation(currentAnnotations, issue);
        if (existing) {
          await UpdateAnnotation(existing.id, track.uri, {
            issueType: issue.issueType,
            note,
            quotedLine: issue.originalLine,
          });
          currentAnnotations = currentAnnotations.map((a) =>
            a.id === existing.id
              ? { ...a, issueType: issue.issueType, note, quotedLine: issue.originalLine }
              : a
          );
          updatedCount++;
        } else {
          const a = await AddAnnotation({
            trackUri: track.uri,
            timestampMs: issue.timestampMs,
            timestampLabel: issue.timestampLabel,
            quotedLine: issue.originalLine,
            plainLine: issue.originalLine,
            issueType: issue.issueType,
            note,
          });
          currentAnnotations = [...currentAnnotations, a];
          addedCount++;
        }
      }

      setAnnotations(currentAnnotations);
      setScanIssues(null);

      if (updatedCount > 0 && addedCount > 0) {
        toast.success(`Updated ${updatedCount} and added ${addedCount} guideline annotations`);
      } else if (updatedCount > 0) {
        toast.success(`Updated ${updatedCount} existing guideline annotations`);
      } else {
        toast.success(`Added ${addedCount} guideline annotations`);
      }
    } catch (err) {
      panelLogger.error("Failed to add all scan issues", err);
      toast.error("Could not add all annotations");
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeMarkdown);
      toast.success("Markdown copied to clipboard");
    } catch (err) {
      panelLogger.error("Failed to copy markdown to clipboard", err);
      toast.error("Could not access clipboard");
    }
  };

  const handleDownload = () => {
    try {
      const blob = new Blob([activeMarkdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = `${track.name} - ${track.artists}`.replace(/[\\/:*?"<>|]+/g, "_");
      a.href = url;
      a.download = `${safeName}.review.md`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Markdown file downloaded");
    } catch (err) {
      panelLogger.error("Failed to download markdown file", err);
      toast.error("Could not download file");
    }
  };

  if (annotations === null) {
    return <div className="sl-reviewer-panel-loading">Loading annotations...</div>;
  }

  return (
    <div className="sl-reviewer-panel">
      <div className="sl-reviewer-panel-header">
        <div className="sl-reviewer-panel-info">
          <div className="sl-reviewer-panel-track">{track.name}</div>
          <div className="sl-reviewer-panel-meta">
            <span className="sl-reviewer-panel-artist">{track.artists}</span>
            {typeof track.durationMs === "number" && track.durationMs > 0 && (
              <>
                <span className="sl-reviewer-panel-meta-dot">·</span>
                <span className="sl-reviewer-panel-duration">{formatTime(track.durationMs)}</span>
              </>
            )}
          </div>
          <div className="sl-reviewer-panel-badges">
            {isPublished && (
              <span className="sl-reviewer-status-badge sl-reviewer-status-badge--published">
                ✓ Published ({syncInfo.provider})
              </span>
            )}
            {syncInfo.isSynced && (
              <span className="sl-reviewer-status-badge sl-reviewer-status-badge--synced">
                {syncInfo.syncLabel}
              </span>
            )}
            {syncInfo.maker && syncInfo.uploader && syncInfo.maker !== syncInfo.uploader ? (
              <>
                <span className="sl-reviewer-status-badge sl-reviewer-status-badge--maker">
                  Made by @{syncInfo.maker}
                </span>
                <span className="sl-reviewer-status-badge sl-reviewer-status-badge--maker">
                  Uploaded by @{syncInfo.uploader}
                </span>
              </>
            ) : syncInfo.maker ? (
              <span className="sl-reviewer-status-badge sl-reviewer-status-badge--maker">
                By @{syncInfo.maker}
              </span>
            ) : syncInfo.uploader ? (
              <span className="sl-reviewer-status-badge sl-reviewer-status-badge--maker">
                Uploaded by @{syncInfo.uploader}
              </span>
            ) : null}
          </div>
        </div>
        <button
          className={`sl-reviewer-completed-toggle${completed ? " Completed" : ""}`}
          onClick={handleToggleCompleted}
        >
          {completed ? "✓ Review completed" : "Mark review completed"}
        </button>
      </div>

      {isPublished && (
        <div
          className={`sl-reviewer-completed-banner${isThirdParty ? " sl-reviewer-completed-banner--third-party" : ""}`}
        >
          <span className="sl-reviewer-completed-banner-icon">{isThirdParty ? "ℹ" : "✓"}</span>
          <span>
            {isThirdParty
              ? `These lyrics are published by a third party (${syncInfo.provider}). There is nothing to review; you can still review them if desired, but it will have no effect.`
              : "These lyrics are already published and looking good, but you can still review them anyway."}
          </span>
        </div>
      )}

      <div className="sl-reviewer-panel-tabs">
        <button
          type="button"
          className={`sl-reviewer-panel-tab${activeTab === "annotations" ? " Active" : ""}`}
          onClick={() => setActiveTab("annotations")}
        >
          Annotations ({annotations.length})
        </button>
        <button
          type="button"
          className={`sl-reviewer-panel-tab${activeTab === "markdown" ? " Active" : ""}`}
          onClick={() => setActiveTab("markdown")}
        >
          Edit Markdown
        </button>
        <div className="sl-reviewer-panel-tab-actions">
          <button
            type="button"
            className="sl-reviewer-btn sl-reviewer-btn--ghost sl-reviewer-scan-trigger"
            onClick={handleScanClick}
          >
            Scan with guidelines
          </button>
        </div>
      </div>

      {showScanWarning && (
        <div className="sl-reviewer-scan-warning">
          <div className="sl-reviewer-scan-warning-title">Notice: Published Lyrics</div>
          <div className="sl-reviewer-scan-warning-body">
            {isThirdParty
              ? `These lyrics are published by a third party (${syncInfo.provider}) and external tracks cannot be modified. Running a scan or adding review notes will have no effect on them, but you may still proceed if desired.`
              : `These lyrics are already published and ${syncInfo.syncLabel.toLowerCase()} (${syncInfo.provider}). Running an automated scan is at your discretion: automated checks verify formatting and syntax rules against Spicy Lyrics guidelines, but cannot be 100% exact for audio timing and vocal pronunciation, which require listening to the recording.`}
          </div>
          <div className="sl-reviewer-scan-warning-actions">
            <button
              type="button"
              className="sl-reviewer-btn sl-reviewer-btn--ghost"
              onClick={() => setShowScanWarning(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="sl-reviewer-btn sl-reviewer-btn--primary"
              onClick={handleConfirmScan}
            >
              Run scan anyway
            </button>
          </div>
        </div>
      )}

      {scanClean && (
        <div className="sl-reviewer-scan-clean">
          <span className="sl-reviewer-scan-clean-icon">✓</span>
          <div className="sl-reviewer-scan-clean-content">
            <div className="sl-reviewer-scan-clean-title">This looks correct</div>
            <div className="sl-reviewer-scan-clean-desc">
              No guideline issues detected automatically. Please confirm manually with the audio just in case to verify timing, vocal nuances, and pronunciation.
            </div>
          </div>
          <button
            type="button"
            className="sl-reviewer-scan-clean-close"
            onClick={() => setScanClean(false)}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </div>
      )}

      {scanIssues && scanIssues.length > 0 && (
        <div className="sl-reviewer-scan-results">
          <div className="sl-reviewer-scan-results-header">
            <div className="sl-reviewer-scan-results-title">
              Guideline scan found {scanIssues.length} {scanIssues.length === 1 ? "issue" : "issues"}
            </div>
            <div className="sl-reviewer-scan-results-actions">
              <button
                type="button"
                className="sl-reviewer-btn sl-reviewer-btn--primary"
                onClick={handleAutoFixAll}
              >
                Auto-fix all
              </button>
              <button
                type="button"
                className="sl-reviewer-btn sl-reviewer-btn--ghost"
                onClick={() => setScanIssues(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
          <div className="sl-reviewer-scan-results-list">
            {scanIssues.map((issue, idx) => {
              const existing = findMatchingAnnotation(annotations ?? [], issue);
              return (
                <div key={`${issue.lineIndex}-${idx}`} className="sl-reviewer-scan-item">
                  <div className="sl-reviewer-scan-item-top">
                    <button
                      type="button"
                      className="sl-reviewer-panel-item-time sl-reviewer-panel-item-time--clickable"
                      onClick={() => jumpToLyricLine(issue.timestampMs, issue.lineIndex)}
                      title="Play and jump to this lyric line in Spotify"
                    >
                      ▶ {issue.timestampLabel}
                    </button>
                    <span className="sl-reviewer-scan-item-badge">{issue.issueType}</span>
                    {existing && (
                      <span className="sl-reviewer-scan-item-already">Already in review</span>
                    )}
                    <span className="sl-reviewer-scan-item-msg">{issue.message}</span>
                    <div className="sl-reviewer-scan-item-actions">
                      <button
                        type="button"
                        className="sl-reviewer-btn sl-reviewer-btn--ghost"
                        onClick={() => jumpToLyricLine(issue.timestampMs, issue.lineIndex)}
                        title="Jump to this lyric line"
                      >
                        Jump to line
                      </button>
                      <button
                        type="button"
                        className="sl-reviewer-btn sl-reviewer-btn--ghost"
                        onClick={() => handleAddScanIssue(issue)}
                      >
                        {existing
                          ? "Update in review"
                          : issue.fixedLine !== issue.originalLine
                            ? "Auto-fix"
                            : "Add to review"}
                      </button>
                      <button
                        type="button"
                        className="sl-reviewer-btn sl-reviewer-btn--ghost"
                        onClick={() =>
                          setScanIssues((prev) => (prev ? prev.filter((_, i) => i !== idx) : null))
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                  <div
                    className="sl-reviewer-scan-item-quote sl-reviewer-scan-item-quote--clickable"
                    onClick={() => jumpToLyricLine(issue.timestampMs, issue.lineIndex)}
                    title="Click to jump to this line"
                  >
                    {issue.originalLine}
                  </div>
                  {issue.fixedLine !== issue.originalLine && (
                    <div className="sl-reviewer-scan-item-fix">
                      Suggested fix: <code>{issue.fixedLine}</code>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "markdown" ? (
        <div className="sl-reviewer-markdown-container">
          <div className="sl-reviewer-markdown-toolbar">
            <span className="sl-reviewer-markdown-hint">
              You can edit this markdown directly before copying or exporting.
            </span>
            {customMarkdown !== null && (
              <button
                type="button"
                className="sl-reviewer-btn sl-reviewer-btn--ghost"
                onClick={() => setCustomMarkdown(null)}
              >
                Reset to generated
              </button>
            )}
          </div>
          <textarea
            className="sl-reviewer-markdown-textarea"
            value={activeMarkdown}
            onChange={(e) => setCustomMarkdown(e.currentTarget.value)}
            spellCheck={false}
            rows={14}
          />
        </div>
      ) : (
        <>
          {annotations.length === 0 ? (
            <div className="sl-reviewer-panel-empty">
              No annotations yet. Click a word or line in the lyrics view while Reviewer Mode is active to
              add one, or run a guideline scan above.
            </div>
          ) : (
            <div className="sl-reviewer-panel-list">
              {annotations.map((a) => (
                <div key={a.id} className="sl-reviewer-panel-item">
                  <div className="sl-reviewer-panel-item-top">
                    <button
                      type="button"
                      className="sl-reviewer-panel-item-time sl-reviewer-panel-item-time--clickable"
                      onClick={() => jumpToLyricLine(a.timestampMs)}
                      title="Play and jump to this lyric line in Spotify"
                    >
                      ▶ {a.timestampLabel}
                    </button>
                    <span className="sl-reviewer-panel-item-issue">{getIssueTypeInfo(a.issueType).label}</span>
                    <div className="sl-reviewer-panel-item-actions">
                      <button
                        type="button"
                        onClick={() => jumpToLyricLine(a.timestampMs)}
                        title="Jump to this lyric line"
                      >
                        Jump
                      </button>
                      <button onClick={() => setEditingId(editingId === a.id ? null : a.id)}>
                        {editingId === a.id ? "Done" : "Edit"}
                      </button>
                      <button onClick={() => handleDelete(a.id)}>Delete</button>
                    </div>
                  </div>

                  {editingId === a.id ? (
                    <div className="sl-reviewer-panel-item-edit">
                      <textarea
                        className="sl-reviewer-composer-line"
                        defaultValue={a.quotedLine}
                        rows={2}
                        onBlur={(e) => handleUpdate(a.id, { quotedLine: e.currentTarget.value })}
                      />
                      <select
                        className="sl-reviewer-composer-select"
                        defaultValue={a.issueType}
                        onChange={(e) => handleUpdate(a.id, { issueType: e.currentTarget.value as IssueType })}
                      >
                        {ISSUE_TYPES.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <textarea
                        className="sl-reviewer-composer-note"
                        defaultValue={a.note}
                        rows={2}
                        onBlur={(e) => handleUpdate(a.id, { note: e.currentTarget.value })}
                      />
                    </div>
                  ) : (
                    <>
                      <div
                        className="sl-reviewer-panel-item-quote sl-reviewer-scan-item-quote--clickable"
                        onClick={() => jumpToLyricLine(a.timestampMs)}
                        title="Click to jump to this line"
                      >
                        {a.quotedLine}
                      </div>
                      {a.note && <div className="sl-reviewer-panel-item-note">{a.note}</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div className="sl-reviewer-panel-footer">
        {annotations && annotations.length > 0 && (
          <button
            className="sl-reviewer-btn sl-reviewer-btn--danger"
            style={{ marginRight: "auto" }}
            onClick={handleClearTrack}
          >
            Clear track
          </button>
        )}
        {onClose && (
          <button className="sl-reviewer-btn sl-reviewer-btn--ghost" onClick={onClose}>
            Continue reviewing
          </button>
        )}
        <button className="sl-reviewer-btn sl-reviewer-btn--ghost" onClick={handleCopy}>
          Copy Markdown
        </button>
        <button className="sl-reviewer-btn sl-reviewer-btn--primary" onClick={handleDownload}>
          Export Markdown
        </button>
      </div>
    </div>
  );
}
