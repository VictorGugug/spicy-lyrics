import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../../components/Modal.ts";
import ReviewPanel from "../../components/ReactComponents/ReviewerMode/ReviewPanel.tsx";
import { GetCurrentTrackMeta } from "./Selection.ts";
import { $reviewerTrackCompleted } from "./state.ts";
import { toast } from "sonner";

export function OpenReviewerPanel(): void {
  const track = GetCurrentTrackMeta();
  if (!track.uri) {
    toast.error("Nothing is playing right now");
    return;
  }

  const container = document.createElement("div");
  const root = ReactDOM.createRoot(container);

  flushSync(() => {
    root.render(
      <ReviewPanel
        track={track}
        initialCompleted={$reviewerTrackCompleted.get()}
        onClose={() => PopupModal.hide()}
      />
    );
  });

  PopupModal.display({
    title: "Lyrics Review",
    content: container,
    isLarge: true,
    modalId: "reviewer-mode",
    onClose: () => root.unmount(),
  });
}
