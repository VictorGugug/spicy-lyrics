import Logger from "../Logger.ts";
import { LyricsObject } from "../Lyrics/lyrics.ts";
import { $currentLyricsData } from "../stores.ts";

const guidelineLogger = new Logger("Reviewer Guidelines");

export interface GuidelineCheckResult {
  hasIssue: boolean;
  issueType?: "formatting" | "incorrect-segmentation" | "vocal-type" | "incorrect-lyrics";
  message: string;
  suggestion?: string;
  fixedLine?: string;
}

const VOCALIZATION_SOUNDS =
  /^(m+|h+|h+m+|m+h+|s+h+|b+r+|z+|tsk|psst|pfft|mm|hm|mh|uh|ah|la|na|ooh|aah|whoa|woah)$/i;

const VOWEL_LATIN =
  /[aeiouyàáâãäåāăąǎȁȃạảấầẩẫậắằẳẵặèéêëēĕėęěȅȇẹẻẽếềểễệìíîïĩīĭįǐȉȋịỉòóôõöøōŏőǒȍȏọỏốồổỗộớờởỡợơớờởỡợùúûüũūŭůűųǔȕȗụủứừửữựýÿŷỳỵỷỹæœıəŵ]/i;

const VOWEL_CYRILLIC = /[аеёиоуыэюяієїәөүӣӯў]/i;

const VOWEL_GREEK = /[αεηιουωάέήίόύώϊϋΐΰ]/i;

const VOWEL_GEORGIAN = /[აეიოუ]/;

const VOWEL_ARMENIAN = /[աեէըիօուև]/i;

const SKIP_SEGMENTATION_SCRIPT =
  /[\u3040-\u30FF\u31F0-\u31FF\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\u3100-\u312F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\u0590-\u05FF\u0900-\u097F\u0980-\u09FF\u0A00-\u0AFF\u0B00-\u0BFF\u0C00-\u0CFF\u0D00-\u0DFF\u0E00-\u0E7F\u0E80-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u1780-\u17FF]|\u{20000}-\u{2EBEF}/u;

const ABBREVIATION_PART = /^(dj|tv|mc|ok|cd|id|lp|ep)$/i;

const SYLLABIC_CONSONANT_PART = /^(tle|dle|ble|ple|cle|gle|kle|fle|sle|zle|thm|rthm|sm|nt)$/i;

const REPEAT_SHORTCUT =
  /\[\s*(chorus|verse|hook|refrain|bridge|pre-?chorus|post-?chorus|intro|outro|interlude)\s*(x\s*\d+)?\s*\]|\brepeat\s+(the\s+)?(chorus|verse|hook|refrain|bridge)\b|\(\s*x\s*\d+\s*\)|\b(chorus|verse)\s*x\s*\d+\b/i;

