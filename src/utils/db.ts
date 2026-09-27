import { openDB } from "idb";
import Logger from "./Logger";

const dbLogger = new Logger("Database");

export const ObjectStores = {
  LyricsStore: "lyricsStore",
  ReviewerAnnotations: "reviewerAnnotations",
  ReviewerReviews: "reviewerReviews",
}

export const dbPromise = openDB("spicylyrics", 2, {
  upgrade(db, oldVersion) {
    dbLogger.debug("Upgrade invoked", { oldVersion });
    if (!db.objectStoreNames.contains(ObjectStores.LyricsStore)) {
      db.createObjectStore(ObjectStores.LyricsStore);
      dbLogger.debug("Created '", ObjectStores.LyricsStore, "' store");
    }

    if (!db.objectStoreNames.contains(ObjectStores.ReviewerAnnotations)) {
      const store = db.createObjectStore(ObjectStores.ReviewerAnnotations, { keyPath: "id" });
      store.createIndex("by-uri", "trackUri");
      dbLogger.debug("Created '", ObjectStores.ReviewerAnnotations, "' store");
    }

    if (!db.objectStoreNames.contains(ObjectStores.ReviewerReviews)) {
      db.createObjectStore(ObjectStores.ReviewerReviews, { keyPath: "trackUri" });
      dbLogger.debug("Created '", ObjectStores.ReviewerReviews, "' store");
    }
  },
});

export async function ensurePersistence() {
  try {
    if (await navigator.storage.persisted()) return true;

    const granted = await navigator.storage.persist();
    if (!granted) {
      dbLogger.warn("Data persistence request was denied; This can lead to potential data loss")
    } else {
      dbLogger.debug("Data persistence request was accepted")
    }
    return granted;
  } catch (e) {
    dbLogger.warn("Persistence check failed", e);
    return false;
  }
}
