import { atom } from "nanostores";
import { dbPromise, ObjectStores } from "../db.ts";
import Logger from "../Logger.ts";
import { $currentLyricsData, $currentLyricsType } from "../stores.ts";
import { getIssueTypeInfo, type Annotation, type IssueType, type TrackReviewState } from "./types.ts";

const reviewerLogger = new Logger("Reviewer Mode");

export const $reviewerModeActive = atom<boolean>(false);
export const $reviewerAnnotationCount = atom<number>(0);
export const $reviewerTrackCompleted = atom<boolean>(false);

const annotationsCache = new Map<string, Annotation[]>();
let currentTrackUri: string | null = null;

type AnnotationsChangeListener = () => void;
const changeListeners: AnnotationsChangeListener[] = [];

export function OnAnnotationsChanged(cb: AnnotationsChangeListener): void {
  changeListeners.push(cb);
}

function notifyAnnotationsChanged(): void {
  changeListeners.forEach((cb) => {
    try {
      cb();
    } catch (err) {
      reviewerLogger.error("Error in annotations change listener", err);
    }
  });
}

export function GetCachedAnnotation(id: string, trackUri: string): Annotation | undefined {
  const list = annotationsCache.get(trackUri);
  return list?.find((a) => a.id === id);
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

async function readAllForUri(uri: string): Promise<Annotation[]> {
  try {
    const db = await dbPromise;
    const all = (await db.getAllFromIndex(
      ObjectStores.ReviewerAnnotations,
      "by-uri",
      uri
    )) as Annotation[];
    const sorted = all.sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0) || a.createdAt - b.createdAt);
    const seen = new Set<string>();
    const deduplicated: Annotation[] = [];
    for (const item of sorted) {
      const key = `${item.timestampLabel}|${item.quotedLine.trim()}|${item.issueType}`;
      if (seen.has(key)) {
        try {
          db.delete(ObjectStores.ReviewerAnnotations, item.id);
        } catch {}
      } else {
        seen.add(key);
        deduplicated.push(item);
      }
    }
    return deduplicated;
  } catch (err) {
    reviewerLogger.error("Failed to read annotations", err);
    return [];
  }
}

async function readReviewState(uri: string): Promise<TrackReviewState | null> {
  try {
    const db = await dbPromise;
    const rec = (await db.get(ObjectStores.ReviewerReviews, uri)) as TrackReviewState | undefined;
    return rec ?? null;
  } catch (err) {
    reviewerLogger.error("Failed to read review state", err);
    return null;
  }
}

export interface LyricsSyncInfo {
  isAvailable: boolean;
  isSynced: boolean;
  isPublished: boolean;
  syncType: "Syllable" | "Line" | "Static" | "None";
  syncLabel: string;
  provider: "Spotify" | "Spicy Lyrics" | "Apple Music" | "Local DB" | "Published source" | "Unknown";
  hasCommunityCredits: boolean;
  maker?: string;
  uploader?: string;
}

