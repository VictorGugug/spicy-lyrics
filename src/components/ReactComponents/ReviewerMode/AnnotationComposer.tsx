import React, { useMemo, useState } from "react";
import { ISSUE_TYPES, getIssueTemplate, type IssueType, type Annotation } from "../../../utils/ReviewerMode/types.ts";
import { CheckLineAgainstGuidelines } from "../../../utils/ReviewerMode/guidelines.ts";

interface Props {
  quotedLine: string;
  timestampLabel: string;
  selectedText?: string;
  segmentation?: string;
  granularity?: "syllable" | "word" | "line";
  existingAnnotation?: Annotation;
  onSave: (data: { issueType: IssueType; note: string; quotedLine: string }) => void;
  onDelete?: (id: string) => void;
  onCancel: () => void;
}

export default function AnnotationComposer({
  quotedLine,
  timestampLabel,
  selectedText,
  segmentation,
  granularity,
  existingAnnotation,
  onSave,
  onDelete,
  onCancel,
}: Props) {
  const initialIssueType = useMemo<IssueType>(() => {
    if (existingAnnotation?.issueType) return existingAnnotation.issueType;
    const check = CheckLineAgainstGuidelines(quotedLine, selectedText, segmentation);
    if (check.hasIssue && check.issueType) return check.issueType;
    if (segmentation && granularity === "syllable") return "incorrect-segmentation";
    return "incorrect-lyrics";
  }, [existingAnnotation, quotedLine, selectedText, segmentation, granularity]);

  const [issueType, setIssueType] = useState<IssueType>(initialIssueType);
  const [note, setNote] = useState(() => existingAnnotation?.note ?? "");
  const [line, setLine] = useState(() => existingAnnotation?.quotedLine ?? quotedLine);

  const guidelineCheck = useMemo(
    () => CheckLineAgainstGuidelines(line, selectedText, segmentation),
    [line, selectedText, segmentation]
  );

  const suggestedGuide = useMemo(
    () => getIssueTemplate(issueType, selectedText, segmentation),
    [issueType, selectedText, segmentation]
  );

  const handleSave = () => {
    if (!line.trim()) return;
    onSave({ issueType, note: note.trim(), quotedLine: line.trim() });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCancel();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="sl-reviewer-composer" onKeyDown={handleKeyDown}>
      {existingAnnotation && (
        <div className="sl-reviewer-composer-badge">
          <span>Marked</span>
        </div>
      )}

      <div className={`sl-reviewer-guideline-status ${guidelineCheck.hasIssue ? "Issue" : "Ok"}`}>
        <span className="sl-reviewer-guideline-icon">
          {guidelineCheck.hasIssue ? "!" : "✓"}
        </span>
        <span className="sl-reviewer-guideline-message">{guidelineCheck.message}</span>
      </div>

      <div className="sl-reviewer-composer-quote">
        <span className="sl-reviewer-composer-time">{timestampLabel}</span>
        <textarea
          className="sl-reviewer-composer-line"
          value={line}
          onChange={(e) => setLine(e.currentTarget.value)}
          rows={2}
          spellCheck={false}
        />
      </div>

      {segmentation && granularity !== "line" && (
        <div className="sl-reviewer-composer-level">
          <span>
            {granularity === "syllable" ? (
              <>Syllable selected{selectedText ? <>: <code>{selectedText}</code></> : null} — click without Shift for the whole word</>
            ) : (
              <>Word selected{selectedText ? <>: <code>{selectedText}</code></> : null} — Shift+click a split for syllable-level</>
            )}
          </span>
        </div>
      )}

      <select
        className="sl-reviewer-composer-select"
        value={issueType}
        onChange={(e) => setIssueType(e.currentTarget.value as IssueType)}
      >
        {ISSUE_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      <textarea
        className="sl-reviewer-composer-note"
        placeholder={
          guidelineCheck.hasIssue
            ? (guidelineCheck.suggestion || "Describe the guideline issue...")
            : "Correction details for TTML creator..."
        }
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
        rows={2}
        autoFocus
      />

      {guidelineCheck.hasIssue && suggestedGuide && !note && (
        <div className="sl-reviewer-composer-suggestion">
          <span className="sl-reviewer-composer-suggestion-text">
            Guide: <code>{suggestedGuide}</code>
          </span>
          <button
            type="button"
            className="sl-reviewer-composer-suggestion-apply"
            onClick={() => setNote(suggestedGuide)}
          >
            Insert
          </button>
        </div>
      )}

      <div className="sl-reviewer-composer-actions">
        {existingAnnotation && onDelete && (
          <button
            className="sl-reviewer-btn sl-reviewer-btn--danger"
            style={{ marginRight: "auto" }}
            onClick={() => onDelete(existingAnnotation.id)}
          >
            Delete
          </button>
        )}
        <button className="sl-reviewer-btn sl-reviewer-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="sl-reviewer-btn sl-reviewer-btn--primary" onClick={handleSave}>
          {existingAnnotation ? "Save changes" : "Add annotation"}
        </button>
      </div>
    </div>
  );
}