const NONSTANDARD_SPELLINGS: Array<{ pattern: RegExp; standard: string; note: string }> = [
  { pattern: /\bya'll\b/i, standard: "y'all", note: "Use y'all for “you all”." },
  { pattern: /\b(i'mma|imma|ima)\b/i, standard: "I'ma", note: "Use I'ma for “I am going to”." },
  { pattern: /\btil\b/i, standard: "'til / till", note: "Use 'til or till for shortened “until”." },
  { pattern: /\btho\b/i, standard: "though", note: "Use though instead of tho." },
  { pattern: /\btrynna\b/i, standard: "tryna", note: "Use tryna for “trying to”." },
  {
    pattern: /\bboujee\b|\bboujie\b/i,
    standard: "bougie",
    note: "Use bougie unless an official title uses another form.",
  },
];

function vowelPatternForWord(word: string): RegExp | null {
  if (SKIP_SEGMENTATION_SCRIPT.test(word)) return null;
  if (/[Ѐ-ӿԀ-ԯ]/.test(word)) return VOWEL_CYRILLIC;
  if (/[Ͱ-Ͽἀ-῿]/.test(word)) return VOWEL_GREEK;
  if (/[Ⴀ-ჿ]/.test(word)) return VOWEL_GEORGIAN;
  if (/[Ա-֏]/.test(word)) return VOWEL_ARMENIAN;
  return VOWEL_LATIN;
}

function isSyllabicConsonantPart(cleanPart: string, vowelPattern: RegExp): boolean {
  if (/^\p{L}$/u.test(cleanPart)) return true;
  if (ABBREVIATION_PART.test(cleanPart)) return true;
  if (vowelPattern === VOWEL_LATIN && SYLLABIC_CONSONANT_PART.test(cleanPart)) return true;
  return false;
}

export function AutoFixLine(text: string): string {
  let res = text.trim();
  res = res
    .replace(/[.]{3,}|…/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  res = res.replace(/\s+([,!?:;])/g, "$1");
  res = res.replace(/\.+(["'”’)]?)$/, "$1");
  res = res.replace(/^\s*\((.*?)\)\s*$/, "$1").trim();
  res = res.replace(/\(([^)]+)\)/g, "$1");
  res = res.replace(/\[[^\]]*\]/g, "").trim();
  res = res.replace(/\(\s*x\s*\d+\s*\)/gi, "").trim();
  res = res.replace(/‘/g, "'");
  res = res
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/!\?|\?!/g, "?")
    .replace(/,{2,}/g, ",");
  return res.replace(/\s{2,}/g, " ").trim();
}

export function CheckLineAgainstGuidelines(
  plainLine: string,
  _selectedText?: string,
  segmentation?: string
): GuidelineCheckResult {
  const line = plainLine.trim();

  if (/[.]{3,}|…/.test(line)) {
    return {
      hasIssue: true,
      issueType: "formatting",
      message: "Ellipses detected: guidelines forbid typing ... or … for pauses or interludes.",
      suggestion: "Remove ellipses (interludes are automatic in Spicy Lyrics).",
      fixedLine: AutoFixLine(line),
    };
  }

  if (/\s+[,!?:;]/.test(line)) {
    return {
      hasIssue: true,
      issueType: "formatting",
      message:
        "Space before punctuation: guidelines require attaching punctuation directly to the preceding word.",
      suggestion: "Remove space before punctuation marks.",
      fixedLine: AutoFixLine(line),
    };
  }

  if (/\.\s*["'”’)]?$/.test(line) && !/[a-zA-Z]\.[a-zA-Z]\./.test(line) && !line.endsWith("...")) {
    return {
      hasIssue: true,
      issueType: "formatting",
      message: "Trailing period: guidelines recommend omitting periods at the end of lyric lines.",
      suggestion: "Remove the period at the end of the line.",
      fixedLine: AutoFixLine(line),
    };
  }

  if (/\([^)]{2,}\)/.test(line)) {
    return {
      hasIssue: true,
      issueType: "vocal-type",
      message:
        "Parentheses in vocals: guidelines forbid parentheses (background vocals render natively).",
      suggestion: "Tag as background vocal without parentheses.",
      fixedLine: AutoFixLine(line),
    };
  }

  if (REPEAT_SHORTCUT.test(line)) {
    return {
      hasIssue: true,
      issueType: "formatting",
      message:
        "Repeat shortcut: guidelines require writing every repeated section in full, never [Chorus x2], Repeat chorus, or (x4).",
      suggestion: "Transcribe the repeated words in full with their own timing.",
      fixedLine: AutoFixLine(line),
    };
  }

  if (/\[.*?\]/.test(line)) {
    return {
      hasIssue: true,
      issueType: "formatting",
      message:
        "Bracketed tag: guidelines forbid section headers like [Verse] or [Chorus], performer labels, [?], [Instrumental], or any unsung text.",
      suggestion: "Remove unsung bracketed text.",
      fixedLine: AutoFixLine(line),
    };
  }

  const repeatedMatch = line.match(/(\p{L})\1{3,}/u);
  if (repeatedMatch) {
    const word = repeatedMatch[0].toLowerCase();
    if (!VOCALIZATION_SOUNDS.test(word)) {
      return {
        hasIssue: true,
        issueType: "formatting",
        message: `Repeated letters in "${repeatedMatch[0]}": guidelines require standard word spelling (write so, not sooooo — timing conveys duration).`,
        suggestion: "Use standard word spelling instead of repeated letters.",
        fixedLine: AutoFixLine(line),
      };
    }
  }

  if (/(!{2,}|\?{2,}|!\?|\?!|,{2,})/.test(line)) {
    return {
      hasIssue: true,
      issueType: "formatting",
      message:
        "Stacked punctuation: guidelines advise avoiding multiple exclamation or question marks.",
      suggestion: "Use single punctuation mark.",
      fixedLine: AutoFixLine(line),
    };
  }

  if (/(\p{L})‘(\p{L})/u.test(line)) {
    return {
      hasIssue: true,
      issueType: "formatting",
      message:
        "Opening quote as apostrophe: guidelines require a plain apostrophe where letters are omitted (I'm, don't, 'cause).",
      suggestion: "Replace ‘ with ' inside words.",
      fixedLine: AutoFixLine(line),
    };
  }

  for (const entry of NONSTANDARD_SPELLINGS) {
    if (entry.pattern.test(line)) {
      return {
        hasIssue: true,
        issueType: "formatting",
        message: `Nonstandard spelling: guidelines prefer ${entry.standard}. ${entry.note}`,
        suggestion: `Consider using ${entry.standard}.`,
      };
    }
  }

  if (segmentation) {
    const words = segmentation.split(/,\s*/);
    for (const w of words) {
      const vowelPattern = vowelPatternForWord(w);
      if (!vowelPattern) {
        continue;
      }
      const cleanWord = w.replace(/[^\p{L}]/gu, "").toLowerCase();
      if (!cleanWord || !vowelPattern.test(cleanWord) || VOCALIZATION_SOUNDS.test(cleanWord)) {
        continue;
      }
      const parts = w.split("\\");
      if (parts.length > 1) {
        for (const p of parts) {
          const cleanPart = p.replace(/[^\p{L}]/gu, "").toLowerCase();
          if (cleanPart.length === 0 || vowelPattern.test(cleanPart)) {
            continue;
          }
          if (
            VOCALIZATION_SOUNDS.test(cleanPart) ||
            isSyllabicConsonantPart(cleanPart, vowelPattern)
          ) {
            continue;
          }
          return {
            hasIssue: true,
            issueType: "incorrect-segmentation",
            message: `Suspicious split in "${w}": "${p.trim()}" has no vowel sound. Valid only if the singer performs it as its own syllable (like tle in little); incorrect if one sung syllable was divided (like thi / nk for one-syllable think). Verify against the recording.`,
            suggestion: `Join the parts in "${w}" unless each one matches a performed syllable.`,
          };
        }
      }
    }
  }

  return {
    hasIssue: false,
    message: "This looks correct",
  };
}

export interface LiveLyricsLine {
  text: string;
  timestampMs: number | null;
  timestampLabel: string;
  segmentation?: string;
}

export interface ScannedLineIssue {
  lineIndex: number;
  timestampMs: number | null;
  timestampLabel: string;
  originalLine: string;
  fixedLine: string;
  issueType: "formatting" | "incorrect-segmentation" | "vocal-type" | "incorrect-lyrics";
  message: string;
  suggestion?: string;
}

export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "-";
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function GetLiveLyricsLines(): LiveLyricsLine[] {
  const lines: LiveLyricsLine[] = [];
  try {
    const raw = $currentLyricsData.get();
    if (raw && !raw.startsWith("NO_LYRICS:")) {
      const data = JSON.parse(raw);
      if (data.Type === "Syllable" && Array.isArray(data.Content)) {
        data.Content.forEach((item: any) => {
          if (item?.Lead?.Syllables && Array.isArray(item.Lead.Syllables)) {
            const words: string[] = [];
            const segs: string[] = [];
            let currentWord: string[] = [];
            item.Lead.Syllables.forEach((s: any) => {
              currentWord.push(s.Text || "");
              if (!s.IsPartOfWord) {
                if (currentWord.length > 1) segs.push(currentWord.join("\\"));
                words.push(currentWord.join(""));
                currentWord = [];
              }
            });
            if (currentWord.length > 0) {
              if (currentWord.length > 1) segs.push(currentWord.join("\\"));
              words.push(currentWord.join(""));
            }
            const text = words.join(" ").trim();
            if (text) {
              const sec = item.Lead.StartTime ?? item.StartTime ?? null;
              const ms = typeof sec === "number" ? Math.round(sec * 1000) : null;
              lines.push({
                text,
                timestampMs: ms,
                timestampLabel: formatTime(ms),
                segmentation: segs.length > 0 ? segs.join(", ") : undefined,
              });
            }
          }
        });
        if (lines.length > 0) return lines;
      } else if (data.Type === "Line" && Array.isArray(data.Content)) {
        data.Content.forEach((item: any) => {
          const text = (item?.Text || "").trim();
          if (text) {
            const sec = item.StartTime ?? null;
            const ms = typeof sec === "number" ? Math.round(sec * 1000) : null;
            lines.push({
              text,
              timestampMs: ms,
              timestampLabel: formatTime(ms),
            });
          }
        });
        if (lines.length > 0) return lines;
      }
    }
  } catch (err) {
    guidelineLogger.error("Failed to extract lyrics lines from store", err);
  }

  const domLines = document.querySelectorAll<HTMLElement>(
    "#SpicyLyricsPage .LyricsContainer .line"
  );
  domLines.forEach((el, idx) => {
    if (el.classList.contains("musical-line")) return;
    const text = (el.textContent || "").trim();
    if (!text) return;
    const sylLine =
      LyricsObject.Types.Syllable?.Lines?.find((l) => l.HTMLElement === el) ??
      LyricsObject.Types.Syllable?.Lines?.[idx];
    const lineLine =
      LyricsObject.Types.Line?.Lines?.find((l) => l.HTMLElement === el) ??
      LyricsObject.Types.Line?.Lines?.[idx];
    const ms = sylLine?.StartTime ?? lineLine?.StartTime ?? null;
    lines.push({ text, timestampMs: ms, timestampLabel: formatTime(ms) });
  });

  return lines;
}

export function ScanAllLyricsAgainstGuidelines(): ScannedLineIssue[] {
  const lines = GetLiveLyricsLines();
  const issues: ScannedLineIssue[] = [];

  lines.forEach((item, idx) => {
    const check = CheckLineAgainstGuidelines(item.text, undefined, item.segmentation);
    if (check.hasIssue) {
      issues.push({
        lineIndex: idx,
        timestampMs: item.timestampMs,
        timestampLabel: item.timestampLabel,
        originalLine: item.text,
        fixedLine: check.fixedLine ?? AutoFixLine(item.text),
        issueType: check.issueType ?? "formatting",
        message: check.message,
        suggestion: check.suggestion,
      });
    }
  });

  return issues;
}