export function GetTrackLyricsSyncInfo(uri?: string | null): LyricsSyncInfo {
  const currentUri = uri ?? currentTrackUri;
  const isReviewed = currentUri ? $reviewerTrackCompleted.get() : false;

  let raw = "";
  try {
    raw = $currentLyricsData.get();
  } catch {}

  const currentType = $currentLyricsType.get();

  if (!raw || raw.startsWith("NO_LYRICS:")) {
    const isSynced = currentType === "Syllable" || currentType === "Line";
    return {
      isAvailable: isSynced || currentType === "Static",
      isSynced,
      isPublished: isSynced || isReviewed,
      syncType: isSynced ? (currentType as "Syllable" | "Line") : "None",
      syncLabel: isSynced ? `${currentType}-synced` : "No lyrics",
      provider: isSynced ? "Published source" : "Unknown",
      hasCommunityCredits: false,
    };
  }

  try {
    const data = JSON.parse(raw);
    const type: "Syllable" | "Line" | "Static" | "None" =
      data.Type === "Syllable" || data.Type === "Line" || data.Type === "Static"
        ? data.Type
        : currentType === "Syllable" || currentType === "Line" || currentType === "Static"
          ? (currentType as any)
          : "None";

    const isSynced = type === "Syllable" || type === "Line";
    const src = typeof data.source === "string" ? data.source.toLowerCase() : "";

    let provider: LyricsSyncInfo["provider"] = "Published source";
    if (src.includes("spl")) provider = "Spicy Lyrics";
    else if (src.includes("spt")) provider = "Spotify";
    else if (src.includes("aml")) provider = "Apple Music";
    else if (src.includes("ldb")) provider = "Local DB";
    else if (isSynced) provider = "Published source";
    else provider = "Unknown";

    const hasCommunityCredits = Boolean(data.TTMLUploadMetadata || src === "spl");
    const maker =
      data.TTMLUploadMetadata?.Maker?.username ||
      data.TTMLUploadMetadata?.Maker?.name ||
      (typeof data.TTMLUploadMetadata?.Maker === "string" ? data.TTMLUploadMetadata.Maker : undefined);
    const uploader =
      data.TTMLUploadMetadata?.Uploader?.username ||
      data.TTMLUploadMetadata?.Uploader?.name ||
      (typeof data.TTMLUploadMetadata?.Uploader === "string" ? data.TTMLUploadMetadata.Uploader : undefined);

    let finalMaker = maker;
    let finalUploader = uploader;
    if (!finalMaker || !finalUploader) {
      try {
        const domMaker = document
          .querySelector("#SpicyLyricsPage .LyricsContainer .SongInfo .Maker .song-info-profile-section")
          ?.textContent?.replace(/^@/, "")
          .trim();
        const domUploader = document
          .querySelector("#SpicyLyricsPage .LyricsContainer .SongInfo .Uploader .song-info-profile-section")
          ?.textContent?.replace(/^@/, "")
          .trim();
        if (!finalMaker && domMaker) finalMaker = domMaker;
        if (!finalUploader && domUploader) finalUploader = domUploader;
      } catch {}
    }

    const isPublished =
      isReviewed ||
      isSynced ||
      provider === "Spotify" ||
      provider === "Spicy Lyrics" ||
      provider === "Apple Music" ||
      Boolean(data.uri && provider !== "Local DB");

    const syncLabel = isSynced ? `${type}-synced` : type === "Static" ? "Unsynced" : "No lyrics";

    return {
      isAvailable: type !== "None",
      isSynced,
      isPublished,
      syncType: type,
      syncLabel,
      provider,
      hasCommunityCredits,
      maker: finalMaker,
      uploader: finalUploader,
    };
  } catch (err) {
    reviewerLogger.error("Failed to parse sync info from current lyrics data", err);
    return {
      isAvailable: false,
      isSynced: false,
      isPublished: isReviewed,
      syncType: "None",
      syncLabel: "No lyrics",
      provider: "Unknown",
      hasCommunityCredits: false,
    };
  }
}

export function IsTrackLyricsCompleted(uri?: string | null): boolean {
  if (!uri || uri === currentTrackUri) {
    if ($reviewerTrackCompleted.get()) return true;
  }
  const info = GetTrackLyricsSyncInfo(uri);
  return info.isPublished;
}

export async function SetActiveTrack(uri: string | null): Promise<void> {
  currentTrackUri = uri;
  if (!uri) {
    $reviewerAnnotationCount.set(0);
    $reviewerTrackCompleted.set(false);
    notifyAnnotationsChanged();
    return;
  }

  const [annotations, review] = await Promise.all([GetAnnotations(uri), readReviewState(uri)]);

  if (currentTrackUri !== uri) return;

  const completed = review?.completed ?? false;

  $reviewerAnnotationCount.set(annotations.length);
  $reviewerTrackCompleted.set(completed);
  notifyAnnotationsChanged();
}

