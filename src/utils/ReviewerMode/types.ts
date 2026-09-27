export type IssueType =
  | "incorrect-lyrics"
  | "incorrect-segmentation"
  | "sync-start-early"
  | "sync-start-late"
  | "sync-end-early"
  | "sync-end-late"
  | "vocal-type"
  | "formatting"
  | "general";

export interface IssueTypeInfo {
  id: IssueType;
  label: string;
  template: string;
}

export const ISSUE_TYPES: IssueTypeInfo[] = [
  { id: "incorrect-lyrics", label: "Incorrect lyrics", template: "Should be ``: " },
  {
    id: "incorrect-segmentation",
    label: "Incorrect syllable segmentation",
    template: "Should be ``: ",
  },
  { id: "sync-start-early", label: "Sync starts too early", template: "Sync starts too early on " },
  { id: "sync-start-late", label: "Sync starts too late", template: "Sync starts too late on " },
  { id: "sync-end-early", label: "Sync ends too early", template: "Sync ends too early on " },
  { id: "sync-end-late", label: "Sync ends too late", template: "Sync ends too late on " },
  {
    id: "vocal-type",
    label: "Incorrect vocal type (main / background)",
    template: "Should be background vocal: ",
  },
  { id: "formatting", label: "Formatting / punctuation", template: "" },
  { id: "general", label: "General note", template: "" },
];

export function getIssueTemplate(
  type: IssueType,
  selectedText?: string,
  segmentation?: string
): string {
  const target = selectedText ? `\`${selectedText}\`` : "";
  switch (type) {
    case "incorrect-lyrics":
      return target ? `Should be ${target}` : "Should be ``";
    case "incorrect-segmentation":
      return segmentation ? `Should be \`${segmentation}\`` : "Should be ``";
    case "sync-start-early":
      return target ? `Sync starts too early on ${target}` : "Sync starts too early on ";
    case "sync-start-late":
      return target ? `Sync starts too late on ${target}` : "Sync starts too late on ";
    case "sync-end-early":
      return target ? `Sync ends too early on ${target}` : "Sync ends too early on ";
    case "sync-end-late":
      return target ? `Sync ends too late on ${target}` : "Sync ends too late on ";
    case "vocal-type":
      return "Incorrect vocal type: should be background vocal";
    case "formatting":
      return "";
    case "general":
      return "";
  }
}

export function getIssueTypeInfo(id: IssueType): IssueTypeInfo {
  return ISSUE_TYPES.find((t) => t.id === id) ?? ISSUE_TYPES[ISSUE_TYPES.length - 1];
}

export type AnnotationGranularity = "syllable" | "word" | "line";

export interface Annotation {
  id: string;
  trackUri: string;
  timestampMs: number | null;
  timestampLabel: string;
  quotedLine: string;
  plainLine: string;
  selectedText?: string;
  granularity?: AnnotationGranularity;
  issueType: IssueType;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface TrackReviewState {
  trackUri: string;
  completed: boolean;
  completedAt: number | null;
}