export async function GetAnnotations(uri: string): Promise<Annotation[]> {
  const cached = annotationsCache.get(uri);
  if (cached) return cached;
  const fromDb = await readAllForUri(uri);
  annotationsCache.set(uri, fromDb);
  return fromDb;
}

async function refreshCurrentTrackCount(uri: string): Promise<void> {
  if (currentTrackUri !== uri) return;
  const annotations = await GetAnnotations(uri);
  $reviewerAnnotationCount.set(annotations.length);
}

export interface CreateAnnotationInput {
  trackUri: string;
  timestampMs: number | null;
  timestampLabel: string;
  quotedLine: string;
  plainLine: string;
  selectedText?: string;
  granularity?: "syllable" | "word" | "line";
  issueType: IssueType;
  note: string;
}

export async function AddAnnotation(input: CreateAnnotationInput): Promise<Annotation> {
  const now = Date.now();
  const annotation: Annotation = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    ...input,
  };

  try {
    const db = await dbPromise;
    await db.put(ObjectStores.ReviewerAnnotations, annotation);
  } catch (err) {
    reviewerLogger.error("Failed to save annotation", err);
  }

  annotationsCache.delete(input.trackUri);
  await refreshCurrentTrackCount(input.trackUri);
  notifyAnnotationsChanged();
  return annotation;
}

export async function UpdateAnnotation(
  id: string,
  trackUri: string,
  patch: Partial<Pick<Annotation, "issueType" | "note" | "quotedLine">>
): Promise<void> {
  try {
    const db = await dbPromise;
    const existing = (await db.get(ObjectStores.ReviewerAnnotations, id)) as Annotation | undefined;
    if (!existing) {
      reviewerLogger.warn("Annotation not found for update", { id });
      return;
    }
    const updated: Annotation = { ...existing, ...patch, updatedAt: Date.now() };
    await db.put(ObjectStores.ReviewerAnnotations, updated);
  } catch (err) {
    reviewerLogger.error("Failed to update annotation", err);
  }
  annotationsCache.delete(trackUri);
  await refreshCurrentTrackCount(trackUri);
  notifyAnnotationsChanged();
}

export async function DeleteAnnotation(id: string, trackUri: string): Promise<void> {
  try {
    const db = await dbPromise;
    await db.delete(ObjectStores.ReviewerAnnotations, id);
  } catch (err) {
    reviewerLogger.error("Failed to delete annotation", err);
  }
  annotationsCache.delete(trackUri);
  await refreshCurrentTrackCount(trackUri);
  notifyAnnotationsChanged();
}

export async function SetTrackCompleted(uri: string, completed: boolean): Promise<void> {
  try {
    const db = await dbPromise;
    const record: TrackReviewState = {
      trackUri: uri,
      completed,
      completedAt: completed ? Date.now() : null,
    };
    await db.put(ObjectStores.ReviewerReviews, record);
  } catch (err) {
    reviewerLogger.error("Failed to save review state", err);
  }
  if (currentTrackUri === uri) $reviewerTrackCompleted.set(completed);
}

export async function ClearTrackReview(uri: string): Promise<void> {
  try {
    const db = await dbPromise;
    const all = (await db.getAllFromIndex(
      ObjectStores.ReviewerAnnotations,
      "by-uri",
      uri
    )) as Annotation[];
    const tx = db.transaction([ObjectStores.ReviewerAnnotations, ObjectStores.ReviewerReviews], "readwrite");
    for (const a of all) {
      tx.objectStore(ObjectStores.ReviewerAnnotations).delete(a.id);
    }
    tx.objectStore(ObjectStores.ReviewerReviews).delete(uri);
    await tx.done;
  } catch (err) {
    reviewerLogger.error("Failed to clear track review", err);
  }
  annotationsCache.delete(uri);
  if (currentTrackUri === uri) {
    $reviewerAnnotationCount.set(0);
    $reviewerTrackCompleted.set(false);
  }
  notifyAnnotationsChanged();
}

export async function ClearAllReviewerStorage(): Promise<void> {
  try {
    const db = await dbPromise;
    const tx = db.transaction([ObjectStores.ReviewerAnnotations, ObjectStores.ReviewerReviews], "readwrite");
    tx.objectStore(ObjectStores.ReviewerAnnotations).clear();
    tx.objectStore(ObjectStores.ReviewerReviews).clear();
    await tx.done;
  } catch (err) {
    reviewerLogger.error("Failed to clear all reviewer storage", err);
  }
  annotationsCache.clear();
  $reviewerAnnotationCount.set(0);
  $reviewerTrackCompleted.set(false);
  notifyAnnotationsChanged();
}

function escapeMd(text: string): string {
  return text.replace(/([`*])/g, "\\$1");
}

export function BuildAnnotationMarkdown(annotation: Annotation): string {
  const info = getIssueTypeInfo(annotation.issueType);
  const noteBody = annotation.note.trim();
  const lines = [`> ${annotation.timestampLabel} ${annotation.quotedLine}`, ""];
  if (noteBody) {
    lines.push(noteBody);
  } else {
    lines.push(`*${info.label}*`);
  }
  lines.push("");
  return lines.join("\n");
}

export interface TrackMeta {
  name: string;
  artists: string;
  uri: string;
  durationMs?: number;
}

export function BuildReviewMarkdown(
  annotations: Annotation[],
  track: TrackMeta,
  completed: boolean = false
): string {
  const syncInfo = GetTrackLyricsSyncInfo(track.uri);
  const durationStr =
    typeof track.durationMs === "number" && track.durationMs > 0
      ? ` (${Math.floor(track.durationMs / 60000)}:${(Math.floor((track.durationMs % 60000) / 1000)).toString().padStart(2, "0")})`
      : "";
  const header: string[] = [
    `# Lyrics Review: ${escapeMd(track.name)}`,
    `**Artist:** ${escapeMd(track.artists)}${durationStr}`,
    `**Sync Status:** ${syncInfo.syncLabel} (${syncInfo.provider})`,
    `**Review Status:** ${completed ? "Review completed" : syncInfo.isPublished ? "Published (in review)" : "In progress"}`,
  ];

  const makerName = syncInfo.maker ? (syncInfo.maker.startsWith("@") ? syncInfo.maker : `@${syncInfo.maker}`) : null;
  const uploaderName = syncInfo.uploader ? (syncInfo.uploader.startsWith("@") ? syncInfo.uploader : `@${syncInfo.uploader}`) : null;

  if (makerName && uploaderName) {
    if (makerName === uploaderName) {
      header.push(`**Made & Published by:** ${makerName}`);
    } else {
      header.push(`**Made by:** ${makerName}`);
      header.push(`**Published by:** ${uploaderName}`);
    }
  } else if (makerName) {
    header.push(`**Made by:** ${makerName}`);
  } else if (uploaderName) {
    header.push(`**Published by:** ${uploaderName}`);
  } else if (syncInfo.provider && syncInfo.provider !== "Unknown") {
    header.push(`**Published by:** ${syncInfo.provider}`);
  }

  header.push("");
  header.push("-----");
  header.push("");
  header.push("> Note: This can be deleted if desired. Feel free to edit or remove any part of this review.");
  header.push("");

  if (annotations.length === 0) {
    return [...header, "_No issues found: lyrics look correct._", ""].join("\n");
  }

  const sorted = [...annotations].sort(
    (a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0) || a.createdAt - b.createdAt
  );

  const body = sorted.map(BuildAnnotationMarkdown);

  return [
    ...header,
    `**Total Annotations:** ${annotations.length}`,
    "",
    ...body,
  ].join("\n");
}

export async function ExportTrackMarkdown(uri: string, track: TrackMeta): Promise<string> {
  const [annotations, review] = await Promise.all([GetAnnotations(uri), readReviewState(uri)]);
  return BuildReviewMarkdown(annotations, track, review?.completed ?? false);
}
